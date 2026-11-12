/* auth.js — (1) đăng ký gửi email xác minh rồi mới lưu tên hiển thị; gửi lỗi không được
   chặn phần còn lại. (2) link đăng xuất dựng bằng DOM API: displayName là chữ thuần,
   không bao giờ thành HTML. (3) chỉ điều hướng login khi API xác nhận được role. */
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
    uid: 'user-a',
    email: 'a@b.vn',
    displayName: 'Truc',
    getIdToken: function () { steps.push('getIdToken'); return Promise.resolve('id-token'); },
    sendEmailVerification: function () {
      steps.push('sendEmailVerification');
      return opts.verify === 'fail'
        ? Promise.reject({ code: 'auth/too-many-requests' }) : Promise.resolve();
    },
    updateProfile: function (p) { steps.push('updateProfile:' + p.displayName); return Promise.resolve(); },
  };
  const r = load('auth.js', {
    deps: ['routes.js', 'utils-i18n.js'],
    window: { location: { href: '', search: opts.search || '' },
      BreezeSupportSession: opts.prepare ? { prepare(uid) { steps.push('prepare:' + uid); return opts.prepare(); } } : undefined },
    globals: {
      fetch: function (url, init) {
        steps.push('fetch:' + url);
        eq('login: gui token Firebase toi API', init.headers.Authorization, 'Bearer id-token');
        if (opts.networkError) return Promise.reject(new Error('network error'));
        return Promise.resolve({
          status: opts.status == null ? 200 : opts.status,
          headers: { get: name => name.toLowerCase() === 'retry-after' ? opts.retryAfter || null : null },
          ok: opts.status == null || opts.status === 200,
          json: function () {
            return opts.invalidJson ? Promise.reject(new Error('invalid json'))
              : Promise.resolve(Object.prototype.hasOwnProperty.call(opts, 'me') ? opts.me : { role: 'customer' });
          },
        });
      },
      setTimeout: function (fn, ms) { timers.push(ms); },
      localStorage: { getItem: function () { return null; }, setItem: function () {},
                      removeItem: function () { steps.push('removeItem'); } },
      auth: {
        onAuthStateChanged: function (fn) { authCb = fn; },
        signInWithEmailAndPassword: function (email, pw) {
          steps.push('signIn:' + email);
          return opts.loginError ? Promise.reject({ code: opts.loginError }) : Promise.resolve({ user: user });
        },
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
  r.login = function () {
    byId('login-email').value = 'a@b.vn';
    byId('login-password').value = '123456';
    r.sandbox.dangNhap();
  };
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

  // Điều hướng chỉ sau khi API xác nhận role, không lấy từ email hay localStorage.
  r = setup({ me: { role: 'admin' } });
  r.login();
  await wait();
  eq('admin -> giao dien quan tri', r.win.location.href, 'admin.html');
  eq('admin: dang nhap -> lay token -> kiem tra role', r.steps,
     ['signIn:a@b.vn', 'getIdToken', 'fetch:/api/me']);

  r = setup({ me: { role: 'customer' } });
  r.login();
  await wait();
  eq('customer -> trang chu', r.win.location.href, 'index.html');

  r = setup({ search: '?redirect=checkout', me: { role: 'customer' } });
  r.login();
  await wait();
  eq('customer trong luong thanh toan -> checkout', r.win.location.href, 'checkout.html');
  r = setup({ search: '?redirect=checkout', me: { role: 'admin' } });
  r.login();
  await wait();
  eq('admin trong luong thanh toan -> giu form', r.win.location.href, '');
  eq('admin khong duoc dat hang', r.byId('login-msg').textContent, 'au.errBadAccount');

  // Staff (nhân viên) = phía quản trị: vào admin.html như admin, không được đặt hàng.
  r = setup({ me: { role: 'staff' } });
  r.login();
  await wait();
  eq('staff -> giao dien quan tri', r.win.location.href, 'admin.html');
  eq('staff: role hop le, khong bao loi', r.byId('login-msg').textContent, '');
  r = setup({ search: '?redirect=checkout', me: { role: 'staff' } });
  r.login();
  await wait();
  eq('staff trong luong thanh toan -> giu form', r.win.location.href, '');
  eq('staff khong duoc dat hang', r.byId('login-msg').textContent, 'au.errBadAccount');

  for (const opts of [
    { status: 401 }, { status: 401, search: '?redirect=checkout' },
    { status: 500 }, { networkError: true }, { invalidJson: true },
    { me: null }, { me: {} }, { me: { role: 'unknown' } },
  ]) {
    r = setup(opts);
    r.login();
    await wait();
    eq('khong xac dinh duoc role -> khong chuyen sang user: ' + JSON.stringify(opts), r.win.location.href, '');
    eq('khong xac dinh duoc role -> bao loi', r.byId('login-msg').textContent, 'au.errRoleCheck');
  }
  r = setup({ loginError: 'auth/invalid-credential' });
  r.login();
  await wait();
  eq('sai mat khau -> giu loi Firebase', r.byId('login-msg').textContent, 'au.eBadCred');
  eq('sai mat khau -> khong goi API', r.steps, ['signIn:a@b.vn']);
  r = setup({ loginError: 'auth/invalid-login-credentials' });
  r.login();
  await wait();
  eq('ma Firebase moi invalid-login-credentials -> cau tieng Viet, khong hien ma tho',
    r.byId('login-msg').textContent, 'au.eBadCred');

  for (const retryAfter of ['286', undefined, 'invalid']) {
    r = setup({ status: 429, retryAfter }); r.login(); await wait();
    eq('rate limited login stays on the form', r.win.location.href, '');
    eq('429 is distinguished from role/network errors', r.byId('login-msg').textContent,
      retryAfter === '286' ? 'au.errRateLimitWait' : 'au.errRateLimit');
    eq('429 never signs out a valid Firebase session', r.steps.filter(s => s === 'signOut').length, 0);
    eq('429 never automatically retries authentication', r.steps.filter(s => s.startsWith('fetch:')).length, 1);
  }
  const localized = load('i18n.js').win.__i18n;
  for (const lang of ['vi', 'en']) {
    localized.current = lang;
    check('rate limit wait translates seconds in ' + lang, localized.t('au.errRateLimitWait', { seconds: 286 }).includes('286'));
  }

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
  let finish;
  r = setup({ prepare: () => new Promise(resolve => { finish = resolve; }) }); r.login(); await wait();
  eq('login waits for guest session transfer before navigating', r.win.location.href, '');
  check('login transfer uses the UID of the authenticated credential', r.steps.includes('prepare:user-a'));
  finish(); await wait(); eq('login redirects after session transfer succeeds', r.win.location.href, 'index.html');
  r = setup({ prepare: () => Promise.reject({ code: 'SUPPORT_SESSION_UNAVAILABLE' }) }); r.login(); await wait();
  eq('session synchronization error keeps login available for retry', r.win.location.href, '');
  eq('session synchronization error has a safe translated message', r.byId('login-msg').textContent, 'au.errSupportSession');
  r = setup({ prepare: () => new Promise(resolve => { finish = resolve; }) }); r.sandbox.dangKy(); await wait();
  eq('signup does not schedule redirect before transfer completes', r.timers.length, 0);
  finish(); await wait(); eq('signup keeps existing verification redirect delay after transfer', r.timers, [3500]);
})();
