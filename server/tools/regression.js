/* regression.js — chay lai dung bo kiem cua TASK 10.2 tren toan site sau khi migrate EJS.

   Dung:  node regression.js
   Thoat khac 0 neu co hang muc do.
*/
const http = require('http');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');

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
  const catN = JSON.parse((await req('GET', BASE + '/api/products?category=sanpham-ao&onsale=0')).body);
  const saleN = JSON.parse((await req('GET', BASE + '/api/products?onsale=1')).body);
  const all = JSON.parse(pub.body);
  const arr = (x) => (Array.isArray(x) ? x : x.data);
  const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd').replace(/\s+/g, ' ').trim();
  const tk = norm('quan').split(' ').filter(Boolean);
  const searchN = arr(all).filter((p) => {
    const hay = norm((p.name_vi || '') + ' ' + (p.name_en || ''));
    return tk.every((t) => hay.indexOf(t) !== -1);
  }).length;
  row('so card danh muc / khuyen mai / tim kiem',
    arr(catN).length === 6 && arr(saleN).length === 14 && searchN === 10,
    arr(catN).length + ' / ' + arr(saleN).length + ' / ' + searchN);

  /* 10. 3 trang khong migrate van do static phuc vu --------------------------- */
  const staticOk = NOT_MIGRATED.every((k) => pages[k].status === 200 && pages[k].headers['last-modified']);
  row('3 trang khong migrate van qua static', staticOk,
    NOT_MIGRATED.map((k) => k + (pages[k].headers['last-modified'] ? '=file' : '=EJS!')).join(', '));

  /* 11. bo test client -------------------------------------------------------- */
  let testOut = '';
  let testOk = false;
  try {
    testOut = execFileSync(process.execPath, [path.join(CLIENT, 'js/__tests__/run-all.js')], { encoding: 'utf8' });
    testOk = /OK: 12\/12 file test pass/.test(testOut);
  } catch (e) { testOut = e.stdout || ''; }
  const asserts = (testOut.match(/KET QUA: (\d+) pass, (\d+)/g) || [])
    .reduce((acc, s) => {
      const m = s.match(/KET QUA: (\d+) pass, (\d+)/);
      return { p: acc.p + Number(m[1]), f: acc.f + Number(m[2]) };
    }, { p: 0, f: 0 });
  row('bo test client', testOk && asserts.f === 0, '12 file, ' + asserts.p + ' assertion, ' + asserts.f + ' fail');

  /* 12. chot chan hoi quy '.html' chua bi pha -------------------------------- */
  const guard = /group-b-route-keys/.test(fs.readdirSync(path.join(CLIENT, 'js/__tests__')).join(','));
  row('chot chan hoi quy .html con nguyen', guard && testOk, guard ? 'group-b-route-keys.test.js pass' : 'MAT FILE TEST');

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
