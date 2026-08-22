/* pagecheck.js — kiem mot trang da render: asset, khoa i18n, thu tu script, rang buoc cung.

   Thay cho phan "mo trinh duyet xem console" ma may nay khong lam duoc. Bat dung nhung
   loai loi tai trang that su sinh ra log do:
     - <script src> / <link href> tro vao file khong ton tai -> 404 trong console
     - khoa i18n co tren trang nhung thieu trong tu dien     -> khoa tho lot ra UI
     - sai thu tu script                                     -> ReferenceError luc parse
   Khong thay duoc: loi runtime chi xay ra sau khi nguoi dung bam, va moi thu ve giao dien.

   Dung:  node pagecheck.js <url> <khoa-trang-mong-doi>
*/
const http = require('http');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const CLIENT = process.env.BREEZE_CLIENT || path.join(__dirname, '..', '..', 'client');

/* --- nap routes.js + i18n.js that vao sandbox, khong chep lai du lieu ------------ */
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
    window: {}, document: doc,
    localStorage: { getItem: () => null, setItem() {} },
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

function req(method, url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search }, (r) => {
      let b = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { b += c; });
      r.on('end', () => resolve({ status: r.statusCode, body: b }));
    }).on('error', reject).end();
  });
}

/* Thu tu chuan o CLAUDE.md. Chi so nho hon = phai nap truoc. */
const GROUP = {
  'firebase-app-compat.js': 1, 'firebase-auth-compat.js': 1, 'chart.umd.min.js': 1,
  'firebase-config.js': 2, 'api-config.js': 2, 'routes.js': 2,
  'auth-helper.js': 3, 'theme.js': 3, 'i18n.js': 3,
  'utils-format.js': 4, 'utils-i18n.js': 4,
  'account-menu.js': 5, 'cart.js': 5, 'cart-drawer.js': 5, 'drawer-menu.js': 5, 'reveal.js': 5,
};
function groupOf(f) { return GROUP[f] === undefined ? 6 : GROUP[f]; }

function allMatches(re, s) {
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out;
}

(async () => {
  const url = process.argv[2];
  const expectKey = process.argv[3];
  const { R, i18n } = loadClientGlobals();
  const fails = [];
  const label = url.split('/').pop().split('?')[0];

  const page = await req('GET', url);
  if (page.status !== 200) {
    console.log('  FAIL ' + label + ' -- HTTP ' + page.status);
    process.exit(1);
  }
  const html = page.body;

  /* 1. asset cuc bo phai 200 --------------------------------------------------- */
  const assets = allMatches(/<script[^>]*\ssrc="([^"]+)"/g, html)
    .concat(allMatches(/<link[^>]*\shref="([^"]+)"/g, html));
  const local = assets.filter((a) => !/^https?:\/\//.test(a));
  for (const a of local) {
    const r = await req('HEAD', 'http://localhost:3000/' + a.replace(/^\.?\//, ''));
    if (r.status !== 200) fails.push('asset ' + a + ' -> HTTP ' + r.status);
  }

  /* 2. khoa trang --------------------------------------------------------------- */
  const gotKey = R.keyOf(new URL(url).pathname);
  if (gotKey !== expectKey) fails.push('currentPageKey: nhan "' + gotKey + '", can "' + expectKey + '"');

  /* 3. khoa i18n co tren trang phai co trong CA HAI tu dien --------------------- */
  const dictVi = i18n.UI.vi || {};
  const dictEn = i18n.UI.en || {};
  const keys = new Set();
  ['data-i18n', 'data-i18n-ph', 'data-i18n-aria', 'data-i18n-title', 'data-i18n-value', 'data-i18n-doctitle']
    .forEach((at) => allMatches(new RegExp(at + '="([^"]+)"', 'g'), html).forEach((k) => keys.add(k)));
  keys.forEach((k) => {
    if (dictVi[k] == null) fails.push('khoa i18n thieu ban VI: ' + k);
    if (dictEn[k] == null) fails.push('khoa i18n thieu ban EN: ' + k);
  });

  /* 4. thu tu script + 3 rang buoc cung ---------------------------------------- */
  const scripts = allMatches(/<script[^>]*\ssrc="([^"]+)"/g, html).map((s) => s.split('/').pop());
  const groups = scripts.map(groupOf);
  /* index.html co y dat page-index-slider.js (nhom 6) giua trang -> bo qua phan tu dau
     khi kiem tinh don dieu, dung nhu ngoai le da chot trong CLAUDE.md. */
  const seq = groups.filter((g, i) => !(i === 0 && g === 6));
  const seqNames = scripts.filter((s, i) => !(i === 0 && groups[0] === 6));
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] < seq[i - 1]) {
      fails.push('sai thu tu nhom script: ' + seqNames[i] + ' (nhom ' + seq[i] + ') dung sau nhom ' + seq[i - 1]);
      break;
    }
  }
  const idx = (f) => scripts.indexOf(f);
  const has = (f) => idx(f) !== -1;
  if (has('firebase-config.js') && has('firebase-app-compat.js') && idx('firebase-app-compat.js') > idx('firebase-config.js')) {
    fails.push('RB1 vo: Firebase SDK sau firebase-config.js');
  }
  if (has('auth.js') && has('firebase-config.js') && idx('firebase-config.js') > idx('auth.js')) {
    fails.push('RB2 vo: firebase-config.js sau auth.js');
  }
  if (has('page-search.js') && !(has('utils-i18n.js') && idx('utils-i18n.js') < idx('page-search.js'))) {
    fails.push('RB3 vo: page-search.js khong co utils-i18n.js dung truoc');
  }

  /* 5. partial dung chung phai nam SAU markup (7 file doc DOM luc parse) -------- */
  ['account-menu.js', 'drawer-menu.js'].forEach((f) => {
    if (!has(f)) return;
    const tagPos = html.indexOf('src="js/' + f + '"');
    const lastMarkup = Math.max(html.lastIndexOf('</footer>'), html.lastIndexOf('</main>'), html.lastIndexOf('</div>'));
    if (tagPos < lastMarkup) fails.push(f + ' nam TRUOC markup -- no doc DOM ngay luc parse');
  });

  if (fails.length === 0) {
    console.log('  OK   ' + label.padEnd(24) + ' asset ' + local.length + '/' + local.length
      + ', khoa "' + gotKey + '", i18n ' + keys.size + ' khoa, script ' + scripts.length);
    process.exit(0);
  }
  console.log('  FAIL ' + label);
  fails.forEach((f) => console.log('       - ' + f));
  process.exit(1);
})();
