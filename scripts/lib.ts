import { type Db, MongoClient } from "mongodb";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

/** Roles keyed by scheduler id (order = array index); people keyed by name. Idempotent. */
export async function upsertRolesAndPeople(db: Db, data: { roles: SeedRole[]; people: SeedPerson[] }): Promise<void> {
  if (data.roles.length) {
    await db.collection<{ _id: string }>("rota_roles").bulkWrite(
      data.roles.map((r, order) => ({
        updateOne: {
          filter: { _id: r.id },
          update: {
            $set: { name: r.name, needs: r.needs, busyFor: r.busyFor, consecutiveDisabled: Boolean(r.consecutiveDisabled), order },
          },
          upsert: true,
        },
      })),
    );
  }
  if (data.people.length) {
    await db.collection("rota_people").bulkWrite(
      data.people.map((p) => ({
        updateOne: { filter: { name: p.name }, update: { $set: { roles: p.roles, frequency: p.frequency } }, upsert: true },
      })),
    );
  }
}
