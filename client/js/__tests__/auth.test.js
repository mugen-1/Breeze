/* auth.js — (1) đăng ký gửi email xác minh rồi mới lưu tên hiển thị; gửi lỗi không được
   chặn phần còn lại. (2) link đăng xuất dựng bằng DOM API: displayName là chữ thuần,
   không bao giờ thành HTML (trước đây ghép thẳng vào innerHTML -> XSS). */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El } = require('./helpers/dom');

const EVIL = '<img src=x onerror=alert(1)>';

/* opts.create : kết quả createUserWithEmailAndPassword ('ok' | mã lỗi Firebase)
   opts.verify : 'ok' | 'fail' cho sendEmailVerification */
function setup(opts) {
  opts = opts || {};
  const steps = [];
  const timers = [];
  let authCb = null;
  const user = {
    sendEmailVerification: function () {
      steps.push('sendEmailVerification');
      return opts.verify === 'fail'
        ? Promise.reject({ code: 'auth/too-many-requests' }) : Promise.resolve();
    },
    updateProfile: function (p) { steps.push('updateProfile:' + p.displayName); return Promise.resolve(); },
  };
  const r = load('auth.js', {
    deps: ['routes.js', 'utils-i18n.js'],
    window: { location: { href: '', search: '' } },
    globals: {
      setTimeout: function (fn, ms) { timers.push(ms); },
      localStorage: { getItem: function () { return null; }, setItem: function () {},
                      removeItem: function () { steps.push('removeItem'); } },
      auth: {
        onAuthStateChanged: function (fn) { authCb = fn; },
        createUserWithEmailAndPassword: function (email, pw) {
          steps.push('create:' + email);
          return opts.create && opts.create !== 'ok'
            ? Promise.reject({ code: opts.create, message: 'raw' }) : Promise.resolve({ user: user });
        },
        signOut: function () { steps.push('signOut'); return Promise.resolve(); },
      },
    },
  });
  const byId = (id) => r.doc.getElementById(id);
  byId('reg-name').value = 'Truc';
  byId('reg-email').value = 'a@b.vn';
  byId('reg-password').value = '123456';
  byId('reg-confirm').value = '123456';
  r.steps = steps; r.timers = timers; r.byId = byId;
  r.fireAuth = function (u) { authCb(u); };
  return r;
}

console.log('auth.js');

(async function () {
  // Đăng ký thành công: xác minh TRƯỚC, rồi mới updateProfile
  let r = setup({});
  r.sandbox.dangKy();
  await wait();
  eq('dang ky: tao -> gui xac minh -> luu ten, dung thu tu', r.steps,
     ['create:a@b.vn', 'sendEmailVerification', 'updateProfile:Truc']);
  eq('dang ky: bao kiem tra email', r.byId('signup-msg').textContent, 'au.signupVerify');
  eq('dang ky: cho 3,5s cho doc thong bao dai hon', r.timers, [3500]);

  // Gửi email lỗi: tài khoản đã tạo -> vẫn lưu tên, về câu thông báo cũ
  r = setup({ verify: 'fail' });
  r.sandbox.dangKy();
  await wait();
  eq('gui xac minh loi -> VAN updateProfile', r.steps,
     ['create:a@b.vn', 'sendEmailVerification', 'updateProfile:Truc']);
  eq('gui xac minh loi -> cau signupOk nhu cu', r.byId('signup-msg').textContent, 'au.signupOk');
  eq('gui xac minh loi -> 1,5s nhu cu', r.timers, [1500]);
  check('gui xac minh loi -> ghi console.error',
        r.log.some(function (x) { return x[0] === 'console.error'; }));

  // Tạo tài khoản lỗi: không gửi gì thêm, báo đúng lỗi
  r = setup({ create: 'auth/email-already-in-use' });
  r.sandbox.dangKy();
  await wait();
  eq('email trung -> dung ngay, khong gui xac minh', r.steps, ['create:a@b.vn']);
  eq('email trung -> bao au.eInUse', r.byId('signup-msg').textContent, 'au.eInUse');

  // Link đăng xuất: displayName độc hại chỉ là CHỮ
  r = setup({});
  const nav = r.byId('nav-login');
  r.fireAuth({ displayName: EVIL, email: 'a@b.vn' });
  eq('dang nhap -> dung dung 1 the a', nav.children.map(function (c) { return c.tagName; }), ['A']);
  const a = nav.children[0];
  eq('displayName vao textContent nguyen van', a.textContent, EVIL + ' | Dang xuat');
  eq('KHONG dung innerHTML', [nav.innerHTML, a.innerHTML], ['', '']);
  eq('KHONG con onclick/javascript: trong thuoc tinh', [a.getAttribute('onclick'), a.href], [null, '#']);
  let prevented = false;
  a.fire('click', { preventDefault: function () { prevented = true; } });
  await wait();
  check('bam -> chan dieu huong "#"', prevented);
  eq('bam -> dang xuat', r.steps, ['signOut', 'removeItem']);

  // Chưa đăng nhập: link tới trang login
  r.fireAuth(null);
  eq('dang xuat -> link login thay the link cu', nav.children.length, 1);
  eq('dang xuat -> href login', nav.children[0].href, 'login.html');

  // Form submit qua data-action (thay onsubmit="..." inline — CSP chặn)
  function submit(r, action) {
    const form = El('form');
    if (action !== null) form.setAttribute('data-action', action);
    let prevented = false;
    r.doc.fire('submit', { target: form, preventDefault: function () { prevented = true; } });
    return prevented;
  }
  r = setup({});
  check('submit login -> chan submit that', submit(r, 'login'));
  eq('submit login -> dangNhap chay (bao thieu email/mat khau)', r.byId('login-msg').textContent, 'au.errNeedEmailPw');
  r = setup({});
  check('submit signup -> chan submit that', submit(r, 'signup'));
  await wait();
  eq('submit signup -> dangKy chay', r.steps, ['create:a@b.vn', 'sendEmailVerification', 'updateProfile:Truc']);
  r = setup({});
  check('submit reset-password -> CHI chan submit (tinh nang chua lam)', submit(r, 'reset-password'));
  eq('reset-password -> khong goi Firebase', r.steps, []);
  check('form khong co data-action -> de nguyen (khong chan)', !submit(r, null));
  check('data-action la khoa ke thua (constructor) -> khong chan', !submit(r, 'constructor'));
})();
