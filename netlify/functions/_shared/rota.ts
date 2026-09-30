import type { Collection, ObjectId } from "mongodb";
import type { Assignments, Person, Role, Week } from "../../../src/shared/types";
import { json } from "./http";
import { calendarDb } from "./mongo";

export type RoleDoc = Omit<Role, "id"> & { _id: string };
export type PersonDoc = Omit<Person, "id"> & { _id: ObjectId };
export type WeekDoc = { date: string; assignments: Assignments };
export type Rota = { roles: Collection<RoleDoc>; people: Collection<PersonDoc>; weeks: Collection<WeekDoc> };

export async function rota(): Promise<Rota> {
  const db = await calendarDb();
  return {
    roles: db.collection<RoleDoc>("rota_roles"),
    people: db.collection<PersonDoc>("rota_people"),
    weeks: db.collection<WeekDoc>("rota_weeks"),
  };
}

export const toRole = ({ _id, ...rest }: RoleDoc): Role => ({ id: _id, ...rest });
export const toPerson = ({ _id, ...rest }: PersonDoc): Person => ({ id: _id.toHexString(), ...rest });
export const toWeek = ({ date, assignments }: WeekDoc): Week => ({ date, assignments });

/** Roles by `order`, people by name. */
export async function loadRolesAndPeople(c: Rota): Promise<{ roles: Role[]; people: Person[] }> {
  const [roles, people] = await Promise.all([
    c.roles.find().sort({ order: 1 }).toArray(),
    c.people.find().sort({ name: 1 }).toArray(),
  ]);
  return { roles: roles.map(toRole), people: people.map(toPerson) };
}

const MAX_BODY = 16_384; // the largest real body (5 weeks x ~10 roles) is ~3 KB

/** Parsed JSON body (undefined when malformed), or a 413 Response when oversized. */
export async function readBody(req: Request): Promise<unknown> {
  // ponytail: buffers before measuring; Netlify already caps bodies at 6 MB.
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "Request body too large" }, 413);
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
