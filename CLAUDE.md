# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted iOS OTA (over-the-air) IPA distribution service. Admin uploads an `.ipa`, gets a
time-limited shareable link; the recipient opens it in Safari on an iPhone and installs in one tap.
npm workspaces monorepo: `backend` (Fastify API) + `frontend` (React SPA).

`README.md` is the authoritative user/operator documentation (Turkish) — read it before changing
deployment, env, or link-lifetime behavior.

> **Under version control since 2026-08-10.** Code can be rolled back via git, but **data cannot**:
> `data-docker/` and `backend/data/` are gitignored — back them up separately before destructive
> operations. The pre-v2 source tree is archived at `../ipa-ota-download-v1-yedek/`.

## Commands

```bash
npm install

npm run dev:backend    # API on :3000   (reads backend/.env.development + backend/.env.local)
npm run dev:frontend   # SPA on :5173   (strictPort — fails instead of shifting ports)

npm run typecheck      # both workspaces
npm run build          # frontend (tsc --noEmit + vite build) then backend (tsc)
npm start              # run the built backend
```

### Tests

There is **no `npm test`** — the real suite is a custom end-to-end harness in `tests/` (plain
`.mjs`, no test framework):

```bash
node tests/run-suite.mjs                  # groups A–D
node tests/run-suite.mjs A C              # only selected groups
node tests/run-suite.mjs D --domain https://other.host
```

- Groups A (env-var reading), B (docker compose var passthrough), C (API contract) spawn **isolated
  backend instances on free ports with temp data dirs** (`tests/lib/harness.mjs`). The harness
  spawns `backend/src/index.ts` directly and passes env explicitly — it reads **no** `.env` files.
- Group B additionally exercises the running `docker compose` stack; bring it up first or those
  cases skip.
- Group D targets the real deployed HTTPS chain, reading `PUBLIC_BASE_URL` from the root `.env`.
- JSON reports land in `tests/reports/`. `tests/TEST-PLAN.md` is the scenario matrix.
- Test IPAs: `tests/fixtures/*.ipa`, regenerate with `node tests/fixtures/make-ipa.mjs <out.ipa> …`.

Current state (2026-08-10): **A+B+C = 106/106** with the compose stack up, **D = 47/47** against
the live domain. Suite D was updated 2026-08-10 to v2 expectations — it now asserts the *absence*
of `/config.js`, a `SameSite=Lax` cookie, and fully disabled CORS in production
(D2.4/D3.3/D3.5/D3.7). Evidence and history: `tests/BULGULAR-HTTPS.md`.

### Docker

```bash
docker compose up -d --build      # api on :3000, web on :5173 (host)
docker compose logs -f api
docker compose stop api && npm run dev:backend   # avoid port 3000 collision
```

**Port 3000 collision is silent on macOS.** A stray `npm run dev:backend` and the api container can
both appear to listen (IPv4 vs IPv6), and requests hit whichever wins. If test results look
impossible, run `lsof -nP -iTCP:3000 -sTCP:LISTEN` first. This is also a **production** concern,
not just a dev nuisance: the public domain's nginx forwards to this machine's :3000 (see
Architecture), so a stray dev backend can end up serving live traffic.

## Architecture

### Two independent deployables, no shared code

`frontend` imports **nothing** from `backend`. The only contract is HTTP, and the DTO types in
`frontend/src/api.ts` are kept in sync with `backend/src/modules/builds/build.dto.ts` +
`backend/src/config/settings.schema.ts` **by hand**. Nothing catches the drift for you at compile
time — test C10 is the guard.

There is **no proxy in this repo**, not even in dev. Vite has no `server.proxy`, and the web
container's nginx serves static files only.

### The API address: relative in production, absolute in development

`frontend/src/api.ts` reads exactly one thing: `import.meta.env.VITE_API_BASE_URL`, baked at build
time. The old runtime mechanism (`/config.js` + `window.__IPA_OTA_CONFIG__` + `API_BASE_URL`) has
been **removed** — do not reintroduce it.

| | `VITE_API_BASE_URL` | consequence |
|---|---|---|
| `frontend/.env.production` | *empty* | relative paths (`/api/...`); same origin; **no CORS**; cookie stays `SameSite=Lax` |
| `frontend/.env.development` | `https://ipa-ios.simurgbilisim.com` | cross-origin; backend must list `http://localhost:5173` in `CORS_ORIGINS` |
| `frontend/.env.local` (gitignored) | `http://localhost:3000` | points dev SPA at the local backend so uploads land in `backend/data/` |

Production therefore requires a reverse proxy in front (**configured by devops, not in this repo**):

```
https://ipa-ios.simurgbilisim.com/        ->  web:8080   (SPA)
https://ipa-ios.simurgbilisim.com/api/*   ->  api:3000   (API + OTA install paths)
```

`INSTALL_PATH_PREFIX=/api/i` in production exists precisely so the install routes also travel
through the single `/api/*` rule. Verified: `/api/i/:token` and `/api/builds` coexist without route
conflict.

The proxy's upstream is **this machine**: a LAN nginx (not in this repo, not on this Mac)
terminates TLS for the domain and forwards to 192.168.20.205:3000/:5173 — the compose stack here
*is* production. With the stack down, the domain returns **502 with a perfectly valid
certificate** (measured 2026-08-10). Check liveness via `https://…/healthz`, never via TLS alone.

### `CORS_ORIGINS` must be empty in production

`backend/src/server.ts` registers `@fastify/cors` **only when the list is non-empty**. A non-empty
list also forces the session cookie to `SameSite=None` (`config/env.ts`), which is a needless
weakening when the SPA is same-origin. Empty list ⇒ `SameSite=Lax` + `Secure`.

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
- `tsconfig.base.json` sets `strict` plus `noUncheckedIndexedAccess`; indexed access yields
  `T | undefined`, hence the `!` / `??` patterns around array and record lookups.

## Environment files

There is no `dotenv`. Node's `--env-file-if-exists` is used, and **later files beat earlier ones,
while a real environment variable beats every file** (verified, not assumed).

| workspace | loaded order |
|---|---|
| backend dev (`npm run dev:backend`) | `.env.development` → `.env.local` → shell |
| backend prod (`npm start`, container `CMD`) | `.env.production` → `.env.local` → shell |
| frontend (Vite) | `.env.development` \| `.env.production` → `.env.local` |

- `backend/.env.development` and `backend/.env.production` **are committed and contain no secrets.**
  `.env.production` is copied into the image; docker compose then overrides secrets via
  `environment:`, which wins because it is a real env var.
- Secrets live only in `backend/.env.local` (dev) and the **root `.env`** (docker compose).
  Templates: `backend/.env.local.example`, `frontend/.env.local.example`, `.env.example`.
- **`docker compose` reads only the root `.env`.** `ADMIN_PASSWORD` and `SESSION_SECRET` use the
  `${VAR:?message}` form, so compose **fails to start** rather than silently running passwordless.
- `NODE_ENV`, `PORT`, `DATA_DIR` are deliberately **not** in compose's `environment:` block — their
  only source is the image's `.env.production`, so a stray value in the root `.env` cannot reach
  the container.
- **`ADMIN_PASSWORD` is read only on first boot** (so a password changed in the panel survives
  restarts). To reset: start once with `ADMIN_PASSWORD_FORCE_RESET=true`, or delete the DB.
- **Changing `SESSION_SECRET` invalidates every session and every outstanding signed link** — it
  keys both the session cookie and the URL HMAC.

## Data lives in a bind mount, not a named volume

`docker-compose.yml` maps `./data-docker:/data` **on purpose**: a named volume lives inside Docker
Desktop's Linux VM and cannot be opened from macOS. With the bind mount:

```bash
sqlite3 data-docker/ipa-ota.db "select app_name, version, expires_at from builds;"   # ONLY while api is stopped
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
> Host `sqlite3` is safe only after `docker compose stop api`.

SQLite runs in **WAL mode**. If you copy the database elsewhere, copy `ipa-ota.db-wal` and
`ipa-ota.db-shm` too — the `.db` file alone is missing the most recent writes. **Back up
`./data-docker/`.**

## HTTPS is a functional requirement, not a hardening step

iOS performs OTA installs only over HTTPS with a valid (non-self-signed, full-chain) certificate;
anything else fails **with no error message on the device**. The app does not terminate TLS — put a
reverse proxy in front and point `PUBLIC_BASE_URL` at the `https://` address. `http://localhost:3000`
exercises the UI and upload flow only; it can never install to a real device. The server logs a
warning at boot and returns `warnings[]` from `/api/settings`, `/api/stats`, and `POST /api/uploads`
when `baseUrl` is missing or non-HTTPS — surface those in the UI rather than suppressing them.
