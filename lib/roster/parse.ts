import { parseCsv } from "./csv-parse";
import { isValidNetid } from "@/lib/directory/lookup";

export type RosterRow = {
  netid: string;
  fullName: string;
  classYear: number | null;
};

export type RosterParse = {
  rows: RosterRow[];
  errors: string[];
};

/**
 * Read the club's own membership spreadsheet.
 *
 * The real file is not one list. It is several side-by-side tables — one
 * column pair per class year:
 *
 *   Juniors (2028) ,                      , Seniors (2027) ,
 *   Name           , Email Address        , Name           , Email Address
 *   Abigail Jung   , aj3691@princeton.edu , Aaliyah Sayed  , as6787@princeton.edu
 *
 * The class year lives in a group header ABOVE the column headers, and the
 * pairs run out at different rows. Any number of pairs is accepted, because
 * in the spring there will be three, not two — the sophomores arrive.
 *
 * netID is the local part of the email, so nobody types it, and the class
 * year comes from the group header, so nobody types that either. Asking the
 * business manager to reshape her spreadsheet before every upload is exactly
 * the friction the dashboard exists to remove.
 */
export function parseRoster(text: string): RosterParse {
  const grid = parseCsv(text);
  const errors: string[] = [];

  const headerIndex = grid.findIndex((row) =>
    row.some((cell) => /^name$/i.test(cell.trim())) &&
    row.some((cell) => /e-?mail/i.test(cell.trim())),
  );

  if (headerIndex === -1) {
    return { rows: [], errors: ["Could not find a header row with Name and Email columns."] };
  }

  const header = grid[headerIndex];
  const groups = headerIndex > 0 ? grid[headerIndex - 1] : [];

  // Every place a Name column is immediately followed by an Email column.
  const pairs: { nameAt: number; emailAt: number; classYear: number | null }[] = [];
  for (let column = 0; column < header.length - 1; column++) {
    if (!/^name$/i.test(header[column].trim())) continue;
    if (!/e-?mail/i.test(header[column + 1].trim())) continue;

    // "Juniors (2028)" — the year in the group header above this pair.
    const label = groups[column] ?? "";
    const year = /\((\d{4})\)/.exec(label)?.[1];

    pairs.push({
      nameAt: column,
      emailAt: column + 1,
      classYear: year ? Number(year) : null,
    });
  }

  if (pairs.length === 0) {
    return { rows: [], errors: ["No Name/Email column pairs found."] };
  }

  const rows: RosterRow[] = [];
  const seen = new Map<string, number>();

  for (let r = headerIndex + 1; r < grid.length; r++) {
    const line = grid[r];
    const lineNumber = r + 1;

    for (const pair of pairs) {
      const fullName = (line[pair.nameAt] ?? "").trim();
      const email = (line[pair.emailAt] ?? "").trim();

      // A pair that has run out while another continues. Not an error.
      if (!fullName && !email) continue;

      if (!fullName) {
        errors.push(`Row ${lineNumber}: "${email}" has no name.`);
        continue;
      }
      if (!email) {
        errors.push(`Row ${lineNumber}: "${fullName}" has no email address.`);
        continue;
      }

      const netid = email.split("@")[0].trim().toLowerCase();

      if (!isValidNetid(netid)) {
        errors.push(`Row ${lineNumber}: "${email}" does not look like a Princeton address.`);
        continue;
      }

      const firstSeen = seen.get(netid);
      if (firstSeen !== undefined) {
        // Last-one-wins would silently drop somebody. Say so instead.
        errors.push(`Row ${lineNumber}: ${netid} already appears on row ${firstSeen}.`);
        continue;
      }

      seen.set(netid, lineNumber);
      rows.push({ netid, fullName, classYear: pair.classYear });
    }
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push("The file has headers but no members in it.");
  }

  return { rows, errors };
}
