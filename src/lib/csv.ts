/**
 * CSV for exports. Pure.
 *
 * Every cell is quoted when it needs to be, and a cell that starts with = + - @ (or a tab / CR) is
 * prefixed with an apostrophe so a spreadsheet shows it as text instead of running it as a formula
 * ("CSV injection": a borrower name or note typed by a user must not be able to do that).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  // CRLF line ends and a UTF-8 BOM so Excel opens Urdu / accented names correctly.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
