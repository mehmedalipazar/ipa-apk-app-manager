# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted iOS OTA (over-the-air) IPA distribution service. Admin uploads an `.ipa`, gets a
time-limited shareable link; the recipient opens it in Safari on an iPhone and installs in one tap.

**Two fully independent services in one repo** (restructured 2026-08-13): `backend` (Fastify API)
and `frontend` (React SPA). There is **no root-level build structure** — no root `package.json`, no
npm workspaces, no shared lockfile, no root `tsconfig.base.json`, no root `.env`, no root
`docker-compose.yml`. Each folder installs, builds, and deploys on its own. **Do not reintroduce a
root-level manifest or a combined compose file** — the separation is the point.

`README.md` is the authoritative user/operator documentation (Turkish) — read it before changing
deployment, env, or link-lifetime behavior.

> **Under version control since 2026-08-10.** Code can be rolled back via git, but **data cannot**:
> `backend/data-docker/` and `backend/data/` are gitignored — back them up separately before
> destructive operations. The pre-v2 source tree is archived at `../ipa-ota-download-v1-yedek/`.

## Commands

Every command runs **inside a service folder**. There is nothing to run at the repo root.

```bash
cd backend
npm install
npm run dev            # API on :3000   (reads .env.development + .env.local)
npm run typecheck
npm run build          # tsc -> dist/
npm start              # run the built backend (.env.production + .env.local)

cd frontend
npm install
npm run dev            # SPA on :5173   (strictPort — fails instead of shifting ports)
npm run typecheck
npm run build          # tsc --noEmit + vite build
```

Each service also has `docker:up` / `docker:down` / `docker:logs` wrappers around its own compose
file. Installing one service never builds the other's dependencies — notably `better-sqlite3`
(native, needs a compiler) is now backend-only.

### Tests

There is **no `npm test`** — the real suite is a custom end-to-end harness in `tests/` (plain
`.mjs`, no test framework):

```bash
node tests/run-suite.mjs                  # groups A–D
node tests/run-suite.mjs A C              # only selected groups
node tests/run-suite.mjs D --domain https://other.host
```

`tests/` stayed at the repo root after the 2026-08-13 split (deliberate choice — it is a
cross-cutting harness, not a workspace). It needs no `npm install` of its own: almost everything is
Node builtins. The one exception is two suite-C cases (F13/F14) that open the test instance's
SQLite directly — they resolve `better-sqlite3` out of `backend/node_modules` via
`createRequire(backend/package.json)`, so the backend must be installed (it must be anyway to spawn
the server under test).

- Groups A (env-var reading), B (docker compose var passthrough), C (API contract) spawn **isolated
  backend instances on free ports with temp data dirs** (`tests/lib/harness.mjs`). The harness
  spawns `backend/src/index.ts` with `cwd: backend/` and passes env explicitly — it reads **no**
  `.env` files, so it resolves `backend/node_modules` and is unaffected by the split.
- Group B additionally exercises the running `docker compose` stack; bring it up first or those
  cases skip.
- Group D targets the real deployed HTTPS chain. `suite-d-https.mjs` reads `PUBLIC_BASE_URL`,
  `INSTALL_PATH_PREFIX` and `ADMIN_PASSWORD` from **`backend/.env`** (the compose secrets file) —
  it logs into the live panel and uploads/removes throwaway builds, so treat a D run as touching
  production.
- JSON reports land in `tests/reports/`. `tests/TEST-PLAN.md` is the scenario matrix.
- Test IPAs: `tests/fixtures/*.ipa`, regenerate with `node tests/fixtures/make-ipa.mjs <out.ipa> …`.

> **Post-split breakage was repaired 2026-08-20.** After the 2026-08-13 split, B and D read the
> deleted root `.env`/`docker-compose.yml`, and — contrary to what this file used to claim
> ("A and C are unaffected, verified by inspection") — **C was also broken in 4 places**
> (C3b read the root `.env`, F13/F14 imported `better-sqlite3` from the deleted root
> `node_modules`, F20 uploaded the deleted root `package.json` as its wrong-extension fixture).
> The inspection-only verification missed what a run caught in seconds: **claims about tests must
> come from running them.** All suites now use `backend/.env`, `backend/docker-compose.yml`
> (project `ipa-ota-backend`, run from `backend/`) and `frontend/.env` / `frontend/` for the web
> service.

Last full green run: **165/165** (2026-08-20; A+C = 102, B = 14, D = 49) — A+B+C against the fixed
sources, D against the live stack (still running the 2026-08-13 image, whose behavior the updated
assertions also accept). Suite D asserts the current posture: no `/config.js` (D2.4), cookie
`SameSite=None` + CORS open for `http://localhost:5173` only (D3.3/D3.5/D3.7), and the Origin
guard rejecting foreign-origin writes (D3.8/D3.9). Group H in suite C (H1–H8) plus
`A-baseurl-bicim` pin the 2026-08-20 bug fixes listed below. Evidence and history:
`tests/BULGULAR-HTTPS.md`.

#### Behavior fixes shipped 2026-08-20 (pinned by suite C group H + `A-baseurl-bicim`)

- **iPad install works.** iPadOS 13+ desktop-mode UA is indistinguishable from macOS on the
  server; the non-iOS install page now carries a hidden install block plus a touch-detection
  script (`Macintosh` + `maxTouchPoints > 1`) that reveals it on iPads. Without JS the page
  stays in the old QR view.
- **Sessions die on password change** — see the env section above.
- **`/api/auth/login` is rate-limited** in-memory: 5 failures per IP → 429 for 15 minutes
  (reset on success or process restart). Suite D's deliberate failures stay under the limit.
- **`download_count` counts real downloads**: only body-bearing requests starting at byte 0.
  Range continuation parts and HEAD no longer inflate it (D8.5's threshold moved 3→2).
- **Range handling follows RFC 9110**: an end past EOF is clamped into a 206 (was: silently a
  200 full body); a start past EOF returns 416 + `Content-Range: bytes */size`.
- **`ttlHours < 1` on upload means "not provided"** → default TTL (was: silently a 1-hour
  link, because an emptied form field serializes as 0); the upload form also disables submit
  on an invalid value.
- **Invalid `PUBLIC_BASE_URL` (missing scheme) fails at boot** instead of being silently
  dropped by the settings loader with a misleading "not set" warning.
- **Un-revoking a purged build returns 409** (mirrors `extend`), and `stats.active`,
  `stats.activeBytes` and the `onlyActive` listing all use the exact `getStatus()` definition
  of active (not expired AND not revoked AND files present).
- **Failed password attempts** on the install page no longer increment `view_count`, and the
  server-config-missing case renders its own 503 page instead of "link not found".
- **Hardening:** empty storage keys are rejected (`removePrefix('')` would have deleted the
  whole uploads root); a zip entry exceeding its declared size now fails parsing instead of
  hanging the request; the `Content-Disposition` filename sanitizes the version string too.

#### Frontend fix shipped 2026-08-25 (no harness coverage)

- **A dead backend no longer reads as "ADMIN_PASSWORD is not set".** `App.tsx` used to swallow
  every `api.me()` failure into `{ configured: false }`, and `LoginPage` renders exactly one thing
  for that flag — so any API outage (nginx 502, network error, CORS block) produced a confident but
  wrong instruction to go set an env var that was already set. Since `GET /api/auth/me` is
  unguarded and **always** answers 200 once reached (`auth.module.ts`), a throw there means
  *unreachable*, never *unconfigured*. The two states are now distinct: `configured` is false only
  when the server actually said so, and a connectivity failure renders the real reason plus a
  "Tekrar dene" button (`baglantiHatasiMi` / `baglantiHatasiMetni` in `frontend/src/api.ts`).

> The `tests/` harness drives the HTTP API, not React, so it cannot catch this class of bug.
> Verified by hand against a throwaway local server that serves `frontend/dist` and returns
> nginx-style 502 for `/api/*`: 502 ⇒ "Sunucuya ulasilamiyor (HTTP 502)"; retry after recovery ⇒
> login form; reachable-but-`configured:false` ⇒ the ADMIN_PASSWORD warning still appears.

### Docker

Two separate stacks, two separate compose projects. Neither file knows about the other service.

```bash
cd backend  && docker compose up -d --build     # project ipa-ota-backend,  api on :3000
cd frontend && docker compose up -d --build     # project ipa-ota-frontend, web on :5173

cd backend && docker compose logs -f api
cd backend && docker compose stop api && npm run dev   # avoid port 3000 collision
```

Compose project names are pinned via the top-level `name:` key in each file. Without it compose
would derive the project from the directory (`backend`, `frontend`). Containers are named
`ipa-ota-api` and `ipa-ota-web`.

**Port 3000 collision is silent on macOS.** A stray `npm run dev` in `backend/` and the api
container can both appear to listen (IPv4 vs IPv6), and requests hit whichever wins. If test
results look impossible, run `lsof -nP -iTCP:3000 -sTCP:LISTEN` first. This is also a
**production** concern, not just a dev nuisance: the public domain's nginx forwards to this
machine's :3000 (see Architecture), so a stray dev backend can end up serving live traffic.

> Quickest way to tell *who answered* (probing `:3000` **directly**, not through the domain — see
> the liveness note under Architecture): `GET /healthz` returns `uptime` **in seconds**. A server you
> just started reports `0`–`2`; a large value means an already-running container replied, not your
> process. This bit during the 2026-08-13 split: Docker Desktop started in the background mid-task
> and `restart: unless-stopped` revived the old containers, making a probe of the "new" backend
> return the old one's answers.

## Architecture

### Two independent deployables, no shared anything

`frontend` imports **nothing** from `backend`. The only contract is HTTP, and the DTO types in
`frontend/src/api.ts` are kept in sync with `backend/src/modules/builds/build.dto.ts` +
`backend/src/config/settings.schema.ts` **by hand**. Nothing catches the drift for you at compile
time — test C10 is the guard.

Since 2026-08-13 the separation is structural, not just conventional. Each service owns:

| | backend | frontend |
|---|---|---|
| manifest + lockfile | `backend/package.json`, `backend/package-lock.json` | `frontend/package.json`, `frontend/package-lock.json` |
| `node_modules` | `backend/node_modules` | `frontend/node_modules` |
| TS config | `backend/tsconfig.json` (self-contained; base was inlined) | `frontend/tsconfig.json` (already was) |
| compose | `backend/docker-compose.yml`, project `ipa-ota-backend` | `frontend/docker-compose.yml`, project `ipa-ota-frontend` |
| image build context | `backend/` | `frontend/` |
| compose env | `backend/.env` | `frontend/.env` |
| data | `backend/data-docker/` (bind mount) | none — stateless |

Docker build contexts are the service folder, **not the repo root**. `docker build` from the root
will fail; `cd backend && docker build .` is the shape now. The Dockerfiles do
`COPY package.json package-lock.json* ./ && npm ci` with no `--workspace` flag.

There is **no proxy in this repo**, not even in dev. Vite has no `server.proxy`, and the web
container's nginx serves static files only.

### The API address: relative in production, absolute in development

`frontend/src/api.ts` reads exactly one thing: `import.meta.env.VITE_API_BASE_URL`, baked at build
time. The old runtime mechanism (`/config.js` + `window.__IPA_OTA_CONFIG__` + `API_BASE_URL`) has
been **removed** — do not reintroduce it.

| | `VITE_API_BASE_URL` | consequence |
|---|---|---|
| `frontend/.env.production` | *empty* | relative paths (`/api/...`); the deployed SPA stays same-origin and never needs CORS |
| `frontend/.env.development` | `https://ipa-ios.simurgbilisim.com` | dev SPA talks to the LIVE API cross-origin (`backend/.env` lists `http://localhost:5173` in `CORS_ORIGINS`) — panel actions hit production data |
| `frontend/.env.local` (gitignored) | `http://localhost:3000` | points the dev SPA at the local backend instead; uploads land in `backend/data/` |

**`frontend/.env` is NOT in that table on purpose.** It exists, but it belongs to `docker compose`
(it carries `WEB_PORT`). Vite nonetheless loads `.env` as its base file — order is
`.env` → `.env.[mode]` → `.env.local` → `.env.[mode].local` — so a `VITE_`-prefixed variable
written there would silently leak into the bundle. Keep `VITE_*` out of `frontend/.env`.

Dev-SPA-to-live-API caveats: Safari blocks third-party cookies (use Chrome/Firefox), and host
port 5173 is usually held by the frontend container — `cd frontend && docker compose stop web`
first (install links keep working while `web` is down, because the backend serves them; only the
live panel goes 502).

Production therefore requires a reverse proxy in front (**configured by devops, not in this repo**):

```
https://ipa-ios.simurgbilisim.com/        ->  web:8080   (SPA)
https://ipa-ios.simurgbilisim.com/api/*   ->  api:3000   (API + OTA install paths)
```

`INSTALL_PATH_PREFIX=/api/i` in production exists precisely so the install routes also travel
through the single `/api/*` rule. Verified: `/api/i/:token` and `/api/builds` coexist without route
conflict.

The proxy's upstream is **this machine**: a LAN nginx (not in this repo, not on this Mac)
terminates TLS for the domain and forwards to 192.168.20.205:3000/:5173 — the compose stacks here
*are* production. Since the split there are **two** of them, so a 502 now localizes the fault:
`/` 502 ⇒ frontend down, `/api/*` 502 ⇒ backend down. Either way the certificate stays perfectly
valid (measured 2026-08-10), so never infer liveness from TLS alone.

> **The public `/healthz` does NOT report the backend — do not use it as a liveness probe.**
> That path is answered by the *frontend* container's nginx as a constant `return 200 "ok"`
> (`frontend/nginx.conf`), while the backend's own `/healthz`
> (`modules/system/system.module.ts`) sits **outside** the proxied `/api/*` prefix and is therefore
> unreachable from the domain. Measured 2026-08-25 with `api` stopped: `https://…/healthz` still
> returned `200 ok` while every `/api/*` returned 502. Probe the backend through `/api/*`
> (e.g. `GET /api/settings`), or hit `/healthz` directly on `:3000`.

### CORS is deliberately open for `http://localhost:5173` (decision 2026-08-10)

The user chose to develop the frontend fully separately, talking to the live API over CORS.
`backend/.env` therefore sets `CORS_ORIGINS=http://localhost:5173`. Note this is **not** a
dependency on the frontend service: the backend only declares which origins may call it, and has
no knowledge of where or whether a frontend runs. Consequences, all intentional:

- `backend/src/server.ts` registers `@fastify/cors` only when the list is non-empty (it now is).
- A non-empty list forces the session cookie to `SameSite=None` (`config/env.ts` 'auto' rule).
- The lost CSRF protection is replaced by the **Origin validation hook** in `server.ts`:
  state-changing requests (POST/PUT/PATCH/DELETE) carrying an `Origin` header outside
  `CORS_ORIGINS ∪ origin(PUBLIC_BASE_URL)` get 403 before auth runs. Clients that send no
  Origin (curl, tests, installd) are unaffected. Do not remove this hook while CORS is open,
  and do not add new allowed origins casually — every entry widens the CSRF trust set.
- Emptying the list rolls everything back to the same-origin posture (cookie returns to
  `SameSite=Lax`) but breaks the dev-SPA-to-live-API workflow; tests D3.3/D3.5/D3.7 would
  then fail by design.

### Backend layout (`backend/src/`)

`container.ts` is the dependency container: every service is constructed once in `createContainer()`
and passed to modules as `ctx`. No globals, no Fastify decorators.

```
config/     env.ts (infrastructure) + settings.schema.ts / settings.service.ts (runtime)
db/         client.ts, forward-only migrations, repositories
domain/     ipa/    zip listing → Info.plist → icon extraction (CgBI→PNG)
            links/  token generation, HMAC-signed URLs, link status
            ota/    manifest.plist generation + server-rendered install page
            storage/ Storage interface + local-disk driver
modules/    auth, settings, builds, uploads, install, system  — each exports an AppModule
jobs/       expiry cleanup
shared/     errors.ts (all typed errors), format.ts, module.types.ts
```

**The module registry is the extension seam.** `modules/index.ts` exports a `MODULES` array;
`server.ts` iterates it. Adding a feature = new folder + one line in that array. Never add routes
directly in `server.ts`.

All typed errors extend `AppError` (which carries `statusCode`); the Fastify error handler returns
`error.message` for 4xx and a generic string for 5xx. A new error type needs no HTTP-layer change.

### Signed URLs, not cookies (the constraint that shapes `domain/links/` and `domain/ota/`)

When iOS follows `itms-services://`, the OS process `installd` — not Safari — fetches
`manifest.plist` and the `.ipa`. It does not share Safari's cookies. Cookie-based protection would
break OTA install entirely. Authorization therefore lives **in the URL** as a short-lived HMAC
(`domain/links/token.ts`), bound to `token + purpose` (`manifest` | `ipa` | `icon`), so holding
build A's link grants nothing for build B — and an `icon` signature is rejected on the `manifest`
route. Never "fix" an install-path route by adding a session check.

`qr.svg` is deliberately **unsigned and status-unchecked**: it only encodes the install page's own
address, which the token holder already knows.

### Settings: three-tier precedence

`database > environment variable > schema default` (`config/settings.service.ts`).

`config/settings.schema.ts` is the single source of truth: adding a field to `AppConfigSchema` +
`CONFIG_FIELDS` surfaces it in the API and renders it in the admin panel automatically.

**`baseUrl` is the deliberate exception** and is asymmetric in three ways:

1. absent from `CONFIG_FIELDS` ⇒ the panel never draws it,
2. omitted from `AppConfigUpdateSchema` ⇒ `PUT /api/settings` silently ignores it,
3. never written to the DB; `PUBLIC_BASE_URL` **overwrites** the stored value on every load.

Writing it once from the panel would permanently shadow the env var. `requireBaseUrl()` throws
rather than guessing from request headers, because a manifest built with the wrong host fails
silently on the device.

### Link lifetime — three distinct tiers, do not conflate

1. `MAX_TTL_HOURS = 8760` in `config/settings.schema.ts` — absolute code ceiling.
2. `maxTtlHours` setting (default 720) — admin-configurable ceiling; `clampTtl()` enforces it.
3. `ttlHours` per link — chosen at upload, editable later via `PATCH /api/builds/:id`.

`ttlFrom: 'upload' | 'now'` decides what the new TTL is added to: `'upload'` corrects the original
choice (can land in the past → link expires), `'now'` revives an expired link. Revocation is
tracked separately (`revokedAt`) and editing TTL never silently un-revokes.

### Upload is two-phase on purpose

`BuildService.ingest()` streams to disk, hashes, and parses; `finalize()` creates the record.
Multipart fields can arrive **after** the file, and the file stream must be consumed immediately —
hence the split. Failures in either phase call `storage.removePrefix(id)` so no orphan files
remain. `POST /api/uploads` is guarded by `requireAuth` as a `preHandler` so an unauthenticated
client gets 401 before sending a gigabyte of body.

### Other load-bearing details

- **CgBI icons** (`domain/ipa/cgbi.ts`): Xcode rewrites app icons into Apple's CgBI variant — `.png`
  extension, not actually PNG. The module undoes three transforms (raw deflate, BGRA→RGBA,
  un-premultiply alpha). Unconvertible variants are skipped; the icon is optional, install is not.
- **Migrations** (`db/migrations.ts`) are forward-only. Append to the array; never edit an existing
  entry.
- **Cleanup** (`jobs/cleanup.job.ts`) deletes files but keeps the row, marking `files_deleted_at` —
  the build shows as "purged" and the link returns 410 instead of vanishing.
- **`domain/storage/types.ts`** exists so a non-local driver (S3/MinIO) can be dropped in.
  `withLocalFile` is the awkward-but-necessary method: zip parsing needs random access, not a stream.
- **`frontend/src/router.tsx`** is a ~70-line History API wrapper, not a router library.

## Conventions

- **Language.** Comments, identifiers, and user-facing strings are **Turkish written in ASCII** —
  no `ç ğ ı ö ş ü` anywhere in `backend/src` or `frontend/src`. Markdown docs use full diacritics.
  Local variables are Turkish (`ayarlar`, `govde`, `sonuc`, `bekle`), while exported/public API
  names are English (`BuildService`, `expiresAt`).
- **TypeScript imports carry the `.ts` extension** (`allowImportingTsExtensions` +
  `rewriteRelativeImportExtensions`) so Node can run sources directly via
  `--experimental-strip-types`, and `tsc` rewrites them to `.js` at build time.
- **No parameter properties.** `constructor(private x: T)` is unsupported by Node's type-stripping
  mode — declare fields and assign in the constructor body (see any service class).
- **Each `tsconfig.json` is self-contained.** `tsconfig.base.json` was deleted in the 2026-08-13
  split and its contents inlined into `backend/tsconfig.json` (`frontend/tsconfig.json` never
  extended it). Both set `strict` plus `noUncheckedIndexedAccess`; indexed access yields
  `T | undefined`, hence the `!` / `??` patterns around array and record lookups. A compiler-option
  change now has to be made **in both files** — that is the accepted cost of independence.

## Environment files

There is no `dotenv`. Node's `--env-file-if-exists` is used, and **later files beat earlier ones,
while a real environment variable beats every file** (verified, not assumed — re-confirmed
2026-08-13 by booting the backend with `PORT=3010`, which overrode `.env.development`'s `3000`).

Each service has **two unrelated families of env files** living in the same folder. Confusing them
is the main footgun of this layout:

| file | read by | purpose |
|---|---|---|
| `backend/.env` | `docker compose` **only** | secrets + host port for the api stack |
| `backend/.env.development` → `.env.local` | Node (`npm run dev`) | local dev config |
| `backend/.env.production` → `.env.local` | Node (`npm start`, container `CMD`) | prod defaults, baked into the image |
| `frontend/.env` | `docker compose` — **and Vite, unavoidably** | `WEB_PORT`; keep `VITE_*` out |
| `frontend/.env.development` \| `.env.production` → `.env.local` | Vite | `VITE_API_BASE_URL` |

- Node never reads a bare `.env`: the files are named explicitly in each `package.json` via
  `--env-file-if-exists`. Vite is the exception — it always loads `.env` as its base file.
- `backend/.env.development` and `backend/.env.production` **are committed and contain no secrets.**
  `.env.production` is copied into the image; docker compose then overrides secrets via
  `environment:`, which wins because it is a real env var.
- Secrets live only in `backend/.env.local` (dev) and **`backend/.env`** (docker compose).
  Templates: `backend/.env.example`, `frontend/.env.example`, `backend/.env.local.example`,
  `frontend/.env.local.example`. All `.env` / `.env.local` files are gitignored (the patterns are
  slash-free, so they match at any depth).
- **`docker compose` reads the `.env` in its own directory**, so `backend/.env` and `frontend/.env`
  cannot see each other. `ADMIN_PASSWORD` and `SESSION_SECRET` use the `${VAR:?message}` form, so
  the backend stack **fails to start** rather than silently running passwordless.
- `NODE_ENV`, `PORT`, `DATA_DIR` are deliberately **not** in compose's `environment:` block — their
  only source is the image's `.env.production`, so a stray value in `backend/.env` cannot reach
  the container.
- **`ADMIN_PASSWORD` is read only on first boot** (so a password changed in the panel survives
  restarts). To reset: start once with `ADMIN_PASSWORD_FORCE_RESET=true`, or delete the DB.
- **Changing `SESSION_SECRET` invalidates every session and every outstanding signed link** — it
  keys both the session cookie and the URL HMAC.
- **Changing the admin password invalidates every session too** (2026-08-20): the session cookie is
  signed with `SESSION_SECRET + password hash`, so a stolen cookie dies with a password change.
  Signed install links are NOT affected — they use the raw `SESSION_SECRET`.

## Data lives in a bind mount, not a named volume

`backend/docker-compose.yml` maps `./data-docker:/data` **on purpose**: a named volume lives inside
Docker Desktop's Linux VM and cannot be opened from macOS. The directory moved from the repo root
to `backend/data-docker/` in the 2026-08-13 split (35 MB, backed up first). With the bind mount:

```bash
sqlite3 backend/data-docker/ipa-ota.db "select app_name, version, expires_at from builds;"   # ONLY while api is stopped
sqlite3 backend/data/ipa-ota.db "..."        # local dev
```

> **WARNING — host `sqlite3` against the LIVE database has destroyed data (2026-08-10).**
> POSIX file locks do not propagate across Docker Desktop's bind mount, so a host-side
> connection believes it is alone: on close it checkpoints and truncates the WAL, silently
> discarding commits the container made (a build row was lost this way and had to be
> restored by hand). While the api container runs, read the DB only from inside it:
>
> ```bash
> docker compose exec -T api node -e 'const {DatabaseSync}=require("node:sqlite");
>   const db=new DatabaseSync("/data/ipa-ota.db",{readOnly:true});
>   console.log(db.prepare("select app_name, version from builds").all());'
> ```
>
> Host `sqlite3` is safe only after `cd backend && docker compose stop api`.

SQLite runs in **WAL mode**. If you copy the database elsewhere, copy `ipa-ota.db-wal` and
`ipa-ota.db-shm` too — the `.db` file alone is missing the most recent writes. **Back up
`backend/data-docker/`.**

### The bind mount breaks SQLite locking — measured, not inferred (2026-08-13)

The 2026-08-10 loss was blamed on *host* `sqlite3`. It is worse than that: the failure is the bind
mount itself, and it hits **any** second writer, including another container.

| setup | second writer's fate | lock holder's fate |
|---|---|---|
| bind mount, two containers | wrote **straight through** a `BEGIN IMMEDIATE` lock | died on `COMMIT` — `locking protocol`, errcode 15; **its transaction was lost** |
| bind mount, two processes in **one** container | identical | identical |
| bind mount, reader only | saw all 200 uncheckpointed WAL rows | untouched; reader's close destroyed nothing |
| **named volume**, two containers | correctly blocked: `database is locked` | committed cleanly, no loss |

There is no Docker setting to fix this: VirtioFS is already enabled
(`useVirtualizationFrameworkVirtioFS: true`, macOS 12.7.4) and the mount still reports as
`fakeowner` over `/run/host_mark`. The named-volume row is the only known cure.

Consequences: **reads from a second process are safe; a second writer is not.** Any future tool
that touches this database concurrently must be read-only, or the DB must move to a named volume
first.

### `dbadmin` — read-only SQLite browser (off by default)

`backend/docker-compose.yml` carries a `dbadmin` service (`coleifer/sqlite-web`, amd64-only so it
emulates on this arm64 Mac) behind the compose profile `dbadmin`, so a plain `docker compose up -d`
never starts it. `cd backend && npm run db:ui` → `http://127.0.0.1:8081`.

Three load-bearing details, each verified:

- **`-r` is the safety boundary, not a preference.** With it, the SQL console returns *attempt to
  write a readonly database* and the `delete-row` / `drop-table` routes are not registered at all
  (404). Removing the flag re-opens the data-loss path in the table above.
- **The volume is deliberately not `:ro`.** In WAL mode even a *reader* must write the `-shm`
  wal-index, so a read-only mount cannot open the database. The read limit comes from `-r`.
- **It binds to `127.0.0.1` by default** (`DBADMIN_BIND`). This Mac is the production host;
  `0.0.0.0` would expose the whole database to the LAN behind nothing but `DBADMIN_PASSWORD`.
  Prefer `ssh -L 8081:127.0.0.1:8081`.

> **Moving the data directory while a container runs is a trap.** Docker resolves a bind mount to
> an inode at container start, so a same-filesystem `mv` is silently followed by the running
> container — it keeps writing to the new location and nothing looks wrong. But on the next
> restart compose re-resolves the *path*, finds it missing, and **creates an empty directory**,
> booting the service against a blank database. Stop the stack before moving data, and after any
> such move verify the mount with `docker compose config | grep source:`.

## HTTPS is a functional requirement, not a hardening step

iOS performs OTA installs only over HTTPS with a valid (non-self-signed, full-chain) certificate;
anything else fails **with no error message on the device**. The app does not terminate TLS — put a
reverse proxy in front and point `PUBLIC_BASE_URL` at the `https://` address. `http://localhost:3000`
exercises the UI and upload flow only; it can never install to a real device. The server logs a
warning at boot and returns `warnings[]` from `/api/settings`, `/api/stats`, and `POST /api/uploads`
when `baseUrl` is missing or non-HTTPS — surface those in the UI rather than suppressing them.
