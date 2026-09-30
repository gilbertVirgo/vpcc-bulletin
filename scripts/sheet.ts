import { isRealDate, isSunday } from "../src/shared/dates.ts";
import type { SeedPerson, SeedRole } from "./lib.ts";

/** Lower-case column headings that do not match a role name or id. null = ignore the column silently. */
export const ROLE_ALIASES: Record<string, string | null> = {
  "worship lead": "worship",
  "communion prep": "communion-prep",
  "lunch cleanup": "lunch-cleanup",
  notes: null,
};

/** Lower-case name as written in the sheet -> person name, for people spelled differently. */
export const PERSON_ALIASES: Record<string, string> = {};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "June 7 2026" or "7 June 2026" -> "2026-06-07"; null when unreadable or impossible. */
export function parseSheetDate(s: string): string | null {
  const t = s.trim().replace(/,/g, "");
  const md = t.match(/^([A-Za-z]+) (\d{1,2}) (\d{4})$/);
  const dm = t.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  const [month, day, year] = md ? [md[1], md[2], md[3]] : dm ? [dm[2], dm[1], dm[3]] : [];
  if (!month || !day || !year) return null;
  const i = MONTHS.indexOf(month.toLowerCase());
  if (i < 0) return null;
  const iso = `${year}-${String(i + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isRealDate(iso) ? iso : null;
}

export type SheetWeek = { date: string; assignments: Record<string, string[]> };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The "Schedule" tab: a "Date" column, then one column per role (heading = role name), each cell a
 * comma-separated list of people. Every dated Sunday with someone in a non-manual role becomes a week,
 * past ones included. Weeks before `today` are history, so anyone known is kept; from `today` on,
 * people must hold the role and a cell takes at most `needs`. Assignments hold person names;
 * anything not taken is listed in `skipped`.
 */
export function parseSheet(
  values: string[][],
  today: string,
  roles: SeedRole[],
  people: SeedPerson[],
): { weeks: SheetWeek[]; skipped: string[] } {
  const [header = [], ...rows] = values;
  const dateCol = header.findIndex((h) => norm(h ?? "") === "date");
  if (dateCol < 0) return { weeks: [], skipped: ['No "Date" column in the header row'] };

  const skipped: string[] = [];
  const roleByKey = new Map<string, SeedRole>();
  for (const r of roles) {
    roleByKey.set(norm(r.name), r);
    roleByKey.set(norm(r.id), r);
  }
  const columns = new Map<number, SeedRole>();
  header.forEach((heading, col) => {
    const key = norm(heading ?? "");
    if (col === dateCol || !key) return;
    const alias = Object.hasOwn(ROLE_ALIASES, key) ? ROLE_ALIASES[key] : undefined;
    if (alias === null) return;
    const role = alias ? roles.find((r) => r.id === alias) : roleByKey.get(key);
    if (role) columns.set(col, role);
    else skipped.push(`Unknown role column "${heading.trim()}"`);
  });

  const personByKey = new Map(people.map((p) => [norm(p.name), p]));
  const findPerson = (name: string) => {
    const key = norm(name);
    return personByKey.get(Object.hasOwn(PERSON_ALIASES, key) ? norm(PERSON_ALIASES[key]) : key);
  };

  const weeks: SheetWeek[] = [];
  for (const row of rows) {
    const raw = row[dateCol] ?? "";
    const date = parseSheetDate(raw);
    if (!date) {
      if (raw.trim()) skipped.push(`Unreadable date "${raw.trim()}"`);
      continue;
    }
    if (!isSunday(date)) {
      skipped.push(`${date} is not a Sunday`);
      continue;
    }
    const history = date < today;
    const assignments: Record<string, string[]> = Object.fromEntries(roles.map((r) => [r.id, []]));
    for (const [col, role] of columns) {
      for (const part of (row[col] ?? "").split(",")) {
        if (!part.trim()) continue;
        const person = findPerson(part);
        const cell = assignments[role.id];
        if (!person) skipped.push(`Unknown person "${part.trim()}"`);
        else if (!history && !role.manual && !person.roles.includes(role.id)) skipped.push(`${person.name} does not do ${role.name} (${date})`);
        else if (cell.includes(person.name)) continue;
        else if (!history && cell.length >= role.needs) skipped.push(`${role.name} on ${date} is full; dropped ${person.name}`);
        else cell.push(person.name);
      }
    }
    // Only manual roles filled (e.g. just a preacher): skipped, so the Sunday can still be generated.
    if (roles.some((r) => !r.manual && assignments[r.id].length)) weeks.push({ date, assignments });
    else if (roles.some((r) => assignments[r.id].length)) {
      skipped.push(`${date} has only manual roles filled; skipped so it can be generated (fill them by hand after)`);
    }
  }
  return { weeks, skipped: [...new Set(skipped)] };
}
