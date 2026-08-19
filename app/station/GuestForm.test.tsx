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

    await userEvent.type(screen.getByLabelText("Guest netID"), "  HF4888 ");
    await userEvent.selectOptions(screen.getByLabelText("Home club"), "Cottage");
    await userEvent.click(screen.getByRole("button", { name: /check in/i }));

    expect(onSubmit).toHaveBeenCalledWith("hf4888", "Cottage");
  });

  it("labels 'None' as not being in a club, rather than as a club named None", async () => {
    render(<GuestForm clubs={CLUBS} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("option", { name: "Not in a club" })).toBeInTheDocument();
  });
});
