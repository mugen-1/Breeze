#!/usr/bin/env node
/*
 * load-test.js — đo khả năng chịu tải đồng thời của website (chỉ GET, không đăng nhập, không ghi dữ liệu).
 * Mỗi "user ảo" gửi request liên tục (xong request này mới gửi request tiếp) trong suốt thời gian đo,
 * nên N user ảo = N request đồng thời tại mọi thời điểm.
 *
 * Chạy:  node load-test.js --base http://127.0.0.1:3000 --users 10,25,50,100 --duration 30 --paths /,/index.html
 * Yêu cầu: Node.js 18+ (có sẵn fetch). Không cần cài thư viện.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const { performance } = require('perf_hooks');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}
const BASE = arg('base', 'http://127.0.0.1:3000').replace(/\/+$/, '');
const USERS = arg('users', '10,25,50,100').split(',').map(Number).filter(n => n > 0);
const DURATION = Number(arg('duration', '30')) * 1000; // thời gian đo mỗi mức (giây)
const WARMUP = Number(arg('warmup', '5')) * 1000;      // khởi động, không tính vào kết quả
const PAUSE = Number(arg('pause', '10')) * 1000;       // nghỉ giữa 2 mức
const TIMEOUT = Number(arg('timeout', '10')) * 1000;   // quá thời gian này tính là lỗi
const PATHS = arg('paths', '/').split(',').map(p => p.trim()).filter(Boolean);
const MAX_P95 = Number(arg('p95', '2000'));            // ngưỡng đạt: p95 (ms)
const MAX_ERR = Number(arg('err', '1'));               // ngưỡng đạt: tỉ lệ lỗi (%)

const sleep = ms => new Promise(r => setTimeout(r, ms));
function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}
const r1 = x => (x === null ? null : Math.round(x * 10) / 10);

async function oneRequest(path) {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'user-agent': 'breeze-load-test/1.0', 'cache-control': 'no-cache' },
    });
    const body = await res.arrayBuffer(); // đọc hết body: đo thời gian nhận trọn trang
    return { ms: performance.now() - t0, status: res.status, bytes: body.byteLength,
      location: res.headers.get('location') || '' };
  } catch (e) {
    const name = e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'TIMEOUT'
      : (e && e.cause && e.cause.code) || (e && e.name) || 'ERROR';
    return { ms: performance.now() - t0, status: 'ERR:' + name, bytes: 0, location: '' };
  }
}

async function runStage(users) {
  const samples = [];
  const start = performance.now();
  const measureFrom = start + WARMUP;
  const end = measureFrom + DURATION;
  let measuredStart = null;
  const vu = async (id) => {
    let i = id;
    while (performance.now() < end) {
      const path = PATHS[i++ % PATHS.length];
      const sentAt = performance.now();
      const r = await oneRequest(path);
      if (sentAt >= measureFrom) {
        if (measuredStart === null) measuredStart = sentAt;
        samples.push({ path, ...r });
      }
    }
  };
  await Promise.all(Array.from({ length: users }, (_, k) => vu(k)));
  const elapsed = (performance.now() - (measuredStart ?? measureFrom)) / 1000;
  return summarize(users, samples, elapsed);
}

function summarize(users, samples, elapsed) {
  const ok = samples.filter(s => typeof s.status === 'number' && s.status >= 200 && s.status < 400);
  const lat = ok.map(s => s.ms).sort((a, b) => a - b);
  const statuses = {};
  for (const s of samples) statuses[s.status] = (statuses[s.status] || 0) + 1;
  const perPath = {};
  for (const p of PATHS) {
    const l = ok.filter(s => s.path === p).map(s => s.ms).sort((a, b) => a - b);
    perPath[p] = { requests: samples.filter(s => s.path === p).length, median_ms: r1(pct(l, 50)), p95_ms: r1(pct(l, 95)) };
  }
  const accessRedirect = samples.some(s => /cloudflareaccess|cdn-cgi\/access/i.test(s.location));
  const errRate = samples.length ? ((samples.length - ok.length) / samples.length) * 100 : 100;
  const p95 = pct(lat, 95);
  return {
    users,
    requests: samples.length,
    ok: ok.length,
    error_rate_pct: r1(errRate),
    rps: r1(samples.length / elapsed),
    median_ms: r1(pct(lat, 50)),
    p90_ms: r1(pct(lat, 90)),
    p95_ms: r1(p95),
    p99_ms: r1(pct(lat, 99)),
    max_ms: r1(lat.length ? lat[lat.length - 1] : null),
    mean_ms: r1(lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null),
    statuses,
    perPath,
    access_redirect: accessRedirect,
    pass: samples.length > 0 && errRate <= MAX_ERR && p95 !== null && p95 <= MAX_P95,
  };
}

(async () => {
  const startedAt = new Date();
  console.log(`BREEZE load test → ${BASE}`);
  console.log(`Mức user: ${USERS.join(', ')} | đo ${DURATION / 1000}s/mức (khởi động ${WARMUP / 1000}s) | trang: ${PATHS.join(', ')}`);
  console.log(`Ngưỡng đạt: lỗi ≤ ${MAX_ERR}% và p95 ≤ ${MAX_P95} ms\n`);

  // Kiểm tra trước: mỗi trang phải trả 2xx, nếu không thì dừng (tránh đo nhầm trang lỗi / trang đăng nhập Cloudflare)
  for (const p of PATHS) {
    const r = await oneRequest(p);
    console.log(`  kiểm tra ${p} → ${r.status} (${r1(r.ms)} ms, ${r.bytes} byte)${r.location ? ' → ' + r.location : ''}`);
    if (!(typeof r.status === 'number' && r.status >= 200 && r.status < 300)) {
      console.error(`\nDỪNG: ${p} không trả 2xx. Kiểm tra lại URL / server trước khi đo.`);
      process.exit(1);
    }
  }
  console.log('');

  const results = [];
  for (let k = 0; k < USERS.length; k++) {
    const u = USERS[k];
    process.stdout.write(`Đang đo ${u} user đồng thời... `);
    const r = await runStage(u);
    results.push(r);
    console.log(`xong: ${r.requests} request, median ${r.median_ms} ms, p95 ${r.p95_ms} ms, lỗi ${r.error_rate_pct}% → ${r.pass ? 'ĐẠT' : 'KHÔNG ĐẠT'}`);
    if (Object.keys(r.statuses).some(s => s !== '200')) console.log('   mã trả về:', JSON.stringify(r.statuses));
    if (r.access_redirect) console.log('   CẢNH BÁO: bị chuyển hướng tới trang đăng nhập Cloudflare Access — kết quả không phản ánh server.');
    if (k < USERS.length - 1) await sleep(PAUSE);
  }

  console.log('\nKẾT QUẢ');
  console.table(results.map(r => ({
    'User': r.users, 'Request': r.requests, 'Req/s': r.rps, 'Median (ms)': r.median_ms,
    'p95 (ms)': r.p95_ms, 'p99 (ms)': r.p99_ms, 'Max (ms)': r.max_ms, 'Lỗi (%)': r.error_rate_pct,
    'Kết luận': r.pass ? 'ĐẠT' : 'KHÔNG ĐẠT',
  })));

  const env = {
    started_at: startedAt.toISOString(), base: BASE, paths: PATHS,
    duration_s: DURATION / 1000, warmup_s: WARMUP / 1000, timeout_s: TIMEOUT / 1000,
    threshold: { max_error_pct: MAX_ERR, max_p95_ms: MAX_P95 },
    machine: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0] && os.cpus()[0].model,
      cores: os.cpus().length, ram_gb: Math.round(os.totalmem() / 2 ** 30), node: process.version },
  };
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const host = BASE.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]/gi, '_');
  fs.writeFileSync(`load-test-${host}-${stamp}.json`, JSON.stringify({ env, results }, null, 2));

  const md = [
    `# Kết quả kiểm thử tải — ${BASE}`, '',
    `- Thời điểm: ${startedAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    `- Trang đo: ${PATHS.join(', ')}`,
    `- Mỗi mức đo ${DURATION / 1000} giây (bỏ ${WARMUP / 1000} giây khởi động); timeout ${TIMEOUT / 1000} giây`,
    `- Máy chạy script: ${env.machine.os}, ${env.machine.cpu}, ${env.machine.cores} luồng, ${env.machine.ram_gb} GB RAM, Node ${env.machine.node}`,
    `- Ngưỡng đạt: tỉ lệ lỗi ≤ ${MAX_ERR}% và p95 ≤ ${MAX_P95} ms`, '',
    '| User đồng thời | Request | Req/s | Median (ms) | p95 (ms) | p99 (ms) | Max (ms) | Lỗi (%) | Kết luận |',
    '|---|---|---|---|---|---|---|---|---|',
    ...results.map(r => `| ${r.users} | ${r.requests} | ${r.rps} | ${r.median_ms} | ${r.p95_ms} | ${r.p99_ms} | ${r.max_ms} | ${r.error_rate_pct} | ${r.pass ? 'ĐẠT' : 'KHÔNG ĐẠT'} |`),
    '', 'Mã trả về theo mức:', '',
    ...results.map(r => `- ${r.users} user: ${JSON.stringify(r.statuses)}`), '',
  ].join('\n');
  fs.writeFileSync(`load-test-${host}-${stamp}.md`, md);
  console.log(`\nĐã lưu: load-test-${host}-${stamp}.json và .md`);
})();
