import { ObjectId, type UpdateFilter } from "mongodb";
import { londonISO } from "../../src/shared/dates";
import { badRequest, guarded, json, notFound, route } from "./_shared/http";
import { type WeekDoc, loadRolesAndPeople, readBody, rota, toPerson } from "./_shared/rota";
import { objectId, personInput } from "./_shared/validate";

// ponytail: check-then-write, so two simultaneous saves of one new name can both land; a unique index on name would close it.
const exists = (name: string) => json({ error: `${name} is already on the list` }, 409);

export default route({
  GET: guarded(async () => json(await loadRolesAndPeople(await rota()))),

  POST: guarded(async (req) => {
    const c = await rota();
    const { roles } = await loadRolesAndPeople(c);
    const body = await readBody(req);
    if (body instanceof Response) return body;
    const p = personInput(body, roles);
    if (!p.ok) return badRequest(p.error);
    if (await c.people.findOne({ name: p.value.name })) return exists(p.value.name);
    const _id = new ObjectId();
    await c.people.insertOne({ _id, ...p.value });
    return json({ person: { id: _id.toHexString(), ...p.value } }, 201);
  }),

  PUT: guarded(async (req, url) => {
    const id = objectId(url.searchParams.get("id"));
    if (!id) return badRequest("id required");
    const c = await rota();
    const { roles } = await loadRolesAndPeople(c);
    const body = await readBody(req);
    if (body instanceof Response) return body;
    const p = personInput(body, roles);
    if (!p.ok) return badRequest(p.error);
    const _id = new ObjectId(id);
    if (await c.people.findOne({ name: p.value.name, _id: { $ne: _id } })) return exists(p.value.name);
    const doc = await c.people.findOneAndUpdate({ _id }, { $set: p.value }, { returnDocument: "after" });
    return doc ? json({ person: toPerson(doc) }) : notFound("No such person");
  }),

  /** Also takes them off every week from today on; past weeks are left as they were. */
  DELETE: guarded(async (_req, url) => {
    const id = objectId(url.searchParams.get("id"));
    if (!id) return badRequest("id required");
    const c = await rota();
    const { roles } = await loadRolesAndPeople(c);
    const { deletedCount } = await c.people.deleteOne({ _id: new ObjectId(id) });
    if (!deletedCount) return notFound("No such person");
    const pull = Object.fromEntries(roles.map((r) => [`assignments.${r.id}`, id]));
    const { modifiedCount } = await c.weeks.updateMany(
      { date: { $gte: londonISO(new Date()) } },
      { $pull: pull } as UpdateFilter<WeekDoc>,
    );
    return json({ ok: true, weeksUpdated: modifiedCount });
  }),
});
