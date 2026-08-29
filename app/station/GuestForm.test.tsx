import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuestForm } from "./GuestForm";

const CLUBS = ["Cap & Gown", "Cottage", "None"];

describe("GuestForm", () => {
  it("rejects an obvious typo before it costs a round trip", async () => {
    const onSubmit = vi.fn();
    render(<GuestForm clubs={CLUBS} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Guest netID"), "not a netid");
    await userEvent.click(screen.getByRole("button", { name: /check in/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("submits a normalised netID and the chosen club", async () => {
    const onSubmit = vi.fn();
    render(<GuestForm clubs={CLUBS} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Guest netID"), "  AB1234 ");
    await userEvent.selectOptions(screen.getByLabelText("Your club"), "Cottage");
    await userEvent.click(screen.getByRole("button", { name: /check in/i }));

    expect(onSubmit).toHaveBeenCalledWith("ab1234", "Cottage");
  });

  it("PRE-FILLS THE NETID THEY JUST TYPED", async () => {
    // They typed it, were told we do not know them, and tapped "I'm a guest".
    // Asking for it a second time is asking the same question twice.
    render(<GuestForm clubs={CLUBS} initialNetid="ab1234" onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText("Guest netID")).toHaveValue("ab1234");
  });

  it("DOES NOT OFFER CAP & GOWN as a guest's club", async () => {
    // A guest of this club is by definition not in it. Offering it invites a
    // wrong answer that nothing downstream can catch.
    render(<GuestForm clubs={CLUBS} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).not.toContain("Cap & Gown");
    expect(options).toContain("Cottage");
  });

  it("REFUSES A NETID THAT IS NOT TWO LETTERS AND FOUR DIGITS", async () => {
    const onSubmit = vi.fn();
    render(<GuestForm clubs={CLUBS} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Guest netID"), "abc123");
    await userEvent.selectOptions(screen.getByLabelText("Your club"), "Cottage");
    await userEvent.click(screen.getByRole("button", { name: /check in/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("REFUSES TO SUBMIT UNTIL A CLUB IS CHOSEN", async () => {
    // It used to default to whichever club came first alphabetically, so a
    // careless submit filed the guest as a member of that club.
    const onSubmit = vi.fn();
    render(<GuestForm clubs={CLUBS} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Guest netID"), "ab1234");
    await userEvent.click(screen.getByRole("button", { name: /check in/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/choose a club/i);
  });

  it("PUTS 'Not in a club' LAST, not wherever None falls alphabetically", async () => {
    render(<GuestForm clubs={CLUBS} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options[options.length - 1]).toBe("Not in a club");
  });

  it("labels 'None' as not being in a club, rather than as a club named None", async () => {
    render(<GuestForm clubs={CLUBS} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("option", { name: "Not in a club" })).toBeInTheDocument();
  });
});
