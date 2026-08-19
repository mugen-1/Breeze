/* Nạp một file client/js/page-*.js vào sandbox có DOM giả.
   Các file page-*.js là script cổ điển chạy trong trình duyệt (không phải module),
   nên ở đây dùng vm.runInContext để chúng thấy đúng các global quen thuộc
   (document, window, fetch, localStorage...) mà không đụng tới global của Node. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeDoc } = require('./dom');

const JS_DIR = path.join(__dirname, '..', '..');

// Các global trình duyệt luôn có sẵn, test hiếm khi cần đổi.
function baseGlobals(log) {
  return {
    URLSearchParams, Number, String, Boolean, Promise, Date, Math, JSON, Object, Array,
    RegExp, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: function (fn) { return fn(); },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    Event: class { constructor(t) { this.type = t; } },
    FormData: class { constructor() { this._d = []; } append(k, v) { this._d.push([k, v]); } },
    URL: {
      createObjectURL: function () { return 'blob:tmp'; },
      revokeObjectURL: function () { log.push(['revokeObjectURL']); },
    },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    console: {
      error: function () { log.push(['console.error', String(arguments[0])]); },
      warn: function () { log.push(['console.warn', String(arguments[0])]); },
      log: function () {},
    },
  };
}

/* load(tenFile, opts) -> { sandbox, doc, log, win }
     opts.window  : các thuộc tính gắn thêm vào window
     opts.globals : global trần cần thêm (vd fetch, alert)
     opts.doc     : dùng document dựng sẵn thay vì tạo mới
     opts.deps    : các file js/ nạp TRƯỚC file chính, đúng thứ tự trang thật
                    (vd ['utils-format.js'] để có global money) — dùng file THẬT
                    chứ không stub, để test bắt được cả lỗi ở module dùng chung */
function load(fileName, opts) {
  opts = opts || {};
  const log = [];
  const doc = opts.doc || makeDoc();
  const sandbox = Object.assign(baseGlobals(log), opts.globals || {});
  sandbox.document = doc;
  sandbox.window = Object.assign({
    addEventListener: function (ev, fn) { (sandbox.window._l = sandbox.window._l || {})[ev] = fn; },
  }, opts.window || {});
  // Trình duyệt có 'location' trần lẫn 'window.location' — trỏ về cùng một đối tượng.
  if (sandbox.window.location) sandbox.location = sandbox.window.location;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  (opts.deps || []).forEach(function (dep) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, dep), 'utf8'), sandbox, { filename: dep });
  });
  const code = fs.readFileSync(path.join(JS_DIR, fileName), 'utf8');
  vm.runInContext(code, sandbox, { filename: fileName });
  return { sandbox, doc, log, win: sandbox.window };
}

const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); };

module.exports = { load, wait, JS_DIR };
