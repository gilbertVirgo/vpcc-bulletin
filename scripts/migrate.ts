// One-off, idempotent import into the calendar DB named by CALENDAR_MONGODB_URI.
//   npm run migrate -- --dry-run                         print the report, touch nothing (no DB connection)
//   npm run migrate                                      write to a *_dev DB
//   CALENDAR_MONGODB_URI='<prod>' npm run migrate -- --production
// Options: --data <rota-scheduler data dir> (default ~/rota-scheduler/data)
//          --credentials <service account json> (default google/credentials.json); needs GOOGLE_SHEET_ID
import { existsSync, readFileSync } from "node:fs";
import { londonISO } from "../src/shared/dates.ts";
import { argValue, assertWritable, connect, ensureIndexes, loadSchedulerData, upsertRolesAndPeople } from "./lib.ts";
import { type SheetWeek, flipSheet } from "./sheet.ts";

async function readSheet(credentialsPath: string): Promise<string[][] | null> {
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

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const data = await loadSchedulerData(argValue(argv, "--data"));
console.log(`Scheduler data: ${data.roles.length} roles, ${data.people.length} people.`);

const values = await readSheet(argValue(argv, "--credentials") ?? "google/credentials.json");
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

if (dryRun) {
  console.log("Dry run: nothing written.");
} else {
  const uri = process.env.CALENDAR_MONGODB_URI ?? "";
  const name = assertWritable(uri, argv);
  const { client, db } = await connect(uri);
  try {
    await ensureIndexes(db);
    await upsertRolesAndPeople(db, data);
    const people = await db.collection<{ name: string }>("rota_people").find().toArray();
    const ids = new Map(people.map((p) => [p.name, p._id.toHexString()]));
    for (const w of weeks) {
      const assignments = Object.fromEntries(
        Object.entries(w.assignments).map(([role, names]) => [role, names.map((n) => ids.get(n)!)]),
      );
      await db.collection("rota_weeks").updateOne({ date: w.date }, { $set: { assignments } }, { upsert: true });
    }
    console.log(`Wrote to ${name}: ${data.roles.length} roles, ${data.people.length} people, ${weeks.length} week(s).`);
  } finally {
    await client.close();
  }
}
