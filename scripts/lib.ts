import { type Db, MongoClient } from "mongodb";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

/** Shapes of rota-scheduler's data/roles.js and data/users.js (order and manual are ours). */
export type SeedRole = {
  id: string; name: string; needs: number; busyFor: number[]; consecutiveDisabled?: boolean; order?: number; manual?: boolean;
};
export type SeedPerson = { name: string; roles: string[]; frequency: number };

export function dbName(uri: string): string {
  return new URL(uri).pathname.replace(/^\//, "");
}

/** Returns the DB name, or throws unless it ends in _dev (or --production is passed and devOnly is false). */
export function assertWritable(uri: string, argv: string[], devOnly = false): string {
  const name = dbName(uri);
  if (!name) throw new Error("CALENDAR_MONGODB_URI has no database name in its path");
  if (name.endsWith("_dev")) return name;
  if (!devOnly && argv.includes("--production")) return name;
  throw new Error(
    `Refusing to write to "${name}": not a *_dev database${devOnly ? "" : " (pass --production to override)"}`,
  );
}

export function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Roles rota-scheduler does not know about: filled by hand in the app, never generated. */
export const MANUAL_ROLES: SeedRole[] = [
  { id: "preaching", name: "Preaching", needs: 1, busyFor: [], consecutiveDisabled: false, order: 10, manual: true },
];

/** rota-scheduler's roles and people, plus MANUAL_ROLES. */
export async function loadSchedulerData(
  dir = join(homedir(), "rota-scheduler", "data"),
): Promise<{ roles: SeedRole[]; people: SeedPerson[] }> {
  const load = async (file: string) => (await import(pathToFileURL(resolve(dir, file)).href)).default;
  return { roles: [...(await load("roles.js")), ...MANUAL_ROLES], people: await load("users.js") };
}

export async function connect(uri: string): Promise<{ client: MongoClient; db: Db }> {
  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 }).connect();
  return { client, db: client.db() };
}

export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection("rota_weeks").createIndex({ date: 1 }, { unique: true });
}

export type Doc = Record<string, unknown>;

/** rota_roles documents as stored: _id = scheduler id, order = given order or array index. */
export const roleDocs = (roles: SeedRole[]): Doc[] =>
  roles.map((r, i) => ({
    _id: r.id, name: r.name, needs: r.needs, busyFor: r.busyFor, consecutiveDisabled: Boolean(r.consecutiveDisabled),
    order: r.order ?? i, manual: Boolean(r.manual),
  }));

/** rota_people fields the migration owns (keyed by name; _id is left to Mongo). */
export const personDocs = (people: SeedPerson[]): Doc[] =>
  people.map((p) => ({ name: p.name, roles: p.roles, frequency: p.frequency }));

export type Diff = {
  insert: string[];
  update: { key: string; fields: string[] }[];
  unchanged: string[];
  /** Left untouched: in the DB but not in the source, or (insert-only) already in the DB. Never deleted. */
  kept: string[];
};

/**
 * What upserting `desired` by `key` would do to `current`. Only desired fields are compared.
 * `insertOnly`: docs already in the DB are kept as they are, never updated.
 */
export function diffDocs(current: Doc[], desired: Doc[], key: string, insertOnly = false): Diff {
  const byKey = new Map(current.map((d) => [String(d[key]), d]));
  const diff: Diff = { insert: [], update: [], unchanged: [], kept: [] };
  for (const d of desired) {
    const k = String(d[key]);
    const have = byKey.get(k);
    if (!have) {
      diff.insert.push(k);
      continue;
    }
    if (insertOnly) continue;
    const fields = Object.keys(d).filter((f) => f !== key && !isDeepStrictEqual(d[f], have[f]));
    if (fields.length) diff.update.push({ key: k, fields });
    else diff.unchanged.push(k);
  }
  const wanted = new Set(desired.map((d) => String(d[key])));
  diff.kept = [...byKey.keys()].filter((k) => insertOnly || !wanted.has(k));
  return diff;
}

/** bulkWrite upserts matched by `key`; `insertOnly` leaves docs that already exist untouched. */
export const upserts = (docs: Doc[], key: string, insertOnly = false) =>
  docs.map(({ [key]: k, ...rest }) => ({
    updateOne: { filter: { [key]: k }, update: insertOnly ? { $setOnInsert: rest } : { $set: rest }, upsert: true },
  }));

/** Roles upserted by scheduler id; people inserted by name, so edits made in the app survive a re-run. */
export async function upsertRolesAndPeople(db: Db, data: { roles: SeedRole[]; people: SeedPerson[] }): Promise<void> {
  if (data.roles.length) await db.collection<Doc>("rota_roles").bulkWrite(upserts(roleDocs(data.roles), "_id"));
  if (data.people.length) await db.collection<Doc>("rota_people").bulkWrite(upserts(personDocs(data.people), "name", true));
}
