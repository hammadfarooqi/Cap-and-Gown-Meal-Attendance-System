/**
 * Minimal RFC 4180 CSV reader.
 *
 * Written rather than installed for the same reason as the writer: this has to
 * keep working after the developer graduates, and the rules are short. It
 * handles what a spreadsheet actually emits — quoted fields, doubled quotes
 * inside them, embedded commas and newlines, CRLF line endings, and a UTF-8
 * byte-order mark, which Excel on Windows adds and which otherwise turns the
 * first header into "﻿Name".
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];

  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = true;
      i += 1;
    } else if (char === ",") {
      endField();
      i += 1;
    } else if (char === "\r" && input[i + 1] === "\n") {
      endRow();
      i += 2;
    } else if (char === "\n" || char === "\r") {
      endRow();
      i += 1;
    } else {
      field += char;
      i += 1;
    }
  }

  // A file with no trailing newline still has a final row.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}
