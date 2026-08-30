/* page-profile.js — trang Cài đặt tài khoản: hồ sơ, địa chỉ, thanh toán,
   theme, avatar, quyền riêng tư, xoá tài khoản. File lớn nhất của client. */
const { check, eq, note } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');

const USER = { uid: 'u1', email: 'a@b.com', displayName: 'Truc' };

function setup(opts) {
  opts = opts || {};
  const doc = makeDoc();
  const api = opts.api || {};
  const acts = [];
  let onChangeCb = null;

  // Khớp markup thật: 3 phần tử này có thuộc tính hidden sẵn trong HTML.
  ['addr-modal-overlay', 'del-modal-overlay'].forEach(function (id) { doc.getElementById(id).hidden = true; });
  if (opts.qsa) Object.assign(doc._qsa, opts.qsa);

  const r = load('page-profile.js', {
    deps: ['routes.js', 'utils-i18n.js'],
    doc: doc,
    globals: { alert: function () { acts.push(['alert']); } },
    window: {
      location: { hash: opts.hash || '', href: '' },
      __i18n: { current: 'vi', t: function (k) { return 'T:' + k; } },
      confirm: function () { return true; },
      AuthHelper: {
        onChange: function (cb) { onChangeCb = cb; },
        isLoggedIn: function () { return !!opts.loggedIn; },
        apiFetch: function (p, o) {
          const m = (o && o.method) || 'GET';
          acts.push(['api', m, p, o && o.body]);
          const res = api[m + ' ' + p] || api[p] || { ok: true, status: 200, body: {} };
          return Promise.resolve({ ok: res.ok !== false, status: res.status || 200,
            json: function () { return Promise.resolve(res.body === undefined ? {} : res.body); } });
        },
      },
      PaymentMethods: { load: function () { acts.push(['pm.load']); },
                        rerender: function () { acts.push(['pm.rerender']); } },
      BreezeTheme: { get: function () { return 'dark'; }, set: function (m) { acts.push(['theme.set', m]); } },
      firebase: { auth: function () { return { currentUser: null }; } },
    },
  });
  r.acts = acts;
  r.api = function () { return acts.filter(function (x) { return x[0] === 'api'; }); };
  r.login = function (u) { opts.loggedIn = !!(u === undefined ? USER : u); return onChangeCb && onChangeCb(u === undefined ? USER : u); };
  return r;
}

(async function () {
  console.log('page-profile.js');

  // Không rò global (toàn bộ trong 1 IIFE)
  let r = setup();
  ['toast', 'byId', 'saveProfile', 'loadMe', 'render', 'fmtDate', 'openModal', 'validate']
    .forEach(function (k) { eq('IIFE khong ro global: ' + k, typeof r.sandbox[k], 'undefined'); });

  // Auth gate
  r = setup({ api: { '/api/me': { body: { display_name: 'Truc', email: 'a@b.com',
    created_at: '2026-01-02T00:00:00Z', last_login: '2026-08-01T00:00:00Z', avatar_url: null } } } });
  r.login(); await wait();
  eq('dang nhap -> nap ho so tu server', r.api().map(function (x) { return x[1] + ' ' + x[2]; }), ['GET /api/me']);

  let guest = setup();
  guest.login(null); await wait();
  eq('chua dang nhap -> KHONG goi API nao', guest.api().length, 0);

  // Lazy load theo tab
  let ca = setup({ hash: '#addresses', api: { '/api/account/addresses': { body: { addresses: [] } } } });
  ca.login(); await wait();
  check('#addresses -> nap so dia chi',
        ca.api().some(function (x) { return x[2] === '/api/account/addresses'; }));
  const soLan = ca.api().length;
  ca.win._l.hashchange && ca.win._l.hashchange();
  await wait();
  eq('mo lai tab lan 2 -> KHONG goi API lai (co _addrLoaded)', ca.api().length, soLan);

  let cp = setup({ hash: '#payments' });
  cp.login(); await wait();
  check('#payments -> uy quyen sang PaymentMethods.load',
        cp.acts.some(function (x) { return x[0] === 'pm.load'; }));

  let cv = setup({ hash: '#privacy', api: { '/api/account/privacy-settings': { body: {} } } });
  cv.login(); await wait();
  check('#privacy -> nap tuy chon rieng tu',
        cv.api().some(function (x) { return x[2] === '/api/account/privacy-settings'; }));

  // Lưu hồ sơ: chặn số điện thoại sai
  const set = function (id, v) { r.doc.getElementById(id).value = v; };
  set('ad-name', 'Nguyen Van A'); set('ad-phone', 'abc!!!'); set('ad-dob', ''); set('ad-gender', '');
  let truoc = r.api().filter(function (x) { return x[1] === 'PUT'; }).length;
  r.doc.getElementById('ad-save').fire('click'); await wait();
  eq('sdt sai dinh dang -> KHONG gui PUT', r.api().filter(function (x) { return x[1] === 'PUT'; }).length, truoc);

  set('ad-phone', '0912 345 678');
  r.doc.getElementById('ad-save').fire('click'); await wait();
  const put = r.api().filter(function (x) { return x[1] === 'PUT'; });
  eq('sdt hop le -> gui PUT /api/me', put.length, truoc + 1);
  check('body PUT chua so dien thoai da nhap', String(put[put.length - 1][3]).includes('0912 345 678'));

  // Đăng xuất phải reset cờ để lần sau nạp lại
  const n1 = r.api().filter(function (x) { return x[2] === '/api/me' && x[1] === 'GET'; }).length;
  r.login(null); await wait(); r.login(); await wait();
  eq('dang xuat roi vao lai -> nap lai /api/me',
     r.api().filter(function (x) { return x[2] === '/api/me' && x[1] === 'GET'; }).length, n1 + 1);

  // Đổi ngôn ngữ + phiên hết hạn
  r.doc.fire('langchange');
  check('langchange -> ve lai ca danh sach the thanh toan',
        r.acts.some(function (x) { return x[0] === 'pm.rerender'; }));
  r.doc.fire('authexpired'); await wait(1800);
  // redirect gio la KHOA trang ('profile'), khong con duoi .html — auth.js dung
  // BreezeRoutes.keyOf() nen nhan ca hai dang.
  eq('authexpired -> dua ve trang dang nhap kem redirect', r.sandbox.window.location.href,
     'login.html?redirect=profile&notice=session-expired');

  // Xoá tài khoản: server chặn vì còn đơn pending
  let cd = setup({ api: { 'DELETE /api/account': { ok: false, status: 409, body: { error: 'pending' } } } });
  cd.login(); await wait();
  cd.doc.getElementById('del-password').value = 'matkhau';
  cd.doc.getElementById('del-form').fire('submit'); await wait();
  eq('xoa tai khoan -> goi DELETE /api/account',
     cd.api().filter(function (x) { return x[1] === 'DELETE'; }).length, 1);
  eq('server tra 409 -> xu ly gon, khong tung loi ra console',
     cd.log.filter(function (x) { return x[0] === 'console.error'; }).length, 0);

  // Avatar: chặn sai định dạng và quá nặng
  let cav = setup({ api: { '/api/me': { body: {} },
                           'POST /api/me/avatar': { body: { avatar_url: '/u/a.png' } } } });
  cav.login(); await wait();
  const input = cav.doc.getElementById('avatar-input');
  const daUpload = function () { return cav.api().some(function (x) { return x[2] === '/api/me/avatar'; }); };

  input.files = [{ name: 'x.gif', type: 'image/gif', size: 1000 }];
  input.fire('change'); await wait();
  check('avatar .gif -> tu choi, khong upload', !daUpload());

  input.files = [{ name: 'x.png', type: 'image/png', size: 3 * 1024 * 1024 }];
  input.fire('change'); await wait();
  check('avatar 3MB (qua 2MB) -> tu choi, khong upload', !daUpload());

  input.files = [{ name: 'x.png', type: 'image/png', size: 500 * 1024 }];
  input.fire('change'); await wait();
  check('avatar png 500KB -> co upload', daUpload());
  check('upload xong -> revoke objectURL (khong ro bo nho)',
        cav.log.some(function (x) { return x[0] === 'revokeObjectURL'; }));

  // Privacy: toggle tự lưu (uỷ quyền change trên #privacy-rows)
  const tg = ['public_profile', 'marketing_emails', 'personalization'].map(function (k) {
    const e = El('input'); e._attrs['data-privacy'] = k; return e;
  });
  let cpv = setup({ hash: '#privacy', qsa: { 'input[data-privacy]': tg }, api: {
    '/api/account/privacy-settings': { body: { public_profile: true, marketing_emails: false, personalization: true } },
    'PATCH /api/account/privacy-settings': { body: { ok: true } } } });
  cpv.login(); await wait();
  const n2 = cpv.api().length;
  tg[0].checked = false;
  cpv.doc.getElementById('privacy-rows').fire('change', { target: tg[0] });
  await wait();
  check('bat/tat toggle rieng tu -> tu luu bang PATCH',
        cpv.api().slice(n2).some(function (x) { return x[1] === 'PATCH'; }));

  // Sổ địa chỉ: render + các nút uỷ quyền
  const ADDRS = [{ id: 1, recipient_name: 'A', phone: '0900000000', line1: 'So 1',
                   city: 'HCM', postal_code: '70000', country_code: 'VN', is_default: true }];
  let cad = setup({ hash: '#addresses', api: {
    '/api/account/addresses': { body: { addresses: ADDRS } },
    'DELETE /api/account/addresses/1': { body: { ok: true } },
    'PATCH /api/account/addresses/1/default': { body: { ok: true } } } });
  cad.login(); await wait();
  const listEl = cad.doc.getElementById('addr-list');
  check('render danh sach dia chi ra card', listEl.children.length > 0);

  const mkBtn = function (action) {
    const b = El('button');
    b._attrs['data-action'] = action; b._attrs['data-id'] = '1';
    b._closest = { 'button[data-action]': b };
    return b;
  };
  listEl.fire('click', { target: mkBtn('delete') }); await wait();
  check('bam Xoa tren card -> goi DELETE dung dia chi',
        cad.api().some(function (x) { return x[1] === 'DELETE' && /addresses\/1$/.test(x[2]); }));
  listEl.fire('click', { target: mkBtn('default') }); await wait();
  check('bam Dat mac dinh -> goi PATCH .../default',
        cad.api().some(function (x) { return x[1] === 'PATCH' && /default$/.test(x[2]); }));

  // ===== Bug (1): dong roi mo lai truoc khi hieu ung fade xong =====
  // closeModal hen gio go modal khoi layout (hidden = true) SAU hieu ung. Neu khong giu
  // timer id de huy, mo lai trong luc no con treo thi no van no vo dieu kien: hidden bi
  // da ve true trong khi .is-open van bat -> hop thoai bien mat, ma nen VAN khoa cuon
  // nen ESC cung khong an (listener gan tren overlay dang display:none).
  // Cua so dinh loi la 220ms (dia chi) / 200ms (xoa tai khoan) — dung tam mot nhip nhap dup.
  // Cung mau voi muc 10a trong change-password.test.js.

  // -- Modal dia chi (hoan 220ms) --
  let mm = setup({ hash: '#addresses' });
  mm.login(); await wait();
  const addrOv = mm.doc.getElementById('addr-modal-overlay');
  mm.doc.getElementById('addr-add').fire('click');
  eq('dia chi: mo modal -> hidden=false', addrOv.hidden, false);
  mm.doc.getElementById('addr-cancel').fire('click');
  await wait(80);                       // nhanh hon 220ms
  mm.doc.getElementById('addr-add').fire('click');
  eq('dia chi: mo lai ngay -> hidden=false', addrOv.hidden, false);
  await wait(320);                      // qua moc hen gio CU cua lan dong truoc
  eq('dia chi: hen gio cu KHONG dong modal vua mo', addrOv.hidden, false);
  check('dia chi: van con .is-open', addrOv.classList.contains('is-open'));
  eq('dia chi: nen van khoa cuon dung trang thai dang mo',
     mm.doc.body.style.overflow, 'hidden');

  // -- Modal xoa tai khoan (hoan 200ms) --
  mm = setup({ hash: '#privacy' });
  mm.login(); await wait();
  const delOv = mm.doc.getElementById('del-modal-overlay');
  mm.doc.getElementById('btn-delete-account').fire('click');
  eq('xoa tk: mo modal -> hidden=false', delOv.hidden, false);
  mm.doc.getElementById('del-cancel').fire('click');
  await wait(80);                       // nhanh hon 200ms
  mm.doc.getElementById('btn-delete-account').fire('click');
  eq('xoa tk: mo lai ngay -> hidden=false', delOv.hidden, false);
  await wait(300);
  eq('xoa tk: hen gio cu KHONG dong modal vua mo', delOv.hidden, false);
  check('xoa tk: van con .is-open', delOv.classList.contains('is-open'));
  note('Modal xoa tai khoan KHONG dat body.style.overflow (khac 3 modal kia) nen o day');
  note('khong kiem overflow — DOM gia tra undefined la dung, khong phai loi.');
  note('Hai modal dung HAI bien timer rieng: chung mot bien thi dong cai nay huy nham cai kia.');

  note('theme.js nap bang defer o profile.html nen window.BreezeTheme chua co luc parse;');
  note('code da phong bang (window.BreezeTheme && ...) -> TASK 5 doi thu tu phai kiem lai cho nay.');
})();
