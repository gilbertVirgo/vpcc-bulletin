# vpcc-bulletin rewrite — design

Date: 2026-09-30 · Status: approved by owner · Plan: `docs/superpowers/plans/2026-09-30-bulletin-rewrite.md`

## Goal

Replace the Express app that mirrors the Google Sheet "Sundays" tab with a small
Netlify site that owns the Sunday serving rota: view it publicly, edit it and
generate new weeks when signed in through the VPCC auth hub.

## Stack

Mirrors `vpcc-sunday-sheets`:

- Vite + TypeScript, no UI framework, plain CSS (no Tailwind).
- Netlify Functions v2 (`netlify/functions/*.mts`), `/api/*` redirected to
  `/.netlify/functions/:splat`.
- Raw `mongodb` driver, one cached client per warm container.
- Vitest. Node 24.
- Package name `vpcc-bulletin`. Runtime deps: `mongodb`, `jsonwebtoken`.
  Dev-only: `googleapis` (migration), `bcryptjs` (seed-dev), types, vite, vitest, typescript.
- Deleted: Express app, `node-cron`, sheet cache, `html/`, `helpers/`, `log.js`,
  `config.js`, `nodemon.json`, `public/main.css`, `google/getServerDataFromSheet.js`, `dayjs`, `dotenv`.

Local ports: bulletin `netlify dev` 8890 (Vite 5175). The auth hub keeps 8888
(Vite 5173); sunday-sheets keeps 8889 (Vite 5174).

## Auth

- `netlify/functions/_shared/auth.ts` is copied **verbatim** from `vpcc-auth`
  (with its test).
- `GET /api/weeks` is public. Everything else goes through `guarded()`.
- `guarded()` differs from sunday-sheets' (which is GET-only): it accepts any
  method, requires a valid session, and requires `Content-Type: application/json`
  on POST/PUT (415 otherwise). JSON-only writes force a CORS preflight, which
  bulletin never answers, so a sibling `*.vpcc.church` site cannot forge writes.
- 401 body is `{ error: "Unauthorized", hub }`. The browser's `api()` helper
  redirects to `${hub}/?returnTo=<current url>` and never resolves.
- Any authenticated role may write.
- `GET /api/me` always answers 200 `{ user: SessionUser | null, hub }` so the
  header can render Login or `username` + Logout without a console 401.
- Logout: `POST ${hub}/api/logout`, body `{}`, `Content-Type: application/json`,
  `credentials: "include"`, then reload.

## Data

Same database as the calendar (DB name = path of `CALENDAR_MONGODB_URI`).

```ts
// rota_roles — seeded only, no UI
{ _id: "worship", name: "Worship", needs: 1, busyFor: [0, 1, 2], consecutiveDisabled: true, order: 0, manual: false }
{ _id: "preaching", name: "Preaching", needs: 1, busyFor: [], consecutiveDisabled: false, order: 10, manual: true }
// rota_people
{ _id: ObjectId, name: "Gil", roles: ["worship", "lyrics"], frequency: 0.8 }
// rota_weeks — unique index on date
{ _id: ObjectId, date: "2026-10-04", assignments: { worship: ["<person id hex>"], welcome: ["…", "…"] } }
```

- Service sections: `0` pre-service, `1` during, `2` post-service.
- Manual roles (`manual: true`, e.g. Preaching, added by our scripts on top of the
  scheduler's roles): generate leaves the cell empty and never reports it as a gap,
  and serving only in a manual role does not count as serving that week (frequency,
  last-week tie-break, next-week consecutive check);
  nobody holds them (not offered on the People page), and a cell edit accepts any person.
- Person ids inside `assignments` are 24-char hex strings, not ObjectIds.
- Stored weeks always carry a key for every role id (empty array when unfilled).
- The unique index is created by the scripts (`ensureIndexes`) and also ensured by
  `POST /api/weeks` once per warm function instance before its first insert, so the
  duplicate-key backstop always exists.
- "Today" is the Europe/London calendar date.

## Validation (at the function boundary)

- `date`: `YYYY-MM-DD`, a real calendar date, a Sunday; for writes also `>= today`.
- Role ids must exist. Person ids must be 24-hex, exist, and hold the role — except
  that a cell edit may keep someone already in that stored cell who no longer holds it,
  and a manual role takes any existing person.
- A cell: array of unique person ids, length `0..needs`.
- Manual cell edits skip the section-clash and consecutive rules — a human
  override is trusted.
- Person: `name` trimmed, 1–60 chars, unique (exact match, 409 on clash);
  `roles` unique known role ids (may be empty); `frequency` finite, `0..1`.
- Generate: `weeks` integer 1–5. Bulk save: 1–5 weeks, unique dates, each one of
  `planDates(coming, stored, 5)` (the next 5 unfilled Sundays), else 400.
- Malformed JSON → 400. User data is only ever put into the DOM via
  `textContent`/attributes, never `innerHTML`.

## API

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/me` | public | – | `{ user, hub }` |
| GET | `/api/weeks` | public | – | `{ roles: Role[], people: {id,name}[], weeks: Week[] }` (weeks `>= today`, ascending) |
| POST | `/api/weeks` | guarded | `{ weeks: Week[] }` | 201 `{ weeks }`; 409 `{ error, dates }` if any date exists (nothing stored); 400 if a date is not among the next 5 unfilled Sundays |
| PUT | `/api/weeks?date=D` | guarded | `{ roleId, personIds }` | `{ week }`; 404 if no such week |
| DELETE | `/api/weeks?date=D` | guarded | – | `{ ok: true }`; 404 |
| POST | `/api/generate` | guarded | `{ weeks: 1..5 }` | `{ weeks: GeneratedWeek[] }` — stores nothing |
| GET | `/api/people` | guarded | – | `{ people: Person[], roles: Role[] }` |
| POST | `/api/people` | guarded | `{ name, roles, frequency }` | 201 `{ person }` |
| PUT | `/api/people?id=X` | guarded | `{ name, roles, frequency }` | `{ person }`; 404 |
| DELETE | `/api/people?id=X` | guarded | – | `{ ok: true, weeksUpdated }` |

Errors are `{ error: string }` with 400/401/404/405/409/415/500. 500s hide detail.

Deleting a person pulls their id from every role in weeks dated `>= today`;
past weeks are left alone. The weeks are cleaned before the person is deleted, so a
retry after a failure part-way finishes the job (a repeat for a gone id is still 404). Editing a person's roles does not rewrite existing
weeks.

### Generation dates

`coming = nextSunday(now)` (today if today is Sunday). Dates are the first `count`
Sundays from `coming` on with no stored week, so a deleted week in the middle is
refilled. The server passes every stored week from `coming` on plus the newest 8
before it to the scheduler as `recent`.

## Scheduler

Pure `generate({ people, roles, dates, recent, rng }) → GeneratedWeek[]` in
`src/shared/schedule.ts`; `GeneratedWeek = Week & { gaps: string[] }` (role ids
left short). `planDates(coming, stored, count) → string[]`. Dates are ascending
Sundays but need not be consecutive.

- Frequency is accounted over a rolling window: `recent` (the newest 8 stored
  weeks before the first new date) plus the new dates. Users often generate 1–2
  weeks at a time, so a per-run quota would make frequency meaningless.
- `quota = frequency > 0 && window > 0 ? max(1, round(min(frequency,1) × window)) : 0`.
  Quota counts **weeks served**; two roles in one week count once. `used` starts
  at the number of recent weeks the person served in.
- Roles processed in ascending `order`.
- Hard rules for a candidate: holds the role; frequency > 0; not blocked; none of
  the role's `busyFor` sections already taken this week.
- Blocked: anyone who held a `consecutiveDisabled` role in the previous week — blocked
  from every role that week. The previous week is the week exactly 7 days before the
  date, generated in this run or stored; with neither there is no previous week. The
  same week drives the served-last-week ordering.
- Next week: when the week 7 days after the date is stored, nobody serving in it may
  take a `consecutiveDisabled` role (that would block them from the week they serve).
- Order: people within quota (or already serving this week) first, by `used/quota`;
  then over-quota people, least over first. Ties: "served previous week" last, then
  a random key from `rng`. Top `needs` are taken. Quota is thus a cap, exceeded only
  to avoid a gap; gaps remain only for true infeasibility.
- An attempt fills what it can; short cells stay partial and are listed in `gaps`.
  Up to 50 attempts; stops at the first attempt with no gaps and no quota overflow,
  else returns the attempt with fewest gaps, then fewest overflows. Never throws for
  infeasibility; never loops forever.
- Fairness accounting keyed by person id; inputs are never mutated.
- Server passes `Math.random`; tests pass `mulberry32(seed)` from `src/shared/rng.ts`.

Not ported: `sortUsersByPercentageRepleted` index bug, ceil/round mismatch,
`MAX_RETRIES = Infinity`, string row count.

## UI

Two Vite HTML entries: `index.html` (Rota, `/`) and `people.html` (`/people`,
Netlify redirect `/people → /people.html 200`). A shared shell renders the header:
v1 logo (inline SVG, `currentColor`, accent), nav (Rota; People when signed in),
and Login link or username + Logout.

**Rota (/)**
- `<table>` in a horizontally scrolling wrapper (`overflow-x: auto`, labelled
  region, `tabindex="0"`). Rows = weeks from today, row header = short date
  ("Sun 4 Oct"), columns = roles in `order` with overline `th scope="col"`.
  Names joined with ", "; empty cell shows an en dash muted.
- Loading: 4 skeleton rows. Empty: "No Sundays on the rota yet." Load error:
  `role="alert"` message.
- Signed in: each cell is a button opening an edit `<dialog>` with a checkbox per
  person holding the role, plus anyone already in the cell who no longer holds it
  (labelled "no longer does this role"); once `needs` are checked the rest disable. Save → PUT.
  Each row ends with a danger "Delete" button → confirm `<dialog>` → DELETE.
  (Native `<dialog>` rather than `window.confirm`, which blocks browser automation.)
- Generate button → `<dialog>`: number input 1–5 (default 4), Generate, preview
  table (read-only, same renderer), Regenerate, Save. Gap cells get
  `.cell--gap` styling **and** the visible text "Unfilled" (not colour alone).
  Save → POST `/api/weeks`; on 409 the dialog shows the error and stays open.

**People (/people)** — requires sign-in (redirect to hub if `me.user` is null).
Table: Name, Roles (names joined ", "), Frequency (the raw number), Edit / Remove. Add/Edit use one `<dialog>` form: name, a
fieldset of role checkboxes, frequency `<input type=number min=0 max=1 step=0.05>`
with hint "1 = every week, 0.5 = every other week". Remove → confirm dialog →
DELETE, then a status line "Removed from N upcoming weeks".

**Style** — plain CSS. Tokens copied from vpcc-v1 `tokens.*.css`, converted from
Tailwind `@theme {}` to `:root {}` (the `--*: initial` resets dropped), plus
additions: `--color-skeleton`, `--color-skeleton-sheen`, `--duration-shimmer`
(from vpcc-calendar) and `--color-backdrop` (dialog backdrop, ink at 40%). No raw colour values outside `tokens.css`. No dark mode
(v1 has none). Area Inktrap via Typekit kit `ccy7tqi`. v1 `favicon.svg`.
Components: pill buttons (primary / secondary / ghost / danger; heights 36/44px),
v1 form controls (radius-md, `line-strong` border, `surface-raised`, danger when
invalid), native dialog with v1 `@starting-style` transition and
`--shadow-popover`, skeleton shimmer (static under reduced motion), table with
hairline `--color-line` row rules and overline headers, `.visually-hidden`.
Global `:focus-visible` ring from v1 base. Reduced motion via v1 token collapse.

## Migration and scripts

All scripts are TypeScript run directly by Node 24 (`node --env-file=.env scripts/x.ts`).
Target DB = `CALENDAR_MONGODB_URI`. Every write path calls `assertWritable(uri, argv)`:
refuses unless the DB name ends in `_dev` or `--production` is passed.
`seed-dev` refuses non-`_dev` even with `--production`.

- `scripts/seed-dev.ts` — upserts roles and inserts missing people from rota-scheduler data,
  upserts a `general` test user (`DEV_TEST_USERNAME` / `DEV_TEST_PASSWORD` from
  `.env`, bcrypt cost 10), ensures indexes.
- `scripts/migrate.ts [--dry-run] [--production] [--data <dir>] [--credentials <file>]`
  - (a) roles (`_id` = scheduler id, `order` = array index; plus `MANUAL_ROLES` with
    their own `order`) upserted by `_id`;
    people inserted by `name` only when missing (`$setOnInsert`; existing people are
    kept as edited in the app). Data dir defaults to `~/rota-scheduler/data`.
  - (b) Sheet tab `GOOGLE_SHEET_TAB` (default `Schedule`): header row with a "Date"
    column (`MMMM D YYYY` or `D MMMM YYYY`) and one column per role, headed with the
    role name (trimmed, case-insensitive; also the role id or `ROLE_ALIASES`). Each
    cell is a comma-separated list of people, matched trimmed and case-insensitively
    (plus `PERSON_ALIASES`) against the DB's people and the scheduler data.
    Every Sunday row with someone in a non-manual role is migrated, past ones included
    (they feed the scheduler's history; the rota view shows today onward). A row with
    only manual roles filled is skipped so that Sunday can still be generated.
    Rows before today keep every known person as written (history); from today on,
    non-holders of a non-manual role and extras beyond `needs` are dropped.
    Skipped and reported: unknown column, unknown person, non-Sunday / unparseable
    date, manual-only row, and (from today on) non-holders and extras.
    Weeks inserted by `date` only when missing (`$setOnInsert`; an existing week is
    kept as edited in the app). The dry run reports existing people and weeks as "kept".
  - Sheet step is skipped with a printed notice when the credentials file or
    `GOOGLE_SHEET_ID` is missing. Zero rows is a valid result.
  - `--dry-run` only reads Mongo (no writes, no index creation); it prints the same report.
  - Prints a report: counts upserted, skipped items with reasons.

## Dev and test

- DB `calendar_dev` on the same Atlas cluster. `.env` files are generated (never
  printed or committed) from `vpcc-calendar/.env` `MONGODB_URI` with the path
  swapped to `/calendar_dev`, plus a fresh local `JWT_SECRET` shared with a new
  `vpcc-auth/.env`. Production DB `calendar` is never written during build/test.
- Vitest: scheduler, validation, http wrapper, auth (copied), scripts' pure
  parts (target guard, sheet flip).
- E2E later by the supervisor in Chrome: public view → login → generate →
  regenerate → save → edit cell → delete row → people CRUD → logout.

## Out of scope

Roles UI, unavailable dates, pairing rules, manual add-row, notes, admin-only
gating, push notifications, dark mode.
