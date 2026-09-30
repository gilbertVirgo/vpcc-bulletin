import { verifySession } from "./_shared/auth";
import { hubUrl, json, route } from "./_shared/http";

/** Always 200 so the header can render Login without a console 401. */
export default route({
  GET: async (req) => json({ user: verifySession(req), hub: hubUrl() }),
});
