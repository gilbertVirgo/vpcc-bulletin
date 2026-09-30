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
    // Newest 8 stored weeks, past or future: frequency is accounted over them plus the new dates.
    const stored = (await c.weeks.find().sort({ date: -1 }).limit(RECENT_WEEKS).toArray()).map(toWeek);
    const { dates, recent } = planDates(nextSunday(new Date()), stored, count.value);
    return json({ weeks: generate({ people, roles, dates, recent, rng: Math.random }) });
  }),
});
