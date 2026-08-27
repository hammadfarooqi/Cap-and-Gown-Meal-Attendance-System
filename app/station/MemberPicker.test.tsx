import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemberPicker } from "./MemberPicker";
import type { CachedPerson } from "@/lib/station/store";

const person = (netid: string, fullName: string): CachedPerson => ({
  netid, fullName, isMember: true, homeClub: "Cap & Gown", photoPath: null,
});

const ALL = [
  person("aa1111", "Alice Anderson"),
  person("bb2222", "Bob Brown"),
  person("cc3333", "Carol Chen"),
];
const UNBOUND = [ALL[0], ALL[2]];

describe("MemberPicker", () => {
  it("shows only unbound members before anyone searches", async () => {
    render(<MemberPicker all={ALL} unbound={UNBOUND} onPick={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText("Alice Anderson")).toBeInTheDocument();
    expect(screen.getByText("Carol Chen")).toBeInTheDocument();
    expect(screen.queryByText("Bob Brown")).not.toBeInTheDocument();
  });

  it("FINDS AN ALREADY-BOUND MEMBER by search", async () => {
    // Someone who lost their card and has a replacement. Without this they
    // are unreachable and would be forced through the guest flow.
    render(<MemberPicker all={ALL} unbound={UNBOUND} onPick={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Search members"), "Bob");

    expect(screen.getByText("Bob Brown")).toBeInTheDocument();
  });

  it("searches case-insensitively", async () => {
    render(<MemberPicker all={ALL} unbound={UNBOUND} onPick={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Search members"), "aLiCe");

    expect(screen.getByText("Alice Anderson")).toBeInTheDocument();
  });

  it("searches by netID as well as name", async () => {
    render(<MemberPicker all={ALL} unbound={UNBOUND} onPick={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Search members"), "bb2222");

    expect(screen.getByText("Bob Brown")).toBeInTheDocument();
  });

  it("hands back the netID, not the display name", async () => {
    const onPick = vi.fn();
    render(<MemberPicker all={ALL} unbound={UNBOUND} onPick={onPick} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByText("Alice Anderson"));

    expect(onPick).toHaveBeenCalledWith("aa1111");
  });

  it("OFFERS THE PERSON THE CARD NAMES, before any searching", async () => {
    // A TigerCard carries its holder's name. On the first day that turns
    // "search 196 names during a rush" into "confirm the one on screen".
    render(
      <MemberPicker
        all={ALL}
        unbound={UNBOUND}
        nameHint={["ALICE", "ANDERSON"]}
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const suggested = screen.getAllByTestId("suggested-member");
    expect(suggested).toHaveLength(1);
    expect(suggested[0]).toHaveTextContent("Alice Anderson");
    expect(screen.getByText(/the card says alice anderson/i)).toBeInTheDocument();
  });

  it("suggests an ALREADY-BOUND member too, for a replacement card", async () => {
    render(
      <MemberPicker
        all={ALL}
        unbound={UNBOUND}
        nameHint={["BOB", "BROWN"]}
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId("suggested-member")).toHaveTextContent("Bob Brown");
  });

  it("suggests nobody when the card carried no name", () => {
    render(<MemberPicker all={ALL} unbound={UNBOUND} onPick={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByTestId("suggested-member")).not.toBeInTheDocument();
  });

  it("suggests nobody when the name matches no member", () => {
    render(
      <MemberPicker
        all={ALL}
        unbound={UNBOUND}
        nameHint={["NOBODY", "HERE"]}
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("suggested-member")).not.toBeInTheDocument();
  });

  it("hands back the netID from a suggestion", async () => {
    const onPick = vi.fn();
    render(
      <MemberPicker
        all={ALL}
        unbound={UNBOUND}
        nameHint={["ALICE", "ANDERSON"]}
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId("suggested-member"));
    expect(onPick).toHaveBeenCalledWith("aa1111");
  });

  it("says so when nothing matches", async () => {
    render(<MemberPicker all={ALL} unbound={UNBOUND} onPick={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Search members"), "zzzz");

    expect(screen.getByText(/no members match/i)).toBeInTheDocument();
  });
});
