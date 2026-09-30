# vpcc-bulletin

The VPCC Sunday serving rota. Anyone can view it; signed-in users (via the shared
login at auth.vpcc.church) can edit cells, delete weeks, generate new weeks and
manage people.

## Architecture

- Vite + TypeScript, no framework, plain CSS. Two pages: `index.html` (rota) and `people.html`.
- Netlify Functions v2 in `netlify/functions` (`/api/*` → `/.netlify/functions/:splat`).
  `GET /api/weeks` is public; everything else needs a valid `vpcc_session` cookie from the auth hub.
- MongoDB: the calendar database (`rota_roles`, `rota_people`, `rota_weeks`).
- The scheduler (`src/shared/schedule.ts`) is shared by the browser and the generate function.

## Local development

Needs Node 24 and the Netlify CLI. Local runs use the `calendar_dev` database, never `calendar`.

`.env` (copy `.env.example`; never commit it) holds:
`CALENDAR_MONGODB_URI` (the calendar's URI with the path changed to `/calendar_dev`),
`JWT_SECRET` (any local value, identical to `../vpcc-auth/.env`),
`AUTH_HUB_URL=http://localhost:8888`, `DEV_TEST_USERNAME`, `DEV_TEST_PASSWORD`,
and `GOOGLE_SHEET_ID` (migration only). `../vpcc-auth/.env` needs the same
`CALENDAR_MONGODB_URI` and `JWT_SECRET`.

```bash
npm install
npm run seed:dev     # roles, missing people, indexes and the test user in calendar_dev (refuses any other DB)
(cd ../vpcc-auth && npx netlify dev --port 8888 --no-open)                               # auth hub
node --env-file-if-exists=.env "$(command -v netlify)" dev --port 8890 --no-open \
  --functions "$PWD/netlify/functions"                                                   # bulletin → http://localhost:8890
```

The bulletin command loads `.env` itself and points netlify-cli at this tree's
functions, because from a git worktree netlify-cli resolves the project root to the
main checkout (it is the `bulletin` entry in `.claude/launch.json`).

Sign in as the `general` test user: username `DEV_TEST_USERNAME`, password
`DEV_TEST_PASSWORD`, both in `.env`.

## Tests

```bash
npm run typecheck
npm test             # vitest: scheduler, validation, http/auth, migration helpers
npm run build        # typecheck + production build into dist/
```

## Migration

`scripts/migrate.ts` imports roles and people from `~/rota-scheduler/data`
(`--data <dir>` to override), plus the manual-only roles in `MANUAL_ROLES`
(`scripts/lib.ts`: Preaching), and every Sunday row of the Google Sheet's
`Schedule` tab (`GOOGLE_SHEET_TAB` to override), past ones included: past weeks feed
the scheduler's frequency window and consecutive rules; the rota page only shows
today onward.
It is idempotent and safe to re-run after launch: roles are upserted by id, but people
(by name) and weeks (by date) are only inserted when missing, so edits made in the app
are never overwritten. Nothing is ever deleted. People and weeks already in the DB, and
anything in the DB but not in the source, are reported as "kept".

```bash
npm run migrate -- --dry-run      # read-only diff against the target DB: insert / update (fields, roles only) / unchanged / kept
npm run migrate                   # writes; refuses a DB not ending in _dev
CALENDAR_MONGODB_URI='<production uri>' npm run migrate -- --dry-run
CALENDAR_MONGODB_URI='<production uri>' npm run migrate -- --production
```

`--dry-run` never writes (no index creation either), so it runs against any DB
without `--production`.

Sheet input: set `GOOGLE_SHEET_ID` and put a service-account key at
`google/credentials.json` (gitignored; `--credentials <file>` to override). Without
both the sheet step is skipped. `--sheet-fixture <file>` reads rows from a JSON
`string[][]` instead (header row first), e.g. `scripts/fixtures/sheet.json`.
The tab has a `Date` column (`June 7 2026` or `7 June 2026`) and one column per role,
headed with the role's name (case-insensitive); each cell is a comma-separated list of
people. Rows that are not Sundays, or have nobody in a non-manual role (e.g. only a
preacher, so the Sunday can still be generated), are skipped. Names are matched against
the people in the DB plus the scheduler data. Unknown people are always skipped. Rows
before today are history and keep everyone else as written; from today on, people who
do not hold the role (any person may fill a manual role) and extras beyond a role's
`needs` are skipped too. Everything skipped is listed; add spellings to `ROLE_ALIASES` / `PERSON_ALIASES` in
`scripts/sheet.ts` and re-run.

Manual roles (`manual: true` in `rota_roles`) are never filled by "Generate weeks" and
never reported as unfilled, and serving in one does not count towards a person's
frequency; anyone can be put in them by editing the cell, and they are
not offered on the People page.

## Deploying to Netlify (owner checklist)

1. Create a site from this repo. `netlify.toml` sets the build: `npm run build`,
   publish `dist`, functions `netlify/functions`, Node 24.
2. Environment variables:
   - `CALENDAR_MONGODB_URI`: the calendar site's `MONGODB_URI` (DB `calendar`).
   - `JWT_SECRET`: identical to the auth hub (and the calendar and other sites sharing the login).
   - `AUTH_HUB_URL`: optional, defaults to `https://auth.vpcc.church`.
   - `COOKIE_DOMAIN`: optional, defaults to `.vpcc.church`.
3. Serve it from a `*.vpcc.church` hostname (e.g. `bulletin.vpcc.church`). The login
   cookie is scoped to `.vpcc.church`; on `*.netlify.app` it is never sent and nobody can sign in.
4. Check the auth hub's `returnTo` / CORS allowlist covers the new hostname.
5. MongoDB Atlas network access must allow Netlify (same rule as the calendar).
6. Import production data once (dry run first, then `--production`, as above). The
   real run also creates the unique index on `rota_weeks.date` (the app ensures it too,
   before its first save of generated weeks).
