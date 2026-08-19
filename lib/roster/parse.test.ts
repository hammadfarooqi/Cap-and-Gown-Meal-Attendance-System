import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv-parse";
import { parseRoster } from "./parse";

/** The club's real shape: a group header row, then Name/Email pairs. */
const CLUB_FORMAT = [
  "Juniors (2028),,Seniors (2027),",
  "Name,Email Address,Name,Email Address",
  "Abigail Jung,aj3691@princeton.edu,Aaliyah Sayed,as6787@princeton.edu",
  "Adam Moussa,am5109@princeton.edu,Abhi Bansal,ab4386@princeton.edu",
  "Zoe Nadal,zn0242@princeton.edu,,",
].join("\n");

describe("parseCsv", () => {
  it("reads a plain grid", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("handles CRLF, which Excel on Windows emits", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("strips a UTF-8 byte-order mark", () => {
    // Without this the first header reads as "﻿Name" and never matches.
    expect(parseCsv("﻿Name,Email")[0][0]).toBe("Name");
  });

  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('"Smith, Jr",x')).toEqual([["Smith, Jr", "x"]]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('"Bob ""Bobby"" Brown",x')).toEqual([['Bob "Bobby" Brown', "x"]]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('"two\nlines",x')).toEqual([["two\nlines", "x"]]);
  });

  it("reads a final row with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toHaveLength(2);
  });
});

describe("parseRoster", () => {
  it("reads the club's own two-table layout", () => {
    const { rows, errors } = parseRoster(CLUB_FORMAT);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ netid: "aj3691", fullName: "Abigail Jung", classYear: 2028 });
  });

  it("TAKES THE CLASS YEAR FROM THE GROUP HEADER ABOVE EACH PAIR", () => {
    const { rows } = parseRoster(CLUB_FORMAT);

    expect(rows.find((r) => r.netid === "aj3691")!.classYear).toBe(2028);
    expect(rows.find((r) => r.netid === "as6787")!.classYear).toBe(2027);
  });

  it("derives the netID from the email, so nobody types it", () => {
    expect(parseRoster(CLUB_FORMAT).rows.map((r) => r.netid)).toContain("zn0242");
  });

  it("ACCEPTS A THIRD PAIR, which is what spring looks like", () => {
    // The sophomores arrive in January. Two hard-coded columns would break
    // exactly when the roster grows from 200 to 300.
    const spring = [
      "Sophomores (2029),,Juniors (2028),,Seniors (2027),",
      "Name,Email Address,Name,Email Address,Name,Email Address",
      "New Person,np1111@princeton.edu,Abigail Jung,aj3691@princeton.edu,Aaliyah Sayed,as6787@princeton.edu",
    ].join("\n");

    const { rows, errors } = parseRoster(spring);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.netid === "np1111")!.classYear).toBe(2029);
  });

  it("does not treat a pair that ran out early as missing data", () => {
    // The seniors column ends two rows before the juniors column does.
    expect(parseRoster(CLUB_FORMAT).errors).toEqual([]);
  });

  it("reads a single Name/Email pair with no group header", () => {
    const simple = "Name,Email Address\nOnly Person,op1234@princeton.edu";
    const { rows, errors } = parseRoster(simple);

    expect(errors).toEqual([]);
    expect(rows).toEqual([{ netid: "op1234", fullName: "Only Person", classYear: null }]);
  });

  it("keeps a name containing a comma intact", () => {
    const quoted = 'Name,Email Address\n"Smith, Jr",sj1234@princeton.edu';
    expect(parseRoster(quoted).rows[0].fullName).toBe("Smith, Jr");
  });

  it("REPORTS A DUPLICATE rather than silently keeping the last one", () => {
    const dupe = [
      "Name,Email Address",
      "First Entry,dd1234@princeton.edu",
      "Second Entry,dd1234@princeton.edu",
    ].join("\n");

    const { rows, errors } = parseRoster(dupe);

    expect(rows).toHaveLength(1);
    expect(errors[0]).toMatch(/dd1234 already appears on row 2/);
  });

  it("reports a bad address by row number instead of dropping it", () => {
    const bad = "Name,Email Address\nWrong Person,not-an-address";
    const { rows, errors } = parseRoster(bad);

    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/Row 2/);
  });

  it("reports a name with no email, and an email with no name", () => {
    const gaps = [
      "Name,Email Address",
      "Nameless,",
      ",em1234@princeton.edu",
    ].join("\n");

    expect(parseRoster(gaps).errors).toHaveLength(2);
  });

  it("REFUSES A FILE WITH NO MEMBERS rather than reading it as 'remove everyone'", () => {
    const empty = "Name,Email Address\n";
    const { rows, errors } = parseRoster(empty);

    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/no members/i);
  });

  it("says so plainly when the file is not a roster at all", () => {
    expect(parseRoster("total,amount\n1,2").errors[0]).toMatch(/header row/i);
  });

  it("normalises a netID typed in capitals", () => {
    const shouty = "Name,Email Address\nLoud Person,LP9999@Princeton.EDU";
    expect(parseRoster(shouty).rows[0].netid).toBe("lp9999");
  });
});
