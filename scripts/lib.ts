import { type Db, MongoClient } from "mongodb";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

/** Shapes of rota-scheduler's data/roles.js and data/users.js. */
export type SeedRole = { id: string; name: string; needs: number; busyFor: number[]; consecutiveDisabled?: boolean };
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

export async function loadSchedulerData(
  dir = join(homedir(), "rota-scheduler", "data"),
): Promise<{ roles: SeedRole[]; people: SeedPerson[] }> {
  const load = async (file: string) => (await import(pathToFileURL(resolve(dir, file)).href)).default;
  return { roles: await load("roles.js"), people: await load("users.js") };
}

export async function connect(uri: string): Promise<{ client: MongoClient; db: Db }> {
  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 }).connect();
  return { client, db: client.db() };
}

export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection("rota_weeks").createIndex({ date: 1 }, { unique: true });
}

export type Doc = Record<string, unknown>;

/** rota_roles documents as stored: _id = scheduler id, order = array index. */
export const roleDocs = (roles: SeedRole[]): Doc[] =>
  roles.map((r, order) => ({
    _id: r.id, name: r.name, needs: r.needs, busyFor: r.busyFor, consecutiveDisabled: Boolean(r.consecutiveDisabled), order,
  }));

/** rota_people fields the migration owns (keyed by name; _id is left to Mongo). */
export const personDocs = (people: SeedPerson[]): Doc[] =>
  people.map((p) => ({ name: p.name, roles: p.roles, frequency: p.frequency }));

export type Diff = {
  insert: string[];
  update: { key: string; fields: string[] }[];
  unchanged: string[];
  /** In the DB but not in the source: left alone, never deleted. */
  kept: string[];
};

/** What upserting `desired` by `key` would do to `current`. Only desired fields are compared. */
export function diffDocs(current: Doc[], desired: Doc[], key: string): Diff {
  const byKey = new Map(current.map((d) => [String(d[key]), d]));
  const diff: Diff = { insert: [], update: [], unchanged: [], kept: [] };
  for (const d of desired) {
    const k = String(d[key]);
    const have = byKey.get(k);
    if (!have) {
      diff.insert.push(k);
      continue;
    }
    const fields = Object.keys(d).filter((f) => f !== key && !isDeepStrictEqual(d[f], have[f]));
    if (fields.length) diff.update.push({ key: k, fields });
    else diff.unchanged.push(k);
  }
  const wanted = new Set(desired.map((d) => String(d[key])));
  diff.kept = [...byKey.keys()].filter((k) => !wanted.has(k));
  return diff;
}

/** Roles keyed by scheduler id; people keyed by name. Idempotent. */
export async function upsertRolesAndPeople(db: Db, data: { roles: SeedRole[]; people: SeedPerson[] }): Promise<void> {
  const upserts = (docs: Doc[], key: string) =>
    docs.map(({ [key]: k, ...rest }) => ({ updateOne: { filter: { [key]: k }, update: { $set: rest }, upsert: true } }));
  if (data.roles.length) await db.collection<Doc>("rota_roles").bulkWrite(upserts(roleDocs(data.roles), "_id"));
  if (data.people.length) await db.collection<Doc>("rota_people").bulkWrite(upserts(personDocs(data.people), "name"));
}
