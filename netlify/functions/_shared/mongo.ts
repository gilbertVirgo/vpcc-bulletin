import { type Db, MongoClient } from "mongodb";

// Cached across warm invocations; a failed connect is evicted so the next call retries.
let client: Promise<MongoClient> | undefined;

/** DB name comes from the URI path (calendar in prod, calendar_dev locally). */
export async function calendarDb(): Promise<Db> {
  const uri = process.env.CALENDAR_MONGODB_URI;
  if (!uri) throw new Error("CALENDAR_MONGODB_URI not set");
  client ??= new MongoClient(uri, { maxPoolSize: 1, maxIdleTimeMS: 60_000, serverSelectionTimeoutMS: 10_000 })
    .connect()
    .catch((err) => {
      client = undefined;
      throw err;
    });
  return (await client).db();
}
