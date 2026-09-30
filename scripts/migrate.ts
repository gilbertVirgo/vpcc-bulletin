// Idempotent import (roles updated; people and weeks only inserted, so app edits survive a re-run) into the calendar DB named by CALENDAR_MONGODB_URI.
//   npm run migrate -- --dry-run                         read-only: diff against the target DB, writes nothing
//   npm run migrate                                      write to a *_dev DB
//   CALENDAR_MONGODB_URI='<prod>' npm run migrate -- --production
// Options: --data <rota-scheduler data dir> (default ~/rota-scheduler/data)
//          --credentials <service account json> (default google/credentials.json); needs GOOGLE_SHEET_ID
//          --sheet-fixture <json file> sheet rows (string[][], header first) instead of the live sheet
import { existsSync, readFileSync } from "node:fs";
import type { Db } from "mongodb";
import { londonISO } from "../src/shared/dates.ts";
import {
  type Diff, type Doc, argValue, assertWritable, connect, dbName, diffDocs, ensureIndexes, loadSchedulerData,
  personDocs, roleDocs, upsertRolesAndPeople, upserts,
} from "./lib.ts";
import { type SheetWeek, flipSheet } from "./sheet.ts";

async function readSheet(credentialsPath: string, fixture: string | undefined): Promise<string[][] | null> {
  if (fixture) {
    console.log(`Sheet rows from fixture ${fixture}.`);
    return JSON.parse(readFileSync(fixture, "utf8"));
  }
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId || !existsSync(credentialsPath)) {
    console.log(`Sheet step skipped: ${sheetId ? `${credentialsPath} not found` : "GOOGLE_SHEET_ID not set"}.`);
    return null;
  }
  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(credentialsPath, "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const res = await google.sheets({ version: "v4", auth }).spreadsheets.values.get({ spreadsheetId: sheetId, range: "Sundays!A1:Z" });
  return (res.data.values ?? []) as string[][];
}

/** Week docs with person names swapped for id hex strings. Unknown ids (dry run, person not yet inserted) → "new:<name>". */
const weekDocs = (weeks: SheetWeek[], ids: Map<string, string>): Doc[] =>
  weeks.map((w) => ({
    date: w.date,
    assignments: Object.fromEntries(
      Object.entries(w.assignments).map(([role, names]) => [role, names.map((n) => ids.get(n) ?? `new:${n}`)]),
    ),
  }));

const personIds = (people: Doc[]) => new Map(people.map((p) => [String(p.name), String(p._id)]));

function printDiff(collection: string, d: Diff): void {
  console.log(
    `${collection}: ${d.insert.length} insert, ${d.update.length} update, ${d.unchanged.length} unchanged, ${d.kept.length} kept (left untouched)`,
  );
  for (const k of d.insert) console.log(`  + ${k}`);
  for (const u of d.update) console.log(`  ~ ${u.key}: ${u.fields.join(", ")}`);
  for (const k of d.kept) console.log(`  = ${k} (kept)`);
}

/** Dry run: reads only. No assertWritable here on purpose — this path has no write calls, so any DB is safe. */
async function dryRun(db: Db, data: Awaited<ReturnType<typeof loadSchedulerData>>, weeks: SheetWeek[]): Promise<void> {
  const read = (name: string) => db.collection<Doc>(name).find().toArray();
  const [roles, people, stored] = await Promise.all([read("rota_roles"), read("rota_people"), read("rota_weeks")]);
  console.log(`Dry run against ${db.databaseName} (read-only):`);
  printDiff("rota_roles", diffDocs(roles, roleDocs(data.roles), "_id"));
  printDiff("rota_people", diffDocs(people, personDocs(data.people), "name", true));
  printDiff("rota_weeks", diffDocs(stored, weekDocs(weeks, personIds(people)), "date", true));
  console.log("Dry run: nothing written.");
}

async function write(db: Db, data: Awaited<ReturnType<typeof loadSchedulerData>>, weeks: SheetWeek[]): Promise<void> {
  await ensureIndexes(db);
  await upsertRolesAndPeople(db, data);
  const ids = personIds(await db.collection<Doc>("rota_people").find().toArray());
  const docs = weekDocs(weeks, ids);
  if (docs.length) await db.collection<Doc>("rota_weeks").bulkWrite(upserts(docs, "date", true));
  console.log(
    `Wrote to ${db.databaseName}: ${data.roles.length} roles upserted; of ${data.people.length} people and ${weeks.length} week(s), ` +
      "only those not already in the DB were inserted (run --dry-run to see which are kept).",
  );
}

const argv = process.argv.slice(2);
const isDryRun = argv.includes("--dry-run");
const uri = process.env.CALENDAR_MONGODB_URI ?? "";
// Check the target before any work: the write path refuses non-_dev without --production.
if (isDryRun) {
  if (!dbName(uri)) throw new Error("CALENDAR_MONGODB_URI has no database name in its path");
} else {
  assertWritable(uri, argv);
}

const data = await loadSchedulerData(argValue(argv, "--data"));
console.log(`Scheduler data: ${data.roles.length} roles, ${data.people.length} people.`);

const values = await readSheet(argValue(argv, "--credentials") ?? "google/credentials.json", argValue(argv, "--sheet-fixture"));
const { weeks, skipped }: { weeks: SheetWeek[]; skipped: string[] } = values
  ? flipSheet(values, londonISO(new Date()), data.roles, data.people)
  : { weeks: [], skipped: [] };
console.log(`Sheet: ${weeks.length} week(s) dated today or later.`);
for (const w of weeks) {
  const cells = Object.entries(w.assignments).filter(([, names]) => names.length);
  console.log(`  ${w.date}  ${cells.map(([role, names]) => `${role}=${names.join("+")}`).join("  ")}`);
}
if (skipped.length) {
  console.log(`Skipped (${skipped.length}):`);
  for (const s of skipped) console.log(`  - ${s}`);
}

const { client, db } = await connect(uri);
try {
  await (isDryRun ? dryRun : write)(db, data, weeks);
} finally {
  await client.close();
}
