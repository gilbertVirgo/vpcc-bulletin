import { verifySession } from "./auth";

export const hubUrl = (): string => process.env.AUTH_HUB_URL || "https://auth.vpcc.church";

export const json = (body: unknown, status = 200): Response => Response.json(body, { status });
export const badRequest = (error: string): Response => json({ error }, 400);
export const notFound = (error = "Not found"): Response => json({ error }, 404);
/** 401 carries the hub URL so the browser knows where to sign in. */
export const unauthorized = (): Response => json({ error: "Unauthorized", hub: hubUrl() }, 401);

export type Handler = (req: Request, url: URL) => Promise<Response>;
type Method = "GET" | "POST" | "PUT" | "DELETE";

/** Dispatch by method; others 405. Errors are logged and returned as a bare 500. */
export function route(handlers: Partial<Record<Method, Handler>>) {
  return async (req: Request): Promise<Response> => {
    const handler = handlers[req.method as Method];
    if (!handler) return json({ error: "Method not allowed" }, 405);
    try {
      return await handler(req, new URL(req.url));
    } catch (err) {
      console.error(err);
      return json({ error: "Internal error" }, 500);
    }
  };
}

/**
 * Requires a session. POST/PUT must be JSON: that forces a CORS preflight
 * cross-origin, which this site never answers, so sibling *.vpcc.church sites
 * cannot forge writes with the shared cookie.
 */
export function guarded(handler: Handler): Handler {
  return async (req, url) => {
    if (!verifySession(req)) return unauthorized();
    const isWrite = req.method === "POST" || req.method === "PUT";
    if (isWrite && !req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "Expected application/json" }, 415);
    }
    return handler(req, url);
  };
}
