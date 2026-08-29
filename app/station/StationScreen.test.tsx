import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StationScreen } from "./StationScreen";
import { openStore, type StationStore, type CachedPerson } from "@/lib/station/store";
import type { StationApi } from "@/lib/station/api";
import type { MealWindow } from "@/lib/meals/types";

// Wednesday 2026-09-02, 12:00 New York.
const DURING_LUNCH = new Date("2026-09-02T16:00:00.000Z");
const BETWEEN_MEALS = new Date("2026-09-02T19:00:00.000Z");

const SCHEDULE: MealWindow[] = [
  { dayOfWeek: 3, periodName: "lunch", startTime: "11:30:00", endTime: "13:30:00", graceMinutes: 15 },
];

const ALICE: CachedPerson = {
  netid: "aa1111", fullName: "Alice Anderson", isMember: true,
  homeClub: "Cap & Gown", photoPath: null,
};
const BOB: CachedPerson = {
  netid: "bb2222", fullName: "Bob Brown", isMember: true,
  homeClub: "Cap & Gown", photoPath: null,
};

/**
 * Real stripe shapes, not bare numbers.
 *
 * The parser only treats a burst as a card when it carries track sentinels;
 * anything else is a typed identifier and takes the netID path instead.
 */
const ALICE_CARD = "%111111111111111=ALICE/ANDERSON?;1111111111111118700=?";
const BOB_CARD = "%222222222222222=BOB/BROWN?;2222222222222228700=?";
/** A card nobody on the roster is named on. */
const UNKNOWN_CARD = "%999999999999999=JOHN/SMITH?;9999999999999998700=?";
/** Carol is on the roster with no card yet — the go-live case. */
const CAROL_CARD = "%333333333333333=CAROL/CLARK?;3333333333333338700=?";

const CAROL: CachedPerson = {
  netid: "cc3333", fullName: "Carol Clark", isMember: true,
  homeClub: "Cap & Gown", photoPath: null,
};

const opened: { close(): void }[] = [];

async function seeded(): Promise<StationStore> {
  const store = await openStore();
  opened.push(store);
  await store.putBootstrap({
    people: [ALICE, BOB, CAROL],
    credentials: [
      { token: "111111111111111", netid: "aa1111" },
      { token: "222222222222222", netid: "bb2222" },
    ],
    schedule: SCHEDULE,
    clubs: ["Cap & Gown", "Cottage", "None"],
    versions: { roster: 1, schedule: 1 },
  });
  return store;
}

function fakeApi(over: Partial<StationApi> = {}): StationApi {
  return {
    bootstrap: vi.fn(),
    resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    bind: vi.fn(),
    // Default: the directory could not be asked, so nobody is refused.
    directory: vi.fn().mockResolvedValue({ ok: false, status: null }),
    createGuest: vi.fn(),
    sync: vi.fn().mockResolvedValue({ ok: true, data: { accepted: 1, skipped: 0 }, versions: { roster: 1, schedule: 1 } }),
    ...over,
  } as unknown as StationApi;
}

/** Type a card at reader speed into the document, ending with Enter. */
async function scan(card: string) {
  await act(async () => {
    for (const ch of card) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

/**
 * A short hold instead of fake timers. Faking setTimeout freezes
 * fake-indexeddb, which resolves on real async scheduling, so every database
 * call inside the component hangs and the test times out rather than failing.
 */
const HOLD_MS = 60;
const TAKEOVER_MS = 300;

const mount = (store: StationStore, api: StationApi, now = DURING_LUNCH) =>
  render(
    <StationScreen
      store={store}
      api={api}
      deviceToken="tok"
      now={() => now}
      holdMs={HOLD_MS}
      takeoverMs={TAKEOVER_MS}
      skipWarm
    />,
  );

afterEach(async () => {
  for (const store of opened) store.close();
  opened.length = 0;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("cap-station");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("StationScreen", () => {
  it("checks a known card in and shows the person's name", async () => {
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await scan(ALICE_CARD);

    expect(await screen.findByTestId("name")).toHaveTextContent("Alice Anderson");
    expect(screen.getByTestId("checked-in")).toHaveTextContent("Checked in for lunch");
  });

  it("shows initials when there is no headshot", async () => {
    // Open question O5 — photos may not arrive before go-live.
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await scan(ALICE_CARD);

    expect(await screen.findByTestId("avatar-initials")).toHaveTextContent("AA");
  });

  it("returns to idle after the hold expires", async () => {
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await scan(ALICE_CARD);
    await screen.findByTestId("name");

    await waitFor(() => expect(screen.getByTestId("idle")).toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it("REPLACES the previous person's face immediately on the next scan", async () => {
    // The privacy reason the hold timer exists at all: the next student in
    // line must not stand in front of someone else's name and photo.
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await scan(ALICE_CARD);
    expect(await screen.findByTestId("name")).toHaveTextContent("Alice Anderson");

    await scan(BOB_CARD);

    await waitFor(() =>
      expect(screen.getByTestId("name")).toHaveTextContent("Bob Brown"),
    );
    expect(screen.queryByText("Alice Anderson")).not.toBeInTheDocument();
  });

  it("says no meal is running outside every window", async () => {
    mount(await seeded(), fakeApi(), BETWEEN_MEALS);
    await screen.findByTestId("idle");

    await scan(ALICE_CARD);

    expect(await screen.findByTestId("no-meal")).toBeInTheDocument();
  });

  it("shows the current meal name while idle", async () => {
    mount(await seeded(), fakeApi());

    expect(await screen.findByTestId("meal-name")).toHaveTextContent("lunch");
  });

  it("shows how many swipes are waiting to sync", async () => {
    const store = await seeded();
    // The API refuses, so nothing drains.
    mount(store, fakeApi({ sync: vi.fn().mockResolvedValue({ ok: false, status: null }) } as Partial<StationApi>));
    await screen.findByTestId("idle");

    await scan(ALICE_CARD);

    await waitFor(() =>
      expect(screen.getByTestId("unsynced")).toHaveTextContent("1 waiting to sync"),
    );
  });

  it("GOES STRAIGHT TO THE FORM when the card matches nobody", async () => {
    // The tile screen would be a question with no answers on it.
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await scan(UNKNOWN_CARD);

    expect(await screen.findByLabelText("Guest netID")).toBeInTheDocument();
    expect(screen.queryByTestId("candidates")).not.toBeInTheDocument();
  });

  it("PRE-FILLS THE NAME OFF THE CARD, so nothing is retyped", async () => {
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await scan(UNKNOWN_CARD);

    expect(await screen.findByLabelText("Name")).toHaveValue("John Smith");
  });

  it("BINDS ON THE FIRST SWIPE AND IS INSTANT ON THE SECOND", async () => {
    // The journey all 196 members take at go-live: one tap, once, ever.
    const store = await seeded();
    mount(store, fakeApi());
    await screen.findByTestId("idle");

    await scan(CAROL_CARD);
    await screen.findByTestId("candidates");
    await userEvent.click(screen.getByRole("button", { name: /cc3333/ }));
    expect(await screen.findByTestId("name")).toHaveTextContent("Carol Clark");

    await new Promise((resolve) => setTimeout(resolve, HOLD_MS * 2));
    await screen.findByTestId("idle");

    await scan(CAROL_CARD);
    expect(await screen.findByTestId("name")).toHaveTextContent("Carol Clark");
    expect(screen.queryByTestId("candidates")).not.toBeInTheDocument();
  });

  it("holds the question open rather than timing it out under someone", async () => {
    // A result clears after the hold; a question waits for an answer.
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await scan(CAROL_CARD);
    await screen.findByTestId("candidates");

    await new Promise((resolve) => setTimeout(resolve, HOLD_MS * 4));

    expect(screen.getByTestId("candidates")).toBeInTheDocument();
  });

  it("CHECKS SOMEONE IN FROM THE TYPED BOX, with no reader involved", async () => {
    // The whole point: the club can serve a meal with a broken scanner, and
    // the developer can test without hardware. The box takes a netID - the
    // person's identity - not a card number, so nothing gets bound.
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await userEvent.type(screen.getByLabelText("Type a netID"), "aa1111");
    await userEvent.click(screen.getByRole("button", { name: "Enter" }));

    expect(await screen.findByTestId("name")).toHaveTextContent("Alice Anderson");
  });

  it("records a typed entry as manual, not as a scan", async () => {
    const store = await seeded();
    mount(store, fakeApi({ sync: vi.fn().mockResolvedValue({ ok: false, status: null }) } as Partial<StationApi>));
    await screen.findByTestId("idle");

    await userEvent.type(screen.getByLabelText("Type a netID"), "aa1111");
    await userEvent.click(screen.getByRole("button", { name: "Enter" }));
    await screen.findByTestId("name");

    const [item] = await store.peekOutbox();
    expect(item.kind === "swipe" && item.entryMethod).toBe("manual");
  });

  it("does NOT fire a scan from ordinary typing in that box", async () => {
    // The burst detector watches the whole document. Human typing must fall
    // through it, or every keystroke in this box would be a card.
    const store = await seeded();
    const api = fakeApi();
    mount(store, api);
    await screen.findByTestId("idle");

    await userEvent.type(screen.getByLabelText("Type a netID"), "22222222222222");

    expect(screen.queryByTestId("name")).not.toBeInTheDocument();
    expect(await store.outboxSize()).toBe(0);
  });

  it("clears the box after a successful entry", async () => {
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    const box = screen.getByLabelText("Type a netID");
    await userEvent.type(box, "aa1111");
    await userEvent.click(screen.getByRole("button", { name: "Enter" }));
    await screen.findByTestId("name");

    await waitFor(() => expect(screen.getByLabelText("Type a netID")).toHaveValue(""));
  });

  it("reports failure explicitly rather than showing a blank screen", async () => {
    // A server fault, not a dead token — re-enrolling would not help.
    mount(await seeded(), fakeApi({
      resolve: vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    } as Partial<StationApi>));
    await screen.findByTestId("idle");

    await scan(UNKNOWN_CARD);

    expect(await screen.findByTestId("failed")).toHaveTextContent("not counted");
  });

  it("ASKS TO BE SET UP AGAIN when its token is dead, instead of blaming the network", async () => {
    // Reported from live testing: a stale token made every swipe say "could
    // not reach the server", sending staff to check Wi-Fi for a problem no
    // network can fix.
    const onUnenrolled = vi.fn();
    const store = await seeded();

    render(
      <StationScreen
        store={store}
        api={fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 401 }) } as Partial<StationApi>)}
        deviceToken="dead-token"
        now={() => DURING_LUNCH}
        holdMs={HOLD_MS}
        skipWarm
        onUnenrolled={onUnenrolled}
      />,
    );
    await screen.findByTestId("idle");

    await scan(UNKNOWN_CARD);

    await waitFor(() => expect(onUnenrolled).toHaveBeenCalledOnce());
    expect(screen.queryByTestId("failed")).not.toBeInTheDocument();
  });

  describe("the typed netID box", () => {
    it("REFUSES A MALFORMED NETID instead of offering the guest route", async () => {
      // zz99 cannot be anybody. Sending it onward finds nobody, offers "I'm a
      // guest", and invites a person to be created under an id that is not a
      // netID at all.
      mount(await seeded(), fakeApi());
      await screen.findByTestId("idle");

      await userEvent.type(screen.getByLabelText("Type a netID"), "zz99");
      expect(screen.getByRole("button", { name: "Enter" })).toBeDisabled();

      await userEvent.click(screen.getByRole("button", { name: "Enter" }));
      expect(screen.queryByTestId("candidates")).not.toBeInTheDocument();
    });

    it("accepts a well-formed one", async () => {
      mount(await seeded(), fakeApi());
      await screen.findByTestId("idle");

      await userEvent.type(screen.getByLabelText("Type a netID"), "aa1111");
      expect(screen.getByRole("button", { name: "Enter" })).toBeEnabled();
    });
  });

  describe("the waiting-to-sync count", () => {
    it("FALLS BACK TO ZERO once the flush that followed the scan finishes", async () => {
      // It used to be read while the flush was still in flight, so it showed
      // the backlog as of the instant of the scan and nothing ever corrected
      // it. The queue drained silently and the number sat there claiming a
      // backlog that had already cleared — which at a door reads as "sync is
      // broken" when sync is fine.
      mount(await seeded(), fakeApi());
      await screen.findByTestId("idle");

      await scan(ALICE_CARD);
      await screen.findByTestId("name");

      await waitFor(() =>
        expect(screen.queryByTestId("unsynced")).not.toBeInTheDocument(),
      );
    });

    it("shows a real backlog when the server is not answering", async () => {
      const api = fakeApi({
        sync: vi.fn().mockResolvedValue({ ok: false, status: null }),
      } as Partial<StationApi>);
      mount(await seeded(), api);
      await screen.findByTestId("idle");

      await scan(ALICE_CARD);
      await screen.findByTestId("name");

      expect(await screen.findByTestId("unsynced")).toHaveTextContent("1 waiting to sync");
    });
  });

  describe("what replaces the lane and what sits under it", () => {
    it("KEEPS THE LANE LIVE UNDER A CHECK-IN, so the next person can swipe", async () => {
      // The point of the whole layout: a result is a notice, not a takeover.
      // The queue must not wait three seconds for the screen to clear.
      mount(await seeded(), fakeApi());
      await screen.findByTestId("idle");

      await scan(ALICE_CARD);
      await screen.findByTestId("name");

      expect(screen.getByTestId("idle")).toBeInTheDocument();
      expect(screen.getByLabelText("Type a netID")).toBeInTheDocument();
    });

    it("TAKES THE LANE for a question, because it is waiting on a person", async () => {
      mount(await seeded(), fakeApi());
      await screen.findByTestId("idle");

      await scan(CAROL_CARD);
      await screen.findByTestId("candidates");

      expect(screen.queryByTestId("idle")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Type a netID")).not.toBeInTheDocument();
    });

    it("lets the NEXT SCAN take over a question nobody answered", async () => {
      // Somebody walks off mid-decision. The lane must never jam behind them.
      mount(await seeded(), fakeApi());
      await screen.findByTestId("idle");

      await scan(CAROL_CARD);
      await screen.findByTestId("candidates");

      await scan(ALICE_CARD);

      expect(await screen.findByTestId("name")).toHaveTextContent("Alice Anderson");
      expect(screen.queryByTestId("candidates")).not.toBeInTheDocument();
    });

    it("gives up on an unanswered question and gives the lane back", async () => {
      mount(await seeded(), fakeApi());
      await screen.findByTestId("idle");

      await scan(CAROL_CARD);
      await screen.findByTestId("candidates");

      await waitFor(() => expect(screen.getByTestId("idle")).toBeInTheDocument(), {
        timeout: TAKEOVER_MS * 4,
      });
    });

    it("HOLDS THE OFFICER MESSAGE LONGER than an ordinary notice", async () => {
      // It asks nothing at the tablet, so it is a notice — but it is an
      // instruction somebody has to read, and three seconds does not do that.
      const store = await seeded();
      mount(store, fakeApi({
        createGuest: vi.fn().mockResolvedValue({ ok: false, status: 409 }),
      } as Partial<StationApi>));
      await screen.findByTestId("idle");

      await scan(UNKNOWN_CARD);
      await userEvent.type(await screen.findByLabelText("Guest netID"), "gg9999");
      await userEvent.selectOptions(screen.getByLabelText("Your club"), "Cottage");
      await userEvent.click(screen.getByRole("button", { name: /check in/i }));

      await screen.findByTestId("already-bound");

      // An ordinary notice would be gone by now.
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS * 4));
      expect(screen.getByTestId("already-bound")).toBeInTheDocument();
    });
  });
});
