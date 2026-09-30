import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCookie, cors, sessionCookie, verifySession } from "./auth";

const SECRET = "test-secret";
const USER = { id: "abc123", username: "admin", role: "admin" };

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("JWT_SECRET", SECRET);
});

describe("sessionCookie", () => {
  it("sets Domain and Secure on vpcc.church hosts", () => {
    expect(sessionCookie("tok", "auth.vpcc.church")).toBe(
      "vpcc_session=tok; Domain=.vpcc.church; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800",
    );
  });
  it("omits Domain and Secure on localhost", () => {
    expect(sessionCookie("tok", "localhost")).toBe(
      "vpcc_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800",
    );
  });
  it("honours COOKIE_DOMAIN", () => {
    vi.stubEnv("COOKIE_DOMAIN", ".example.org");
    expect(sessionCookie("tok", "auth.example.org")).toBe(
      "vpcc_session=tok; Domain=.example.org; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800",
    );
  });
});

describe("clearCookie", () => {
  it("expires the cookie with matching attributes", () => {
    expect(clearCookie("auth.vpcc.church")).toBe(
      "vpcc_session=; Domain=.vpcc.church; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    );
    expect(clearCookie("localhost")).toBe(
      "vpcc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });
});

describe("cors", () => {
  const req = (origin?: string) =>
    new Request("https://auth.vpcc.church/api/me", {
      headers: origin ? { origin } : {},
    });

  it.each(["https://trifold.vpcc.church", "http://localhost:5173"])(
    "allows %s with credentials",
    (origin) => {
      const h = cors(req(origin));
      expect(h["Access-Control-Allow-Origin"]).toBe(origin);
      expect(h["Access-Control-Allow-Credentials"]).toBe("true");
    },
  );

  it.each([undefined, "https://evil.com", "https://evilvpcc.church", "null"])(
    "returns no headers for %s",
    (origin) => {
      expect(cors(req(origin))).toEqual({});
    },
  );
});

describe("verifySession", () => {
  const token = jwt.sign(USER, SECRET, { expiresIn: "7d" });
  const at = (headers: Record<string, string>) =>
    new Request("https://auth.vpcc.church/api/me", { headers });

  it("reads the cookie", () => {
    expect(verifySession(at({ cookie: `a=1; vpcc_session=${token}` }))).toEqual(USER);
  });
  it("reads a Bearer header", () => {
    expect(verifySession(at({ authorization: `Bearer ${token}` }))).toEqual(USER);
  });
  it("falls back to Bearer when the cookie is invalid", () => {
    expect(
      verifySession(at({ cookie: "vpcc_session=junk", authorization: `Bearer ${token}` })),
    ).toEqual(USER);
  });
  it("rejects a token signed with another secret", () => {
    const bad = jwt.sign(USER, "other");
    expect(verifySession(at({ cookie: `vpcc_session=${bad}` }))).toBeNull();
  });
  it("rejects an expired token", () => {
    const old = jwt.sign({ ...USER, exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
    expect(verifySession(at({ cookie: `vpcc_session=${old}` }))).toBeNull();
  });
  it("returns null with no credentials", () => {
    expect(verifySession(at({}))).toBeNull();
  });
  it("throws when JWT_SECRET is missing", () => {
    vi.stubEnv("JWT_SECRET", "");
    expect(() => verifySession(at({}))).toThrow("JWT_SECRET");
  });
});
