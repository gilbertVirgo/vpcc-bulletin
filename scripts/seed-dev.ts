// Usage: npm run seed:dev [-- --data <rota-scheduler data dir>]
// Seeds calendar_dev: roles, people, indexes and a general-role test user. Never runs against a non-_dev DB.
import bcrypt from "bcryptjs";
import { argValue, assertWritable, connect, ensureIndexes, loadSchedulerData, upsertRolesAndPeople } from "./lib.ts";

const argv = process.argv.slice(2);
const uri = process.env.CALENDAR_MONGODB_URI ?? "";
const username = process.env.DEV_TEST_USERNAME;
const password = process.env.DEV_TEST_PASSWORD;
if (!username || !password) throw new Error("DEV_TEST_USERNAME and DEV_TEST_PASSWORD must be set in .env");

const name = assertWritable(uri, argv, true);
const data = await loadSchedulerData(argValue(argv, "--data"));
const { client, db } = await connect(uri);
try {
  await ensureIndexes(db);
  await upsertRolesAndPeople(db, data);
  await db
    .collection("users")
    .updateOne({ username }, { $set: { password: await bcrypt.hash(password, 10), role: "general" } }, { upsert: true });
  console.log(`Seeded ${name}: ${data.roles.length} roles, ${data.people.length} people, user ${username}.`);
} finally {
  await client.close();
}
