/* theme-boot.js — gắn data-theme lên <html> TRƯỚC khi vẽ, thay script inline ở 3 trang
   tĩnh (admin, checkout, invoice) mà CSP chặn. Nhánh tự động phải cho KẾT QUẢ Y HỆT
   snippet chống FOUC trong server/views/partials/head.ejs (18 trang EJS) — test đọc thẳng
   snippet đó ra chạy cùng một ma trận, lệch là đỏ. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, eq } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');

/* o.mode: data-theme-mode trên thẻ script; o.saved: breeze-theme đã lưu; o.osDark: hệ
   điều hành đang tối; o.throws: localStorage ném lỗi (chế độ riêng tư); o.noMM: không có
   matchMedia; o.noScript: document.currentScript = null. */
function env(o) {
  const doc = makeDoc();
  if (!o.noScript) {
    const s = El('script');
    if (o.mode) s.setAttribute('data-theme-mode', o.mode);
    doc.currentScript = s;
  } else {
    doc.currentScript = null;
  }
  const reads = [];
  const store = o.throws
    ? { getItem: function () { throw new Error('SecurityError'); } }
    : { getItem: function (k) { reads.push(k); return k === 'breeze-theme' ? (o.saved || null) : null; } };
  const win = o.noMM ? {} : { matchMedia: function (q) {
    return { matches: !!o.osDark && q === '(prefers-color-scheme: dark)' };
  } };
  return { doc: doc, store: store, win: win, reads: reads };
}

function boot(o) {
  const e = env(o);
  load('theme-boot.js', { doc: e.doc, globals: { localStorage: e.store }, window: e.win });
  return { theme: e.doc.documentElement.getAttribute('data-theme'), reads: e.reads };
}

// Snippet 'auto' của head.ejs (thẻ script inline đầu tiên, có nonce).
const HEAD = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'server', 'views', 'partials', 'head.ejs'), 'utf8');
const m = HEAD.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/);
function snippet(o) {
  const e = env(o);
  const ctx = { document: e.doc, window: e.win, localStorage: e.store };
  vm.createContext(ctx);
  vm.runInContext(m[1], ctx);
  return e.doc.documentElement.getAttribute('data-theme');
}

console.log('theme-boot.js');

// Ép sáng (admin, invoice): bỏ qua mọi lựa chọn, không cả đọc localStorage
eq('mode=light + da luu dark -> light', boot({ mode: 'light', saved: 'dark', osDark: true }).theme, 'light');
eq('mode=light -> KHONG doc localStorage', boot({ mode: 'light', saved: 'dark' }).reads, []);
eq('mode=light + localStorage nem loi -> light', boot({ mode: 'light', throws: true }).theme, 'light');

// Tự động (checkout)
eq('auto: da luu dark -> dark', boot({ saved: 'dark' }).theme, 'dark');
eq('auto: da luu light, HDH toi -> light (lua chon da luu thang)', boot({ saved: 'light', osDark: true }).theme, 'light');
eq('auto: chua luu, HDH toi -> dark', boot({ osDark: true }).theme, 'dark');
eq('auto: chua luu, HDH sang -> light', boot({}).theme, 'light');
eq('auto: gia tri rac -> theo HDH', boot({ saved: 'blue', osDark: true }).theme, 'dark');
eq('auto: khong co matchMedia -> light', boot({ noMM: true }).theme, 'light');
eq('auto: localStorage nem loi -> light', boot({ throws: true, osDark: true }).theme, 'light');
eq('khong co currentScript -> coi nhu auto', boot({ noScript: true, saved: 'dark' }).theme, 'dark');

// Đồng bộ với snippet head.ejs
check('tim thay snippet auto trong head.ejs', !!m && /breeze-theme/.test(m[1]));
const MATRIX = [
  {}, { osDark: true }, { saved: 'dark' }, { saved: 'light', osDark: true },
  { saved: 'blue', osDark: true }, { saved: 'blue' }, { noMM: true }, { noMM: true, saved: 'dark' },
  { throws: true }, { throws: true, osDark: true },
];
const lech = MATRIX.filter(function (o) { return boot(o).theme !== snippet(o); });
eq('nhanh auto cho ket qua Y HET snippet head.ejs (' + MATRIX.length + ' tinh huong)', lech, []);
