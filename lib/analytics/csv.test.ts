import { describe, it, expect } from "vitest";
import { csvField, toCsv, EXPORT_COLUMNS } from "./csv";

describe("csvField", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvField("Alice")).toBe("Alice");
    expect(csvField(42)).toBe("42");
  });

  it("QUOTES A NAME CONTAINING A COMMA", () => {
    // Unquoted, "Smith, Jr" shifts every later column on that row — the kind
    // of corruption nobody notices until a report is already wrong.
    expect(csvField("Smith, Jr")).toBe('"Smith, Jr"');
  });

  it("escapes an embedded quote by doubling it", () => {
    expect(csvField('Bob "Bobby" Brown')).toBe('"Bob ""Bobby"" Brown"');
  });

  it("quotes a value containing a newline", () => {
    expect(csvField("two\nlines")).toBe('"two\nlines"');
  });

  it("renders null and undefined as empty, not as the word null", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("renders booleans readably", () => {
    expect(csvField(true)).toBe("true");
    expect(csvField(false)).toBe("false");
  });
});

describe("toCsv", () => {
  it("writes a header row followed by the data", () => {
    const csv = toCsv(["a", "b"], [[1, 2], [3, 4]]);
    expect(csv).toBe("a,b\r\n1,2\r\n3,4\r\n");
  });

  it("STILL RETURNS HEADERS FOR AN EMPTY RESULT", () => {
    // A file with no header at all looks like a broken export rather than an
    // empty range, and someone will report it as a bug.
    expect(toCsv(["a", "b"], [])).toBe("a,b\r\n");
  });

  it("quotes fields inside data rows, not only headers", () => {
    expect(toCsv(["name"], [["Smith, Jr"]])).toBe('name\r\n"Smith, Jr"\r\n');
  });

  it("names every column the export promises", () => {
    expect(EXPORT_COLUMNS).toHaveLength(7);
    expect(EXPORT_COLUMNS).toContain("netID");
    expect(EXPORT_COLUMNS).toContain("Member at the time");
  });
});
