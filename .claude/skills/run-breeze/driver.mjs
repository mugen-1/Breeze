#!/usr/bin/env node
/*
 * driver.mjs — launch the Breeze Shop app, smoke the API, and screenshot pages.
 *
 * Breeze is a web app: an Express server (server/) that also serves the static
 * storefront (client/) on the same origin. This driver:
 *   1. reuses a server already on :3000, or spawns `node server.js` itself;
 *   2. waits for /api/health (proves SQL Server + the process are really up);
 *   3. smoke-checks a public route (200) and an auth-protected route (401);
 *   4. screenshots the storefront + logged-out profile with headless Chrome/Edge;
 *   5. stops the server it started (leaves a pre-existing one alone).
 *
 * Requires: Node 18+ (global fetch), a running SQL Server + Firebase creds the
 * server can reach (see SKILL.md Prerequisites), and Chrome or Edge installed.
 *
 * Usage:  node .claude/skills/run-breeze/driver.mjs
 * Exit:   0 = all checks passed, 1 = something failed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');          // .claude/skills/run-breeze -> repo root
const SERVER_DIR = join(REPO, 'server');
const OUT = join(HERE, 'screenshots');
const BASE = 'http://127.0.0.1:3000';

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const BROWSER = BROWSERS.find(existsSync);

let failed = false;
const log = (...a) => console.log('[driver]', ...a);
const mark = (ok, ...a) => { if (!ok) failed = true; log(ok ? 'PASS' : 'FAIL', ...a); };

async function health() {
  try { const r = await fetch(BASE + '/api/health'); return r.ok ? await r.json() : null; }
  catch { return null; }
}

async function waitHealth(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const h = await health();
    if (h) return h;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function expectStatus(path, want) {
  let status = 'ERR';
  try { status = (await fetch(BASE + path)).status; } catch (e) { status = 'ERR:' + e.message; }
  mark(status === want, `GET ${path} -> ${status} (want ${want})`);
}

function shot(name, url) {
  if (!BROWSER) { mark(false, 'screenshot', name, '(no Chrome/Edge found)'); return; }
  const out = join(OUT, name);
  spawnSync(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1366,1000', '--screenshot=' + out, url,
  ], { timeout: 60000 });
  const ok = existsSync(out) && statSync(out).size > 1000;
  mark(ok, 'screenshot', name, ok ? `-> ${out} (${statSync(out).size} B)` : '(missing/blank)');
}

let srv = null;
try {
  mkdirSync(OUT, { recursive: true });

  const existing = await health();
  if (existing) {
    log('reusing server already on :3000 — DB:', existing.database);
  } else {
    log('starting server (node server.js in server/)…');
    srv = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', (d) => process.stdout.write('  [srv] ' + d));
    srv.stderr.on('data', (d) => process.stderr.write('  [srv!] ' + d));
    const h = await waitHealth();
    if (!h) throw new Error('server did not become healthy within 30s (SQL Server / .env / Firebase?)');
    log('health OK — DB:', h.database, '| login:', h.login);
  }

  await expectStatus('/api/health', 200);
  await expectStatus('/api/products', 200);            // public storefront data
  await expectStatus('/api/account/addresses', 401);   // auth-protected (no token)

  shot('storefront.png', BASE + '/index.html');
  shot('profile-logged-out.png', BASE + '/profile.html');
} catch (e) {
  console.error('[driver] ERROR:', e.message);
  failed = true;
} finally {
  if (srv) { srv.kill(); log('stopped server this driver started'); }
  log(failed ? 'RESULT: FAIL' : 'RESULT: PASS  (screenshots in ' + OUT + ')');
  process.exit(failed ? 1 : 0);
}
