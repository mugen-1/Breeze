---
name: run-breeze
description: Build, launch, smoke-test, and screenshot the Breeze Shop web app (Express + SQL Server + Firebase Admin, serving the static storefront in client/). Use when asked to run, start, serve, screenshot, or verify the Breeze app / storefront / backend locally.
---

# Run Breeze Shop

Breeze is a **web app**: an Express API in `server/` that also serves the static
storefront in `client/` on the same origin (`http://localhost:3000`). It needs a
reachable **SQL Server** (`BreezeShopDB`) and **Firebase Admin** credentials.

The agent harness is **`.claude/skills/run-breeze/driver.mjs`** — it launches the
server (or reuses one already on :3000), waits for a real DB-backed health check,
smoke-tests a public + an auth-protected route, screenshots pages with headless
Chrome/Edge, and stops the server it started. Prefer it over `npm start` (which
just opens a window and blocks).

> All paths below are relative to the repo root (the `<unit>`). This is a Windows
> box; commands are Git Bash unless noted. Verified on Node v24.16.0, Chrome + Edge.

## Prerequisites

- **Node 18+** and npm (`node --version`).
- **SQL Server** running and reachable, with `BreezeShopDB`. Connection comes from
  `server/.env` (copy `server/.env.example` → `server/.env`, fill `DB_*`). Already
  present on this machine (server connects to `Hades` / `BreezeShopDB`).
- **`server/firebase-service-account.json`** — Firebase Admin service account
  (already present here). Without it, auth routes error but the app still boots.
- **Chrome or Edge** for screenshots (driver auto-detects the usual install paths).

## Setup

```bash
cd server && npm install    # deps: express, mssql, firebase-admin, helmet, cors, express-rate-limit
```

First-time **DB bootstrap** (only for an empty database — *destructive*, not run
here because BreezeShopDB already exists): the project uses one runner,
`server/db/run-sql.js`, the same one proven below for a migration:

```bash
# cd server
# node db/run-sql.js db/schema.sql     # DROPs + recreates the 5 base tables
# node db/run-sql.js db/seed.sql        # 5 categories, 50 products
# node db/run-sql.js db/migrations/006_delivery_addresses.sql   # + other migrations/*
```

Migrations in `db/migrations/` are idempotent (safe to re-run); `schema.sql` and
`seed.sql` are **not** (they drop data).

## Run — agent path (use this)

```bash
node .claude/skills/run-breeze/driver.mjs
```

Prints `PASS/FAIL` per check and `RESULT: PASS|FAIL` (exit 0/1). Screenshots land
in `.claude/skills/run-breeze/screenshots/` (`storefront.png`,
`profile-logged-out.png`). It reuses a server already on :3000 and leaves it
running; if it started its own, it kills it. Verified output:

```
[driver] health OK — DB: BreezeShopDB | login: gucci_app
[driver] PASS GET /api/health -> 200 (want 200)
[driver] PASS GET /api/products -> 200 (want 200)
[driver] PASS GET /api/account/addresses -> 401 (want 401)
[driver] PASS screenshot storefront.png -> ...\screenshots\storefront.png (709367 B)
[driver] PASS screenshot profile-logged-out.png -> ...\screenshots\profile-logged-out.png (39197 B)
[driver] RESULT: PASS
```

To screenshot other pages, edit the `shot(...)` calls near the bottom of
`driver.mjs` (any file under `client/`, e.g. `/sanpham-ao.html`, `/cart.html`).

### Direct API smoke (no driver)

With a server up, the surface is HTTP:

```bash
curl -s http://127.0.0.1:3000/api/health          # {status:ok, database:BreezeShopDB, ...}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/account/addresses   # 401
```

Read-only DB sanity check (connects, prints category/product counts):

```bash
cd server && node db/verify.js
```

## Run — human path

Double-click **`start-server.bat`** (Windows), or:

```bash
cd server && npm start        # → http://localhost:3000/index.html ; Ctrl+C to stop
```

Useless headless — it blocks and expects a browser window. Use the driver instead.

## Gotchas

- **Auth-gated features can't be driven headless.** Profile settings, saved
  **delivery addresses**, cart, and orders require a real Firebase login in the
  browser (email/password → Firebase issues an ID token the API verifies). The
  driver screenshots the **storefront** and the **logged-out** profile (which
  correctly shows "Vui lòng đăng nhập"). To test the address CRUD UI, log in
  manually at `/login.html`, then open `/profile.html` → tab "Địa chỉ giao hàng".
- **Use `127.0.0.1`, not `localhost`, from Node `fetch`.** The server binds all
  interfaces; Node may resolve `localhost` to IPv6 `::1` and stall. The driver
  already uses `127.0.0.1`.
- **Screenshot path must be Windows-style.** `driver.mjs` gets that free from
  `path.join` on win32. From Git Bash directly, wrap with `cygpath -w`.
- **Port 3000 reuse.** If `start-server.bat` (or any server) is already on :3000,
  the driver reuses it and will **not** kill it on exit.
- **CORS whitelist** allows `:3000` and `:5500`. Opening `client/` via VS Code
  Live Server (:5500) still lets API calls to :3000 through.
- **No unit-test suite.** `package.json` has only `start`/`dev`; verification here
  *is* the driver + `db/verify.js`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Driver: `server did not become healthy within 30s` | SQL Server not running / wrong `DB_*` in `server/.env`. Confirm with `cd server && node db/verify.js`. |
| Server logs `[firebase] KHÔNG khởi tạo được Admin SDK` | Missing/invalid `server/firebase-service-account.json`. App still boots; auth routes 500. |
| Screenshot `(missing/blank)` | Chrome/Edge not at a detected path — edit the `BROWSERS` array in `driver.mjs`. |
| `/api/health` returns 500 | DB unreachable; the JSON `detail`/`code` field names the SQL error. |
