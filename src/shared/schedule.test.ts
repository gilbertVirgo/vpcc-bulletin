import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { mulberry32 } from "./rng";
import { generate, planDates, quota } from "./schedule";
import type { Assignments, GeneratedWeek, Person, Role, Week } from "./types";

const PRE = 0, DURING = 1, POST = 2;
const role = (id: string, busyFor: number[], extra: Partial<Role> = {}): Role => ({
  id, name: id, needs: 1, busyFor, consecutiveDisabled: false, order: 0, manual: false, ...extra,
});
const person = (id: string, roles: string[], frequency = 1, name = id): Person => ({ id, name, roles, frequency });
const sundays = (n: number) => Array.from({ length: n }, (_, i) => addDays("2026-10-04", 7 * i));
const servedIn = (w: GeneratedWeek, id: string) => Object.values(w.assignments).some((ids) => ids.includes(id));
const served = (weeks: GeneratedWeek[], id: string) => weeks.filter((w) => servedIn(w, id)).length;
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const LAST_SUNDAY = addDays("2026-10-04", -7);
const lastWeek = (assignments: Assignments): Week[] => [{ date: LAST_SUNDAY, assignments }];
/** Generate one week at a time, feeding the output back as up to 8 recent weeks. */
const rolling = (people: Person[], roles: Role[], weeks: number, seed: number) => {
  const rng = mulberry32(seed);
  const out: GeneratedWeek[] = [];
  for (const date of sundays(weeks)) out.push(...generate({ people, roles, dates: [date], recent: out.slice(-8), rng }));
  return out;
};

// Real data from /Users/gilbertvirgo/rota-scheduler/data (2026-09-30).
const ROLES: Role[] = [
  role("worship", [PRE, DURING, POST], { consecutiveDisabled: true }),
  role("soundcheck", [PRE, POST]),
  role("creche", [DURING]),
  role("lyrics", [PRE, DURING]),
  role("worship-support", [PRE, DURING]),
  role("communion-prep", [PRE, POST]),
  role("lunch-cleanup", [DURING, POST]),
  role("sunday-lunch", [PRE, DURING, POST], { consecutiveDisabled: true }),
  role("welcome", [PRE], { needs: 2 }),
  role("refreshments", [PRE, POST]),
].map((r, order) => ({ ...r, order }));
const PEOPLE: Person[] = [
  person("albany", ["lyrics", "refreshments", "welcome", "worship-support", "sunday-lunch", "lunch-cleanup", "creche"], 0.8),
  person("ben-v", ["welcome", "communion-prep"], 0.4),
  person("ben-b", ["welcome", "refreshments", "communion-prep", "sunday-lunch", "lunch-cleanup"], 1),
  person("beth", ["refreshments", "welcome", "worship-support", "sunday-lunch", "lunch-cleanup", "communion-prep", "creche"], 0.8),
  person("emma", ["refreshments", "welcome", "sunday-lunch", "lunch-cleanup", "communion-prep", "creche"], 0.6),
  person("gil", ["lyrics", "refreshments", "soundcheck", "welcome", "worship", "worship-support", "communion-prep", "creche"], 0.8),
  person("isaiah", ["refreshments", "soundcheck", "worship-support"], 0.6),
  person("jonny", ["refreshments", "welcome", "soundcheck", "worship", "worship-support", "sunday-lunch", "lunch-cleanup", "communion-prep"], 0.8),
  person("pascal", ["lyrics", "refreshments", "welcome", "lunch-cleanup"], 0.6),
  person("pascal-sup", ["sunday-lunch"], 0.2),
  person("ambrose", ["lyrics", "welcome"], 0.8),
  person("lucy", ["lyrics", "refreshments", "sunday-lunch", "lunch-cleanup", "communion-prep"], 0.6),
  person("rachel", ["refreshments", "welcome", "worship-support", "sunday-lunch", "communion-prep", "creche"], 0.8),
  person("rufus", ["lyrics", "soundcheck", "sunday-lunch", "lunch-cleanup", "creche", "worship-support"], 0.8),
  person("tom", ["lyrics", "welcome", "refreshments", "soundcheck", "sunday-lunch", "lunch-cleanup", "communion-prep"], 0.8),
  person("tara", ["welcome", "refreshments", "sunday-lunch"], 0.8),
  person("dan", ["welcome", "refreshments"], 0.8),
];
const real = (seed: number, weeks = 5) =>
  generate({ people: PEOPLE, roles: ROLES, dates: sundays(weeks), rng: mulberry32(seed) });

describe("quota", () => {
  it.each([
    [0.8, 5, 4], [0.2, 5, 1], [0.2, 1, 1], [0.05, 9, 1], [0.2, 9, 2], [0.5, 1, 1], [1, 4, 4],
    [0, 5, 0], [1, 0, 0], [-1, 3, 0], [Number.NaN, 3, 0], [1.5, 2, 2],
  ])("quota(%d, %d) = %d", (f, w, want) => {
    expect(quota(f, w)).toBe(want);
  });
});

describe("planDates", () => {
  const coming = "2026-10-04";
  const at = (...dates: string[]) => dates.map((date) => ({ date }));
  it("starts at the coming Sunday when nothing is stored", () => {
    expect(planDates(coming, [], 3)).toEqual(["2026-10-04", "2026-10-11", "2026-10-18"]);
  });
  it("takes the next Sundays with no stored week, refilling a deleted middle week", () => {
    expect(planDates(coming, at("2026-10-18", coming), 3)).toEqual(["2026-10-11", "2026-10-25", "2026-11-01"]);
    expect(planDates(coming, at(coming, "2026-10-11"), 1)).toEqual(["2026-10-18"]);
  });
  it("ignores past weeks", () => {
    expect(planDates(coming, at("2026-09-13", "2026-09-27"), 2)).toEqual([coming, "2026-10-11"]);
  });
});

describe("generate", () => {
  it("returns one week per date with a key for every role", () => {
    const weeks = real(1);
    expect(weeks.map((w) => w.date)).toEqual(sundays(5));
    for (const w of weeks) expect(Object.keys(w.assignments).sort()).toEqual(ROLES.map((r) => r.id).sort());
  });

  it("is deterministic for a seed", () => {
    expect(real(7)).toEqual(real(7));
  });

  it("returns [] for no dates", () => {
    expect(generate({ people: PEOPLE, roles: ROLES, dates: [], rng: mulberry32(1) })).toEqual([]);
  });

  it.each(SEEDS)("keeps every rule on real data (seed %d)", (seed) => {
    const weeks = real(seed);
    for (const [i, w] of weeks.entries()) {
      const sections = new Map<string, number[]>();
      for (const r of ROLES) {
        const ids = w.assignments[r.id];
        expect(ids.length).toBeLessThanOrEqual(r.needs);
        expect(new Set(ids).size).toBe(ids.length);
        if (ids.length < r.needs) expect(w.gaps).toContain(r.id);
        for (const id of ids) {
          expect(PEOPLE.find((p) => p.id === id)!.roles).toContain(r.id);
          const taken = sections.get(id) ?? [];
          for (const s of r.busyFor) expect(taken).not.toContain(s);
          sections.set(id, [...taken, ...r.busyFor]);
        }
      }
      if (i > 0) {
        const prev = weeks[i - 1];
        for (const r of ROLES.filter((x) => x.consecutiveDisabled)) {
          for (const id of prev.assignments[r.id]) expect(servedIn(w, id)).toBe(false);
        }
      }
    }
    for (const p of PEOPLE) expect(served(weeks, p.id)).toBeLessThanOrEqual(quota(p.frequency, 5));
  });

  it("blocks the history week's consecutive holder from week 1", () => {
    for (const seed of SEEDS) {
      const [w] = generate({ people: PEOPLE, roles: ROLES, dates: sundays(1), recent: lastWeek({ worship: ["gil"] }), rng: mulberry32(seed) });
      expect(servedIn(w, "gil")).toBe(false);
      expect(w.assignments.worship).toEqual(["jonny"]);
    }
  });

  it("puts last week's servers at the back when fairness is equal", () => {
    const people = [person("a", ["r"]), person("b", ["r"])];
    for (const seed of SEEDS) {
      const [w] = generate({ people, roles: [role("r", [PRE])], dates: sundays(1), recent: lastWeek({ r: ["a"] }), rng: mulberry32(seed) });
      expect(w.assignments.r).toEqual(["b"]);
    }
  });

  it("shares a role fairly, counting by id not name", () => {
    const people = [person("s1", ["r"], 1, "Sam"), person("s2", ["r"], 1, "Sam")];
    for (const seed of SEEDS) {
      const weeks = generate({ people, roles: [role("r", [PRE])], dates: sundays(4), rng: mulberry32(seed) });
      expect([served(weeks, "s1"), served(weeks, "s2")]).toEqual([2, 2]);
    }
  });

  it("applies last-week rules only when the newest recent week is exactly 7 days before", () => {
    const people = [person("a", ["lead"])];
    const roles = [role("lead", [PRE], { consecutiveDisabled: true })];
    const run = (date: string) =>
      generate({ people, roles, dates: sundays(1), recent: [{ date, assignments: { lead: ["a"] } }], rng: mulberry32(1) })[0];
    expect(run(LAST_SUNDAY)).toMatchObject({ assignments: { lead: [] }, gaps: ["lead"] });
    expect(run(addDays(LAST_SUNDAY, -7))).toMatchObject({ assignments: { lead: ["a"] }, gaps: [] });
    // Recent weeks on or after the first new date are ignored entirely.
    expect(run("2026-10-04")).toMatchObject({ assignments: { lead: ["a"] }, gaps: [] });
  });

  it("takes last-week rules from the week 7 days before each date, stored or generated", () => {
    const people = [person("a", ["lead"]), person("b", ["lead"]), person("c", ["lead"])];
    const roles = [role("lead", [PRE], { consecutiveDisabled: true })];
    const recent: Week[] = [
      { date: "2026-10-04", assignments: { lead: ["a"] } },
      { date: "2026-10-18", assignments: { lead: ["b"] } },
    ];
    for (const seed of SEEDS) {
      const [gap, after] = generate({ people, roles, dates: ["2026-10-11", "2026-10-25"], recent, rng: mulberry32(seed) });
      expect(gap.assignments.lead).toEqual(["c"]); // a led the week before, b leads the week after
      expect(after.assignments.lead).not.toContain("b"); // stored 18 Oct, not generated 11 Oct, is its last week
    }
  });

  it("does not carry last-week rules across a Sunday that is not being generated", () => {
    const people = [person("a", ["lead"])];
    const roles = [role("lead", [PRE], { consecutiveDisabled: true })];
    const weeks = generate({ people, roles, dates: ["2026-10-04", "2026-10-18"], rng: mulberry32(1) });
    expect(weeks.map((w) => w.assignments.lead)).toEqual([["a"], ["a"]]);
  });

  it("keeps consecutive roles from anyone serving in the stored week after a gap", () => {
    const people = [person("a", ["lead", "other"]), person("b", ["lead"])];
    const roles = [role("lead", [PRE], { consecutiveDisabled: true }), role("other", [POST], { order: 1 })];
    const recent: Week[] = [{ date: "2026-10-11", assignments: { lead: ["a"], other: [] } }];
    for (const seed of SEEDS) {
      const [w] = generate({ people, roles, dates: ["2026-10-04"], recent, rng: mulberry32(seed) });
      expect(w.assignments).toEqual({ lead: ["b"], other: ["a"] });
    }
  });

  it("counts recent weeks towards quota", () => {
    const people = [person("a", ["r"], 0.5), person("b", ["r"], 0.5)];
    const recent: Week[] = [
      { date: addDays(LAST_SUNDAY, -7), assignments: { r: ["a"] } },
      { date: LAST_SUNDAY, assignments: { r: ["a"] } },
    ];
    for (const seed of SEEDS) {
      const weeks = generate({ people, roles: [role("r", [PRE])], dates: sundays(2), recent, rng: mulberry32(seed) });
      expect(weeks.map((w) => w.assignments.r)).toEqual([["b"], ["b"]]);
    }
  });

  it("serves people in proportion to frequency across one-week runs", () => {
    const people = [person("a", ["r"], 0.5), person("b", ["r"], 0.3), person("c", ["r"], 0.2)];
    for (const seed of SEEDS) {
      const weeks = rolling(people, [role("r", [PRE])], 10, seed);
      expect(weeks.every((w) => w.gaps.length === 0)).toBe(true);
      expect(served(weeks, "a")).toBeGreaterThanOrEqual(4);
      expect(served(weeks, "a")).toBeLessThanOrEqual(6);
      expect(served(weeks, "b")).toBeGreaterThanOrEqual(2);
      expect(served(weeks, "b")).toBeLessThanOrEqual(4);
      expect(served(weeks, "c")).toBeGreaterThanOrEqual(1);
      expect(served(weeks, "c")).toBeLessThanOrEqual(3);
    }
  });

  it("keeps real data fair across ten one-week runs", () => {
    for (const seed of SEEDS) {
      const weeks = rolling(PEOPLE, ROLES, 10, seed);
      expect(weeks.flatMap((w) => w.gaps)).toEqual([]);
      for (const p of PEOPLE) {
        const n = served(weeks, p.id);
        // Demand is below total availability, so people land somewhat under their frequency, never far.
        expect(n).toBeGreaterThanOrEqual(Math.max(1, Math.floor(p.frequency * 10 * 0.6))); // low-frequency people do get picked
        expect(n).toBeLessThanOrEqual(Math.ceil(p.frequency * 10) + 1);
      }
      expect(served(weeks, "pascal-sup")).toBeLessThanOrEqual(3);
    }
  });

  it("overflows quota as a last resort, least-over first, instead of leaving a gap", () => {
    const people = [person("a", ["r"], 0.2), person("b", ["r"], 0.4)];
    for (const seed of SEEDS) {
      const weeks = generate({ people, roles: [role("r", [PRE])], dates: sundays(5), rng: mulberry32(seed) });
      expect(weeks.flatMap((w) => w.gaps)).toEqual([]);
      expect([served(weeks, "a"), served(weeks, "b")].sort()).toEqual([2, 3]);
    }
  });

  it("never overflows into frequency 0", () => {
    const weeks = generate({ people: [person("zero", ["r"], 0)], roles: [role("r", [PRE])], dates: sundays(2), rng: mulberry32(1) });
    expect(weeks.map((w) => w.assignments.r)).toEqual([[], []]);
    expect(weeks.map((w) => w.gaps)).toEqual([["r"], ["r"]]);
  });

  it("never schedules frequency 0", () => {
    const people = [person("zero", ["r"], 0), person("one", ["r"], 1)];
    const weeks = generate({ people, roles: [role("r", [PRE])], dates: sundays(3), rng: mulberry32(1) });
    expect(served(weeks, "zero")).toBe(0);
  });

  it("allows two roles in a week when sections do not overlap, counting one week of quota", () => {
    const people = [person("p", ["a", "b"], 1)];
    const [w] = generate({ people, roles: [role("a", [PRE]), role("b", [POST], { order: 1 })], dates: sundays(1), rng: mulberry32(1) });
    expect(w.assignments).toEqual({ a: ["p"], b: ["p"] });
    expect(w.gaps).toEqual([]);
  });

  it("processes roles in order, so the lower order wins a clash", () => {
    const people = [person("p", ["a", "b"], 1)];
    const roles = [role("a", [PRE], { order: 1 }), role("b", [PRE], { order: 0 })];
    const [w] = generate({ people, roles, dates: sundays(1), rng: mulberry32(1) });
    expect(w.assignments).toEqual({ a: [], b: ["p"] });
    expect(w.gaps).toEqual(["a"]);
  });

  it("leaves an infeasible cell partial, flags it and terminates", () => {
    const people = [person("p", ["welcome"], 1)];
    const roles = [role("welcome", [PRE], { needs: 2 }), role("nobody", [POST], { order: 1 })];
    const weeks = generate({ people, roles, dates: sundays(2), rng: mulberry32(1) });
    expect(weeks.map((w) => w.gaps)).toEqual([["welcome", "nobody"], ["welcome", "nobody"]]);
    expect(weeks[0].assignments).toEqual({ welcome: ["p"], nobody: [] });
  });

  it("does not mutate its inputs", () => {
    const freeze = <T>(x: T): T => {
      if (x && typeof x === "object") {
        Object.values(x).forEach(freeze);
        Object.freeze(x);
      }
      return x;
    };
    const people = freeze(structuredClone(PEOPLE));
    const roles = freeze(structuredClone(ROLES).reverse());
    const recent = freeze(lastWeek({ worship: ["gil"] }));
    expect(() => generate({ people, roles, dates: sundays(5), recent, rng: mulberry32(3) })).not.toThrow();
    expect(people).toEqual(PEOPLE);
  });

  it("handles empty people and empty roles", () => {
    const empty = generate({ people: [], roles: ROLES, dates: sundays(2), rng: mulberry32(1) });
    expect(empty.map((w) => w.gaps)).toEqual([ROLES.map((r) => r.id), ROLES.map((r) => r.id)]);
    expect(Object.values(empty[0].assignments).flat()).toEqual([]);
    expect(generate({ people: PEOPLE, roles: [], dates: sundays(1), rng: mulberry32(1) })).toEqual([
      { date: sundays(1)[0], assignments: {}, gaps: [] },
    ]);
  });

  it("blocks a consecutive role holder the week after within one run", () => {
    const people = [person("a", ["lead"]), person("b", ["lead"])];
    const roles = [role("lead", [PRE], { consecutiveDisabled: true })];
    for (const seed of SEEDS) {
      const weeks = generate({ people, roles, dates: sundays(4), rng: mulberry32(seed) });
      for (let i = 1; i < 4; i++) expect(weeks[i].assignments.lead).not.toEqual(weeks[i - 1].assignments.lead);
    }
  });

  it("leaves manual roles empty and never counts them as gaps", () => {
    const roles = [...ROLES, role("preaching", [], { order: 10, manual: true })];
    const people = PEOPLE.map((p) => ({ ...p, roles: [...p.roles, "preaching"] })); // even if someone held it
    for (const seed of SEEDS) {
      const weeks = generate({ people, roles, dates: sundays(3), rng: mulberry32(seed) });
      for (const w of weeks) {
        expect(w.assignments.preaching).toEqual([]);
        expect(w.gaps).not.toContain("preaching");
      }
    }
    const [w] = generate({ people: [], roles: [role("preaching", [], { manual: true })], dates: sundays(1), rng: mulberry32(1) });
    expect(w).toEqual({ date: sundays(1)[0], assignments: { preaching: [] }, gaps: [] });
  });

  it("does not count manual roles towards frequency", () => {
    const people = [person("a", ["r"], 0.5), person("b", ["r"], 0.5)];
    const roles = [role("r", [PRE]), role("preaching", [], { order: 1, manual: true })];
    const recent: Week[] = [
      { date: addDays(LAST_SUNDAY, -7), assignments: { r: ["b"], preaching: ["a"] } },
      { date: LAST_SUNDAY, assignments: { r: ["b"], preaching: ["a"] } },
    ];
    for (const seed of SEEDS) {
      // b served twice; a only preached, so a has served 0 of their quota and goes first.
      const [w] = generate({ people, roles, dates: sundays(1), recent, rng: mulberry32(seed) });
      expect(w.assignments.r).toEqual(["a"]);
    }
  });

  it("gives needs > 1 distinct people", () => {
    const people = [person("a", ["w"]), person("b", ["w"]), person("c", ["w"])];
    for (const seed of SEEDS) {
      const [w] = generate({ people, roles: [role("w", [PRE], { needs: 2 })], dates: sundays(1), rng: mulberry32(seed) });
      expect(new Set(w.assignments.w).size).toBe(2);
    }
  });

  it("fills real data without gaps for nearly every seed", () => {
    const seeds = Array.from({ length: 100 }, (_, i) => i + 1);
    const clean = seeds.filter((s) => real(s).every((w) => w.gaps.length === 0)).length;
    expect(clean).toBeGreaterThanOrEqual(95);
  });
});

describe("mulberry32", () => {
  it("repeats for a seed and stays in [0, 1)", () => {
    const a = mulberry32(42), b = mulberry32(42);
    const xs = Array.from({ length: 100 }, () => a());
    expect(xs).toEqual(Array.from({ length: 100 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBe(100);
  });
});
