import { isRealDate, isSunday } from "../../../src/shared/dates";
import type { Assignments, Person, PersonInput, Role, Week } from "../../../src/shared/types";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const OBJECT_ID = /^[0-9a-f]{24}$/;
export const objectId = (v: string | null): string | null => (v && OBJECT_ID.test(v) ? v : null);

export function sundayDate(v: unknown, today: string): Result<string> {
  if (typeof v !== "string" || !isRealDate(v)) return fail("date must be YYYY-MM-DD");
  if (!isSunday(v)) return fail(`${v} is not a Sunday`);
  if (v < today) return fail(`${v} is in the past`);
  return ok(v);
}

export function weekCount(body: unknown): Result<number> {
  const n = isObj(body) ? body.weeks : undefined;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5
    ? ok(n)
    : fail("weeks must be a whole number from 1 to 5");
}

export function personInput(body: unknown, roles: Role[]): Result<PersonInput> {
  if (!isObj(body)) return fail("Expected a JSON object");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 60) return fail("name must be 1 to 60 characters");
  if (/\p{Cc}/u.test(name)) return fail("name must not contain control characters");
  const known = new Set(roles.map((r) => r.id));
  const list = body.roles;
  if (!Array.isArray(list) || !list.every((r) => typeof r === "string" && known.has(r)) || new Set(list).size !== list.length) {
    return fail("roles must be a list of unique known role ids");
  }
  const f = body.frequency;
  if (typeof f !== "number" || !Number.isFinite(f) || f < 0 || f > 1) return fail("frequency must be a number from 0 to 1");
  return ok({ name, roles: list as string[], frequency: f });
}

export function cell(roleId: unknown, personIds: unknown, roles: Role[], people: Person[]): Result<string[]> {
  const role = roles.find((r) => r.id === roleId);
  if (!role) return fail(`Unknown role ${String(roleId)}`);
  if (!Array.isArray(personIds) || personIds.length > role.needs || new Set(personIds).size !== personIds.length) {
    return fail(`${role.name} takes up to ${role.needs} different people`);
  }
  for (const id of personIds) {
    const p = typeof id === "string" && OBJECT_ID.test(id) ? people.find((x) => x.id === id) : undefined;
    if (!p) return fail(`Unknown person ${String(id)}`);
    if (!p.roles.includes(role.id)) return fail(`${p.name} does not do ${role.name}`);
  }
  return ok(personIds as string[]);
}

export function cellBody(body: unknown, roles: Role[], people: Person[]): Result<{ roleId: string; personIds: string[] }> {
  if (!isObj(body)) return fail("Expected a JSON object");
  const c = cell(body.roleId, body.personIds, roles, people);
  return c.ok ? ok({ roleId: body.roleId as string, personIds: c.value }) : c;
}

/** 1–5 unique future Sundays; every role key present in the result. */
export function weeksBody(body: unknown, roles: Role[], people: Person[], today: string): Result<Week[]> {
  const list = isObj(body) ? body.weeks : undefined;
  if (!Array.isArray(list) || list.length < 1 || list.length > 5) return fail("weeks must be a list of 1 to 5 weeks");
  const out: Week[] = [];
  const seen = new Set<string>();
  for (const w of list) {
    if (!isObj(w)) return fail("Each week must be an object");
    const d = sundayDate(w.date, today);
    if (!d.ok) return d;
    if (seen.has(d.value)) return fail(`${d.value} appears twice`);
    seen.add(d.value);
    const given = w.assignments;
    if (!isObj(given)) return fail(`${d.value}: assignments must be an object`);
    const unknown = Object.keys(given).find((k) => !roles.some((r) => r.id === k));
    if (unknown) return fail(`${d.value}: Unknown role ${unknown}`);
    const assignments: Assignments = {};
    for (const role of roles) {
      const c = cell(role.id, Object.hasOwn(given, role.id) ? given[role.id] : [], roles, people);
      if (!c.ok) return fail(`${d.value}: ${c.error}`);
      assignments[role.id] = c.value;
    }
    out.push({ date: d.value, assignments });
  }
  return ok(out);
}
