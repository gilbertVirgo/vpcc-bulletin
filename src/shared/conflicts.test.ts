import { describe, expect, it } from "vitest";
import { findConflicts } from "./conflicts";
import type { Person, Role, Week } from "./types";

const role = (id: string, busyFor: number[], extra: Partial<Role> = {}): Role => ({
  id, name: id, needs: 1, busyFor, consecutiveDisabled: false, order: 0, manual: false, ...extra,
});
const person = (id: string, roles: string[]): Person => ({ id, name: id.toUpperCase(), roles, frequency: 1 });
const ROLES = [role("worship", [0, 1, 2], { consecutiveDisabled: true }), role("welcome", [0]), role("lunch", [2]), role("preach", [1], { manual: true })];
const PEOPLE = [person("a", ["worship", "welcome", "lunch"]), person("b", ["welcome", "lunch"])];

describe("findConflicts", () => {
  it("finds nothing in a clean rota", () => {
    const weeks: Week[] = [{ date: "2026-10-04", assignments: { worship: ["a"], welcome: ["b"] } }, { date: "2026-10-11", assignments: { welcome: ["b"], lunch: ["b"] } }];
    expect(findConflicts(weeks, ROLES, PEOPLE).size).toBe(0);
  });

  it("flags a section clash on both cells", () => {
    const c = findConflicts([{ date: "2026-10-04", assignments: { worship: ["a"], welcome: ["a"] } }], ROLES, PEOPLE);
    expect(c.get("2026-10-04/worship")).toEqual(["A is also on welcome at the same time"]);
    expect(c.get("2026-10-04/welcome")).toEqual(["A is also on worship at the same time"]);
  });

  it("flags serving the week after a consecutive role, but not a manual role", () => {
    const weeks: Week[] = [
      { date: "2026-10-04", assignments: { worship: ["a"] } },
      { date: "2026-10-11", assignments: { lunch: ["a"], preach: ["a"] } },
    ];
    const c = findConflicts(weeks, ROLES, PEOPLE);
    expect(c.get("2026-10-11/lunch")).toEqual(["A was on worship the week before"]);
    expect(c.has("2026-10-11/preach")).toBe(false);
  });

  it("flags someone in a role they do not hold, except manual roles", () => {
    const c = findConflicts([{ date: "2026-10-04", assignments: { worship: ["b"], preach: ["b"] } }], ROLES, PEOPLE);
    expect(c.get("2026-10-04/worship")).toEqual(["B does not do worship", "B is also on preach at the same time"]);
    expect(c.get("2026-10-04/preach")).toEqual(["B is also on worship at the same time"]);
  });
});
