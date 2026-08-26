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

const opened: { close(): void }[] = [];

async function seeded(): Promise<StationStore> {
  const store = await openStore();
  opened.push(store);
  await store.putBootstrap({
    people: [ALICE, BOB],
    credentials: [
      { token: "11111111111111", netid: "aa1111" },
      { token: "22222222222222", netid: "bb2222" },
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

const mount = (store: StationStore, api: StationApi, now = DURING_LUNCH) =>
  render(
    <StationScreen
      store={store}
      api={api}
      deviceToken="tok"
      now={() => now}
      holdMs={HOLD_MS}
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

    await scan("11111111111111");

    expect(await screen.findByTestId("name")).toHaveTextContent("Alice Anderson");
    expect(screen.getByTestId("checked-in")).toHaveTextContent("Checked in for lunch");
  });

  it("shows initials when there is no headshot", async () => {
    // Open question O5 — photos may not arrive before go-live.
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await scan("11111111111111");

    expect(await screen.findByTestId("avatar-initials")).toHaveTextContent("AA");
  });

  it("returns to idle after the hold expires", async () => {
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await scan("11111111111111");
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

    await scan("11111111111111");
    expect(await screen.findByTestId("name")).toHaveTextContent("Alice Anderson");

    await scan("22222222222222");

    await waitFor(() =>
      expect(screen.getByTestId("name")).toHaveTextContent("Bob Brown"),
    );
    expect(screen.queryByText("Alice Anderson")).not.toBeInTheDocument();
  });

  it("says no meal is running outside every window", async () => {
    mount(await seeded(), fakeApi(), BETWEEN_MEALS);
    await screen.findByTestId("idle");

    await scan("11111111111111");

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

    await scan("11111111111111");

    await waitFor(() =>
      expect(screen.getByTestId("unsynced")).toHaveTextContent("1 waiting to sync"),
    );
  });

  it("offers the member-or-guest prompt for an unknown card", async () => {
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await scan("99999999999999");

    expect(await screen.findByTestId("prompt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Member" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guest" })).toBeInTheDocument();
  });

  it("holds the prompt open rather than timing it out under someone", async () => {
    // A result clears after the hold; a question waits for an answer.
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await scan("99999999999999");
    await screen.findByTestId("prompt");

    await new Promise((resolve) => setTimeout(resolve, HOLD_MS * 4));

    expect(screen.getByTestId("prompt")).toBeInTheDocument();
  });

  it("CHECKS SOMEONE IN FROM THE TYPED BOX, with no reader involved", async () => {
    // The whole point: the club can serve a meal with a broken scanner, and
    // the developer can test without hardware.
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    await userEvent.type(screen.getByLabelText("Enter an ID by hand"), "11111111111111");
    await userEvent.click(screen.getByRole("button", { name: "Enter" }));

    expect(await screen.findByTestId("name")).toHaveTextContent("Alice Anderson");
  });

  it("records a typed entry as manual, not as a scan", async () => {
    const store = await seeded();
    mount(store, fakeApi({ sync: vi.fn().mockResolvedValue({ ok: false, status: null }) } as Partial<StationApi>));
    await screen.findByTestId("idle");

    await userEvent.type(screen.getByLabelText("Enter an ID by hand"), "11111111111111");
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

    await userEvent.type(screen.getByLabelText("Enter an ID by hand"), "22222222222222");

    expect(screen.queryByTestId("name")).not.toBeInTheDocument();
    expect(await store.outboxSize()).toBe(0);
  });

  it("clears the box after a successful entry", async () => {
    mount(await seeded(), fakeApi());
    await screen.findByTestId("idle");

    const box = screen.getByLabelText("Enter an ID by hand");
    await userEvent.type(box, "11111111111111");
    await userEvent.click(screen.getByRole("button", { name: "Enter" }));
    await screen.findByTestId("name");

    await waitFor(() => expect(screen.getByLabelText("Enter an ID by hand")).toHaveValue(""));
  });

  it("reports failure explicitly rather than showing a blank screen", async () => {
    mount(await seeded(), fakeApi({
      resolve: vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    } as Partial<StationApi>));
    await screen.findByTestId("idle");

    await scan("99999999999999");

    expect(await screen.findByTestId("failed")).toHaveTextContent("not counted");
  });
});
