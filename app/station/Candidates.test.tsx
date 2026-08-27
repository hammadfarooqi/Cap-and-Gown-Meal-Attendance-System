import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Candidates } from "./Candidates";
import type { CachedPerson } from "@/lib/station/store";

const person = (netid: string, fullName: string): CachedPerson => ({
  netid,
  fullName,
  isMember: true,
  homeClub: "Cap & Gown",
  photoPath: null,
});

/** Two people with one name, the way two real members have. */
const SAME_NAME = [person("rh1000", "Robin Hale"), person("rh1001", "Robin Hale")];
const ONE = [person("ab1234", "Alice Browning")];

const noop = { onPick: vi.fn(), onGuest: vi.fn(), onCancel: vi.fn() };

describe("Candidates", () => {
  it("SHOWS THE NETID, which is the only thing telling two identical names apart", () => {
    // No headshots are loaded, so both tiles fall back to initials — and two
    // people called Robin Hale have the same initials as well as the same
    // name. Without the netID this screen cannot be answered correctly.
    render(<Candidates people={SAME_NAME} {...noop} />);

    expect(screen.getByText("rh1000")).toBeInTheDocument();
    expect(screen.getByText("rh1001")).toBeInTheDocument();
  });

  it("hands back the netID that was tapped, not the name", async () => {
    const onPick = vi.fn();
    render(<Candidates people={SAME_NAME} {...noop} onPick={onPick} />);

    await userEvent.click(screen.getByRole("button", { name: /rh1001/ }));

    expect(onPick).toHaveBeenCalledWith("rh1001");
  });

  it("asks which one when there are several, and whether it is you when there is one", () => {
    const { unmount } = render(<Candidates people={SAME_NAME} {...noop} />);
    expect(screen.getByTestId("candidates")).toHaveTextContent(/which one/i);
    unmount();

    render(<Candidates people={ONE} {...noop} />);
    expect(screen.getByTestId("candidates")).toHaveTextContent(/is this you/i);
  });

  it("DOES NOT ASK \"IS THIS YOU?\" WHEN THERE IS NOBODY TO POINT AT", () => {
    // Found by rendering it and looking, not by a test: with no tiles the
    // screen read "Is this you?" above an empty space, which is a question
    // about nobody. The person swiping cannot tell what happened.
    render(<Candidates people={[]} {...noop} />);

    const heading = screen.getByTestId("candidates");
    expect(heading).not.toHaveTextContent(/is this you/i);
    expect(heading).toHaveTextContent(/do not recognise/i);
  });

  it("OFFERS THE GUEST ROUTE EVEN WITH NO TILES", async () => {
    // Zero candidates is the same screen, not a different one. A guest whose
    // name matches nobody lands here and must be able to keep moving.
    const onGuest = vi.fn();
    render(<Candidates people={[]} {...noop} onGuest={onGuest} />);

    await userEvent.click(screen.getByRole("button", { name: /guest/i }));

    expect(onGuest).toHaveBeenCalled();
  });

  it("does not say \"No\" when there was nothing to say no to", () => {
    // Same class as the heading: with no tiles, "No, I'm a guest" answers a
    // question that was never asked.
    render(<Candidates people={[]} {...noop} />);
    expect(screen.getByRole("button", { name: /guest/i })).toHaveTextContent(/^I.m a guest$/);

    render(<Candidates people={ONE} {...noop} />);
    expect(screen.getAllByRole("button", { name: /guest/i })[1]).toHaveTextContent(/^No, I.m a guest$/);
  });

  it("tells a member who cannot see themselves where to go", () => {
    // The escape hatch for a card whose printed name does not match the
    // roster. Without this the screen is a dead end for them.
    render(<Candidates people={[]} {...noop} />);

    expect(screen.getByText(/officer or the business manager/i)).toBeInTheDocument();
  });

  it("RELEASES THE LANE eventually, so a walked-away swipe does not block it", async () => {
    // Short real duration, not fake timers: faking them freezes
    // fake-indexeddb, which resolves on real async scheduling.
    const onCancel = vi.fn();
    render(<Candidates people={ONE} {...noop} onCancel={onCancel} dismissMs={20} />);

    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it("does NOT release the lane while somebody is still reading it", async () => {
    // The result screens fall back to idle after 3 seconds. This one must
    // not, or the tablet clears itself while a person is choosing.
    const onCancel = vi.fn();
    render(<Candidates people={ONE} {...noop} onCancel={onCancel} dismissMs={10_000} />);

    await new Promise((r) => setTimeout(r, 30));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
