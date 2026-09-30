import { ObjectId, type UpdateFilter } from "mongodb";
import { londonISO, nextSunday } from "../../src/shared/dates";
import { planDates } from "../../src/shared/schedule";
import { badRequest, guarded, json, notFound, route } from "./_shared/http";
import { type Rota, type WeekDoc, loadRolesAndPeople, readBody, rota, toWeek } from "./_shared/rota";
import { cellBody, sundayDate, weeksBody } from "./_shared/validate";

const today = () => londonISO(new Date());
const TAKEN = "Some of these Sundays are already on the rota";
/** The most weeks one save may add; the dates must be among the next this many unfilled Sundays. */
const MAX_BATCH = 5;

// The duplicate-key backstop below needs the unique index; ensured once per warm instance (idempotent).
let dateIndex: Promise<unknown> | undefined;
const ensureDateIndex = (c: Rota) =>
  (dateIndex ??= c.weeks.createIndex({ date: 1 }, { unique: true }).catch((err) => {
    dateIndex = undefined;
    throw err;
  }));

export default route({
  /** Public: names only, never frequencies or roles held. */
  GET: async () => {
    const c = await rota();
    const { roles, people } = await loadRolesAndPeople(c);
    const weeks = await c.weeks.find({ date: { $gte: today() } }).sort({ date: 1 }).toArray();
    return json({ roles, people: people.map(({ id, name }) => ({ id, name })), weeks: weeks.map(toWeek) });
  },

  /** Saves a previewed batch. Every cell is re-validated; nothing is stored if any date is taken. */
  POST: guarded(async (req) => {
    const body = await readBody(req);
    if (body instanceof Response) return body;
    const c = await rota();
    const { roles, people } = await loadRolesAndPeople(c);
    const parsed = weeksBody(body, roles, people, today());
    if (!parsed.ok) return badRequest(parsed.error);
    const dates = parsed.value.map((w) => w.date);
    const taken = async () => (await c.weeks.find({ date: { $in: dates } }).toArray()).map((w) => w.date);
    const existing = await taken();
    if (existing.length) return json({ error: TAKEN, dates: existing }, 409);
    const coming = nextSunday(new Date());
    const future = await c.weeks.find({ date: { $gte: coming } }, { projection: { date: 1 } }).toArray();
    const open = new Set(planDates(coming, future, MAX_BATCH));
    const outside = dates.filter((d) => !open.has(d));
    if (outside.length) return badRequest(`Only the next ${MAX_BATCH} free Sundays can be added, not ${outside.join(", ")}`);
    const docs = parsed.value.map((w) => ({ _id: new ObjectId(), ...w }));
    await ensureDateIndex(c);
    try {
      await c.weeks.insertMany(docs);
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      // Lost a race on the unique date index: undo whatever of this batch got in, by our own ids.
      await c.weeks.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
      return json({ error: TAKEN, dates: await taken() }, 409);
    }
    return json({ weeks: parsed.value }, 201);
  }),

  PUT: guarded(async (req, url) => {
    const date = sundayDate(url.searchParams.get("date"), today());
    if (!date.ok) return badRequest(date.error);
    const body = await readBody(req);
    if (body instanceof Response) return body;
    const c = await rota();
    const { roles, people } = await loadRolesAndPeople(c);
    const stored = await c.weeks.findOne({ date: date.value });
    if (!stored) return notFound("No such week");
    // People already in the stored cell may stay after they stop holding the role.
    const parsed = cellBody(body, roles, people, stored.assignments);
    if (!parsed.ok) return badRequest(parsed.error);
    // roleId is a known role id here, so the dotted path is safe.
    const update = { $set: { [`assignments.${parsed.value.roleId}`]: parsed.value.personIds } } as UpdateFilter<WeekDoc>;
    const week = await c.weeks.findOneAndUpdate({ date: date.value }, update, { returnDocument: "after" });
    return week ? json({ week: toWeek(week) }) : notFound("No such week");
  }),

  DELETE: guarded(async (_req, url) => {
    const date = sundayDate(url.searchParams.get("date"), today());
    if (!date.ok) return badRequest(date.error);
    const { deletedCount } = await (await rota()).weeks.deleteOne({ date: date.value });
    return deletedCount ? json({ ok: true }) : notFound("No such week");
  }),
});
