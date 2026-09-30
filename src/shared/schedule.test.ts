import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { mulberry32 } from "./rng";
import { generate, planDates, quota } from "./schedule";
import type { GeneratedWeek, Person, Role } from "./types";

const PRE = 0, DURING = 1, POST = 2;
const role = (id: string, busyFor: number[], extra: Partial<Role> = {}): Role => ({
  id, name: id, needs: 1, busyFor, consecutiveDisabled: false, order: 0, ...extra,
});
const person = (id: string, roles: string[], frequency = 1, name = id): Person => ({ id, name, roles, frequency });
const sundays = (n: number) => Array.from({ length: n }, (_, i) => addDays("2026-10-04", 7 * i));
const servedIn = (w: GeneratedWeek, id: string) => Object.values(w.assignments).some((ids) => ids.includes(id));
const served = (weeks: GeneratedWeek[], id: string) => weeks.filter((w) => servedIn(w, id)).length;
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

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
    [0.8, 5, 4], [0.2, 5, 1], [0.2, 1, 0], [0.5, 1, 1], [1, 4, 4],
    [0, 5, 0], [1, 0, 0], [Number.NaN, 3, 0], [1.5, 2, 2],
  ])("quota(%d, %d) = %d", (f, w, want) => {
    expect(quota(f, w)).toBe(want);
  });
});

describe("planDates", () => {
  const coming = "2026-10-04";
  const a = { worship: ["gil"] };
  it("starts at the coming Sunday when nothing is stored", () => {
    expect(planDates(coming, null, 3)).toEqual({ dates: ["2026-10-04", "2026-10-11", "2026-10-18"], history: null });
  });
  it("continues after the last future week and uses it as history", () => {
    expect(planDates(coming, { date: "2026-10-18", assignments: a }, 1)).toEqual({ dates: ["2026-10-25"], history: a });
    expect(planDates(coming, { date: coming, assignments: a }, 1)).toEqual({ dates: ["2026-10-11"], history: a });
  });
  it("uses last Sunday as history when it is the week before", () => {
    expect(planDates(coming, { date: "2026-09-27", assignments: a }, 1)).toEqual({ dates: [coming], history: a });
  });
  it("ignores an older last week", () => {
    expect(planDates(coming, { date: "2026-09-13", assignments: a }, 1)).toEqual({ dates: [coming], history: null });
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
      const [w] = generate({ people: PEOPLE, roles: ROLES, dates: sundays(1), history: { worship: ["gil"] }, rng: mulberry32(seed) });
      expect(servedIn(w, "gil")).toBe(false);
      expect(w.assignments.worship).toEqual(["jonny"]);
    }
  });

  it("puts last week's servers at the back when fairness is equal", () => {
    const people = [person("a", ["r"]), person("b", ["r"])];
    for (const seed of SEEDS) {
      const [w] = generate({ people, roles: [role("r", [PRE])], dates: sundays(1), history: { r: ["a"] }, rng: mulberry32(seed) });
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
    const history = freeze({ worship: ["gil"] });
    expect(() => generate({ people, roles, dates: sundays(5), history, rng: mulberry32(3) })).not.toThrow();
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
