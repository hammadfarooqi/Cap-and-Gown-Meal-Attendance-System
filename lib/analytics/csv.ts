/**
 * Quote a CSV field.
 *
 * A field needs quoting if it contains a comma, a quote, or a newline; inside
 * quotes, a quote is doubled. "Smith, Jr" unquoted shifts every later column
 * on that row, which is the kind of corruption nobody notices until a report
 * is already wrong.
 *
 * Three lines rather than a dependency, because this has to keep working
 * after the developer graduates.
 */
export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";

  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;

  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(columns: string[], rows: (string | number | boolean | null)[][]): string {
  const lines = [columns.map(csvField).join(",")];
  for (const row of rows) lines.push(row.map(csvField).join(","));

  // CRLF: the line ending every spreadsheet on every platform accepts.
  return lines.join("\r\n") + "\r\n";
}

export const EXPORT_COLUMNS = [
  "netID",
  "Name",
  "Member at the time",
  "Home club",
  "Meal date",
  "Meal",
  "Scanned at (New York)",
];
