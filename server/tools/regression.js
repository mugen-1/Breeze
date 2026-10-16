/* regression.js — chay lai dung bo kiem cua TASK 10.2 tren toan site sau khi migrate EJS.

   Dung:  node regression.js
   Thoat khac 0 neu co hang muc do.
*/
const http = require('http');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');
const { readCatalog, checkListings } = require('./product-listing-check');

const CLIENT = process.env.BREEZE_CLIENT || path.join(__dirname, '..', '..', 'client');
const BASE = 'http://localhost:3000';

const ALL_PAGES = [
  'index', 'cart', 'checkout', 'orders', 'product', 'search', 'invoice', 'admin',
  'profile', 'login', 'signup', 'forgot-password',
  'chinhsachbaomat', 'chinhsachdoitra', 'chinhsachgiaohang',
  'sanpham-ao', 'sanpham-quan', 'sanpham-giay', 'handbags', 'gold-jewellery', 'sale',
];
/* 3 trang co y KHONG migrate — van serve qua express.static. */
const NOT_MIGRATED = ['invoice', 'admin', 'checkout'];

function loadClientGlobals() {
  const el = {
    setAttribute() {}, getAttribute() { return null; }, querySelectorAll() { return []; },
    querySelector() { return null; }, addEventListener() {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    style: {}, textContent: '', innerHTML: '',
  };
  const doc = {
    documentElement: el, body: null, title: '',
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, readyState: 'loading', createElement: () => Object.assign({}, el),
  };
  const sb = {
    window: {}, document: doc, localStorage: { getItem: () => null, setItem() {} },
    location: { pathname: '/' }, matchMedia: () => ({ matches: false }), console,
  };
  sb.window.document = doc;
  sb.window.location = sb.location;
  sb.window.addEventListener = () => {};
  sb.window.localStorage = sb.localStorage;
  sb.window.matchMedia = sb.matchMedia;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(CLIENT, 'js/routes.js'), 'utf8'), sb, { filename: 'routes.js' });
  vm.runInContext(fs.readFileSync(path.join(CLIENT, 'js/i18n.js'), 'utf8'), sb, { filename: 'i18n.js' });
  return { R: sb.window.BreezeRoutes, i18n: sb.window.__i18n };
}

function req(method, url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: headers || {} }, (r) => {
      let b = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { b += c; });
      r.on('end', () => resolve({ status: r.statusCode, body: b, headers: r.headers }));
    }).on('error', reject).end();
  });
}

function allMatches(re, s) {
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out;
}

/* URL co duoc mot nguon trong script-src cho phep khong — dung luat khop cua CSP cho
   2 dang nguon dang dung: 'https://host' (moi duong dan tren host do) va
   'https://host/duong/dan/' (dau '/' cuoi = moi thu NAM DUOI thu muc do). */
function allowedBy(url, sources) {
  return sources.some((s) => {
    if (!/^https?:\/\//.test(s)) return false;
    if (s.endsWith('/')) return url.startsWith(s);
    return new URL(url).origin === s.replace(/\/$/, '');
  });
}

/* Loi CSP cua MOT trang (header + HTML) -> mang thong bao, rong = sach. Hang muc 13. */
function cspIssues(headers, html) {
  const out = [];
  const hdr = headers['content-security-policy'];
  if (!hdr) {
    out.push(headers['content-security-policy-report-only'] ? 'CSP moi o che do Report-Only' : 'thieu header CSP');
    return out;
  }
  const scriptSrc = (hdr.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src ')) || '')
    .split(/\s+/).slice(1);
  const nonceTok = scriptSrc.find((s) => s.startsWith("'nonce-"));
  const nonce = nonceTok ? nonceTok.slice(7, -1) : null;
  (html.match(/<script\b[^>]*>/g) || []).forEach((t) => {
    const src = (t.match(/\ssrc="([^"]+)"/) || [])[1];
    if (!src) {
      const n = (t.match(/\snonce="([^"]+)"/) || [])[1];
      if (!n) out.push('script inline KHONG co nonce');
      else if (n !== nonce) out.push('nonce trong HTML khac nonce trong header');
      return;
    }
    if (!/^https?:\/\//.test(src)) return;   // 'self'
    if (!allowedBy(src, scriptSrc)) out.push('script ngoai allowlist: ' + src);
    if (!/\sintegrity="sha(256|384|512)-/.test(t)) out.push('script ngoai thieu SRI: ' + src);
  });
  const handlers = html.match(/<[a-z][^>]*\son[a-z]+\s*=/gi) || [];
  if (handlers.length) out.push(handlers.length + ' handler inline on*=');
  if (/href\s*=\s*["']\s*javascript:/i.test(html)) out.push('co URL javascript:');
  return out;
}

const rows = [];
function row(name, ok, detail) {
  rows.push({ name, ok, detail });
}

(async () => {
  const { R, i18n } = loadClientGlobals();
  const pages = {};

  /* 1. 21/21 trang HTTP 200 --------------------------------------------------- */
  let ok200 = 0;
  for (const k of ALL_PAGES) {
    const r = await req('GET', BASE + '/' + R.PATHS[k]);
    pages[k] = r;
    if (r.status === 200) ok200++;
  }
  row('21/21 trang HTTP 200', ok200 === 21, ok200 + '/21');

  /* 2. asset .js/.css gay ------------------------------------------------------ */
  const seen = new Set();
  let broken = 0;
  for (const k of ALL_PAGES) {
    const html = pages[k].body;
    const assets = allMatches(/<script[^>]*\ssrc="([^"]+)"/g, html)
      .concat(allMatches(/<link[^>]*\shref="([^"]+)"/g, html))
      .filter((a) => !/^https?:\/\//.test(a));
    for (const a of assets) {
      if (seen.has(a)) continue;
      seen.add(a);
      const r = await req('HEAD', BASE + '/' + a.replace(/^\.?\//, ''));
      if (r.status !== 200) { broken++; console.log('   asset gay: ' + a + ' -> ' + r.status); }
    }
  }
  row('asset .js/.css gay', broken === 0, broken + ' gay / ' + seen.size + ' asset');

  /* 3+4. global bat buoc co tren moi trang ------------------------------------- */
  /* routes.js -> BreezeRoutes, theme.js -> BreezeTheme, i18n.js -> __i18n,
     utils-format.js -> money/esc. Kiem bang su hien dien cua the <script>. */
  const NEED = { 'routes.js': 'BreezeRoutes', 'theme.js': 'BreezeTheme', 'i18n.js': '__i18n', 'utils-format.js': 'money' };
  let globalsOk = 0;
  for (const k of ALL_PAGES) {
    const scripts = allMatches(/<script[^>]*\ssrc="([^"]+)"/g, pages[k].body).map((s) => s.split('/').pop());
    const missing = Object.keys(NEED).filter((f) => !scripts.includes(f));
    if (missing.length === 0) globalsOk++;
    else console.log('   ' + k + ' thieu: ' + missing.join(', '));
  }
  row('BreezeRoutes/BreezeTheme/__i18n/money du', globalsOk === 21, globalsOk + '/21');

  /* 5. currentPageKey() dung khoa --------------------------------------------- */
  let keyOk = 0;
  for (const k of ALL_PAGES) {
    if (R.keyOf('/' + R.PATHS[k]) === k) keyOk++;
    else console.log('   keyOf sai o ' + k);
  }
  row('currentPageKey() dung khoa', keyOk === 21, keyOk + '/21');

  /* 6+7. khoa i18n: co tren trang thi phai co ca VI lan EN --------------------- */
  const dictVi = i18n.UI.vi || {};
  const dictEn = i18n.UI.en || {};
  let missKeys = 0;
  let totalKeys = 0;
  for (const k of ALL_PAGES) {
    const keys = new Set();
    ['data-i18n', 'data-i18n-ph', 'data-i18n-aria', 'data-i18n-title', 'data-i18n-value', 'data-i18n-doctitle']
      .forEach((at) => allMatches(new RegExp(at + '="([^"]+)"', 'g'), pages[k].body).forEach((x) => keys.add(x)));
    keys.forEach((key) => {
      totalKeys++;
      if (dictVi[key] == null || dictEn[key] == null) {
        missKeys++;
        console.log('   ' + k + ': khoa "' + key + '" thieu ban dich');
      }
    });
  }
  row('khoa i18n co du VI+EN', missKeys === 0, totalKeys + ' khoa, ' + missKeys + ' thieu');

  /* nut doi ngon ngu that phai co tren moi trang co footer */
  let langBtn = 0;
  for (const k of ALL_PAGES) {
    if (/data-lang="vi"/.test(pages[k].body) && /data-lang="en"/.test(pages[k].body)) langBtn++;
  }
  /* Dung 18: checkout, invoice, admin khong co footer chung -> khong co nut doi ngon
     ngu. Da doi chieu 3 file GOC, chung cung khong he co — day la hien trang cu, khong
     phai hoi quy cua dot migrate. */
  row('nut [data-lang] VI+EN co mat', langBtn === 18, langBtn + '/21 (checkout/invoice/admin von khong co footer)');

  /* 8. API cong khai / can quyen ---------------------------------------------- */
  const pub = await req('GET', BASE + '/api/products');
  const prot = await req('GET', BASE + '/api/me');
  row('API cong khai /api/products -> 200', pub.status === 200, 'HTTP ' + pub.status);
  row('API can quyen /api/me -> 401', prot.status === 401, 'HTTP ' + prot.status);

  /* 9. so card danh muc / khuyen mai / tim kiem -------------------------------- */
  /* Catalog thay doi qua admin; doi chieu ID voi SQL, khong dong dinh so card.
     HTTP/JSON/SQL loi van danh do hang muc nay va tiep tuc nhung muc con lai. */
  try {
    const category = await req('GET', BASE + '/api/products?category=sanpham-ao&onsale=0');
    const sale = await req('GET', BASE + '/api/products?onsale=1');
    const result = checkListings(await readCatalog(), { all: pub, category, sale });
    row('so card danh muc / khuyen mai / tim kiem', result.ok, result.detail);
  } catch (_) {
    row('so card danh muc / khuyen mai / tim kiem', false, 'Khong doi chieu duoc Product API / SQL');
  }

  /* 10. 3 trang khong migrate van do static phuc vu --------------------------- */
  const staticOk = NOT_MIGRATED.every((k) => pages[k].status === 200 && pages[k].headers['last-modified']);
  row('3 trang khong migrate van qua static', staticOk,
    NOT_MIGRATED.map((k) => k + (pages[k].headers['last-modified'] ? '=file' : '=EJS!')).join(', '));

  /* 11. bo test client -------------------------------------------------------- */
  let testOut = '';
  let testOk = false;
  try {
    testOut = execFileSync(process.execPath, [path.join(CLIENT, 'js/__tests__/run-all.js')], { encoding: 'utf8' });
    /* Backreference \1: khop "OK: N/N file test pass" voi N bat ky, mien la hai ve
       BANG NHAU (tuc moi file deu pass). Truoc day cho nay ghi cung 12/12 — them file
       test thu 13 la hang muc nay do oan, keo theo ca hang muc 12 vi no dung testOk. */
    testOk = /OK: (\d+)\/\1 file test pass/.test(testOut);
  } catch (e) { testOut = e.stdout || ''; }
  /* Moi file test in dung MOT dong "KET QUA: ..." -> dem luon so file tu day, khong
     ghi cung con so vao chuoi. Truoc day cho nay in cung '12 file' va da lech that khi
     them change-password.test.js (file thu 13). */
  const ketQua = testOut.match(/KET QUA: (\d+) pass, (\d+)/g) || [];
  const asserts = ketQua.reduce((acc, s) => {
    const m = s.match(/KET QUA: (\d+) pass, (\d+)/);
    return { p: acc.p + Number(m[1]), f: acc.f + Number(m[2]) };
  }, { p: 0, f: 0 });
  row('bo test client', testOk && asserts.f === 0,
    ketQua.length + ' file, ' + asserts.p + ' assertion, ' + asserts.f + ' fail');

  /* 12. chot chan hoi quy '.html' chua bi pha -------------------------------- */
  const guard = /group-b-route-keys/.test(fs.readdirSync(path.join(CLIENT, 'js/__tests__')).join(','));
  row('chot chan hoi quy .html con nguyen', guard && testOk, guard ? 'group-b-route-keys.test.js pass' : 'MAT FILE TEST');

  /* 13. CSP that tren HTML that cua 21 trang --------------------------------- */
  /* May nay khong co headless browser nen khong "mo trang xem Console" duoc. Thay vao
     do kiem dung nhung gi trinh duyet se kiem, tren HTML server tra ve:
       - header la Content-Security-Policy (CHAN that), KHONG phai ban Report-Only;
       - moi <script> inline mang dung nonce cua header (3 trang tinh: phai 0 inline);
       - 0 handler inline on*=, 0 URL javascript: (CSP chan ca hai);
       - moi <script src> ngoai nam trong allowlist script-src cua header va co SRI.
     Chi bat duoc cai nam trong HTML. Cai JS sinh luc chay (fetch, anh dong...) van
     phai xem log [csp] cua server khi duyet that. */
  const cspProblems = [];
  for (const k of ALL_PAGES) {
    cspIssues(pages[k].headers, pages[k].body).forEach((m) => cspProblems.push(k + ': ' + m));
  }
  cspProblems.slice(0, 10).forEach((m) => console.log('   csp: ' + m));
  row('CSP enforce + nonce + 0 inline + allowlist', cspProblems.length === 0,
    cspProblems.length ? cspProblems.length + ' loi (xem tren)' : '21/21 trang sach');

  /* --- in bang ------------------------------------------------------------- */
  console.log('');
  console.log('| Hang muc                                   | Ket qua | Chi tiet');
  console.log('|--------------------------------------------|---------|----------------------------');
  let bad = 0;
  rows.forEach((r) => {
    if (!r.ok) bad++;
    console.log('| ' + r.name.padEnd(42) + ' |   ' + (r.ok ? 'OK ' : 'DO ') + '   | ' + r.detail);
  });
  console.log('');
  console.log(bad === 0 ? 'REGRESSION: TAT CA XANH (' + rows.length + '/' + rows.length + ')'
    : 'REGRESSION: ' + bad + '/' + rows.length + ' HANG MUC DO');
  process.exit(bad === 0 ? 0 : 1);
})();
