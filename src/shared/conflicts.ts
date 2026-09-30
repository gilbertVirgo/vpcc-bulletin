import { addDays } from "./dates";
import type { Person, Role, Week } from "./types";

/**
 * Rule breaks in a rota, as `${date}/${roleId}` -> messages, for cells edited by hand. The same rules
 * generate() keeps: no section clash within a week, nobody serves the week after a consecutive role
 * (manual roles do not count as serving), and non-manual roles only go to people who hold them.
 */
export function findConflicts(weeks: Week[], roles: Role[], people: Person[]): Map<string, string[]> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.name ?? "Unknown";
  const byDate = new Map(weeks.map((w) => [w.date, w.assignments]));
  const out = new Map<string, string[]>();
  const add = (date: string, roleId: string, msg: string) => {
    const key = `${date}/${roleId}`;
    out.set(key, [...(out.get(key) ?? []), msg]);
  };

  for (const { date, assignments } of weeks) {
    const previous = byDate.get(addDays(date, -7)) ?? {};
    const inRoles = (id: string) => roles.filter((r) => assignments[r.id]?.includes(id));
    for (const role of roles) {
      for (const id of assignments[role.id] ?? []) {
        const person = byId.get(id);
        if (!role.manual && person && !person.roles.includes(role.id)) add(date, role.id, `${name(id)} does not do ${role.name}`);
        const clash = inRoles(id).filter((r) => r !== role && r.busyFor.some((s) => role.busyFor.includes(s)));
        if (clash.length) add(date, role.id, `${name(id)} is also on ${clash.map((r) => r.name).join(", ")} at the same time`);
        const last = roles.filter((r) => r.consecutiveDisabled && previous[r.id]?.includes(id));
        if (!role.manual && last.length) add(date, role.id, `${name(id)} was on ${last.map((r) => r.name).join(", ")} the week before`);
      }
    }
  }
  return out;
}
