/* page-login.js — thông báo "cần đăng nhập" khi bị account-menu đá về từ nút Đăng xuất. */
const { check, eq } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');

function setup(search) {
  const calls = [];
  const r = load('page-login.js', {
    window: { location: { search: search }, __i18n: { t: function (k) { return 'DICH(' + k + ')'; } } },
    globals: { showMessage: function (id, msg, isErr) { calls.push([id, msg, isErr]); } },
  });
  r.calls = calls;
  return r;
}

console.log('page-login.js');

// Có ?notice=need-login -> hiện thông báo lúc DOMContentLoaded
let r = setup('?notice=need-login');
r.doc.fire('DOMContentLoaded');
eq('notice=need-login -> goi showMessage dung tham so', r.calls,
   [['login-msg', 'DICH(au.notLoggedIn)', true]]);

// Đổi ngôn ngữ -> vẽ lại
r.doc.fire('langchange');
eq('langchange -> ve lai thong bao', r.calls.length, 2);

// Không có notice -> không đăng ký listener, không hiện gì
const r2 = setup('');
eq('khong co notice -> khong goi showMessage', r2.calls, []);
check('khong co notice -> khong dang ky listener nao',
      Object.keys(r2.doc._l).length === 0);

// showMsg đã bị xoá ở commit fca9d63 (code chết) — không được quay lại
check('showMsg (code chet) khong con ton tai', typeof r.sandbox.showMsg === 'undefined');
