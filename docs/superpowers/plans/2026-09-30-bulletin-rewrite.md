# vpcc-bulletin Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Express/Google-Sheets app with a Vite + TypeScript + Netlify Functions site that stores the Sunday rota in MongoDB, shows it publicly, and lets signed-in users edit it, generate new weeks and manage people.

**Architecture:** Static Vite pages (`/` rota, `/people`) in plain TS with no UI framework talk to Netlify Functions under `/api/*`. Functions use the raw `mongodb` driver against the calendar database (collections `rota_roles`, `rota_people`, `rota_weeks`) and the shared VPCC session cookie verified by a verbatim copy of vpcc-auth's `auth.ts`. Rota generation is a pure, seeded, unit-tested function shared by the API.

**Tech Stack:** Node 24, TypeScript 7 (`tsc --noEmit`), Vite 8, Vitest 5, Netlify Functions v2 (`.mts`), `mongodb` 7, `jsonwebtoken` 9; dev-only `bcryptjs`, `googleapis`.

**Spec:** `docs/superpowers/specs/2026-09-30-bulletin-rewrite-design.md`

**Worktree:** `/Users/gilbertvirgo/vpcc/vpcc-bulletin/.claude/worktrees/vpcc-repo-refactor-153148` (branch `claude/vpcc-repo-refactor-153148`). Run every command from there. Never `cd` into the main checkout. Never `git stash`.

## Global Constraints

- Node `>=24`; `npm run typecheck` = `tsc --noEmit`; tests = `npm test` (`vitest run`).
- Package name `vpcc-bulletin`. Runtime deps only `mongodb`, `jsonwebtoken`. No task after Task 1 edits `package.json`, `package-lock.json` or `tsconfig.json`.
- No UI framework, no Tailwind, no CSS preprocessor.
- Never use `innerHTML`/`outerHTML`/`insertAdjacentHTML`. Build DOM with `h()` from `src/dom.ts`; user data goes in via text nodes / attributes only.
- No raw colour values (`#hex`, `rgb(`, `hsl(`, `oklch(`) in any CSS file except `src/styles/tokens.css`.
- `netlify/functions/_shared/auth.ts` is a verbatim copy of `/Users/gilbertvirgo/vpcc/vpcc-auth/netlify/functions/_shared/auth.ts`. Never edit it.
- Dates are `YYYY-MM-DD` strings; "today" = `londonISO(new Date())`.
- **Never write to the production DB `calendar`.** Local `.env` points at `calendar_dev`. Scripts call `assertWritable()` before any write.
- Never print, `cat`, or commit `.env` files, `google/credentials.json`, the Mongo URI, `JWT_SECRET` or the dev test password. Grep for key *names* only.
- Scripts under `scripts/` run directly under Node 24 type stripping: `import type` for types, relative imports with explicit `.ts` extension, no enums / parameter properties / namespaces. Scripts may import only `src/shared/types.ts`, `src/shared/dates.ts` and each other.
- Local ports: bulletin `netlify dev` 8890 → Vite 5175; auth hub 8888 → Vite 5173.
- Commit after each task with a normal-prose message ending in the attribution line the executing session is given.

## Task graph

| Task | Depends on | Parallel with | Owns (no other task edits these) |
|---|---|---|---|
| T1 Scaffold, shared server code, env, seed-dev | – | – | package.json, lockfile, tsconfig, vite/netlify config, `.gitignore`, `.env.example`, `.claude/launch.json`, `src/shared/{types,dates}.ts`, `netlify/functions/_shared/{auth,mongo,http}.ts`, `netlify/functions/me.mts`, `scripts/{lib,seed-dev}.ts` |
| T2 Scheduler (TDD) | T1 | T4, T7 | `src/shared/{schedule,rng}.ts` + test |
| T3 API functions | T1, T2 | T4, T7 | `netlify/functions/_shared/{validate,rota}.ts`, `netlify/functions/{weeks,people,generate}.mts` |
| T4 Design tokens, CSS, shell | T1 | T2, T3, T7 | `src/styles/{tokens,base,components,index}.css`, `src/{dom,api,ui,shell}.ts`, `index.html`, `people.html`, `public/favicon.svg`, stub `src/rota.ts` + `src/people.ts` |
| T5 Rota page | T3, T4 | T6, T7 | `src/rota.ts` (replaces stub), `src/rota-table.ts`, `src/styles/rota.css` |
| T6 People page | T3, T4 | T5, T7 | `src/people.ts` (replaces stub) |
| T7 Migration script | T1 | T2–T6 | `scripts/{sheet,migrate}.ts` + test |
| T8 README + final verification | all | – | `README.md` |

Parallel tasks share no files. T5 and T6 both *read* `src/ui.ts`, `src/api.ts`, `src/dom.ts`, `src/shell.ts` from T4 and must not modify them; if either needs a change there, stop and report instead.

## Shared interfaces (pinned — every task uses exactly these names)

`src/shared/types.ts` (created in T1):

```ts
export type Role = {
  id: string;
  name: string;
  needs: number;
  busyFor: number[]; // 0 pre-service, 1 during, 2 post-service
  consecutiveDisabled: boolean;
  order: number;
};
export type Person = { id: string; name: string; roles: string[]; frequency: number };
export type PersonName = { id: string; name: string };
export type PersonInput = { name: string; roles: string[]; frequency: number };
export type Assignments = Record<string, string[]>; // role id -> person ids
export type Week = { date: string; assignments: Assignments };
export type GeneratedWeek = Week & { gaps: string[] }; // role ids left short
export type SessionUser = { id: string; username: string; role: string };
export type Me = { user: SessionUser | null; hub: string };
export type RotaResponse = { roles: Role[]; people: PersonName[]; weeks: Week[] };
export type PeopleResponse = { people: Person[]; roles: Role[] };
```

Server helpers:

```ts
// netlify/functions/_shared/http.ts (T1)
export const hubUrl: () => string;
export const json: (body: unknown, status?: number) => Response;
export const badRequest: (error: string) => Response;
export const notFound: (error?: string) => Response;
export const unauthorized: () => Response; // 401 { error: "Unauthorized", hub }
export type Handler = (req: Request, url: URL) => Promise<Response>;
export function route(handlers: Partial<Record<"GET" | "POST" | "PUT" | "DELETE", Handler>>): (req: Request) => Promise<Response>;
export function guarded(handler: Handler): Handler;
export function readJson(req: Request): Promise<unknown>; // undefined when not JSON

// netlify/functions/_shared/mongo.ts (T1)
export const calendarDb: () => Promise<Db>;

// src/shared/dates.ts (T1)
export const ISO_DATE: RegExp;
export function addDays(iso: string, n: number): string;
export function isRealDate(iso: string): boolean;
export function isSunday(iso: string): boolean;
export function londonISO(d: Date): string;
export function nextSunday(now: Date): string; // today if today is Sunday
export function shortDate(iso: string): string; // "Sun 4 Oct"

// src/shared/schedule.ts (T2)
export const MAX_ATTEMPTS = 50;
export const RECENT_WEEKS = 8;
export function quota(frequency: number, weeks: number): number; // max(1, round(min(f,1) × weeks)); 0 when f ≤ 0 or weeks ≤ 0
export function planDates(coming: string, stored: Week[], count: number): { dates: string[]; recent: Week[] };
export type GenerateInput = { people: Person[]; roles: Role[]; dates: string[]; recent?: Week[]; rng?: () => number };
export function generate(input: GenerateInput): GeneratedWeek[];

// src/shared/rng.ts (T2)
export function mulberry32(seed: number): () => number;
```

HTTP API (T3 implements, T5/T6 consume). All bodies JSON; errors are `{ error: string }`.

| Method | Path | Auth | Request body | Success | Other statuses |
|---|---|---|---|---|---|
| GET | `/api/me` | public | – | 200 `Me` | – |
| GET | `/api/weeks` | public | – | 200 `RotaResponse` (weeks `>= today`, ascending) | – |
| POST | `/api/weeks` | guarded | `{ weeks: Week[] }` (1–5) | 201 `{ weeks: Week[] }` | 400, 409 `{ error, dates: string[] }` |
| PUT | `/api/weeks?date=D` | guarded | `{ roleId: string, personIds: string[] }` | 200 `{ week: Week }` | 400, 404 |
| DELETE | `/api/weeks?date=D` | guarded | – | 200 `{ ok: true }` | 400, 404 |
| POST | `/api/generate` | guarded | `{ weeks: number }` (1–5) | 200 `{ weeks: GeneratedWeek[] }` | 400 |
| GET | `/api/people` | guarded | – | 200 `PeopleResponse` | – |
| POST | `/api/people` | guarded | `PersonInput` | 201 `{ person: Person }` | 400, 409 |
| PUT | `/api/people?id=X` | guarded | `PersonInput` | 200 `{ person: Person }` | 400, 404, 409 |
| DELETE | `/api/people?id=X` | guarded | – | 200 `{ ok: true, weeksUpdated: number }` | 400, 404 |

Guarded routes also return 401 `{ error, hub }` without a session and 415 for POST/PUT without `Content-Type: application/json`. Unlisted methods 405.

Client helpers (T4, consumed by T5/T6):

```ts
// src/dom.ts
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K];
// src/api.ts
export class ApiError extends Error { status: number; body: Record<string, unknown> }
export function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>; // path without "/api/"
export function message(err: unknown): string;
export function loginUrl(hub: string): string;
export function logout(hub: string): Promise<void>;
// src/ui.ts
export function openModal(title: string, ...content: Node[]): HTMLDialogElement;
export function confirmDialog(text: string, confirmLabel: string): Promise<boolean>;
export function skeletonTable(columns: number, rows: number, label: string): HTMLElement;
// src/shell.ts
export function mountShell(active: "rota" | "people"): Promise<Me>;
```

CSS classes available after T4: `container`, `page-head`, `stack`, `visually-hidden`, `skip-link`, `button` + `button--primary|secondary|ghost|danger|sm`, `field`, `field__label`, `field__hint`, `control`, `control--short`, `fieldset`, `check`, `table-scroll`, `table`, `row-actions`, `dialog`, `dialog--wide`, `dialog__title`, `dialog__actions`, `skeleton`, `skeleton--line`, `status`, `error`, `empty`.

---

### Task 1: Scaffold, shared server code, local env, seed-dev

**Files:**
- Delete: `index.js`, `log.js`, `config.js`, `nodemon.json`, `helpers/`, `html/`, `public/main.css`, `google/getServerDataFromSheet.js`, `package-lock.json`
- Create/replace: `package.json`, `tsconfig.json`, `vite.config.ts`, `netlify.toml`, `.gitignore`, `.env.example`, `.claude/launch.json`
- Create: `src/shared/types.ts`, `src/shared/dates.ts`, `src/shared/dates.test.ts`
- Create: `netlify/functions/_shared/auth.ts`, `auth.test.ts` (copies), `mongo.ts`, `http.ts`, `http.test.ts`, `netlify/functions/me.mts`
- Create: `scripts/lib.ts`, `scripts/lib.test.ts`, `scripts/seed-dev.ts`
- Local only (gitignored, never printed): `.env` here, `/Users/gilbertvirgo/vpcc/vpcc-auth/.env`

**Interfaces:** Produces everything in "Shared interfaces" marked T1, plus:

```ts
// scripts/lib.ts
export type SeedRole = { id: string; name: string; needs: number; busyFor: number[]; consecutiveDisabled?: boolean };
export type SeedPerson = { name: string; roles: string[]; frequency: number };
export function dbName(uri: string): string;
export function assertWritable(uri: string, argv: string[], devOnly?: boolean): string; // returns db name or throws
export function argValue(argv: string[], flag: string): string | undefined;
export function loadSchedulerData(dir?: string): Promise<{ roles: SeedRole[]; people: SeedPerson[] }>;
export function connect(uri: string): Promise<{ client: MongoClient; db: Db }>;
export function ensureIndexes(db: Db): Promise<void>;
export function upsertRolesAndPeople(db: Db, data: { roles: SeedRole[]; people: SeedPerson[] }): Promise<void>;
```

- [ ] **Step 1: Remove the old app**

```bash
git rm -r -q index.js log.js config.js nodemon.json helpers html public/main.css google/getServerDataFromSheet.js package-lock.json
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "vpcc-bulletin",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "seed:dev": "node --env-file-if-exists=.env scripts/seed-dev.ts",
    "migrate": "node --env-file-if-exists=.env scripts/migrate.ts"
  }
}
```

Then install (this fills in dependency versions):

```bash
npm install mongodb@^7.6.0 jsonwebtoken@^9.0.3
npm install -D typescript@^7.0.2 vite@^8.3.0 vitest@^5.0.1 @types/node@^26.6.2 @types/jsonwebtoken@^9.0.10 bcryptjs@^3.0.3 googleapis
```

- [ ] **Step 3: Config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true
  },
  "include": ["src", "netlify", "scripts", "vite.config.ts"]
}
```

`vite.config.ts`:

```ts
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // 5173 = auth hub, 5174 = sunday-sheets in local dev.
  server: { port: 5175, strictPort: true },
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        people: resolve(import.meta.dirname, "people.html"),
      },
    },
  },
});
```

`netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "24"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200

[[redirects]]
  from = "/people"
  to = "/people.html"
  status = 200

[dev]
  framework = "#custom"
  command = "npm run dev"
  targetPort = 5175
  port = 8890
```

`.gitignore`:

```
node_modules
dist
.netlify
.env
google/credentials.json
.superpowers
deno.lock
```

(`deno.lock` added in T1: `netlify dev` writes it for its edge runtime.)

`.env.example`:

```
# Calendar DB. Local dev: the calendar URI with its path swapped to /calendar_dev
CALENDAR_MONGODB_URI=
# Identical in calendar, auth and bulletin sites. Local: a throwaway value shared with ../vpcc-auth/.env
JWT_SECRET=
# Where 401s send the browser to sign in. Local: http://localhost:8888
AUTH_HUB_URL=https://auth.vpcc.church
# Local only: the test user `npm run seed:dev` creates in calendar_dev
DEV_TEST_USERNAME=
DEV_TEST_PASSWORD=
# Migration only (npm run migrate)
GOOGLE_SHEET_ID=
```

`.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "auth-hub", "runtimeExecutable": "sh", "runtimeArgs": ["-c", "cd /Users/gilbertvirgo/vpcc/vpcc-auth && npx netlify dev --port 8888 --no-open"], "port": 8888 },
    { "name": "bulletin", "runtimeExecutable": "sh", "runtimeArgs": ["-c", "node --env-file-if-exists=.env \"$(command -v netlify)\" dev --port 8890 --no-open --functions \"$PWD/netlify/functions\""], "port": 8890 }
  ]
}
```

> **Deviation (found in T1): netlify dev in a git worktree.** netlify-cli finds the project root by searching upward for a `.git` *directory*. In this worktree `.git` is a file, so the CLI resolves the root to the main checkout `/Users/gilbertvirgo/vpcc/vpcc-bulletin`: it loads no functions, ignores the worktree `.env`, writes `.netlify/` there and appends `.netlify` to the main checkout's `.gitignore`. Workaround used by the `bulletin` launch config (it also works in a normal checkout): load `.env` into the process with `node --env-file-if-exists=.env` and pass `--functions "$PWD/netlify/functions"`. Start the bulletin server only via this launch config (or the same command), never plain `npx netlify dev`.

- [ ] **Step 4: Shared types** — write `src/shared/types.ts` exactly as in "Shared interfaces".

- [ ] **Step 5: Write the failing dates test** — `src/shared/dates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDays, isRealDate, isSunday, londonISO, nextSunday, shortDate } from "./dates";

describe("dates", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDays("2026-10-04", -7)).toBe("2026-09-27");
  });
  it("rejects impossible dates", () => {
    expect(isRealDate("2026-10-04")).toBe(true);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("4 Oct")).toBe(false);
  });
  it("knows Sundays", () => {
    expect(isSunday("2026-10-04")).toBe(true);
    expect(isSunday("2026-10-05")).toBe(false);
  });
  it("reads the London day of an instant", () => {
    expect(londonISO(new Date("2026-09-22T23:00:00Z"))).toBe("2026-09-23");
  });
  it("finds the coming Sunday, today included", () => {
    expect(nextSunday(new Date("2026-09-30T12:00:00Z"))).toBe("2026-10-04");
    expect(nextSunday(new Date("2026-10-04T08:00:00Z"))).toBe("2026-10-04");
    expect(nextSunday(new Date("2026-10-03T23:30:00Z"))).toBe("2026-10-04"); // already Sunday in BST
  });
  it("formats a short date", () => {
    expect(shortDate("2026-10-04")).toBe("Sun 4 Oct");
  });
});
```

Run: `npx vitest run src/shared/dates.test.ts` — Expected: FAIL (cannot resolve `./dates`).

- [ ] **Step 6: Implement `src/shared/dates.ts`** (adapted from vpcc-sunday-sheets `src/shared/dates.ts`):

```ts
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const DAY_MS = 86_400_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Treat a YYYY-MM-DD string as a UTC calendar day, so day arithmetic never meets DST. */
function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  return new Date(utc(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD that names a real day (2026-02-30 is not). */
export function isRealDate(iso: string): boolean {
  return ISO_DATE.test(iso) && addDays(iso, 0) === iso;
}

export function isSunday(iso: string): boolean {
  return new Date(utc(iso)).getUTCDay() === 0;
}

export function shortDate(iso: string): string {
  const d = new Date(utc(iso));
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

/** The Europe/London calendar day an instant falls on, as YYYY-MM-DD. */
export function londonISO(d: Date): string {
  return LONDON_DAY.format(d);
}

export function nextSunday(now: Date): string {
  const today = londonISO(now);
  const dow = new Date(utc(today)).getUTCDay();
  return addDays(today, dow === 0 ? 0 : 7 - dow);
}
```

Run: `npx vitest run src/shared/dates.test.ts` — Expected: PASS.

- [ ] **Step 7: Copy auth verbatim**

```bash
mkdir -p netlify/functions/_shared
cp /Users/gilbertvirgo/vpcc/vpcc-auth/netlify/functions/_shared/auth.ts netlify/functions/_shared/auth.ts
cp /Users/gilbertvirgo/vpcc/vpcc-auth/netlify/functions/_shared/auth.test.ts netlify/functions/_shared/auth.test.ts
```

- [ ] **Step 8: `netlify/functions/_shared/mongo.ts`**

```ts
import { type Db, MongoClient } from "mongodb";

// Cached across warm invocations; a failed connect is evicted so the next call retries.
let client: Promise<MongoClient> | undefined;

/** DB name comes from the URI path (calendar in prod, calendar_dev locally). */
export async function calendarDb(): Promise<Db> {
  const uri = process.env.CALENDAR_MONGODB_URI;
  if (!uri) throw new Error("CALENDAR_MONGODB_URI not set");
  client ??= new MongoClient(uri, { maxPoolSize: 1, maxIdleTimeMS: 60_000, serverSelectionTimeoutMS: 10_000 })
    .connect()
    .catch((err) => {
      client = undefined;
      throw err;
    });
  return (await client).db();
}
```

- [ ] **Step 9: Write the failing http test** — `netlify/functions/_shared/http.test.ts`:

```ts
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
```

Run: `npx vitest run netlify/functions/_shared/http.test.ts` — Expected: FAIL (cannot resolve `./http`).

- [ ] **Step 10: Implement `netlify/functions/_shared/http.ts`**

```ts
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

/** The parsed JSON body, or undefined when it is not valid JSON. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}
```

Run: `npx vitest run netlify/functions` — Expected: PASS (http + copied auth tests).

- [ ] **Step 11: `netlify/functions/me.mts`**

```ts
import { verifySession } from "./_shared/auth";
import { hubUrl, json, route } from "./_shared/http";

/** Always 200 so the header can render Login without a console 401. */
export default route({
  GET: async (req) => json({ user: verifySession(req), hub: hubUrl() }),
});
```

- [ ] **Step 12: Write the failing scripts test** — `scripts/lib.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertWritable, dbName } from "./lib.ts";

const uri = (db: string) => `mongodb+srv://u:p@cluster0.example.net/${db}?retryWrites=true`;

describe("dbName", () => {
  it("reads the path", () => {
    expect(dbName(uri("calendar_dev"))).toBe("calendar_dev");
    expect(dbName("mongodb://localhost:27017")).toBe("");
  });
});

describe("assertWritable", () => {
  it("allows *_dev", () => {
    expect(assertWritable(uri("calendar_dev"), [])).toBe("calendar_dev");
  });
  it("refuses production without the flag", () => {
    expect(() => assertWritable(uri("calendar"), [])).toThrow(/Refusing/);
  });
  it("allows production with --production", () => {
    expect(assertWritable(uri("calendar"), ["--production"])).toBe("calendar");
  });
  it("refuses production even with the flag when dev-only", () => {
    expect(() => assertWritable(uri("calendar"), ["--production"], true)).toThrow(/Refusing/);
  });
  it("refuses a URI with no database", () => {
    expect(() => assertWritable("mongodb://localhost:27017", ["--production"])).toThrow(/no database/);
  });
});
```

Run: `npx vitest run scripts` — Expected: FAIL (cannot resolve `./lib.ts`).

- [ ] **Step 13: Implement `scripts/lib.ts`**

```ts
import { type Db, MongoClient } from "mongodb";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Shapes of rota-scheduler's data/roles.js and data/users.js. */
export type SeedRole = { id: string; name: string; needs: number; busyFor: number[]; consecutiveDisabled?: boolean };
export type SeedPerson = { name: string; roles: string[]; frequency: number };

export function dbName(uri: string): string {
  return new URL(uri).pathname.replace(/^\//, "");
}

/** Returns the DB name, or throws unless it ends in _dev (or --production is passed and devOnly is false). */
export function assertWritable(uri: string, argv: string[], devOnly = false): string {
  const name = dbName(uri);
  if (!name) throw new Error("CALENDAR_MONGODB_URI has no database name in its path");
  if (name.endsWith("_dev")) return name;
  if (!devOnly && argv.includes("--production")) return name;
  throw new Error(
    `Refusing to write to "${name}": not a *_dev database${devOnly ? "" : " (pass --production to override)"}`,
  );
}

export function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function loadSchedulerData(
  dir = join(homedir(), "rota-scheduler", "data"),
): Promise<{ roles: SeedRole[]; people: SeedPerson[] }> {
  const load = async (file: string) => (await import(pathToFileURL(resolve(dir, file)).href)).default;
  return { roles: await load("roles.js"), people: await load("users.js") };
}

export async function connect(uri: string): Promise<{ client: MongoClient; db: Db }> {
  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 }).connect();
  return { client, db: client.db() };
}

export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection("rota_weeks").createIndex({ date: 1 }, { unique: true });
}

/** Roles keyed by scheduler id (order = array index); people keyed by name. Idempotent. */
export async function upsertRolesAndPeople(db: Db, data: { roles: SeedRole[]; people: SeedPerson[] }): Promise<void> {
  if (data.roles.length) {
    await db.collection<{ _id: string }>("rota_roles").bulkWrite(
      data.roles.map((r, order) => ({
        updateOne: {
          filter: { _id: r.id },
          update: {
            $set: { name: r.name, needs: r.needs, busyFor: r.busyFor, consecutiveDisabled: Boolean(r.consecutiveDisabled), order },
          },
          upsert: true,
        },
      })),
    );
  }
  if (data.people.length) {
    await db.collection("rota_people").bulkWrite(
      data.people.map((p) => ({
        updateOne: { filter: { name: p.name }, update: { $set: { roles: p.roles, frequency: p.frequency } }, upsert: true },
      })),
    );
  }
}
```

Run: `npx vitest run scripts` — Expected: PASS.

- [ ] **Step 14: `scripts/seed-dev.ts`**

```ts
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
```

- [ ] **Step 15: Create local `.env` files without printing anything secret**

Refuses to overwrite existing files (`flag: "wx"`). Prints only "written".

```bash
node -e '
const fs = require("fs"), crypto = require("crypto");
const line = fs.readFileSync("/Users/gilbertvirgo/vpcc/vpcc-calendar/.env", "utf8").split("\n").find((l) => l.startsWith("MONGODB_URI="));
const u = new URL(line.slice("MONGODB_URI=".length).trim().replace(/^["\x27]|["\x27]$/g, ""));
u.pathname = "/calendar_dev";
const secret = crypto.randomBytes(32).toString("hex");
fs.writeFileSync(".env", [
  `CALENDAR_MONGODB_URI=${u}`, `JWT_SECRET=${secret}`, "AUTH_HUB_URL=http://localhost:8888",
  "DEV_TEST_USERNAME=bulletin-test", `DEV_TEST_PASSWORD=${crypto.randomBytes(12).toString("base64url")}`, "",
].join("\n"), { flag: "wx" });
fs.writeFileSync("/Users/gilbertvirgo/vpcc/vpcc-auth/.env", [`CALENDAR_MONGODB_URI=${u}`, `JWT_SECRET=${secret}`, ""].join("\n"), { flag: "wx" });
console.log("written");'
git check-ignore .env && git -C /Users/gilbertvirgo/vpcc/vpcc-auth check-ignore .env
grep -o '^[A-Z_]*=' .env
```

Expected: `written`, both paths echoed by `check-ignore`, and the five key names. If either file already exists, stop and report rather than overwriting.

Then make the hub runnable: `npm --prefix /Users/gilbertvirgo/vpcc/vpcc-auth install`.

- [ ] **Step 16: Seed the dev DB**

Run: `npm run seed:dev`
Expected: `Seeded calendar_dev: 10 roles, 17 people, user bulletin-test.` If Atlas rejects the write (permissions on `calendar_dev`), stop and report — do not fall back to another DB.

- [ ] **Step 17: Verify**

```bash
npm run typecheck && npm test
# run in background; see the worktree deviation note under Step 3
node --env-file-if-exists=.env "$(command -v netlify)" dev --port 8890 --no-open --functions "$PWD/netlify/functions"
curl -s http://localhost:8890/api/me    # {"user":null,"hub":"http://localhost:8888"}
```

`npm run build` cannot pass until T4 adds `index.html` and `people.html` (Vite's inputs); T1 verifies with `typecheck` only.

Stop the dev server afterwards.

- [ ] **Step 18: Commit**

```bash
git add -A
git status --short   # confirm no .env / credentials staged
git commit -m "Scaffold the Netlify rewrite: config, shared auth/http/mongo, dates, seed-dev"
```

---

### Task 2: Scheduler (TDD)

**Files:**
- Create: `src/shared/rng.ts`, `src/shared/schedule.ts`, `src/shared/schedule.test.ts`

**Interfaces:**
- Consumes: `Role`, `Person`, `Assignments`, `Week`, `GeneratedWeek` from `src/shared/types.ts`; `addDays` from `src/shared/dates.ts`.
- Produces: `MAX_ATTEMPTS`, `quota`, `planDates`, `GenerateInput`, `generate` (schedule.ts); `mulberry32` (rng.ts) — signatures in "Shared interfaces".

Rules (from the spec): frequency is accounted over a rolling window = `recent` stored weeks (newest 8 before `dates[0]`) + the new dates, so repeated 1–2 week generations stay proportional. quota = `max(1, round(min(f,1) × window))` (0 when f ≤ 0), counts weeks served; `used` starts at the recent weeks each person served in. Roles in ascending `order`. Hard rules: holds the role, frequency > 0, not blocked, no clash with a section already taken this week. Blocked = held a `consecutiveDisabled` role the previous week; for week 1 that is the newest `recent` week **only if it is exactly 7 days before `dates[0]`** — `generate` checks this itself (same for the served-last-week ordering). Rank: within-quota (or already serving this week) before over-quota; then `used/quota` (over-quota: `used − quota`, least over first); then served-previous-week last; then `rng()`. Take `needs`. So quota is a cap that is only exceeded to avoid a gap; gaps remain only for true infeasibility and cells stay partial. Up to 50 attempts; stop at the first with zero gaps and zero quota overflows, else keep the best by (gaps, overflows). Never mutate inputs.

**Status:** done — the committed `src/shared/{rng,schedule,schedule.test}.ts` are the source of truth; the code blocks below are the original T2 draft (single `history` week) and are superseded.

- [ ] **Step 1: `src/shared/rng.ts`**

```ts
/** Small seeded PRNG for reproducible schedules in tests. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 2: Write the failing tests** — `src/shared/schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { mulberry32 } from "./rng";
import { generate, planDates, quota } from "./schedule";
import type { GeneratedWeek, Person, Role } from "./types";

const PRE = 0, DURING = 1, POST = 2;
const role = (id: string, busyFor: number[], extra: Partial<Role> = {}): Role => ({
  id, name: id, needs: 1, busyFor, consecutiveDisabled: false, order: 0, ...extra,
});
const person = (id: string, roles: string[], frequency = 1, name = id): Person => ({ id, name, roles, frequency });
const sundays = (n: number) => Array.from({ length: n }, (_, i) => addDays("2026-10-04", 7 * i));
const servedIn = (w: GeneratedWeek, id: string) => Object.values(w.assignments).some((ids) => ids.includes(id));
const served = (weeks: GeneratedWeek[], id: string) => weeks.filter((w) => servedIn(w, id)).length;
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

// Real data from /Users/gilbertvirgo/rota-scheduler/data (2026-09-30).
const ROLES: Role[] = [
  role("worship", [PRE, DURING, POST], { consecutiveDisabled: true }),
  role("soundcheck", [PRE, POST]),
  role("creche", [DURING]),
  role("lyrics", [PRE, DURING]),
  role("worship-support", [PRE, DURING]),
  role("communion-prep", [PRE, POST]),
  role("lunch-cleanup", [DURING, POST]),
  role("sunday-lunch", [PRE, DURING, POST], { consecutiveDisabled: true }),
  role("welcome", [PRE], { needs: 2 }),
  role("refreshments", [PRE, POST]),
].map((r, order) => ({ ...r, order }));
const PEOPLE: Person[] = [
  person("albany", ["lyrics", "refreshments", "welcome", "worship-support", "sunday-lunch", "lunch-cleanup", "creche"], 0.8),
  person("ben-v", ["welcome", "communion-prep"], 0.4),
  person("ben-b", ["welcome", "refreshments", "communion-prep", "sunday-lunch", "lunch-cleanup"], 1),
  person("beth", ["refreshments", "welcome", "worship-support", "sunday-lunch", "lunch-cleanup", "communion-prep", "creche"], 0.8),
  person("emma", ["refreshments", "welcome", "sunday-lunch", "lunch-cleanup", "communion-prep", "creche"], 0.6),
  person("gil", ["lyrics", "refreshments", "soundcheck", "welcome", "worship", "worship-support", "communion-prep", "creche"], 0.8),
  person("isaiah", ["refreshments", "soundcheck", "worship-support"], 0.6),
  person("jonny", ["refreshments", "welcome", "soundcheck", "worship", "worship-support", "sunday-lunch", "lunch-cleanup", "communion-prep"], 0.8),
  person("pascal", ["lyrics", "refreshments", "welcome", "lunch-cleanup"], 0.6),
  person("pascal-sup", ["sunday-lunch"], 0.2),
  person("ambrose", ["lyrics", "welcome"], 0.8),
  person("lucy", ["lyrics", "refreshments", "sunday-lunch", "lunch-cleanup", "communion-prep"], 0.6),
  person("rachel", ["refreshments", "welcome", "worship-support", "sunday-lunch", "communion-prep", "creche"], 0.8),
  person("rufus", ["lyrics", "soundcheck", "sunday-lunch", "lunch-cleanup", "creche", "worship-support"], 0.8),
  person("tom", ["lyrics", "welcome", "refreshments", "soundcheck", "sunday-lunch", "lunch-cleanup", "communion-prep"], 0.8),
  person("tara", ["welcome", "refreshments", "sunday-lunch"], 0.8),
  person("dan", ["welcome", "refreshments"], 0.8),
];
const real = (seed: number, weeks = 5) =>
  generate({ people: PEOPLE, roles: ROLES, dates: sundays(weeks), rng: mulberry32(seed) });

describe("quota", () => {
  it.each([
    [0.8, 5, 4], [0.2, 5, 1], [0.2, 1, 0], [0.5, 1, 1], [1, 4, 4],
    [0, 5, 0], [1, 0, 0], [Number.NaN, 3, 0], [1.5, 2, 2],
  ])("quota(%d, %d) = %d", (f, w, want) => {
    expect(quota(f, w)).toBe(want);
  });
});

describe("planDates", () => {
  const coming = "2026-10-04";
  const a = { worship: ["gil"] };
  it("starts at the coming Sunday when nothing is stored", () => {
    expect(planDates(coming, null, 3)).toEqual({ dates: ["2026-10-04", "2026-10-11", "2026-10-18"], history: null });
  });
  it("continues after the last future week and uses it as history", () => {
    expect(planDates(coming, { date: "2026-10-18", assignments: a }, 1)).toEqual({ dates: ["2026-10-25"], history: a });
    expect(planDates(coming, { date: coming, assignments: a }, 1)).toEqual({ dates: ["2026-10-11"], history: a });
  });
  it("uses last Sunday as history when it is the week before", () => {
    expect(planDates(coming, { date: "2026-09-27", assignments: a }, 1)).toEqual({ dates: [coming], history: a });
  });
  it("ignores an older last week", () => {
    expect(planDates(coming, { date: "2026-09-13", assignments: a }, 1)).toEqual({ dates: [coming], history: null });
  });
});

describe("generate", () => {
  it("returns one week per date with a key for every role", () => {
    const weeks = real(1);
    expect(weeks.map((w) => w.date)).toEqual(sundays(5));
    for (const w of weeks) expect(Object.keys(w.assignments).sort()).toEqual(ROLES.map((r) => r.id).sort());
  });

  it("is deterministic for a seed", () => {
    expect(real(7)).toEqual(real(7));
  });

  it("returns [] for no dates", () => {
    expect(generate({ people: PEOPLE, roles: ROLES, dates: [], rng: mulberry32(1) })).toEqual([]);
  });

  it.each(SEEDS)("keeps every rule on real data (seed %d)", (seed) => {
    const weeks = real(seed);
    for (const [i, w] of weeks.entries()) {
      const sections = new Map<string, number[]>();
      for (const r of ROLES) {
        const ids = w.assignments[r.id];
        expect(ids.length).toBeLessThanOrEqual(r.needs);
        expect(new Set(ids).size).toBe(ids.length);
        if (ids.length < r.needs) expect(w.gaps).toContain(r.id);
        for (const id of ids) {
          expect(PEOPLE.find((p) => p.id === id)!.roles).toContain(r.id);
          const taken = sections.get(id) ?? [];
          for (const s of r.busyFor) expect(taken).not.toContain(s);
          sections.set(id, [...taken, ...r.busyFor]);
        }
      }
      if (i > 0) {
        const prev = weeks[i - 1];
        for (const r of ROLES.filter((x) => x.consecutiveDisabled)) {
          for (const id of prev.assignments[r.id]) expect(servedIn(w, id)).toBe(false);
        }
      }
    }
    for (const p of PEOPLE) expect(served(weeks, p.id)).toBeLessThanOrEqual(quota(p.frequency, 5));
  });

  it("blocks the history week's consecutive holder from week 1", () => {
    for (const seed of SEEDS) {
      const [w] = generate({ people: PEOPLE, roles: ROLES, dates: sundays(1), history: { worship: ["gil"] }, rng: mulberry32(seed) });
      expect(servedIn(w, "gil")).toBe(false);
      expect(w.assignments.worship).toEqual(["jonny"]);
    }
  });

  it("puts last week's servers at the back when fairness is equal", () => {
    const people = [person("a", ["r"]), person("b", ["r"])];
    for (const seed of SEEDS) {
      const [w] = generate({ people, roles: [role("r", [PRE])], dates: sundays(1), history: { r: ["a"] }, rng: mulberry32(seed) });
      expect(w.assignments.r).toEqual(["b"]);
    }
  });

  it("shares a role fairly, counting by id not name", () => {
    const people = [person("s1", ["r"], 1, "Sam"), person("s2", ["r"], 1, "Sam")];
    for (const seed of SEEDS) {
      const weeks = generate({ people, roles: [role("r", [PRE])], dates: sundays(4), rng: mulberry32(seed) });
      expect([served(weeks, "s1"), served(weeks, "s2")]).toEqual([2, 2]);
    }
  });

  it("never schedules frequency 0", () => {
    const people = [person("zero", ["r"], 0), person("one", ["r"], 1)];
    const weeks = generate({ people, roles: [role("r", [PRE])], dates: sundays(3), rng: mulberry32(1) });
    expect(served(weeks, "zero")).toBe(0);
  });

  it("allows two roles in a week when sections do not overlap, counting one week of quota", () => {
    const people = [person("p", ["a", "b"], 1)];
    const [w] = generate({ people, roles: [role("a", [PRE]), role("b", [POST], { order: 1 })], dates: sundays(1), rng: mulberry32(1) });
    expect(w.assignments).toEqual({ a: ["p"], b: ["p"] });
    expect(w.gaps).toEqual([]);
  });

  it("processes roles in order, so the lower order wins a clash", () => {
    const people = [person("p", ["a", "b"], 1)];
    const roles = [role("a", [PRE], { order: 1 }), role("b", [PRE], { order: 0 })];
    const [w] = generate({ people, roles, dates: sundays(1), rng: mulberry32(1) });
    expect(w.assignments).toEqual({ a: [], b: ["p"] });
    expect(w.gaps).toEqual(["a"]);
  });

  it("leaves an infeasible cell partial, flags it and terminates", () => {
    const people = [person("p", ["welcome"], 1)];
    const roles = [role("welcome", [PRE], { needs: 2 }), role("nobody", [POST], { order: 1 })];
    const weeks = generate({ people, roles, dates: sundays(2), rng: mulberry32(1) });
    expect(weeks.map((w) => w.gaps)).toEqual([["welcome", "nobody"], ["welcome", "nobody"]]);
    expect(weeks[0].assignments).toEqual({ welcome: ["p"], nobody: [] });
  });

  it("does not mutate its inputs", () => {
    const freeze = <T>(x: T): T => {
      if (x && typeof x === "object") {
        Object.values(x).forEach(freeze);
        Object.freeze(x);
      }
      return x;
    };
    const people = freeze(structuredClone(PEOPLE));
    const roles = freeze(structuredClone(ROLES).reverse());
    const history = freeze({ worship: ["gil"] });
    expect(() => generate({ people, roles, dates: sundays(5), history, rng: mulberry32(3) })).not.toThrow();
    expect(people).toEqual(PEOPLE);
  });
});
```

Run: `npx vitest run src/shared/schedule.test.ts` — Expected: FAIL (cannot resolve `./schedule`).

- [ ] **Step 3: Implement `src/shared/schedule.ts`**

```ts
import { addDays } from "./dates";
import type { Assignments, GeneratedWeek, Person, Role, Week } from "./types";

export const MAX_ATTEMPTS = 50;

/** Weeks a person may serve out of `weeks`. Hard cap. */
export function quota(frequency: number, weeks: number): number {
  if (!(frequency > 0) || !(weeks > 0)) return 0;
  return Math.round(Math.min(frequency, 1) * weeks);
}

/** Dates to generate and the stored week (if it is the Sunday before) to use as history. */
export function planDates(
  coming: string,
  last: Week | null,
  count: number,
): { dates: string[]; history: Assignments | null } {
  const start = last && last.date >= coming ? addDays(last.date, 7) : coming;
  const dates = Array.from({ length: count }, (_, i) => addDays(start, 7 * i));
  const history = last && last.date === addDays(start, -7) ? last.assignments : null;
  return { dates, history };
}

export type GenerateInput = {
  people: Person[];
  roles: Role[];
  dates: string[];
  history?: Assignments | null;
  rng?: () => number;
};

export function generate({ people, roles, dates, history = null, rng = Math.random }: GenerateInput): GeneratedWeek[] {
  const ordered = [...roles].sort((a, b) => a.order - b.order);
  let best: GeneratedWeek[] = [];
  let bestGaps = Infinity;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const weeks = attempt(people, ordered, dates, history, rng);
    const gaps = weeks.reduce((n, w) => n + w.gaps.length, 0);
    if (gaps < bestGaps) {
      best = weeks;
      bestGaps = gaps;
    }
    if (gaps === 0) break;
  }
  return best;
}

function attempt(
  people: Person[],
  roles: Role[],
  dates: string[],
  history: Assignments | null,
  rng: () => number,
): GeneratedWeek[] {
  const quotas = new Map(people.map((p) => [p.id, quota(p.frequency, dates.length)]));
  const used = new Map(people.map((p) => [p.id, 0]));
  let previous: Assignments = history ?? {};
  const out: GeneratedWeek[] = [];

  for (const date of dates) {
    const servedLastWeek = new Set(Object.values(previous).flat());
    const blocked = new Set(roles.filter((r) => r.consecutiveDisabled).flatMap((r) => previous[r.id] ?? []));
    const busy = new Map<string, Set<number>>(); // person id -> sections taken this week
    const assignments: Assignments = {};
    const gaps: string[] = [];

    for (const role of roles) {
      const ranked = people
        .filter(
          (p) =>
            p.roles.includes(role.id) &&
            !blocked.has(p.id) &&
            (busy.has(p.id) || used.get(p.id)! < quotas.get(p.id)!) &&
            !role.busyFor.some((s) => busy.get(p.id)?.has(s)),
        )
        .map((p) => ({
          id: p.id,
          ratio: used.get(p.id)! / quotas.get(p.id)!,
          last: servedLastWeek.has(p.id) ? 1 : 0,
          tie: rng(),
        }))
        .sort((a, b) => a.ratio - b.ratio || a.last - b.last || a.tie - b.tie);

      const chosen = ranked.slice(0, role.needs).map((c) => c.id);
      if (chosen.length < role.needs) gaps.push(role.id);
      for (const id of chosen) busy.set(id, new Set([...(busy.get(id) ?? []), ...role.busyFor]));
      assignments[role.id] = chosen;
    }

    for (const id of busy.keys()) used.set(id, used.get(id)! + 1);
    out.push({ date, assignments, gaps });
    previous = assignments;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/schedule.test.ts` — Expected: PASS. If the history test fails because Jonny is short of quota for a 1-week run, re-check `quota(0.8, 1) === 1` before changing any rule; do not weaken assertions to make them pass.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/shared/rng.ts src/shared/schedule.ts src/shared/schedule.test.ts
git commit -m "Add the pure, seeded rota scheduler with tests"
```

---

### Task 3: API functions

**Files:**
- Create: `netlify/functions/_shared/validate.ts`, `netlify/functions/_shared/validate.test.ts`, `netlify/functions/_shared/rota.ts`
- Create: `netlify/functions/weeks.mts`, `netlify/functions/people.mts`, `netlify/functions/generate.mts`

**Interfaces:**
- Consumes: `route`, `guarded`, `json`, `badRequest`, `notFound`, `readJson` (http.ts); `calendarDb` (mongo.ts); `ISO_DATE`, `isRealDate`, `isSunday`, `londonISO`, `nextSunday` (dates.ts); `generate`, `planDates`, `RECENT_WEEKS` (schedule.ts); shared types.
- Produces: the HTTP API table in "Shared interfaces", and:

```ts
// validate.ts
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const OBJECT_ID: RegExp;
export function objectId(v: string | null): string | null;
export function sundayDate(v: unknown, today: string): Result<string>;
export function weekCount(body: unknown): Result<number>;
export function personInput(body: unknown, roles: Role[]): Result<PersonInput>;
export function cell(roleId: unknown, personIds: unknown, roles: Role[], people: Person[]): Result<string[]>;
export function cellBody(body: unknown, roles: Role[], people: Person[]): Result<{ roleId: string; personIds: string[] }>;
export function weeksBody(body: unknown, roles: Role[], people: Person[], today: string): Result<Week[]>;
// rota.ts
export type RoleDoc; export type PersonDoc; export type WeekDoc; export type Rota;
export function rota(): Promise<Rota>;
export function toRole(d: RoleDoc): Role; export function toPerson(d: PersonDoc): Person; export function toWeek(d: WeekDoc): Week;
export function loadRolesAndPeople(c: Rota): Promise<{ roles: Role[]; people: Person[] }>;
```

- [ ] **Step 1: Write the failing validation tests** — `netlify/functions/_shared/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Person, Role } from "../../../src/shared/types";
import { cell, cellBody, objectId, personInput, sundayDate, weekCount, weeksBody } from "./validate";

const TODAY = "2026-09-30";
const GIL = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TOM = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ROLES: Role[] = [
  { id: "worship", name: "Worship", needs: 1, busyFor: [0, 1, 2], consecutiveDisabled: true, order: 0 },
  { id: "welcome", name: "Welcome", needs: 2, busyFor: [0], consecutiveDisabled: false, order: 1 },
];
const PEOPLE: Person[] = [
  { id: GIL, name: "Gil", roles: ["worship", "welcome"], frequency: 0.8 },
  { id: TOM, name: "Tom", roles: ["welcome"], frequency: 0.8 },
];

describe("sundayDate", () => {
  it("accepts a future or current Sunday", () => {
    expect(sundayDate("2026-10-04", TODAY)).toEqual({ ok: true, value: "2026-10-04" });
    expect(sundayDate("2026-10-04", "2026-10-04").ok).toBe(true);
  });
  it.each([null, 5, "04/10/2026", "2026-02-30", "2026-10-05", "2026-09-27"])("rejects %s", (v) => {
    expect(sundayDate(v, TODAY).ok).toBe(false);
  });
});

describe("weekCount", () => {
  it("accepts integers 1..5", () => {
    expect(weekCount({ weeks: 5 })).toEqual({ ok: true, value: 5 });
  });
  it.each([0, 6, 2.5, "3", null])("rejects %s", (weeks) => {
    expect(weekCount({ weeks }).ok).toBe(false);
  });
});

describe("objectId", () => {
  it("accepts 24 lowercase hex only", () => {
    expect(objectId(GIL)).toBe(GIL);
    expect(objectId("xyz")).toBeNull();
    expect(objectId(null)).toBeNull();
  });
});

describe("personInput", () => {
  it("trims and accepts a valid person", () => {
    expect(personInput({ name: "  Ann ", roles: ["welcome"], frequency: 0 }, ROLES)).toEqual({
      ok: true,
      value: { name: "Ann", roles: ["welcome"], frequency: 0 },
    });
  });
  it.each([
    { name: "   ", roles: [], frequency: 0.5 },
    { name: "x".repeat(61), roles: [], frequency: 0.5 },
    { name: "Ann", roles: ["nope"], frequency: 0.5 },
    { name: "Ann", roles: ["welcome", "welcome"], frequency: 0.5 },
    { name: "Ann", roles: "welcome", frequency: 0.5 },
    { name: "Ann", roles: [], frequency: 1.1 },
    { name: "Ann", roles: [], frequency: -0.1 },
    { name: "Ann", roles: [], frequency: "0.5" },
    { name: "Ann", roles: [], frequency: Number.NaN },
    null,
  ])("rejects %j", (body) => {
    expect(personInput(body, ROLES).ok).toBe(false);
  });
});

describe("cell", () => {
  it("accepts holders up to needs, and empty", () => {
    expect(cell("welcome", [GIL, TOM], ROLES, PEOPLE)).toEqual({ ok: true, value: [GIL, TOM] });
    expect(cell("worship", [], ROLES, PEOPLE).ok).toBe(true);
  });
  it("rejects unknown roles, too many, duplicates, unknown people and non-holders", () => {
    expect(cell("nope", [], ROLES, PEOPLE).ok).toBe(false);
    expect(cell("worship", [GIL, TOM], ROLES, PEOPLE).ok).toBe(false);
    expect(cell("welcome", [GIL, GIL], ROLES, PEOPLE).ok).toBe(false);
    expect(cell("welcome", ["cccccccccccccccccccccccc"], ROLES, PEOPLE).ok).toBe(false);
    expect(cell("worship", [TOM], ROLES, PEOPLE)).toEqual({ ok: false, error: "Tom does not do Worship" });
    expect(cell("welcome", "x", ROLES, PEOPLE).ok).toBe(false);
  });
  it("cellBody wraps cell", () => {
    expect(cellBody({ roleId: "worship", personIds: [GIL] }, ROLES, PEOPLE)).toEqual({
      ok: true,
      value: { roleId: "worship", personIds: [GIL] },
    });
    expect(cellBody("nope", ROLES, PEOPLE).ok).toBe(false);
  });
});

describe("weeksBody", () => {
  const week = (date: string, assignments: Record<string, unknown> = { worship: [GIL] }) => ({ date, assignments });
  it("normalises every role key", () => {
    expect(weeksBody({ weeks: [week("2026-10-04")] }, ROLES, PEOPLE, TODAY)).toEqual({
      ok: true,
      value: [{ date: "2026-10-04", assignments: { worship: [GIL], welcome: [] } }],
    });
  });
  it("rejects bad batches", () => {
    const bad = (weeks: unknown) => weeksBody({ weeks }, ROLES, PEOPLE, TODAY).ok;
    expect(bad([])).toBe(false);
    expect(bad(Array.from({ length: 6 }, (_, i) => week(`2026-10-${String(4 + 7 * (i % 4)).padStart(2, "0")}`)))).toBe(false);
    expect(bad([week("2026-10-04"), week("2026-10-04")])).toBe(false);
    expect(bad([week("2026-10-05")])).toBe(false);
    expect(bad([week("2026-10-04", { nope: [] })])).toBe(false);
    expect(bad([week("2026-10-04", { worship: [TOM] })])).toBe(false);
    expect(bad([{ date: "2026-10-04" }])).toBe(false);
  });
});
```

Run: `npx vitest run netlify/functions/_shared/validate.test.ts` — Expected: FAIL (cannot resolve `./validate`).

- [ ] **Step 2: Implement `netlify/functions/_shared/validate.ts`**

```ts
import { isRealDate, isSunday } from "../../../src/shared/dates";
import type { Assignments, Person, PersonInput, Role, Week } from "../../../src/shared/types";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const OBJECT_ID = /^[0-9a-f]{24}$/;
export const objectId = (v: string | null): string | null => (v && OBJECT_ID.test(v) ? v : null);

export function sundayDate(v: unknown, today: string): Result<string> {
  if (typeof v !== "string" || !isRealDate(v)) return fail("date must be YYYY-MM-DD");
  if (!isSunday(v)) return fail(`${v} is not a Sunday`);
  if (v < today) return fail(`${v} is in the past`);
  return ok(v);
}

export function weekCount(body: unknown): Result<number> {
  const n = isObj(body) ? body.weeks : undefined;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5
    ? ok(n)
    : fail("weeks must be a whole number from 1 to 5");
}

export function personInput(body: unknown, roles: Role[]): Result<PersonInput> {
  if (!isObj(body)) return fail("Expected a JSON object");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 60) return fail("name must be 1 to 60 characters");
  const known = new Set(roles.map((r) => r.id));
  const list = body.roles;
  if (!Array.isArray(list) || !list.every((r) => typeof r === "string" && known.has(r)) || new Set(list).size !== list.length) {
    return fail("roles must be a list of unique known role ids");
  }
  const f = body.frequency;
  if (typeof f !== "number" || !Number.isFinite(f) || f < 0 || f > 1) return fail("frequency must be a number from 0 to 1");
  return ok({ name, roles: list as string[], frequency: f });
}

export function cell(roleId: unknown, personIds: unknown, roles: Role[], people: Person[]): Result<string[]> {
  const role = roles.find((r) => r.id === roleId);
  if (!role) return fail(`Unknown role ${String(roleId)}`);
  if (!Array.isArray(personIds) || personIds.length > role.needs || new Set(personIds).size !== personIds.length) {
    return fail(`${role.name} takes up to ${role.needs} different people`);
  }
  for (const id of personIds) {
    const p = typeof id === "string" && OBJECT_ID.test(id) ? people.find((x) => x.id === id) : undefined;
    if (!p) return fail(`Unknown person ${String(id)}`);
    if (!p.roles.includes(role.id)) return fail(`${p.name} does not do ${role.name}`);
  }
  return ok(personIds as string[]);
}

export function cellBody(body: unknown, roles: Role[], people: Person[]): Result<{ roleId: string; personIds: string[] }> {
  if (!isObj(body)) return fail("Expected a JSON object");
  const c = cell(body.roleId, body.personIds, roles, people);
  return c.ok ? ok({ roleId: body.roleId as string, personIds: c.value }) : c;
}

/** 1–5 unique future Sundays; every role key present in the result. */
export function weeksBody(body: unknown, roles: Role[], people: Person[], today: string): Result<Week[]> {
  const list = isObj(body) ? body.weeks : undefined;
  if (!Array.isArray(list) || list.length < 1 || list.length > 5) return fail("weeks must be a list of 1 to 5 weeks");
  const out: Week[] = [];
  const seen = new Set<string>();
  for (const w of list) {
    if (!isObj(w)) return fail("Each week must be an object");
    const d = sundayDate(w.date, today);
    if (!d.ok) return d;
    if (seen.has(d.value)) return fail(`${d.value} appears twice`);
    seen.add(d.value);
    const given = w.assignments;
    if (!isObj(given)) return fail(`${d.value}: assignments must be an object`);
    const unknown = Object.keys(given).find((k) => !roles.some((r) => r.id === k));
    if (unknown) return fail(`Unknown role ${unknown}`);
    const assignments: Assignments = {};
    for (const role of roles) {
      const c = cell(role.id, Object.hasOwn(given, role.id) ? given[role.id] : [], roles, people);
      if (!c.ok) return fail(`${d.value}: ${c.error}`);
      assignments[role.id] = c.value;
    }
    out.push({ date: d.value, assignments });
  }
  return ok(out);
}
```

Run: `npx vitest run netlify/functions/_shared/validate.test.ts` — Expected: PASS.

- [ ] **Step 3: `netlify/functions/_shared/rota.ts`**

```ts
import type { Collection, ObjectId } from "mongodb";
import type { Assignments, Person, Role, Week } from "../../../src/shared/types";
import { calendarDb } from "./mongo";

export type RoleDoc = Omit<Role, "id"> & { _id: string };
export type PersonDoc = Omit<Person, "id"> & { _id: ObjectId };
export type WeekDoc = { date: string; assignments: Assignments };
export type Rota = { roles: Collection<RoleDoc>; people: Collection<PersonDoc>; weeks: Collection<WeekDoc> };

export async function rota(): Promise<Rota> {
  const db = await calendarDb();
  return {
    roles: db.collection<RoleDoc>("rota_roles"),
    people: db.collection<PersonDoc>("rota_people"),
    weeks: db.collection<WeekDoc>("rota_weeks"),
  };
}

export const toRole = ({ _id, ...rest }: RoleDoc): Role => ({ id: _id, ...rest });
export const toPerson = ({ _id, ...rest }: PersonDoc): Person => ({ id: _id.toHexString(), ...rest });
export const toWeek = ({ date, assignments }: WeekDoc): Week => ({ date, assignments });

/** Roles by `order`, people by name. */
export async function loadRolesAndPeople(c: Rota): Promise<{ roles: Role[]; people: Person[] }> {
  const [roles, people] = await Promise.all([
    c.roles.find().sort({ order: 1 }).toArray(),
    c.people.find().sort({ name: 1 }).toArray(),
  ]);
  return { roles: roles.map(toRole), people: people.map(toPerson) };
}
```

- [ ] **Step 4: `netlify/functions/weeks.mts`**

```ts
import { londonISO } from "../../src/shared/dates";
import { badRequest, guarded, json, notFound, readJson, route } from "./_shared/http";
import { loadRolesAndPeople, rota, toWeek } from "./_shared/rota";
import { cellBody, sundayDate, weeksBody } from "./_shared/validate";

const today = () => londonISO(new Date());
const TAKEN = "Some of these Sundays are already on the rota";

export default route({
  GET: async () => {
    const c = await rota();
    const { roles, people } = await loadRolesAndPeople(c);
    const weeks = await c.weeks.find({ date: { $gte: today() } }).sort({ date: 1 }).toArray();
    return json({ roles, people: people.map(({ id, name }) => ({ id, name })), weeks: weeks.map(toWeek) });
  },

  POST: guarded(async (req) => {
    const c = await rota();
    const { roles, people } = await loadRolesAndPeople(c);
    const parsed = weeksBody(await readJson(req), roles, people, today());
    if (!parsed.ok) return badRequest(parsed.error);
    const dates = parsed.value.map((w) => w.date);
    const existing = await c.weeks.find({ date: { $in: dates } }).toArray();
    if (existing.length) return json({ error: TAKEN, dates: existing.map((w) => w.date) }, 409);
    try {
      // Copies: insertMany adds _id to the objects it is given.
      await c.weeks.insertMany(parsed.value.map((w) => ({ ...w })));
    } catch (err) {
      // ponytail: a concurrent save can leave earlier weeks of this batch stored; the unique index stops duplicates.
      if ((err as { code?: number }).code === 11000) return json({ error: TAKEN, dates }, 409);
      throw err;
    }
    return json({ weeks: parsed.value }, 201);
  }),

  PUT: guarded(async (req, url) => {
    const date = sundayDate(url.searchParams.get("date"), today());
    if (!date.ok) return badRequest(date.error);
    const c = await rota();
    const { roles, people } = await loadRolesAndPeople(c);
    const parsed = cellBody(await readJson(req), roles, people);
    if (!parsed.ok) return badRequest(parsed.error);
    const week = await c.weeks.findOneAndUpdate(
      { date: date.value },
      { $set: { [`assignments.${parsed.value.roleId}`]: parsed.value.personIds } },
      { returnDocument: "after" },
    );
    return week ? json({ week: toWeek(week) }) : notFound("No such week");
  }),

  DELETE: guarded(async (_req, url) => {
    const date = sundayDate(url.searchParams.get("date"), today());
    if (!date.ok) return badRequest(date.error);
    const { deletedCount } = await (await rota()).weeks.deleteOne({ date: date.value });
    return deletedCount ? json({ ok: true }) : notFound("No such week");
  }),
});
```

- [ ] **Step 5: `netlify/functions/generate.mts`**

```ts
import { nextSunday } from "../../src/shared/dates";
import { generate, planDates, RECENT_WEEKS } from "../../src/shared/schedule";
import { badRequest, guarded, json, readJson, route } from "./_shared/http";
import { loadRolesAndPeople, rota, toWeek } from "./_shared/rota";
import { weekCount } from "./_shared/validate";

/** Preview only: stores nothing. */
export default route({
  POST: guarded(async (req) => {
    const count = weekCount(await readJson(req));
    if (!count.ok) return badRequest(count.error);
    const c = await rota();
    const { roles, people } = await loadRolesAndPeople(c);
    // Newest 8 stored weeks, past or future: frequency is accounted over them plus the new dates.
    const stored = (await c.weeks.find().sort({ date: -1 }).limit(RECENT_WEEKS).toArray()).map(toWeek);
    const { dates, recent } = planDates(nextSunday(new Date()), stored, count.value);
    return json({ weeks: generate({ people, roles, dates, recent, rng: Math.random }) });
  }),
});
```

- [ ] **Step 6: `netlify/functions/people.mts`**

```ts
import { ObjectId, type UpdateFilter } from "mongodb";
import { londonISO } from "../../src/shared/dates";
import { badRequest, guarded, json, notFound, readJson, route } from "./_shared/http";
import { type WeekDoc, loadRolesAndPeople, rota, toPerson } from "./_shared/rota";
import { objectId, personInput } from "./_shared/validate";

const exists = (name: string) => json({ error: `${name} is already on the list` }, 409);

export default route({
  GET: guarded(async () => json(await loadRolesAndPeople(await rota()))),

  POST: guarded(async (req) => {
    const c = await rota();
    const { roles } = await loadRolesAndPeople(c);
    const p = personInput(await readJson(req), roles);
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
    const p = personInput(await readJson(req), roles);
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
```

If `tsc` rejects the `$pull` cast, use `as unknown as UpdateFilter<WeekDoc>` — nothing else. The same applies to the computed `$set` key in `weeks.mts` PUT: if its type is rejected, cast that update object `as UpdateFilter<WeekDoc>` (import the type from `mongodb`).

- [ ] **Step 7: Typecheck and unit tests**

Run: `npm run typecheck && npm test` — Expected: PASS.

- [ ] **Step 8: Exercise the API against calendar_dev**

Start both servers in the background: `sh -c 'cd /Users/gilbertvirgo/vpcc/vpcc-auth && npx netlify dev --port 8888 --no-open'` and `node --env-file-if-exists=.env "$(command -v netlify)" dev --port 8890 --no-open --functions "$PWD/netlify/functions"` (worktree-safe, see T1 Step 3 note; or `preview_start` with the `auth-hub` / `bulletin` entries in `.claude/launch.json`). Do not `source` `.env` (the URI contains `&`); read only the two test-user values, never echo them:

```bash
J=$(mktemp); P=$(mktemp); B=http://localhost:8890/api
U=$(grep '^DEV_TEST_USERNAME=' .env | cut -d= -f2-); W=$(grep '^DEV_TEST_PASSWORD=' .env | cut -d= -f2-)
curl -s -c "$J" -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"$W\"}" \
  http://localhost:8888/api/login -o /dev/null -w '%{http_code}\n'                                                   # 200
curl -s $B/weeks | head -c 300; echo                                                                                  # roles + people, "weeks":[]
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{"weeks":2}' $B/generate     # 401
curl -s -b "$J" -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: text/plain' -d '{"weeks":2}' $B/generate  # 415
curl -s -b "$J" -X POST -H 'content-type: application/json' -d '{"weeks":9}' $B/generate; echo                       # 400
curl -s -b "$J" -X POST -H 'content-type: application/json' -d '{"weeks":2}' $B/generate > "$P"                      # 2026-10-04, 2026-10-11
curl -s -b "$J" -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data @"$P" $B/weeks    # 201
curl -s -b "$J" -X POST -H 'content-type: application/json' --data @"$P" $B/weeks; echo                              # 409 + dates
curl -s -b "$J" -X POST -H 'content-type: application/json' -d '{"weeks":1}' $B/generate | grep -o '"date":"[^"]*"'   # 2026-10-18
curl -s -b "$J" -X PUT -H 'content-type: application/json' -d '{"roleId":"worship","personIds":[]}' "$B/weeks?date=2026-10-04"; echo      # week, worship []
curl -s -b "$J" -X PUT -H 'content-type: application/json' -d '{"roleId":"worship","personIds":["zzz"]}' "$B/weeks?date=2026-10-04"; echo  # 400
curl -s -b "$J" -X DELETE "$B/weeks?date=2026-10-11"; echo                                                          # {"ok":true}
curl -s -b "$J" -o /dev/null -w '%{http_code}\n' -X DELETE "$B/weeks?date=2026-10-11"                                # 404
curl -s -b "$J" -X POST -H 'content-type: application/json' -d '{"name":"Test Person","roles":["welcome"],"frequency":0.5}' $B/people; echo  # 201 + person
curl -s -b "$J" -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{"name":"Test Person","roles":[],"frequency":0.5}' $B/people  # 409
```

Dates assume today is 2026-09-30; otherwise expect the coming Sunday and the weeks after it. The preview file carries `gaps`; the server ignores extra week keys, so the 201 confirms that. Then PUT and DELETE "Test Person" by the returned id (DELETE → `weeksUpdated`), delete the 2026-10-04 week, `rm -f "$J" "$P"`, and stop both servers.

- [ ] **Step 9: Commit**

```bash
git add netlify/functions
git commit -m "Add rota API: weeks, generate and people functions with boundary validation"
```

---

### Task 4: Design tokens, CSS, page shell

**Files:**
- Create: `src/styles/tokens.css` (generated), `src/styles/base.css`, `src/styles/components.css`, `src/styles/index.css`
- Create: `src/dom.ts`, `src/api.ts`, `src/ui.ts`, `src/shell.ts`
- Create: `index.html`, `people.html`, `public/favicon.svg` (copy), stub `src/rota.ts`, stub `src/people.ts`

**Interfaces:**
- Consumes: `Me` type; `GET /api/me`.
- Produces: client helpers and CSS classes listed in "Shared interfaces". Page HTML contains `<header id="site-header">` and `<main id="main">`.

- [ ] **Step 1: Generate `src/styles/tokens.css` from vpcc-v1**

```bash
mkdir -p src/styles public
node -e '
const fs = require("fs"), dir = "/Users/gilbertvirgo/vpcc/vpcc-v1/src/styles/";
let out = "/* Design tokens. Copied from vpcc-v1 src/styles/tokens.*.css (Tailwind @theme converted to :root).\n   The ONLY file allowed raw colour values. Do not hand-edit the ramps. */\n\n";
for (const f of ["color", "typography", "layout", "motion"]) {
  out += fs.readFileSync(`${dir}tokens.${f}.css`, "utf8").replace(/@theme\s*\{/g, ":root {").replace(/^\s*--[a-z-]*\*: initial;\n/gm, "") + "\n";
}
out += `/* Additions: skeleton (vpcc-calendar src/index.scss) and dialog backdrop. */
:root {
	--color-skeleton: var(--color-surface-sunken);
	--color-skeleton-sheen: oklch(100% 0 0 / 0.6);
	--color-backdrop: oklch(15.94% 0.0233 279.4 / 0.4);
	--duration-shimmer: 1600ms;
}
`;
fs.writeFileSync("src/styles/tokens.css", out);'
grep -c '@theme\|: initial;' src/styles/tokens.css   # expect 0
cp /Users/gilbertvirgo/vpcc/vpcc-v1/public/favicon.svg public/favicon.svg
```

- [ ] **Step 2: `src/styles/base.css`** (v1 base.css without Tailwind layers, plus the resets Tailwind preflight gave v1)

```css
*,
*::before,
*::after {
	box-sizing: border-box;
}

html {
	-webkit-text-size-adjust: 100%;
}

body {
	margin: 0;
	background-color: var(--color-surface);
	color: var(--color-ink);
	font-family: var(--font-sans);
	font-size: var(--text-body);
	font-weight: var(--font-weight-medium);
	line-height: 1.65;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
	text-rendering: optimizeLegibility;
	font-synthesis-weight: none;
	font-synthesis-style: none;
}

h1,
h2,
h3 {
	margin: 0;
	font-weight: var(--font-weight-bold);
	text-wrap: balance;
}

/* App pages: the h2 step reads as a page title without v1's marketing-sized h1. */
h1 {
	font-size: var(--text-h2);
	line-height: var(--text-h2--line-height);
	letter-spacing: var(--text-h2--letter-spacing);
}

p {
	margin: 0;
	text-wrap: pretty;
}

img,
svg {
	display: block;
	max-width: 100%;
}

input,
button,
textarea,
select {
	font: inherit;
	color: inherit;
	letter-spacing: inherit;
}

a {
	color: var(--color-ink-accent);
	text-underline-offset: 0.15em;
}

/* Visible for keyboard users, invisible for mouse users. Never remove without replacing. */
:focus-visible {
	outline: 2px solid var(--color-focus-ring);
	outline-offset: 2px;
	border-radius: var(--radius-sm);
}

:focus:not(:focus-visible) {
	outline: none;
}

::selection {
	background-color: var(--color-accent);
	color: var(--color-accent-contrast);
}
```

- [ ] **Step 3: `src/styles/components.css`**

```css
/* ---- Layout ------------------------------------------------------------ */
.container {
	width: 100%;
	max-width: var(--container-default);
	margin-inline: auto;
	padding-inline: var(--space-gutter);
}

main.container {
	padding-block: calc(var(--spacing) * 8) var(--space-section);
}

.stack > * + * {
	margin-top: calc(var(--spacing) * 5);
}

.page-head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: calc(var(--spacing) * 4);
	margin-bottom: calc(var(--spacing) * 6);
}

.visually-hidden {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: -1px;
	padding: 0;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
	border: 0;
}

.skip-link {
	position: absolute;
	top: calc(var(--spacing) * 2);
	left: var(--space-gutter);
	z-index: var(--z-toast);
	padding: calc(var(--spacing) * 2) calc(var(--spacing) * 4);
	border-radius: var(--radius-pill);
	background: var(--color-surface-raised);
	translate: 0 -200%;
}

.skip-link:focus {
	translate: 0 0;
}

/* ---- Header ------------------------------------------------------------ */
.site-header {
	border-bottom: 1px solid var(--color-line);
}

.site-header__inner {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: calc(var(--spacing) * 3) calc(var(--spacing) * 6);
	min-height: calc(var(--spacing) * 16);
	padding-block: calc(var(--spacing) * 2);
}

.site-header__logo {
	color: var(--color-accent);
}

.site-header__logo svg {
	width: calc(var(--spacing) * 10);
	height: calc(var(--spacing) * 10);
}

.site-nav {
	display: flex;
	gap: calc(var(--spacing) * 5);
}

.site-nav a {
	color: var(--color-ink-secondary);
	font-size: var(--text-body-sm);
	font-weight: var(--font-weight-bold);
	text-decoration: none;
}

.site-nav a:hover,
.site-nav a[aria-current="page"] {
	color: var(--color-ink);
}

.site-nav a[aria-current="page"] {
	text-decoration: underline;
	text-decoration-color: var(--color-accent);
	text-decoration-thickness: 2px;
	text-underline-offset: 0.4em;
}

.site-header__auth {
	display: flex;
	align-items: center;
	gap: calc(var(--spacing) * 3);
	margin-left: auto;
	color: var(--color-ink-muted);
	font-size: var(--text-body-sm);
}

/* ---- Buttons (v1 ui/button.tsx; danger from vpcc-calendar) ------------- */
.button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: calc(var(--spacing) * 2);
	height: calc(var(--spacing) * 11);
	padding: 0 calc(var(--spacing) * 6);
	border: 1px solid transparent;
	border-radius: var(--radius-pill);
	font-size: var(--text-body-sm);
	font-weight: var(--font-weight-bold);
	white-space: nowrap;
	text-decoration: none;
	user-select: none;
	cursor: pointer;
	transition:
		background-color var(--duration-fast) var(--ease-standard),
		color var(--duration-fast) var(--ease-standard),
		border-color var(--duration-fast) var(--ease-standard),
		scale var(--duration-fast) var(--ease-standard);
}

.button:active {
	scale: 0.98;
}

.button:disabled,
.button[aria-disabled="true"] {
	pointer-events: none;
	opacity: 0.5;
}

.button--sm {
	height: calc(var(--spacing) * 9);
	padding: 0 calc(var(--spacing) * 4);
}

.button--primary {
	background-color: var(--color-accent);
	color: var(--color-accent-contrast);
}

.button--primary:hover {
	background-color: var(--color-accent-hover);
}

.button--primary:active {
	background-color: var(--color-accent-pressed);
}

.button--secondary {
	border-color: var(--color-line-strong);
	background-color: transparent;
	color: var(--color-ink);
}

.button--secondary:hover,
.button--ghost:hover {
	background-color: var(--color-surface-sunken);
}

.button--ghost {
	background-color: transparent;
	color: var(--color-ink);
}

.button--danger {
	background-color: var(--color-danger);
	color: var(--color-ink-inverse);
}

.button--danger:hover {
	filter: brightness(0.9);
}

/* ---- Forms (v1 ui/form.tsx) -------------------------------------------- */
.field {
	display: flex;
	flex-direction: column;
	gap: calc(var(--spacing) * 2);
}

.field__label {
	color: var(--color-ink);
	font-size: var(--text-body-sm);
	font-weight: var(--font-weight-bold);
}

.field__hint {
	color: var(--color-ink-muted);
	font-size: var(--text-caption);
	line-height: var(--text-caption--line-height);
}

.control {
	width: 100%;
	padding: calc(var(--spacing) * 3) calc(var(--spacing) * 4);
	border: 1px solid var(--color-line-strong);
	border-radius: var(--radius-md);
	background-color: var(--color-surface-raised);
	color: var(--color-ink);
	font-size: var(--text-body);
	transition:
		border-color var(--duration-fast) var(--ease-standard),
		background-color var(--duration-fast) var(--ease-standard);
}

.control:hover {
	border-color: var(--color-ink-muted);
}

.control:user-invalid,
.control[aria-invalid="true"] {
	border-color: var(--color-danger);
}

.control:disabled {
	cursor: not-allowed;
	opacity: 0.6;
	background-color: var(--color-surface-sunken);
}

.control--short {
	width: calc(var(--spacing) * 28);
}

.fieldset {
	display: grid;
	gap: calc(var(--spacing) * 3);
	margin: 0;
	padding: 0;
	border: 0;
}

.fieldset legend {
	margin-bottom: calc(var(--spacing) * 3);
	padding: 0;
}

.check {
	display: flex;
	align-items: flex-start;
	gap: calc(var(--spacing) * 3);
}

.check input {
	flex-shrink: 0;
	width: calc(var(--spacing) * 5);
	height: calc(var(--spacing) * 5);
	margin: calc(var(--spacing) * 1) 0 0;
	accent-color: var(--color-accent);
}

.check label {
	color: var(--color-ink-secondary);
	font-size: var(--text-body-sm);
}

/* ---- Table: hairline rules, overline headers ---------------------------- */
.table-scroll {
	overflow-x: auto;
	overscroll-behavior-x: contain;
}

.table {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--text-body-sm);
}

.table th,
.table td {
	padding: calc(var(--spacing) * 3) calc(var(--spacing) * 4) calc(var(--spacing) * 3) 0;
	border-bottom: 1px solid var(--color-line);
	text-align: left;
	vertical-align: top;
}

.table thead th {
	border-bottom-color: var(--color-line-strong);
	color: var(--color-ink-muted);
	font-size: var(--text-overline);
	font-weight: var(--font-weight-bold);
	line-height: var(--text-overline--line-height);
	letter-spacing: var(--text-overline--letter-spacing);
	text-transform: uppercase;
	white-space: nowrap;
}

/* First column stays put while the rest scrolls sideways on phones. */
.table tr > :first-child {
	position: sticky;
	left: 0;
	z-index: var(--z-raised);
	background-color: var(--color-surface);
	white-space: nowrap;
}

.dialog .table tr > :first-child {
	background-color: var(--color-surface-raised);
}

.table td {
	min-width: calc(var(--spacing) * 28);
}

.row-actions {
	display: flex;
	justify-content: flex-end;
	gap: calc(var(--spacing) * 2);
}

/* ---- Dialog (v1 utilities.css transition; native <dialog>) -------------- */
.dialog {
	width: min(100% - 2 * var(--space-gutter), var(--container-narrow));
	max-height: calc(100dvh - 2 * var(--space-gutter));
	padding: calc(var(--spacing) * 6);
	overflow: auto;
	border: 1px solid var(--color-line);
	border-radius: var(--radius-lg);
	background-color: var(--color-surface-raised);
	color: var(--color-ink);
	box-shadow: var(--shadow-popover);
	opacity: 0;
	scale: 0.98;
	transition:
		opacity var(--duration-base) var(--ease-standard),
		scale var(--duration-base) var(--ease-standard),
		display var(--duration-base) allow-discrete,
		overlay var(--duration-base) allow-discrete;
}

.dialog[open] {
	opacity: 1;
	scale: 1;
}

@starting-style {
	.dialog[open] {
		opacity: 0;
		scale: 0.98;
	}
}

.dialog::backdrop {
	background-color: var(--color-backdrop);
	backdrop-filter: blur(2px);
}

.dialog--wide {
	width: min(100% - 2 * var(--space-gutter), var(--container-default));
}

.dialog__title {
	margin-bottom: calc(var(--spacing) * 5);
	font-size: var(--text-h4);
	line-height: var(--text-h4--line-height);
	letter-spacing: var(--text-h4--letter-spacing);
}

.dialog__actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: calc(var(--spacing) * 3);
	margin-top: calc(var(--spacing) * 6);
}

/* ---- Skeleton (vpcc-calendar, shared spec with v1) ---------------------- */
.skeleton {
	position: relative;
	overflow: hidden;
	border-radius: var(--radius-sm);
	background-color: var(--color-skeleton);
	color: transparent;
	user-select: none;
	pointer-events: none;
}

.skeleton::after {
	content: "";
	position: absolute;
	inset: 0;
	translate: -100% 0;
	background-image: linear-gradient(90deg, transparent, var(--color-skeleton-sheen), transparent);
	animation: skeleton-shimmer var(--duration-shimmer) var(--ease-standard) infinite;
}

.skeleton--line {
	display: block;
	height: 1rem;
}

@keyframes skeleton-shimmer {
	to {
		translate: 100% 0;
	}
}

/* After .skeleton::after so it wins: a static block, no strobing sheen. */
@media (prefers-reduced-motion: reduce) {
	.skeleton::after {
		display: none;
		animation: none;
	}
}

/* ---- Messages ----------------------------------------------------------- */
.status {
	color: var(--color-ink-secondary);
	font-size: var(--text-body-sm);
}

.error {
	color: var(--color-danger);
	font-size: var(--text-body-sm);
	font-weight: var(--font-weight-bold);
}

.empty {
	padding-block: var(--space-section-sm);
	color: var(--color-ink-secondary);
}
```

`src/styles/index.css` (order matters: components after base so `.button` keeps its pill radius over `:focus-visible`):

```css
@import "./tokens.css";
@import "./base.css";
@import "./components.css";
```

- [ ] **Step 4: `src/dom.ts`**

```ts
type AttrValue = string | number | boolean | undefined | ((e: Event) => void);
export type Attrs = Record<string, AttrValue>;
export type Child = Node | string | null | undefined | false;

/**
 * Element builder. Strings become text nodes, so user data can never become markup.
 * `onclick` style keys attach listeners; `true` sets an empty attribute; false/undefined are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  return el;
}
```

- [ ] **Step 5: `src/api.ts`**

```ts
export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export const loginUrl = (hub: string): string => `${hub}/?returnTo=${encodeURIComponent(location.href)}`;

/** JSON call to /api/<path>. A 401 sends the browser to the auth hub and never resolves. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const res = await fetch(`/api/${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: hasBody ? { "Content-Type": "application/json" } : {},
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 && typeof body.hub === "string") {
    location.assign(loginUrl(body.hub));
    return new Promise<T>(() => {});
  }
  if (!res.ok) {
    throw new ApiError(typeof body.error === "string" ? body.error : `Request failed (${res.status})`, res.status, body);
  }
  return body as T;
}

export const message = (err: unknown): string => (err instanceof Error ? err.message : "Something went wrong.");

/** The hub clears the shared cookie; it requires a JSON content type. */
export async function logout(hub: string): Promise<void> {
  await fetch(`${hub}/api/logout`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => {});
  location.reload();
}
```

- [ ] **Step 6: `src/ui.ts`**

```ts
import { h } from "./dom";

/** Native modal <dialog>: focus trap, Esc and inert background come from the platform. Removed on close. */
export function openModal(title: string, ...content: Node[]): HTMLDialogElement {
  const id = `dialog-${crypto.randomUUID()}`;
  const dialog = h("dialog", { class: "dialog", "aria-labelledby": id }, h("h2", { id, class: "dialog__title" }, title), ...content);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/** In-page confirm. Not window.confirm, which blocks browser automation. Esc = cancel. */
export function confirmDialog(text: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = openModal(
      "Are you sure?",
      h("p", {}, text),
      h(
        "form",
        { method: "dialog", class: "dialog__actions" },
        h("button", { value: "cancel", class: "button button--secondary" }, "Cancel"),
        h("button", { value: "ok", class: "button button--danger" }, confirmLabel),
      ),
    );
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"));
  });
}

export function skeletonTable(columns: number, rows: number, label: string): HTMLElement {
  const cell = () => h("td", {}, h("span", { class: "skeleton skeleton--line", "aria-hidden": "true" }, "Loading"));
  return h(
    "div",
    { class: "table-scroll", "aria-busy": "true" },
    h("p", { class: "visually-hidden" }, label),
    h("table", { class: "table" }, h("tbody", {}, ...Array.from({ length: rows }, () => h("tr", {}, ...Array.from({ length: columns }, cell))))),
  );
}
```

- [ ] **Step 7: `src/shell.ts`** (`MARK` is the path data from `/Users/gilbertvirgo/vpcc/vpcc-v1/src/components/brand/logo.tsx`, verbatim)

```ts
import { api, loginUrl, logout } from "./api";
import { h } from "./dom";
import type { Me } from "./shared/types";

// The VPCC mark, from vpcc-v1 src/components/brand/logo.tsx. Painted with currentColor.
const MARK =
  "M50 100C77.6142 100 100 77.6142 100 50C100 22.3858 77.6142 0 50 0C22.3858 0 0 22.3858 0 50C0 77.6142 22.3858 100 50 100ZM12.32 43.36L19.04 60H23.52L30.24 43.36H25.76L21.28 55.44L16.8 43.36H12.32ZM40.8638 42.96C36.0638 42.96 31.9037 46.88 31.9037 51.68V68.32H36.3838V58.96C37.8237 60 39.4238 60.4 41.1037 60.4C45.8237 60.4 49.8237 56.48 49.8237 51.68C49.8237 46.48 46.0638 42.96 40.8638 42.96ZM45.3438 51.68C45.3438 54.24 43.5037 56.24 40.8638 56.24C38.3037 56.24 36.3838 54.24 36.3838 51.68C36.3838 49.04 38.3037 47.12 40.8638 47.12C43.5037 47.12 45.3438 49.04 45.3438 51.68ZM52.5491 51.68C52.5491 56.88 56.3091 60.4 61.5091 60.4C63.8291 60.4 66.0691 59.44 67.6691 57.76L64.7091 54.88C63.9091 55.68 62.7091 56.24 61.5091 56.24C58.9491 56.24 57.0291 54.24 57.0291 51.68C57.0291 49.04 58.9491 47.12 61.5091 47.12C62.7891 47.12 63.9091 47.6 64.7891 48.4L67.7491 45.44C65.9891 43.68 63.9891 42.96 61.5091 42.96C56.7091 42.96 52.5491 46.88 52.5491 51.68ZM70.3225 51.68C70.3225 56.88 74.0825 60.4 79.2825 60.4C81.6025 60.4 83.8425 59.44 85.4425 57.76L82.4825 54.88C81.6825 55.68 80.4825 56.24 79.2825 56.24C76.7225 56.24 74.8025 54.24 74.8025 51.68C74.8025 49.04 76.7225 47.12 79.2825 47.12C80.5625 47.12 81.6825 47.6 82.5625 48.4L85.5225 45.44C83.7625 43.68 81.7625 42.96 79.2825 42.96C74.4825 42.96 70.3225 46.88 70.3225 51.68Z";

function logo(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("fill-rule", "evenodd");
  path.setAttribute("clip-rule", "evenodd");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", MARK);
  svg.append(path);
  return svg;
}

/** Renders the header into #site-header and returns who is signed in. */
export async function mountShell(active: "rota" | "people"): Promise<Me> {
  const me = await api<Me>("me");
  const link = (href: string, label: string, key: string) =>
    h("a", { href, "aria-current": key === active ? "page" : undefined }, label);
  const auth = me.user
    ? [
        h("span", {}, me.user.username),
        h("button", { type: "button", class: "button button--sm button--secondary", onclick: () => void logout(me.hub) }, "Log out"),
      ]
    : [h("a", { class: "button button--sm button--secondary", href: loginUrl(me.hub) }, "Log in")];
  document.querySelector<HTMLElement>("#site-header")!.replaceChildren(
    h(
      "div",
      { class: "container site-header__inner" },
      h("a", { href: "/", class: "site-header__logo", "aria-label": "Victoria Park Community Church rota" }, logo()),
      h("nav", { class: "site-nav", "aria-label": "Main" }, link("/", "Rota", "rota"), me.user ? link("/people", "People", "people") : null),
      h("div", { class: "site-header__auth" }, ...auth),
    ),
  );
  return me;
}
```

- [ ] **Step 8: HTML entries and stubs**

`index.html` (and `people.html` identical except `<title>People · VPCC</title>` and `src="/src/people.ts"`):

```html
<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Sunday rota · VPCC</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://use.typekit.net" crossorigin />
    <link rel="preconnect" href="https://p.typekit.net" crossorigin />
    <link rel="stylesheet" href="https://use.typekit.net/ccy7tqi.css" />
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header id="site-header" class="site-header"></header>
    <main id="main" class="container" tabindex="-1"></main>
    <script type="module" src="/src/rota.ts"></script>
  </body>
</html>
```

Stub `src/rota.ts` (T5 replaces it):

```ts
import "./styles/index.css";
import { mountShell } from "./shell";

void mountShell("rota");
```

Stub `src/people.ts` (T6 replaces it):

```ts
import "./styles/index.css";
import { mountShell } from "./shell";

void mountShell("people");
```

- [ ] **Step 9: Verify**

```bash
npm run build
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(' src/styles --include=*.css | grep -v 'src/styles/tokens.css'   # expect nothing
grep -rnE 'innerHTML|outerHTML|insertAdjacentHTML' src   # expect nothing
```

Run `node --env-file-if-exists=.env "$(command -v netlify)" dev --port 8890 --no-open --functions "$PWD/netlify/functions"` in the background (worktree-safe, see T1 Step 3 note) and load http://localhost:8890/ and /people: the header shows the orange logo, "Rota", and a "Log in" pill in Area Inktrap; the Log in href starts with `http://localhost:8888/?returnTo=`. Stop the server.

- [ ] **Step 10: Commit**

```bash
git add src/styles src/dom.ts src/api.ts src/ui.ts src/shell.ts src/rota.ts src/people.ts index.html people.html public/favicon.svg
git commit -m "Add v1 design tokens, component CSS and the page shell"
```

---

### Task 5: Rota page

**Files:**
- Create: `src/rota-table.ts`, `src/styles/rota.css`
- Replace: `src/rota.ts` (T4 stub)

**Interfaces:**
- Consumes: `h`; `api`, `ApiError`, `message`; `openModal`, `confirmDialog`, `skeletonTable`; `mountShell`; `shortDate`; types `GeneratedWeek`, `Me`, `PeopleResponse`, `Person`, `Role`, `RotaResponse`, `Week`; endpoints `GET /api/weeks`, `GET /api/people`, `PUT|DELETE /api/weeks?date=`, `POST /api/generate`, `POST /api/weeks`.
- Produces: `rotaTable(roles, people, weeks, caption, opts?)` (used only inside T5).

- [ ] **Step 1: `src/rota-table.ts`**

```ts
import { h } from "./dom";
import { shortDate } from "./shared/dates";
import type { GeneratedWeek, PersonName, Role, Week } from "./shared/types";

export type TableOptions = {
  onEditCell?: (week: Week, role: Role) => void;
  onDeleteWeek?: (week: Week) => void;
};

/** The rota as a table: rows = Sundays, columns = roles. Read-only unless handlers are given. */
export function rotaTable(
  roles: Role[],
  people: PersonName[],
  weeks: (Week | GeneratedWeek)[],
  caption: string,
  opts: TableOptions = {},
): HTMLElement {
  const names = new Map(people.map((p) => [p.id, p.name]));
  const { onEditCell, onDeleteWeek } = opts;

  const head = h(
    "tr",
    {},
    h("th", { scope: "col" }, "Sunday"),
    ...roles.map((r) => h("th", { scope: "col" }, r.name)),
    onDeleteWeek ? h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, "Actions")) : null,
  );

  const rows = weeks.map((week) => {
    const gaps = "gaps" in week ? week.gaps : [];
    const date = shortDate(week.date);
    return h(
      "tr",
      {},
      h("th", { scope: "row" }, date),
      ...roles.map((role) => {
        const text = (week.assignments[role.id] ?? []).map((id) => names.get(id) ?? "Unknown").join(", ");
        const gap = gaps.includes(role.id);
        const content = [
          text ? h("span", {}, text) : h("span", { class: "cell__empty" }, "–"),
          gap ? h("span", { class: "cell__gap-label" }, "Unfilled") : null,
        ];
        return h(
          "td",
          { class: gap ? "cell cell--gap" : "cell" },
          onEditCell
            ? h(
                "button",
                {
                  type: "button",
                  class: "cell__edit",
                  "aria-label": `${role.name} on ${date}: ${text || "nobody"}. Edit`,
                  onclick: () => onEditCell(week, role),
                },
                ...content,
              )
            : h("span", {}, ...content),
        );
      }),
      onDeleteWeek
        ? h(
            "td",
            {},
            h(
              "button",
              { type: "button", class: "button button--sm button--danger", onclick: () => onDeleteWeek(week) },
              "Delete",
              h("span", { class: "visually-hidden" }, ` ${date}`),
            ),
          )
        : null,
    );
  });

  return h(
    "div",
    { class: "table-scroll", role: "region", "aria-label": caption, tabindex: 0 },
    h("table", { class: "table" }, h("caption", { class: "visually-hidden" }, caption), h("thead", {}, head), h("tbody", {}, ...rows)),
  );
}
```

- [ ] **Step 2: `src/styles/rota.css`**

```css
.cell__edit {
	display: block;
	width: calc(100% + var(--spacing) * 2);
	min-height: calc(var(--spacing) * 9);
	margin: calc(var(--spacing) * -1) 0 calc(var(--spacing) * -1) calc(var(--spacing) * -2);
	padding: calc(var(--spacing) * 1) calc(var(--spacing) * 2);
	border: 1px dashed transparent;
	border-radius: var(--radius-md);
	background: transparent;
	text-align: left;
	cursor: pointer;
	transition:
		background-color var(--duration-fast) var(--ease-standard),
		border-color var(--duration-fast) var(--ease-standard);
}

.cell__edit:hover {
	border-color: var(--color-line-strong);
	background-color: var(--color-surface-sunken);
}

.cell__empty {
	color: var(--color-ink-muted);
}

.table td.cell--gap {
	padding-left: calc(var(--spacing) * 2);
	background-color: var(--color-danger-surface);
}

.cell__gap-label {
	display: block;
	color: var(--color-danger);
	font-size: var(--text-overline);
	font-weight: var(--font-weight-bold);
	letter-spacing: var(--text-overline--letter-spacing);
	text-transform: uppercase;
}

.generate__form {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: calc(var(--spacing) * 3);
	margin-bottom: calc(var(--spacing) * 6);
}

.preview:empty {
	display: none;
}
```

- [ ] **Step 3: Replace `src/rota.ts`**

```ts
import "./styles/index.css";
import "./styles/rota.css";
import { ApiError, api, message } from "./api";
import { h } from "./dom";
import { rotaTable } from "./rota-table";
import { shortDate } from "./shared/dates";
import type { GeneratedWeek, Me, PeopleResponse, Person, Role, RotaResponse, Week } from "./shared/types";
import { mountShell } from "./shell";
import { confirmDialog, openModal, skeletonTable } from "./ui";

const main = document.querySelector<HTMLElement>("#main")!;
const body = h("div", {});
const status = h("p", { class: "status", role: "status" });
let me: Me;
let rota: RotaResponse = { roles: [], people: [], weeks: [] };
let people: Person[] = []; // full records (who holds which role); only loaded when signed in

async function start(): Promise<void> {
  me = await mountShell("rota");
  main.replaceChildren(
    h(
      "div",
      { class: "page-head" },
      h("h1", {}, "Sunday rota"),
      me.user ? h("button", { type: "button", class: "button button--primary", onclick: openGenerate }, "Generate weeks") : null,
    ),
    status,
    body,
  );
  await load();
}

async function load(): Promise<void> {
  body.replaceChildren(skeletonTable(8, 4, "Loading the rota"));
  try {
    const [r, p] = await Promise.all([
      api<RotaResponse>("weeks"),
      me.user ? api<PeopleResponse>("people") : Promise.resolve(null),
    ]);
    rota = r;
    people = p?.people ?? [];
    render();
  } catch (err) {
    body.replaceChildren(h("p", { class: "error", role: "alert" }, message(err)));
  }
}

function render(): void {
  if (!rota.weeks.length) {
    body.replaceChildren(
      h("p", { class: "empty" }, "No Sundays on the rota yet.", me.user ? " Use “Generate weeks” to add some." : ""),
    );
    return;
  }
  body.replaceChildren(
    rotaTable(rota.roles, rota.people, rota.weeks, "Sunday rota", me.user ? { onEditCell: editCell, onDeleteWeek: deleteWeek } : {}),
  );
}

function editCell(week: Week, role: Role): void {
  const holders = people.filter((p) => p.roles.includes(role.id));
  const current = new Set(week.assignments[role.id] ?? []);
  const error = h("p", { class: "error", role: "alert" });
  const boxes = holders.map((p) =>
    h("input", { type: "checkbox", id: `pick-${p.id}`, value: p.id, checked: current.has(p.id) }),
  );
  const sync = () => {
    const picked = boxes.filter((b) => b.checked).length;
    for (const b of boxes) b.disabled = !b.checked && picked >= role.needs;
  };
  boxes.forEach((b) => b.addEventListener("change", sync));
  sync();

  const form = h(
    "form",
    { class: "stack" },
    h(
      "fieldset",
      { class: "fieldset" },
      h("legend", { class: "field__label" }, role.needs === 1 ? "Choose one person" : `Choose up to ${role.needs} people`),
      ...(holders.length
        ? holders.map((p, i) => h("div", { class: "check" }, boxes[i], h("label", { for: `pick-${p.id}` }, p.name)))
        : [h("p", { class: "status" }, "Nobody does this role yet. Add it to someone on the People page.")]),
    ),
    error,
    h(
      "div",
      { class: "dialog__actions" },
      h("button", { type: "button", class: "button button--secondary", onclick: () => dialog.close() }, "Cancel"),
      h("button", { type: "submit", class: "button button--primary" }, "Save"),
    ),
  );
  const dialog = openModal(`${role.name} · ${shortDate(week.date)}`, form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    try {
      await api(`weeks?date=${week.date}`, {
        method: "PUT",
        body: { roleId: role.id, personIds: boxes.filter((b) => b.checked).map((b) => b.value) },
      });
      dialog.close();
      status.textContent = `Saved ${role.name} for ${shortDate(week.date)}.`;
      await load();
    } catch (err) {
      error.textContent = message(err);
    }
  });
}

async function deleteWeek(week: Week): Promise<void> {
  if (!(await confirmDialog(`Remove ${shortDate(week.date)} from the rota?`, "Delete"))) return;
  try {
    await api(`weeks?date=${week.date}`, { method: "DELETE" });
    status.textContent = `Removed ${shortDate(week.date)}.`;
    await load();
  } catch (err) {
    status.textContent = message(err);
  }
}

function openGenerate(): void {
  let preview: GeneratedWeek[] = [];
  const count = h("input", {
    type: "number", id: "generate-count", class: "control control--short", min: 1, max: 5, step: 1, value: 4, required: true,
  });
  const generateButton = h("button", { type: "submit", class: "button button--secondary" }, "Generate");
  const saveButton = h("button", { type: "button", class: "button button--primary", disabled: true }, "Save");
  const out = h("div", { class: "preview" });
  const error = h("p", { class: "error", role: "alert" });
  const form = h(
    "form",
    { class: "generate__form" },
    h("div", { class: "field" }, h("label", { for: "generate-count", class: "field__label" }, "Weeks (1–5)"), count),
    generateButton,
  );
  const dialog = openModal(
    "Generate weeks",
    form,
    out,
    error,
    h(
      "div",
      { class: "dialog__actions" },
      h("button", { type: "button", class: "button button--secondary", onclick: () => dialog.close() }, "Cancel"),
      saveButton,
    ),
  );
  dialog.classList.add("dialog--wide");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    generateButton.disabled = true;
    try {
      preview = (await api<{ weeks: GeneratedWeek[] }>("generate", { method: "POST", body: { weeks: count.valueAsNumber } })).weeks;
      const gaps = preview.reduce((n, w) => n + w.gaps.length, 0);
      out.replaceChildren(
        h("p", { class: gaps ? "error" : "status" }, gaps ? `${gaps} slot${gaps === 1 ? "" : "s"} could not be filled — marked Unfilled.` : "Every slot is filled."),
        rotaTable(rota.roles, rota.people, preview, "Generated preview"),
      );
      generateButton.textContent = "Regenerate";
      saveButton.disabled = false;
    } catch (err) {
      error.textContent = message(err);
    } finally {
      generateButton.disabled = false;
    }
  });

  saveButton.addEventListener("click", async () => {
    error.textContent = "";
    saveButton.disabled = true;
    try {
      await api("weeks", { method: "POST", body: { weeks: preview.map(({ date, assignments }) => ({ date, assignments })) } });
      dialog.close();
      status.textContent = `Added ${preview.length} week${preview.length === 1 ? "" : "s"}.`;
      await load();
    } catch (err) {
      const dates = err instanceof ApiError && Array.isArray(err.body.dates) ? (err.body.dates as string[]) : [];
      error.textContent = dates.length ? `${message(err)}: ${dates.map(shortDate).join(", ")}` : message(err);
      saveButton.disabled = false;
    }
  });
}

start().catch((err) => main.replaceChildren(h("p", { class: "error", role: "alert" }, message(err))));
```

- [ ] **Step 4: Verify**

```bash
npm run build
grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|window\.confirm|\bconfirm\(' src/rota.ts src/rota-table.ts   # expect nothing
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(' src/styles/rota.css   # expect nothing
```

With both dev servers running (see Task 3 Step 8), check in a browser at http://localhost:8890/: signed out → table or empty state, no edit buttons, no Generate; at 375px width the table scrolls sideways with the date column pinned. Sign in via Log in (test user from `.env`) → Generate weeks → 2 → preview → Regenerate → Save → rows appear; click a cell → pick people → Save → name shows; Delete a row → confirm → gone. Leave calendar_dev with no weeks afterwards (delete what you created). Stop the servers.

- [ ] **Step 5: Commit**

```bash
git add src/rota.ts src/rota-table.ts src/styles/rota.css
git commit -m "Add the rota page: public table, cell editing, row delete, generate dialog"
```

---

### Task 6: People page

**Files:**
- Replace: `src/people.ts` (T4 stub)

**Interfaces:**
- Consumes: `h`; `api`, `loginUrl`, `message`; `openModal`, `confirmDialog`, `skeletonTable`; `mountShell`; types `PeopleResponse`, `Person`, `PersonInput`; endpoints `GET|POST /api/people`, `PUT|DELETE /api/people?id=`.
- Produces: nothing used elsewhere. No new CSS (T4 classes cover it).

- [ ] **Step 1: Replace `src/people.ts`**

```ts
import "./styles/index.css";
import { api, loginUrl, message } from "./api";
import { h } from "./dom";
import type { PeopleResponse, Person, PersonInput } from "./shared/types";
import { mountShell } from "./shell";
import { confirmDialog, openModal, skeletonTable } from "./ui";

const main = document.querySelector<HTMLElement>("#main")!;
const body = h("div", {});
const status = h("p", { class: "status", role: "status" });
let data: PeopleResponse = { people: [], roles: [] };

async function start(): Promise<void> {
  const me = await mountShell("people");
  if (!me.user) {
    location.assign(loginUrl(me.hub));
    return;
  }
  main.replaceChildren(
    h(
      "div",
      { class: "page-head" },
      h("h1", {}, "People"),
      h("button", { type: "button", class: "button button--primary", onclick: () => edit(null) }, "Add person"),
    ),
    status,
    body,
  );
  await load();
}

async function load(): Promise<void> {
  body.replaceChildren(skeletonTable(4, 6, "Loading people"));
  try {
    data = await api<PeopleResponse>("people");
    render();
  } catch (err) {
    body.replaceChildren(h("p", { class: "error", role: "alert" }, message(err)));
  }
}

function render(): void {
  if (!data.people.length) {
    body.replaceChildren(h("p", { class: "empty" }, "Nobody here yet. Add the first person."));
    return;
  }
  const rows = data.people.map((p) =>
    h(
      "tr",
      {},
      h("th", { scope: "row" }, p.name),
      h("td", {}, data.roles.filter((r) => p.roles.includes(r.id)).map((r) => r.name).join(", ") || "–"),
      h("td", {}, String(p.frequency)),
      h(
        "td",
        {},
        h(
          "div",
          { class: "row-actions" },
          h("button", { type: "button", class: "button button--sm button--secondary", onclick: () => edit(p) },
            "Edit", h("span", { class: "visually-hidden" }, ` ${p.name}`)),
          h("button", { type: "button", class: "button button--sm button--danger", onclick: () => void remove(p) },
            "Remove", h("span", { class: "visually-hidden" }, ` ${p.name}`)),
        ),
      ),
    ),
  );
  body.replaceChildren(
    h(
      "div",
      { class: "table-scroll", role: "region", "aria-label": "People", tabindex: 0 },
      h(
        "table",
        { class: "table" },
        h("caption", { class: "visually-hidden" }, "People on the rota"),
        h(
          "thead",
          {},
          h("tr", {},
            h("th", { scope: "col" }, "Name"),
            h("th", { scope: "col" }, "Roles"),
            h("th", { scope: "col" }, "Frequency"),
            h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, "Actions"))),
        ),
        h("tbody", {}, ...rows),
      ),
    ),
  );
}

function edit(person: Person | null): void {
  const error = h("p", { class: "error", role: "alert" });
  const name = h("input", {
    id: "person-name", class: "control", required: true, maxlength: 60, autocomplete: "off", value: person?.name ?? "",
  });
  const frequency = h("input", {
    id: "person-frequency", class: "control control--short", type: "number", min: 0, max: 1, step: 0.05, required: true,
    value: person?.frequency ?? 0.5, "aria-describedby": "person-frequency-hint",
  });
  const boxes = data.roles.map((r) =>
    h("input", { type: "checkbox", id: `role-${r.id}`, value: r.id, checked: person?.roles.includes(r.id) ?? false }),
  );
  const form = h(
    "form",
    { class: "stack" },
    h("div", { class: "field" }, h("label", { for: "person-name", class: "field__label" }, "Name"), name),
    h(
      "fieldset",
      { class: "fieldset" },
      h("legend", { class: "field__label" }, "Roles"),
      ...data.roles.map((r, i) => h("div", { class: "check" }, boxes[i], h("label", { for: `role-${r.id}` }, r.name))),
    ),
    h(
      "div",
      { class: "field" },
      h("label", { for: "person-frequency", class: "field__label" }, "Frequency"),
      frequency,
      h("p", { id: "person-frequency-hint", class: "field__hint" }, "1 = every week, 0.5 = every other week, 0 = never scheduled."),
    ),
    error,
    h(
      "div",
      { class: "dialog__actions" },
      h("button", { type: "button", class: "button button--secondary", onclick: () => dialog.close() }, "Cancel"),
      h("button", { type: "submit", class: "button button--primary" }, person ? "Save" : "Add"),
    ),
  );
  const dialog = openModal(person ? `Edit ${person.name}` : "Add person", form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    const input: PersonInput = {
      name: name.value.trim(),
      roles: boxes.filter((b) => b.checked).map((b) => b.value),
      frequency: frequency.valueAsNumber,
    };
    try {
      await api(person ? `people?id=${person.id}` : "people", { method: person ? "PUT" : "POST", body: input });
      dialog.close();
      status.textContent = person ? `Saved ${input.name}.` : `Added ${input.name}.`;
      await load();
    } catch (err) {
      error.textContent = message(err);
    }
  });
}

async function remove(person: Person): Promise<void> {
  if (!(await confirmDialog(`Remove ${person.name}? They will be taken off every upcoming Sunday.`, "Remove"))) return;
  try {
    const { weeksUpdated } = await api<{ weeksUpdated: number }>(`people?id=${person.id}`, { method: "DELETE" });
    status.textContent = `Removed ${person.name} from ${weeksUpdated} upcoming week${weeksUpdated === 1 ? "" : "s"}.`;
    await load();
  } catch (err) {
    status.textContent = message(err);
  }
}

start().catch((err) => main.replaceChildren(h("p", { class: "error", role: "alert" }, message(err))));
```

- [ ] **Step 2: Verify**

```bash
npm run build
grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|\bconfirm\(' src/people.ts   # expect nothing
```

With both dev servers running: http://localhost:8890/people signed out → redirected to the hub with `returnTo`. Signed in → 17 people listed; Add "Test Person" (Welcome, 0.5) → appears; Edit → change frequency → saved; adding a duplicate name shows the 409 message in the dialog; Remove → confirm → status line with weeks count. Delete the test person afterwards. Stop the servers.

- [ ] **Step 3: Commit**

```bash
git add src/people.ts
git commit -m "Add the people page: list, add, edit and remove"
```

---

### Task 7: Migration script

**Files:**
- Create: `scripts/sheet.ts`, `scripts/sheet.test.ts`, `scripts/migrate.ts`

**Interfaces:**
- Consumes: `SeedRole`, `SeedPerson`, `argValue`, `assertWritable`, `connect`, `ensureIndexes`, `loadSchedulerData`, `upsertRolesAndPeople` (`scripts/lib.ts`); `addDays`, `isSunday`, `londonISO` (`src/shared/dates.ts`, imported with `.ts`).
- Produces:

```ts
// scripts/sheet.ts
export const ROLE_ALIASES: Record<string, string | null>; // lower-case sheet name -> role id, null = ignore
export const PERSON_ALIASES: Record<string, string>;      // sheet header -> scheduler name
export function parseSheetDate(s: string): string | null; // "4 October 2026" -> "2026-10-04"
export type SheetWeek = { date: string; assignments: Record<string, string[]> }; // role id -> scheduler person NAMES
export function flipSheet(values: string[][], today: string, roles: SeedRole[], people: SeedPerson[]): { weeks: SheetWeek[]; skipped: string[] };
```

Sheet shape (from the old `google/getServerDataFromSheet.js`): row 0 is the header; the column named `Date` holds `D MMMM YYYY`; columns 0 and 1 are ignored; every other header is a person name and each cell is that person's role(s) that Sunday.

- [ ] **Step 1: Write the failing test** — `scripts/sheet.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SeedPerson, SeedRole } from "./lib.ts";
import { flipSheet, parseSheetDate } from "./sheet.ts";

const ROLES: SeedRole[] = [
  { id: "worship", name: "Worship", needs: 1, busyFor: [0, 1, 2], consecutiveDisabled: true },
  { id: "welcome", name: "Welcome", needs: 1, busyFor: [0] },
  { id: "lyrics", name: "Lyrics", needs: 1, busyFor: [0, 1] },
];
const PEOPLE: SeedPerson[] = [
  { name: "Gil", roles: ["worship", "lyrics", "welcome"], frequency: 0.8 },
  { name: "Tom", roles: ["welcome", "lyrics"], frequency: 0.8 },
  { name: "Dan", roles: ["welcome"], frequency: 0.8 },
];
const HEADER = ["Date", "Notes", "Gil", "tom ", "Dan", "Stranger"];

describe("parseSheetDate", () => {
  it.each([
    ["4 October 2026", "2026-10-04"],
    [" 11 october 2026 ", "2026-10-11"],
    ["31 February 2026", null],
    ["2026-10-04", null],
    ["", null],
  ])("%j -> %j", (s, want) => {
    expect(parseSheetDate(s)).toBe(want);
  });
});

describe("flipSheet", () => {
  it("flips person->role into role->people for today onwards", () => {
    const values = [
      HEADER,
      ["27 September 2026", "", "Worship Lead", "Welcome"],
      ["4 October 2026", "x", "Worship Lead", "Lyrics, Welcome", "Welcome", "Welcome"],
      ["11 October 2026", "", "Away", "", "welcome"],
    ];
    const { weeks, skipped } = flipSheet(values, "2026-09-30", ROLES, PEOPLE);
    expect(weeks).toEqual([
      { date: "2026-10-04", assignments: { worship: ["Gil"], welcome: ["Tom"], lyrics: ["Tom"] } },
      { date: "2026-10-11", assignments: { worship: [], welcome: ["Dan"], lyrics: [] } },
    ]);
    expect(skipped).toEqual([
      "Welcome on 2026-10-04 is full; dropped Dan",
      'Unknown person "Stranger"',
    ]);
  });

  it("reports unknown roles, non-holders, bad and non-Sunday dates", () => {
    const values = [
      HEADER,
      ["5 October 2026", "", "Lyrics"],
      ["someday", "", "Lyrics"],
      ["18 October 2026", "", "Preaching", "Worship"],
    ];
    const { weeks, skipped } = flipSheet(values, "2026-09-30", ROLES, PEOPLE);
    expect(weeks).toEqual([{ date: "2026-10-18", assignments: { worship: [], welcome: [], lyrics: [] } }]);
    expect(skipped).toEqual([
      "2026-10-05 is not a Sunday",
      'Unreadable date "someday"',
      'Unknown role "Preaching"',
      "Tom does not do Worship (2026-10-18)",
    ]);
  });

  it("returns nothing without a Date column", () => {
    expect(flipSheet([["When", "x"]], "2026-09-30", ROLES, PEOPLE)).toEqual({
      weeks: [],
      skipped: ['No "Date" column in the header row'],
    });
  });

  it("does not treat prototype keys as aliases", () => {
    const { skipped } = flipSheet([HEADER, ["4 October 2026", "", "constructor"]], "2026-09-30", ROLES, PEOPLE);
    expect(skipped).toEqual(['Unknown role "constructor"']);
  });
});
```

Run: `npx vitest run scripts/sheet.test.ts` — Expected: FAIL (cannot resolve `./sheet.ts`).

- [ ] **Step 2: Implement `scripts/sheet.ts`**

```ts
import { addDays, isSunday } from "../src/shared/dates.ts";
import type { SeedPerson, SeedRole } from "./lib.ts";

/** Lower-case sheet role names that do not match a role name or id. null = ignore silently. */
export const ROLE_ALIASES: Record<string, string | null> = {
  "worship lead": "worship",
  away: null,
};

/** Sheet column header -> scheduler person name, for headers spelled differently. */
export const PERSON_ALIASES: Record<string, string> = {};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "4 October 2026" -> "2026-10-04"; null when unreadable or impossible. */
export function parseSheetDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  const iso = `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return addDays(iso, 0) === iso ? iso : null;
}

export type SheetWeek = { date: string; assignments: Record<string, string[]> };

const norm = (s: string) => s.trim().toLowerCase();

export function flipSheet(
  values: string[][],
  today: string,
  roles: SeedRole[],
  people: SeedPerson[],
): { weeks: SheetWeek[]; skipped: string[] } {
  const [header = [], ...rows] = values;
  const dateCol = header.findIndex((h) => norm(h ?? "") === "date");
  if (dateCol < 0) return { weeks: [], skipped: ['No "Date" column in the header row'] };

  const roleByKey = new Map<string, SeedRole>();
  for (const r of roles) {
    roleByKey.set(norm(r.name), r);
    roleByKey.set(norm(r.id), r);
  }
  const personByKey = new Map(people.map((p) => [norm(p.name), p]));
  const findPerson = (heading: string) =>
    personByKey.get(norm(Object.hasOwn(PERSON_ALIASES, heading.trim()) ? PERSON_ALIASES[heading.trim()] : heading));

  const skipped: string[] = [];
  const weeks: SheetWeek[] = [];
  for (const row of rows) {
    const raw = row[dateCol] ?? "";
    const date = parseSheetDate(raw);
    if (!date) {
      if (raw.trim()) skipped.push(`Unreadable date "${raw.trim()}"`);
      continue;
    }
    if (date < today) continue;
    if (!isSunday(date)) {
      skipped.push(`${date} is not a Sunday`);
      continue;
    }
    const assignments: Record<string, string[]> = Object.fromEntries(roles.map((r) => [r.id, []]));
    row.forEach((value, col) => {
      if (col === 0 || col === 1 || col === dateCol || !value?.trim()) return;
      const heading = header[col] ?? "";
      const person = findPerson(heading);
      if (!person) {
        skipped.push(`Unknown person "${heading.trim()}"`);
        return;
      }
      for (const part of value.split(",")) {
        const key = norm(part);
        if (!key) continue;
        const roleId = Object.hasOwn(ROLE_ALIASES, key) ? ROLE_ALIASES[key] : roleByKey.get(key)?.id;
        if (roleId === null) continue;
        const role = roles.find((r) => r.id === roleId);
        if (!role) skipped.push(`Unknown role "${part.trim()}"`);
        else if (!person.roles.includes(role.id)) skipped.push(`${person.name} does not do ${role.name} (${date})`);
        else if (assignments[role.id].length >= role.needs) skipped.push(`${role.name} on ${date} is full; dropped ${person.name}`);
        else assignments[role.id].push(person.name);
      }
    });
    weeks.push({ date, assignments });
  }
  return { weeks, skipped: [...new Set(skipped)] };
}
```

Run: `npx vitest run scripts` — Expected: PASS.

- [ ] **Step 3: `scripts/migrate.ts`**

```ts
// One-off, idempotent import into the calendar DB named by CALENDAR_MONGODB_URI.
//   npm run migrate -- --dry-run                         print the report, touch nothing (no DB connection)
//   npm run migrate                                      write to a *_dev DB
//   CALENDAR_MONGODB_URI='<prod>' npm run migrate -- --production
// Options: --data <rota-scheduler data dir> (default ~/rota-scheduler/data)
//          --credentials <service account json> (default google/credentials.json); needs GOOGLE_SHEET_ID
import { existsSync, readFileSync } from "node:fs";
import { londonISO } from "../src/shared/dates.ts";
import { argValue, assertWritable, connect, ensureIndexes, loadSchedulerData, upsertRolesAndPeople } from "./lib.ts";
import { type SheetWeek, flipSheet } from "./sheet.ts";

async function readSheet(credentialsPath: string): Promise<string[][] | null> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId || !existsSync(credentialsPath)) {
    console.log(`Sheet step skipped: ${sheetId ? `${credentialsPath} not found` : "GOOGLE_SHEET_ID not set"}.`);
    return null;
  }
  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(credentialsPath, "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const res = await google.sheets({ version: "v4", auth }).spreadsheets.values.get({ spreadsheetId: sheetId, range: "Sundays!A1:Z" });
  return (res.data.values ?? []) as string[][];
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const data = await loadSchedulerData(argValue(argv, "--data"));
console.log(`Scheduler data: ${data.roles.length} roles, ${data.people.length} people.`);

const values = await readSheet(argValue(argv, "--credentials") ?? "google/credentials.json");
const { weeks, skipped }: { weeks: SheetWeek[]; skipped: string[] } = values
  ? flipSheet(values, londonISO(new Date()), data.roles, data.people)
  : { weeks: [], skipped: [] };
console.log(`Sheet: ${weeks.length} week(s) dated today or later.`);
for (const w of weeks) {
  const cells = Object.entries(w.assignments).filter(([, names]) => names.length);
  console.log(`  ${w.date}  ${cells.map(([role, names]) => `${role}=${names.join("+")}`).join("  ")}`);
}
if (skipped.length) {
  console.log(`Skipped (${skipped.length}):`);
  for (const s of skipped) console.log(`  - ${s}`);
}

if (dryRun) {
  console.log("Dry run: nothing written.");
} else {
  const uri = process.env.CALENDAR_MONGODB_URI ?? "";
  const name = assertWritable(uri, argv);
  const { client, db } = await connect(uri);
  try {
    await ensureIndexes(db);
    await upsertRolesAndPeople(db, data);
    const people = await db.collection<{ name: string }>("rota_people").find().toArray();
    const ids = new Map(people.map((p) => [p.name, p._id.toHexString()]));
    for (const w of weeks) {
      const assignments = Object.fromEntries(
        Object.entries(w.assignments).map(([role, names]) => [role, names.map((n) => ids.get(n)!)]),
      );
      await db.collection("rota_weeks").updateOne({ date: w.date }, { $set: { assignments } }, { upsert: true });
    }
    console.log(`Wrote to ${name}: ${data.roles.length} roles, ${data.people.length} people, ${weeks.length} week(s).`);
  } finally {
    await client.close();
  }
}
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm test
npm run migrate -- --dry-run          # report; "Sheet step skipped: …" if no credentials; "Dry run: nothing written."
npm run migrate                       # writes calendar_dev; run twice, second run reports the same counts (idempotent)
CALENDAR_MONGODB_URI='mongodb://localhost:27017/calendar' node scripts/migrate.ts   # must throw "Refusing to write to "calendar"" before connecting
```

> **Deviation (found in T7):** the last command above (a URI naming `calendar`) was blocked by the session's permission classifier and not run. The refusal is covered by `assertWritable`'s unit tests in `scripts/lib.test.ts`, and `migrate.ts` calls it before `connect()`. Idempotency was checked by hashing `rota_roles`/`rota_people`/`rota_weeks` in calendar_dev before and after two real runs (identical). The sheet step was only unit-tested (no credentials), so the week-upsert path has not run live.

If `google/credentials.json` and `GOOGLE_SHEET_ID` are available in this worktree, also run the dry run with them and check the skipped list is sensible; otherwise note in the task report that the sheet step was only unit-tested.

- [ ] **Step 5: Commit**

```bash
git add scripts/sheet.ts scripts/sheet.test.ts scripts/migrate.ts
git commit -m "Add the idempotent migration from rota-scheduler data and the Sundays sheet"
```

---

### Task 8: README and final verification

**Files:**
- Create: `README.md`

**Interfaces:** Consumes everything. Produces documentation only.

- [ ] **Step 1: Write `README.md`**

~~~~markdown
# vpcc-bulletin

The VPCC Sunday serving rota. Anyone can view it; signed-in users (via the
shared login at auth.vpcc.church) can edit cells, delete weeks, generate new
weeks and manage people.

Vite + TypeScript (no framework), Netlify Functions, MongoDB (the calendar
database: `rota_roles`, `rota_people`, `rota_weeks`).

## Local development

Needs Node 24 and the Netlify CLI (`npm i -g netlify-cli`, or use `npx netlify`).
Local runs use the `calendar_dev` database — never `calendar`.

```bash
npm install
# .env: copy .env.example and fill it in. CALENDAR_MONGODB_URI is the calendar's
# MONGODB_URI with the path changed to /calendar_dev; JWT_SECRET is any local value
# that must match ../vpcc-auth/.env; AUTH_HUB_URL=http://localhost:8888.
npm run seed:dev                         # roles, people, indexes and the test user in calendar_dev
(cd ../vpcc-auth && npm install && npx netlify dev --port 8888)   # auth hub, terminal 1
npx netlify dev --port 8890              # bulletin, terminal 2 → http://localhost:8890
npm test                                 # vitest
npm run build                            # typecheck + production build
```

`../vpcc-auth/.env` needs `CALENDAR_MONGODB_URI` (same calendar_dev URI) and the
same `JWT_SECRET`. Sign in with `DEV_TEST_USERNAME` / `DEV_TEST_PASSWORD` from `.env`.

## Scripts

| Command | Does |
|---|---|
| `npm run seed:dev` | Seeds a `*_dev` DB only (refuses anything else, even with `--production`) |
| `npm run migrate -- --dry-run` | Prints what the migration would do; no DB connection |
| `npm run migrate` | Upserts roles + people from `~/rota-scheduler/data` (`--data <dir>` to override) and future rows of the Google Sheet "Sundays" tab. Refuses a DB not ending in `_dev` unless `--production` is passed |

The sheet step needs `GOOGLE_SHEET_ID` and `google/credentials.json` (a service
account key, gitignored; `--credentials <file>` to override). Without them it is
skipped and only roles and people are imported. Unmatched sheet names are listed
in the report; add spellings to `ROLE_ALIASES` / `PERSON_ALIASES` in
`scripts/sheet.ts` and re-run (it is idempotent).

## Deploying to Netlify

1. New site from this repo. `netlify.toml` sets the build (`npm run build`,
   publish `dist`, functions `netlify/functions`, Node 24).
2. Environment variables:
   - `CALENDAR_MONGODB_URI` — the calendar site's `MONGODB_URI` (DB `calendar`).
   - `JWT_SECRET` — **identical** to the calendar, auth and trifold sites.
   - `AUTH_HUB_URL` — optional, defaults to `https://auth.vpcc.church`.
   - `COOKIE_DOMAIN` — optional, defaults to `.vpcc.church`.
3. Custom domain **must be a subdomain of vpcc.church** (e.g. `bulletin.vpcc.church`):
   the `vpcc_session` cookie is scoped to `.vpcc.church` and the hub only returns
   to `*.vpcc.church`. On `*.netlify.app` nobody can sign in.
4. MongoDB Atlas network access must allow Netlify (same rule as the calendar).
5. Import production data once, from a machine with the sheet credentials:
   ```bash
   CALENDAR_MONGODB_URI='<production uri>' GOOGLE_SHEET_ID='<id>' node scripts/migrate.ts --dry-run
   CALENDAR_MONGODB_URI='<production uri>' GOOGLE_SHEET_ID='<id>' node scripts/migrate.ts --production
   ```
   This also creates the unique index on `rota_weeks.date`.
~~~~

- [ ] **Step 2: Final checks**

```bash
npm ci && npm run build && npm test
git ls-files | grep -E '(^|/)\.env$|credentials\.json' ; echo "tracked secrets: none above"
grep -rnE 'express|node-cron|dayjs|dotenv|google-spreadsheet' package.json src netlify scripts || echo "no old deps"
grep -rnE 'innerHTML|outerHTML|insertAdjacentHTML' src || echo "no innerHTML"
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(' src/styles --include=*.css | grep -v src/styles/tokens.css || echo "no raw colours"
node -e 'const p=require("./package.json");console.log(p.name, Object.keys(p.dependencies))'   # vpcc-bulletin [ 'jsonwebtoken', 'mongodb' ]
```

Then run both dev servers and do one pass of the E2E path by hand (public view → log in → generate → regenerate → save → edit cell → delete row → people add/edit/remove → log out), leaving `calendar_dev` with no weeks and no test people afterwards. The supervisor repeats this in Chrome.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document local development, scripts and the Netlify deploy checklist"
```

---

## Self-review notes

- Spec coverage: auth (T1 http/me, T4 shell), data + indexes (T1 lib, T3 rota), validation (T3), every API row (T3), generation dates + recent weeks (T2 `planDates`, T3 generate), scheduler rules and fixes (T2), rota and people UI incl. skeleton, empty state, gaps, dialogs, mobile scroll (T4–T6), style tokens (T4), migration + dry-run + guard (T1 lib, T7), seed-dev (T1), env + calendar_dev (T1), README + deploy checklist (T8).
- Type names are the ones in "Shared interfaces"; `rotaTable` is internal to T5.
- Known ceiling marked in code: concurrent bulk saves can partially store a batch (`ponytail:` note in `weeks.mts`).
