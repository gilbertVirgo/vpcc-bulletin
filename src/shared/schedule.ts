import { addDays } from "./dates";
import type { Assignments, GeneratedWeek, Person, Role, Week } from "./types";

export const MAX_ATTEMPTS = 50;

/** Weeks a person may serve out of `weeks`. Hard cap. */
export function quota(frequency: number, weeks: number): number {
  if (!(frequency > 0) || !(weeks > 0)) return 0;
  return Math.round(Math.min(frequency, 1) * weeks);
}

/** Dates to generate and the stored week (if it is the Sunday before) to use as history. */
export function planDates(
  coming: string,
  last: Week | null,
  count: number,
): { dates: string[]; history: Assignments | null } {
  const start = last && last.date >= coming ? addDays(last.date, 7) : coming;
  const dates = Array.from({ length: count }, (_, i) => addDays(start, 7 * i));
  const history = last && last.date === addDays(start, -7) ? last.assignments : null;
  return { dates, history };
}

export type GenerateInput = {
  people: Person[];
  roles: Role[];
  dates: string[];
  history?: Assignments | null;
  rng?: () => number;
};

export function generate({ people, roles, dates, history = null, rng = Math.random }: GenerateInput): GeneratedWeek[] {
  const ordered = [...roles].sort((a, b) => a.order - b.order);
  let best: GeneratedWeek[] = [];
  let bestGaps = Infinity;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const weeks = attempt(people, ordered, dates, history, rng);
    const gaps = weeks.reduce((n, w) => n + w.gaps.length, 0);
    if (gaps < bestGaps) {
      best = weeks;
      bestGaps = gaps;
    }
    if (gaps === 0) break;
  }
  return best;
}

function attempt(
  people: Person[],
  roles: Role[],
  dates: string[],
  history: Assignments | null,
  rng: () => number,
): GeneratedWeek[] {
  const quotas = new Map(people.map((p) => [p.id, quota(p.frequency, dates.length)]));
  const used = new Map(people.map((p) => [p.id, 0]));
  let previous: Assignments = history ?? {};
  const out: GeneratedWeek[] = [];

  for (const date of dates) {
    const servedLastWeek = new Set(Object.values(previous).flat());
    const blocked = new Set(roles.filter((r) => r.consecutiveDisabled).flatMap((r) => previous[r.id] ?? []));
    const busy = new Map<string, Set<number>>(); // person id -> sections taken this week
    const assignments: Assignments = {};
    const gaps: string[] = [];

    for (const role of roles) {
      const ranked = people
        .filter(
          (p) =>
            p.roles.includes(role.id) &&
            !blocked.has(p.id) &&
            (busy.has(p.id) || used.get(p.id)! < quotas.get(p.id)!) &&
            !role.busyFor.some((s) => busy.get(p.id)?.has(s)),
        )
        .map((p) => ({
          id: p.id,
          ratio: used.get(p.id)! / quotas.get(p.id)!,
          last: servedLastWeek.has(p.id) ? 1 : 0,
          tie: rng(),
        }))
        .sort((a, b) => a.ratio - b.ratio || a.last - b.last || a.tie - b.tie);

      const chosen = ranked.slice(0, role.needs).map((c) => c.id);
      if (chosen.length < role.needs) gaps.push(role.id);
      for (const id of chosen) busy.set(id, new Set([...(busy.get(id) ?? []), ...role.busyFor]));
      assignments[role.id] = chosen;
    }

    for (const id of busy.keys()) used.set(id, used.get(id)! + 1);
    out.push({ date, assignments, gaps });
    previous = assignments;
  }
  return out;
}
