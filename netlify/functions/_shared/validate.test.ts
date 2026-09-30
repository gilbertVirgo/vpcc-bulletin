import { describe, expect, it } from "vitest";
import type { Person, Role } from "../../../src/shared/types";
import { cell, cellBody, objectId, personInput, sundayDate, weekCount, weeksBody } from "./validate";

const TODAY = "2026-09-30";
const GIL = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TOM = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ROLES: Role[] = [
  { id: "worship", name: "Worship", needs: 1, busyFor: [0, 1, 2], consecutiveDisabled: true, order: 0, manual: false },
  { id: "welcome", name: "Welcome", needs: 2, busyFor: [0], consecutiveDisabled: false, order: 1, manual: false },
  { id: "preaching", name: "Preaching", needs: 1, busyFor: [], consecutiveDisabled: false, order: 10, manual: true },
];
const PEOPLE: Person[] = [
  { id: GIL, name: "Gil", roles: ["worship", "welcome"], frequency: 0.8 },
  { id: TOM, name: "Tom", roles: ["welcome"], frequency: 0.8 },
];

describe("sundayDate", () => {
  it("accepts a future or current Sunday", () => {
    expect(sundayDate("2026-10-04", TODAY)).toEqual({ ok: true, value: "2026-10-04" });
    expect(sundayDate("2026-10-04", "2026-10-04").ok).toBe(true);
  });
  it.each([null, 5, "04/10/2026", "2026-02-30", "2026-10-05", "2026-09-27"])("rejects %s", (v) => {
    expect(sundayDate(v, TODAY).ok).toBe(false);
  });
});

describe("weekCount", () => {
  it("accepts integers 1..5", () => {
    expect(weekCount({ weeks: 5 })).toEqual({ ok: true, value: 5 });
  });
  it.each([0, 6, 2.5, "3", null])("rejects %s", (weeks) => {
    expect(weekCount({ weeks }).ok).toBe(false);
  });
});

describe("objectId", () => {
  it("accepts 24 lowercase hex only", () => {
    expect(objectId(GIL)).toBe(GIL);
    expect(objectId("xyz")).toBeNull();
    expect(objectId(null)).toBeNull();
    expect(objectId(GIL.toUpperCase())).toBeNull();
  });
});

describe("personInput", () => {
  it("trims and accepts a valid person", () => {
    expect(personInput({ name: "  Ann ", roles: ["welcome"], frequency: 0 }, ROLES)).toEqual({
      ok: true,
      value: { name: "Ann", roles: ["welcome"], frequency: 0 },
    });
  });
  it.each([
    { name: "   ", roles: [], frequency: 0.5 },
    { name: "x".repeat(61), roles: [], frequency: 0.5 },
    { name: "A\nB", roles: [], frequency: 0.5 },
    { name: 7, roles: [], frequency: 0.5 },
    { name: "Ann", roles: ["nope"], frequency: 0.5 },
    { name: "Ann", roles: ["welcome", "welcome"], frequency: 0.5 },
    { name: "Ann", roles: "welcome", frequency: 0.5 },
    { name: "Ann", roles: [], frequency: 1.1 },
    { name: "Ann", roles: [], frequency: -0.1 },
    { name: "Ann", roles: [], frequency: "0.5" },
    { name: "Ann", roles: [], frequency: Number.NaN },
    null,
  ])("rejects %j", (body) => {
    expect(personInput(body, ROLES).ok).toBe(false);
  });
});

describe("cell", () => {
  it("accepts holders up to needs, and empty", () => {
    expect(cell("welcome", [GIL, TOM], ROLES, PEOPLE)).toEqual({ ok: true, value: [GIL, TOM] });
    expect(cell("worship", [], ROLES, PEOPLE).ok).toBe(true);
  });
  it("rejects unknown roles, too many, duplicates, unknown people and non-holders", () => {
    expect(cell("nope", [], ROLES, PEOPLE).ok).toBe(false);
    expect(cell("worship", [GIL, TOM], ROLES, PEOPLE).ok).toBe(false);
    expect(cell("welcome", [GIL, GIL], ROLES, PEOPLE).ok).toBe(false);
    expect(cell("welcome", ["cccccccccccccccccccccccc"], ROLES, PEOPLE).ok).toBe(false);
    expect(cell("worship", [TOM], ROLES, PEOPLE)).toEqual({ ok: false, error: "Tom does not do Worship" });
    expect(cell("welcome", "x", ROLES, PEOPLE).ok).toBe(false);
  });
  it("keeps someone who no longer holds the role only when they are already in the stored cell", () => {
    expect(cell("worship", [TOM], ROLES, PEOPLE, [TOM])).toEqual({ ok: true, value: [TOM] });
    expect(cell("worship", [TOM], ROLES, PEOPLE, [GIL])).toEqual({ ok: false, error: "Tom does not do Worship" });
  });
  it("takes any existing person for a manual role, still checking ids, needs and duplicates", () => {
    expect(cell("preaching", [TOM], ROLES, PEOPLE)).toEqual({ ok: true, value: [TOM] });
    expect(cell("preaching", ["cccccccccccccccccccccccc"], ROLES, PEOPLE)).toEqual({ ok: false, error: "Unknown person cccccccccccccccccccccccc" });
    expect(cell("preaching", [GIL, TOM], ROLES, PEOPLE).ok).toBe(false);
    expect(cell("preaching", ["x"], ROLES, PEOPLE).ok).toBe(false);
  });
  it("cellBody wraps cell", () => {
    expect(cellBody({ roleId: "worship", personIds: [GIL] }, ROLES, PEOPLE)).toEqual({
      ok: true,
      value: { roleId: "worship", personIds: [GIL] },
    });
    expect(cellBody("nope", ROLES, PEOPLE).ok).toBe(false);
    expect(cellBody({ roleId: "worship", personIds: [TOM] }, ROLES, PEOPLE, { worship: [TOM] }).ok).toBe(true);
  });
});

describe("weeksBody", () => {
  const week = (date: string, assignments: Record<string, unknown> = { worship: [GIL] }) => ({ date, assignments });
  it("normalises every role key", () => {
    expect(weeksBody({ weeks: [week("2026-10-04")] }, ROLES, PEOPLE, TODAY)).toEqual({
      ok: true,
      value: [{ date: "2026-10-04", assignments: { worship: [GIL], welcome: [], preaching: [] } }],
    });
  });
  it("rejects bad batches", () => {
    const bad = (weeks: unknown) => weeksBody({ weeks }, ROLES, PEOPLE, TODAY).ok;
    expect(bad([])).toBe(false);
    expect(bad(Array.from({ length: 6 }, (_, i) => week(`2026-10-${String(4 + 7 * (i % 4)).padStart(2, "0")}`)))).toBe(false);
    expect(bad([week("2026-10-04"), week("2026-10-04")])).toBe(false);
    expect(bad([week("2026-10-05")])).toBe(false);
    expect(bad([week("2026-10-04", { nope: [] })])).toBe(false);
    expect(bad([week("2026-10-04", { worship: [TOM] })])).toBe(false);
    expect(bad([{ date: "2026-10-04" }])).toBe(false);
    expect(bad([week("2026-09-27")])).toBe(false); // past Sunday
    expect(bad([week("2026-10-04", { welcome: [GIL, GIL] })])).toBe(false);
    expect(bad([week("2026-10-04", { welcome: [GIL, 5] })])).toBe(false);
    expect(bad("x")).toBe(false);
  });
  it("ignores extra week keys such as gaps from a preview", () => {
    const r = weeksBody({ weeks: [{ ...week("2026-10-04"), gaps: ["welcome"] }] }, ROLES, PEOPLE, TODAY);
    expect(r).toEqual({ ok: true, value: [{ date: "2026-10-04", assignments: { worship: [GIL], welcome: [], preaching: [] } }] });
  });
});
