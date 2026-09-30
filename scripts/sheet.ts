import { addDays, isSunday } from "../src/shared/dates.ts";
import type { SeedPerson, SeedRole } from "./lib.ts";

/** Lower-case sheet role names that do not match a role name or id. null = ignore silently. */
export const ROLE_ALIASES: Record<string, string | null> = {
  "worship lead": "worship",
  away: null,
};

/** Sheet column header -> scheduler person name, for headers spelled differently. */
export const PERSON_ALIASES: Record<string, string> = {};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "4 October 2026" -> "2026-10-04"; null when unreadable or impossible. */
export function parseSheetDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  const iso = `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return addDays(iso, 0) === iso ? iso : null;
}

export type SheetWeek = { date: string; assignments: Record<string, string[]> };

const norm = (s: string) => s.trim().toLowerCase();

export function flipSheet(
  values: string[][],
  today: string,
  roles: SeedRole[],
  people: SeedPerson[],
): { weeks: SheetWeek[]; skipped: string[] } {
  const [header = [], ...rows] = values;
  const dateCol = header.findIndex((h) => norm(h ?? "") === "date");
  if (dateCol < 0) return { weeks: [], skipped: ['No "Date" column in the header row'] };

  const roleByKey = new Map<string, SeedRole>();
  for (const r of roles) {
    roleByKey.set(norm(r.name), r);
    roleByKey.set(norm(r.id), r);
  }
  const personByKey = new Map(people.map((p) => [norm(p.name), p]));
  const findPerson = (heading: string) =>
    personByKey.get(norm(Object.hasOwn(PERSON_ALIASES, heading.trim()) ? PERSON_ALIASES[heading.trim()] : heading));

  const skipped: string[] = [];
  const weeks: SheetWeek[] = [];
  for (const row of rows) {
    const raw = row[dateCol] ?? "";
    const date = parseSheetDate(raw);
    if (!date) {
      if (raw.trim()) skipped.push(`Unreadable date "${raw.trim()}"`);
      continue;
    }
    if (date < today) continue;
    if (!isSunday(date)) {
      skipped.push(`${date} is not a Sunday`);
      continue;
    }
    const assignments: Record<string, string[]> = Object.fromEntries(roles.map((r) => [r.id, []]));
    row.forEach((value, col) => {
      if (col === 0 || col === 1 || col === dateCol || !value?.trim()) return;
      const heading = header[col] ?? "";
      const person = findPerson(heading);
      if (!person) {
        skipped.push(`Unknown person "${heading.trim()}"`);
        return;
      }
      for (const part of value.split(",")) {
        const key = norm(part);
        if (!key) continue;
        const roleId = Object.hasOwn(ROLE_ALIASES, key) ? ROLE_ALIASES[key] : roleByKey.get(key)?.id;
        if (roleId === null) continue;
        const role = roles.find((r) => r.id === roleId);
        if (!role) skipped.push(`Unknown role "${part.trim()}"`);
        else if (!person.roles.includes(role.id)) skipped.push(`${person.name} does not do ${role.name} (${date})`);
        else if (assignments[role.id].length >= role.needs) skipped.push(`${role.name} on ${date} is full; dropped ${person.name}`);
        else assignments[role.id].push(person.name);
      }
    });
    weeks.push({ date, assignments });
  }
  return { weeks, skipped: [...new Set(skipped)] };
}
