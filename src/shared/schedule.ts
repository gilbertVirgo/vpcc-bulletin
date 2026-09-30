import { addDays } from "./dates";
import type { Assignments, GeneratedWeek, Person, Role, Week } from "./types";

export const MAX_ATTEMPTS = 50;
/** Stored weeks counted towards frequency, on top of the weeks being generated. */
export const RECENT_WEEKS = 8;

/** Weeks a person should serve out of `weeks`. Anyone with frequency > 0 gets at least 1. */
export function quota(frequency: number, weeks: number): number {
  if (!(frequency > 0) || !(weeks > 0)) return 0;
  return Math.max(1, Math.round(Math.min(frequency, 1) * weeks));
}

const byDate = (weeks: Week[]) => [...weeks].sort((a, b) => a.date.localeCompare(b.date));

/** The first `count` Sundays from `coming` on that have no stored week, so a deleted week gets refilled. */
export function planDates(coming: string, stored: { date: string }[], count: number): string[] {
  const taken = new Set(stored.map((w) => w.date));
  const dates: string[] = [];
  for (let d = coming; dates.length < count; d = addDays(d, 7)) if (!taken.has(d)) dates.push(d);
  return dates;
}

export type GenerateInput = {
  people: Person[];
  roles: Role[];
  dates: string[]; // Sundays, ascending, none of them stored
  /**
   * Stored weeks, any order. The newest 8 before dates[0] count towards frequency; a stored week
   * exactly 7 days before or after a date drives the last-week and next-week rules for it.
   */
  recent?: Week[];
  rng?: () => number;
};

export function generate({ people, roles, dates, recent = [], rng = Math.random }: GenerateInput): GeneratedWeek[] {
  if (dates.length === 0) return [];
  const ordered = [...roles].sort((a, b) => a.order - b.order);
  const past = byDate(recent.filter((w) => w.date < dates[0])).slice(-RECENT_WEEKS);
  const stored = new Map(recent.map((w) => [w.date, w.assignments]));

  let best: GeneratedWeek[] = [];
  let bestScore = [Infinity, Infinity];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const { weeks, overflow } = attempt(people, ordered, dates, past, stored, rng);
    const gaps = weeks.reduce((n, w) => n + w.gaps.length, 0);
    if (gaps < bestScore[0] || (gaps === bestScore[0] && overflow < bestScore[1])) {
      best = weeks;
      bestScore = [gaps, overflow];
    }
    if (gaps === 0 && overflow === 0) break;
  }
  return best;
}

function attempt(
  people: Person[],
  roles: Role[],
  dates: string[],
  past: Week[],
  stored: Map<string, Assignments>,
  rng: () => number,
): { weeks: GeneratedWeek[]; overflow: number } {
  const window = past.length + dates.length;
  const quotas = new Map(people.map((p) => [p.id, quota(p.frequency, window)]));
  const used = new Map(people.map((p) => [p.id, past.filter((w) => Object.values(w.assignments).some((ids) => ids.includes(p.id))).length]));
  let overflow = 0;
  const out: GeneratedWeek[] = [];
  const made = new Map<string, Assignments>();

  for (const date of dates) {
    // Last week is whichever of this run or the DB has the Sunday before; next week can only be stored.
    const previous = made.get(addDays(date, -7)) ?? stored.get(addDays(date, -7)) ?? {};
    const servedLastWeek = new Set(Object.values(previous).flat());
    const servesNextWeek = new Set(Object.values(stored.get(addDays(date, 7)) ?? {}).flat());
    const blocked = new Set(roles.filter((r) => r.consecutiveDisabled).flatMap((r) => previous[r.id] ?? []));
    const busy = new Map<string, Set<number>>(); // person id -> sections taken this week
    const assignments: Assignments = {};
    const gaps: string[] = [];

    for (const role of roles) {
      if (role.manual) {
        assignments[role.id] = []; // filled by hand, never a gap
        continue;
      }
      // Hard rules: holds the role, frequency > 0, not blocked, no section clash, and no consecutive
      // role for someone serving next week (they would have to be blocked from it).
      // Quota is soft only as a last resort: over-quota people rank after everyone within quota.
      const ranked = people
        .filter(
          (p) =>
            p.roles.includes(role.id) &&
            quotas.get(p.id)! > 0 &&
            !blocked.has(p.id) &&
            !(role.consecutiveDisabled && servesNextWeek.has(p.id)) &&
            !role.busyFor.some((s) => busy.get(p.id)?.has(s)),
        )
        .map((p) => {
          const u = used.get(p.id)!, q = quotas.get(p.id)!;
          const over = !busy.has(p.id) && u >= q;
          return { id: p.id, over: over ? 1 : 0, fair: over ? u - q : u / q, last: servedLastWeek.has(p.id) ? 1 : 0, tie: rng() };
        })
        .sort((a, b) => a.over - b.over || a.fair - b.fair || a.last - b.last || a.tie - b.tie);

      const chosen = ranked.slice(0, role.needs);
      if (chosen.length < role.needs) gaps.push(role.id);
      for (const c of chosen) {
        overflow += c.over;
        busy.set(c.id, new Set([...(busy.get(c.id) ?? []), ...role.busyFor]));
      }
      assignments[role.id] = chosen.map((c) => c.id);
    }

    for (const id of busy.keys()) used.set(id, used.get(id)! + 1);
    out.push({ date, assignments, gaps });
    made.set(date, assignments);
  }
  return { weeks: out, overflow };
}
