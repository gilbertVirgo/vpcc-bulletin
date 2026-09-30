// Copied verbatim into vpcc-sunday-sheets/netlify/functions/_shared/auth.ts. Keep self-contained.
import jwt from "jsonwebtoken";

export type SessionUser = { id: string; username: string; role: string };

const COOKIE = "vpcc_session";
const MAX_AGE = 604800; // 7 days, matches JWT expiresIn

function cookie(value: string, host: string, maxAge: number): string {
  const domain = process.env.COOKIE_DOMAIN || ".vpcc.church";
  const onDomain = host.endsWith(domain);
  const parts = [`${COOKIE}=${value}`];
  if (onDomain) parts.push(`Domain=${domain}`);
  parts.push("Path=/", "HttpOnly");
  if (onDomain) parts.push("Secure");
  parts.push("SameSite=Lax", `Max-Age=${maxAge}`);
  return parts.join("; ");
}

export function sessionCookie(token: string, host: string): string {
  return cookie(token, host, MAX_AGE);
}

export function clearCookie(host: string): string {
  return cookie("", host, 0);
}

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return {};
  }
  if (!host.endsWith(".vpcc.church") && host !== "localhost") return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function verifySession(req: Request): SessionUser | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  for (const token of [readCookie(req.headers.get("cookie"), COOKIE), bearer]) {
    if (!token) continue;
    try {
      const p = jwt.verify(token, secret);
      if (typeof p === "string") continue;
      return { id: String(p.id), username: String(p.username), role: String(p.role) };
    } catch {
      // invalid or expired; try the next source
    }
  }
  return null;
}
