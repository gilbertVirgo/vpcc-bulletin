import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { guarded, readJson, route } from "./http";

const SECRET = "test-secret";
const cookie = () => `vpcc_session=${jwt.sign({ id: "1", username: "tester", role: "general" }, SECRET)}`;
const req = (method: string, headers: Record<string, string> = {}, body?: string) =>
  new Request("http://localhost/api/x", { method, headers, body });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("JWT_SECRET", SECRET);
});

const handler = route({
  GET: async (_req, url) => Response.json({ path: url.pathname }),
  POST: guarded(async () => Response.json({ ok: true })),
  PUT: async () => {
    throw new Error("secret detail");
  },
});

describe("route", () => {
  it("dispatches by method", async () => {
    const res = await handler(req("GET"));
    expect(await res.json()).toEqual({ path: "/api/x" });
  });
  it("405s other methods", async () => {
    expect((await handler(req("PATCH"))).status).toBe(405);
  });
  it("hides handler errors behind a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handler(req("PUT"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
  });
});

describe("guarded", () => {
  it("401s with the hub URL when there is no session", async () => {
    vi.stubEnv("AUTH_HUB_URL", "http://localhost:8888");
    const res = await handler(req("POST", { "content-type": "application/json" }, "{}"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized", hub: "http://localhost:8888" });
  });
  it("defaults the hub to auth.vpcc.church", async () => {
    const res = await handler(req("POST", { "content-type": "application/json" }, "{}"));
    expect((await res.json()).hub).toBe("https://auth.vpcc.church");
  });
  it("415s a write that is not JSON", async () => {
    const res = await handler(req("POST", { cookie: cookie(), "content-type": "text/plain" }, "{}"));
    expect(res.status).toBe(415);
  });
  it("runs the handler for a JSON write with a session", async () => {
    const res = await handler(req("POST", { cookie: cookie(), "content-type": "application/json" }, "{}"));
    expect(res.status).toBe(200);
  });
});

describe("readJson", () => {
  it("parses JSON and returns undefined for junk", async () => {
    expect(await readJson(req("POST", {}, '{"a":1}'))).toEqual({ a: 1 });
    expect(await readJson(req("POST", {}, "{nope"))).toBeUndefined();
  });
});
