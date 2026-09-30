export type Role = {
  id: string;
  name: string;
  needs: number;
  busyFor: number[]; // 0 pre-service, 1 during, 2 post-service
  consecutiveDisabled: boolean;
  order: number;
  manual: boolean; // filled by hand only: generate() leaves it empty, and anyone may be put in it
};
export type Person = { id: string; name: string; roles: string[]; frequency: number };
export type PersonName = { id: string; name: string };
export type PersonInput = { name: string; roles: string[]; frequency: number };
export type Assignments = Record<string, string[]>; // role id -> person ids
export type Week = { date: string; assignments: Assignments };
export type GeneratedWeek = Week & { gaps: string[] }; // role ids left short
export type SessionUser = { id: string; username: string; role: string };
export type Me = { user: SessionUser | null; hub: string };
export type RotaResponse = { roles: Role[]; people: PersonName[]; weeks: Week[] };
export type PeopleResponse = { people: Person[]; roles: Role[] };
