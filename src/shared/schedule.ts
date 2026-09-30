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

/**
 * Dates to generate after the stored weeks, and the stored weeks (newest 8, oldest first) to hand
 * to `generate` as `recent`. `stored` may be in any order and include past weeks.
 */
export function planDates(coming: string, stored: Week[], count: number): { dates: string[]; recent: Week[] } {
  const recent = byDate(stored).slice(-RECENT_WEEKS);
  const last = recent.at(-1);
  const start = last && last.date >= coming ? addDays(last.date, 7) : coming;
  return { dates: Array.from({ length: count }, (_, i) => addDays(start, 7 * i)), recent };
}

export type GenerateInput = {
  people: Person[];
  roles: Role[];
  dates: string[]; // consecutive Sundays, ascending
  recent?: Week[]; // stored weeks before dates[0]; any order, newest 8 are used
  rng?: () => number;
};

export function generate({ people, roles, dates, recent = [], rng = Math.random }: GenerateInput): GeneratedWeek[] {
  if (dates.length === 0) return [];
  const ordered = [...roles].sort((a, b) => a.order - b.order);
  const past = byDate(recent.filter((w) => w.date < dates[0])).slice(-RECENT_WEEKS);
  // Last-week rules (consecutiveDisabled, served-last-week ordering) only when it really was last week.
  const newest = past.at(-1);
  const previous = newest && newest.date === addDays(dates[0], -7) ? newest.assignments : {};

  let best: GeneratedWeek[] = [];
  let bestScore = [Infinity, Infinity];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const { weeks, overflow } = attempt(people, ordered, dates, past, previous, rng);
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
  previous: Assignments,
  rng: () => number,
): { weeks: GeneratedWeek[]; overflow: number } {
  const window = past.length + dates.length;
  const quotas = new Map(people.map((p) => [p.id, quota(p.frequency, window)]));
  const used = new Map(people.map((p) => [p.id, past.filter((w) => Object.values(w.assignments).some((ids) => ids.includes(p.id))).length]));
  let overflow = 0;
  const out: GeneratedWeek[] = [];

  for (const date of dates) {
    const servedLastWeek = new Set(Object.values(previous).flat());
    const blocked = new Set(roles.filter((r) => r.consecutiveDisabled).flatMap((r) => previous[r.id] ?? []));
    const busy = new Map<string, Set<number>>(); // person id -> sections taken this week
    const assignments: Assignments = {};
    const gaps: string[] = [];

    for (const role of roles) {
      // Hard rules: holds the role, frequency > 0, not blocked, no section clash.
      // Quota is soft only as a last resort: over-quota people rank after everyone within quota.
      const ranked = people
        .filter(
          (p) =>
            p.roles.includes(role.id) &&
            quotas.get(p.id)! > 0 &&
            !blocked.has(p.id) &&
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
    previous = assignments;
  }
  return { weeks: out, overflow };
}
