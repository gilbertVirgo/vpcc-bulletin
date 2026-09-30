import { nextSunday } from "../../src/shared/dates";
import { generate, planDates, RECENT_WEEKS } from "../../src/shared/schedule";
import { badRequest, guarded, json, route } from "./_shared/http";
import { loadRolesAndPeople, readBody, rota, toWeek } from "./_shared/rota";
import { weekCount } from "./_shared/validate";

/** Preview only: stores nothing. */
export default route({
  POST: guarded(async (req) => {
    const body = await readBody(req);
    if (body instanceof Response) return body;
    const count = weekCount(body);
    if (!count.ok) return badRequest(count.error);
    const c = await rota();
    const { roles, people } = await loadRolesAndPeople(c);
    // Every future week (to skip, and for the rules either side of a gap) plus the newest 8 before
    // them: that covers the 8 weeks before the first new date that frequency is accounted over.
    const coming = nextSunday(new Date());
    const [past, future] = await Promise.all([
      c.weeks.find({ date: { $lt: coming } }).sort({ date: -1 }).limit(RECENT_WEEKS).toArray(),
      c.weeks.find({ date: { $gte: coming } }).toArray(),
    ]);
    const recent = [...past, ...future].map(toWeek);
    const dates = planDates(coming, future, count.value);
    return json({ weeks: generate({ people, roles, dates, recent, rng: Math.random }) });
  }),
});
