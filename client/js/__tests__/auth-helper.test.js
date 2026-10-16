/* auth-helper.js — phiên có sẵn mà email CHƯA xác minh: reload() hỏi lại Firebase, nếu nay
   đã xác minh thì getIdToken(true) lấy token mới, và apiFetch CHỜ bước đó rồi mới gửi.
   Không làm gì thừa với tài khoản đã xác minh; lỗi mạng không được chặn lệnh gọi API. */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');

/* opts.verified   : emailVerified lúc phiên được khôi phục
   opts.afterReload: emailVerified sau reload() (mặc định giữ nguyên)
   opts.reload     : 'ok' | 'fail';  opts.delay: ms reload() mất */
function setup(opts) {
  opts = opts || {};
  const steps = [];
  const sent = [];
  let token = 'T1';
  const user = opts.guest ? null : {
    emailVerified: !!opts.verified,
    reload: function () {
      steps.push('reload');
      return new Promise(function (res, rej) {
        setTimeout(function () {
          if (opts.reload === 'fail') return rej({ code: 'auth/network-request-failed' });
          if (opts.afterReload !== undefined) user.emailVerified = opts.afterReload;
          res();
        }, opts.delay || 0);
      });
    },
    getIdToken: function (force) {
      steps.push(force ? 'getIdToken(true)' : 'getIdToken');
      if (force) token = 'T2';
      return Promise.resolve(token);
    },
  };
  let authCb = null;
  const fb = { auth: function () {
    return { currentUser: user, onAuthStateChanged: function (fn) { authCb = fn; } };
  } };
  const r = load('auth-helper.js', {
    window: { firebase: fb, API_BASE: '' },
    globals: {
      firebase: fb,
      fetch: function (url, o) {
        steps.push('fetch');
        sent.push({ url: url, auth: (o.headers || {}).Authorization || null });
        return Promise.resolve({ ok: true });
      },
    },
  });
  const AH = r.win.AuthHelper;
  // Trang thật: callback onChange gọi apiFetch NGAY (vd cart.js nạp giỏ).
  AH.onChange(function (u) { if (u) AH.apiFetch('/api/cart'); });
  r.steps = steps; r.sent = sent; r.AH = AH;
  r.login = function () { authCb(user); };
  return r;
}

console.log('auth-helper.js');

(async function () {
  // Vừa xác minh ở tab khác: token cũ ghi false -> phải lấy token mới TRƯỚC khi gọi API
  let r = setup({ verified: false, afterReload: true, delay: 30 });
  r.login();
  await wait(5);
  eq('reload chua xong -> CHUA gui API', r.sent, []);
  await wait(60);
  eq('thu tu: reload -> lam moi token -> gui API', r.steps,
     ['reload', 'getIdToken(true)', 'getIdToken', 'fetch']);
  eq('API mang token MOI', r.sent, [{ url: '/api/cart', auth: 'Bearer T2' }]);

  // Vẫn chưa xác minh: không ép làm mới token
  r = setup({ verified: false });
  r.login();
  await wait(30);
  eq('van chua xac minh -> reload nhung KHONG ep lam moi', r.steps, ['reload', 'getIdToken', 'fetch']);
  eq('van chua xac minh -> gui bang token hien co', r.sent[0].auth, 'Bearer T1');

  // Đã xác minh từ trước: không tốn thêm request nào
  r = setup({ verified: true });
  r.login();
  await wait(30);
  eq('da xac minh -> khong reload', r.steps, ['getIdToken', 'fetch']);

  // reload lỗi (mất mạng): vẫn gọi API bằng token hiện có
  r = setup({ verified: false, reload: 'fail' });
  r.login();
  await wait(30);
  eq('reload loi -> van gui API', r.sent, [{ url: '/api/cart', auth: 'Bearer T1' }]);
  check('reload loi -> co canh bao', r.log.some(function (x) { return x[0] === 'console.warn'; }));

  // Lệnh gọi SAU khi kiểm tra xong: không chờ, không reload lại
  r.steps.length = 0;
  await r.AH.apiFetch('/api/me');
  eq('goi sau -> khong reload lai', r.steps, ['getIdToken', 'fetch']);

  // Khách
  r = setup({ guest: true });
  r.login();
  await wait(10);
  eq('khach -> khong reload, khong goi API', r.steps, []);
  eq('khach -> getToken tra null', await r.AH.getToken(), null);
})();
