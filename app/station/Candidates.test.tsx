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
/** No headshots — still a real case for the nine members who have none. */
const noPhotos = { photos: [null, null] };

describe("Candidates", () => {
  it("SHOWS THE NETID, which is the only thing telling two identical names apart", () => {
    // No headshots are loaded, so both tiles fall back to initials — and two
    // people called Robin Hale have the same initials as well as the same
    // name. Without the netID this screen cannot be answered correctly.
    render(<Candidates people={SAME_NAME} {...noPhotos} {...noop} />);

    expect(screen.getByText("rh1000")).toBeInTheDocument();
    expect(screen.getByText("rh1001")).toBeInTheDocument();
  });

  it("hands back the netID that was tapped, not the name", async () => {
    const onPick = vi.fn();
    render(<Candidates people={SAME_NAME} {...noPhotos} {...noop} onPick={onPick} />);

    await userEvent.click(screen.getByRole("button", { name: /rh1001/ }));

    expect(onPick).toHaveBeenCalledWith("rh1001");
  });

  it("asks which one when there are several, and whether it is you when there is one", () => {
    const { unmount } = render(<Candidates people={SAME_NAME} {...noPhotos} {...noop} />);
    expect(screen.getByTestId("candidates")).toHaveTextContent(/which one/i);
    unmount();

    render(<Candidates people={ONE} {...noPhotos} {...noop} />);
    expect(screen.getByTestId("candidates")).toHaveTextContent(/is this you/i);
  });

  it("DOES NOT ASK \"IS THIS YOU?\" WHEN THERE IS NOBODY TO POINT AT", () => {
    // Found by rendering it and looking, not by a test: with no tiles the
    // screen read "Is this you?" above an empty space, which is a question
    // about nobody. The person swiping cannot tell what happened.
    render(<Candidates people={[]} {...noPhotos} {...noop} />);

    const heading = screen.getByTestId("candidates");
    expect(heading).not.toHaveTextContent(/is this you/i);
    expect(heading).toHaveTextContent(/scanned here before/i);
  });

  it("OFFERS THE GUEST ROUTE EVEN WITH NO TILES", async () => {
    // Zero candidates is the same screen, not a different one. A guest whose
    // name matches nobody lands here and must be able to keep moving.
    const onGuest = vi.fn();
    render(<Candidates people={[]} {...noPhotos} {...noop} onGuest={onGuest} />);

    await userEvent.click(screen.getByRole("button", { name: /guest/i }));

    expect(onGuest).toHaveBeenCalled();
  });

  it("does not say \"No\" when there was nothing to say no to", () => {
    // Same class as the heading: with no tiles, "No, I'm a guest" answers a
    // question that was never asked.
    render(<Candidates people={[]} {...noPhotos} {...noop} />);
    expect(screen.getByRole("button", { name: /guest/i })).toHaveTextContent(/^I.m a guest$/);

    render(<Candidates people={ONE} {...noPhotos} {...noop} />);
    expect(screen.getAllByRole("button", { name: /guest/i })[1]).toHaveTextContent(/^No, I.m a guest$/);
  });

  it("SHOWS A FACE WHEN THERE IS ONE, which is what separates two same names", () => {
    // The tile passed url={null} from the day it was written, because no
    // headshots existed then. They do now, and a photo is the difference
    // between recognising yourself and reading two netIDs.
    render(
      <Candidates
        people={SAME_NAME}
        photos={["blob:one", "blob:two"]}
        {...noop}
      />,
    );

    const photos = screen.getAllByTestId("avatar-photo");
    expect(photos).toHaveLength(2);
    expect(photos[0]).toHaveAttribute("src", "blob:one");
    expect(photos[1]).toHaveAttribute("src", "blob:two");
  });

  it("falls back to initials for somebody with no photo", () => {
    render(<Candidates people={SAME_NAME} photos={["blob:one", null]} {...noop} />);

    expect(screen.getAllByTestId("avatar-photo")).toHaveLength(1);
    expect(screen.getAllByTestId("avatar-initials")).toHaveLength(1);
  });

  it("tells a member who cannot see themselves where to go", () => {
    // The escape hatch for a card whose printed name does not match the
    // roster. Without this the screen is a dead end for them.
    render(<Candidates people={[]} {...noPhotos} {...noop} />);

    expect(screen.getByText(/officer or the business manager/i)).toBeInTheDocument();
  });


});
