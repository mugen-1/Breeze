/* change-password.js — modal đổi mật khẩu trong profile.html (Phase 2B).

   LƯU Ý VỀ PHẠM VI: file này CỐ Ý không có nhóm "guard đăng nhập" và nhóm "redirect về
   profile". Bản Phase 2 từng là một TRANG RIÊNG nên phải tự guard onAuthStateChanged và
   tự điều hướng; Phase 2B biến nó thành modal trong profile.html, nơi page-profile.js đã
   guard cả trang và đổi xong thì chỉ đóng modal chứ không rời trang. Hai nhóm test đó
   giờ kiểm một hành vi không còn tồn tại — đã thay bằng nhóm [1] mở modal, [2] đóng
   modal, và các khẳng định "xoá sạch 3 ô" ở cả ba đường đóng.

   Điểm sống còn của file này: mật khẩu KHÔNG được nằm lại trong DOM sau khi modal đóng,
   dù đóng bằng Huỷ, ESC, click nền, nút X, hay sau khi đổi thành công. */
const { check, eq, note } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');
const { makeDoc, El } = require('./helpers/dom');

const PW_OLD = 'oldpass123';
const PW_NEW = 'brandnew456';
const FIELDS = ['cp-current', 'cp-new', 'cp-confirm'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/* Dựng lại đúng những phần DOM mà change-password.js đọc tới. Mini-DOM không có
   querySelectorAll thật nên phải nạp sẵn danh sách nút toggle qua doc._qsa. */
function setup(o) {
  o = o || {};
  const doc = makeDoc();
  FIELDS.forEach((i) => { doc.getElementById(i).type = 'password'; });
  const overlay = doc.getElementById('cp-modal-overlay');
  overlay.hidden = true;
  const form = doc.getElementById('cp-form');
  const openBtn = doc.getElementById('cp-open');
  const cancel = doc.getElementById('cp-cancel');
  doc.activeElement = openBtn;

  const btns = FIELDS.map((id) => {
    const b = El('button');
    b.setAttribute('data-toggle-pw', id);
    return b;
  });
  doc._qsa['[data-toggle-pw]'] = btns;

  const user = {
    email: 'a@b.c',
    providerData: o.providerData || [{ providerId: 'password' }],
    reauthenticateWithCredential: () => (o.reauth ? o.reauth() : Promise.resolve()),
    updatePassword: () => (o.update ? o.update() : Promise.resolve()),
  };

  const toasts = [];
  const r = load('change-password.js', {
    deps: ['utils-i18n.js'],
    doc,
    window: {
      location: { pathname: '/profile.html' },
      ProfileToast: (m) => toasts.push(m),
      AuthHelper: { getUser: () => ('user' in o ? o.user : user) },
    },
    globals: { firebase: { auth: { EmailAuthProvider: { credential: (e, p) => ({ e: e, p: p }) } } } },
  });

  return {
    doc, btns, form, overlay, openBtn, cancel, toasts, log: r.log,
    set(c, n, f) {
      doc.getElementById('cp-current').value = c;
      doc.getElementById('cp-new').value = n;
      doc.getElementById('cp-confirm').value = f;
    },
    vals: () => FIELDS.map((i) => doc.getElementById(i).value).join('|'),
    msg: () => doc.getElementById('cp-msg'),
    submitBtn: () => doc.getElementById('cp-submit'),
  };
}

(async function () {
  console.log('change-password.js — modal doi mat khau');

  // ===== 1. Mo modal — bam pattern openModal cua modal dia chi =====
  let s = setup();
  s.set('rac1', 'rac2', 'rac3');           // rac con sot tu lan truoc
  s.msg().textContent = 'thong bao cu';
  s.openBtn.fire('click');
  eq('mo: overlay.hidden = false', s.overlay.hidden, false);
  check('mo: them class is-open', s.overlay.classList.contains('is-open'));
  eq('mo: khoa cuon nen', s.doc.body.style.overflow, 'hidden');
  eq('mo: 3 o duoc xoa sach', s.vals(), '||');
  eq('mo: thong bao cu bi xoa', s.msg().textContent, '');
  await wait(60);
  check('mo: focus vao o "mat khau hien tai"', s.doc.getElementById('cp-current')._focused);

  // ===== 2. Dong modal — 4 duong, deu phai xoa sach 3 o =====
  const DONG = [
    ['nut Huy', (x) => x.cancel.fire('click')],
    ['nut X', (x) => x.doc.getElementById('cp-modal-close').fire('click')],
    ['phim ESC', (x) => x.overlay.fire('keydown', { key: 'Escape' })],
    ['click nen', (x) => x.overlay.fire('mousedown', { target: x.overlay })],
  ];
  for (const [ten, act] of DONG) {
    const x = setup();
    x.openBtn.fire('click');
    x.set(PW_OLD, PW_NEW, PW_NEW);
    act(x);
    eq('dong bang ' + ten + ': 3 o xoa NGAY', x.vals(), '||');
    check('dong bang ' + ten + ': bo class is-open', !x.overlay.classList.contains('is-open'));
    check('dong bang ' + ten + ': tra focus ve nut mo', x.openBtn._focused);
    await wait(300);
    eq('dong bang ' + ten + ': sau hieu ung -> hidden', x.overlay.hidden, true);
    eq('dong bang ' + ten + ': thong bao da xoa', x.msg().textContent, '');
  }
  note('Xoa o NGAY, khong doi het hieu ung: day la yeu cau bao mat, khong phai my thuat.');

  // ===== 3. Nut hien/an mat khau =====
  s = setup();
  s.openBtn.fire('click');
  eq('toggle: aria-pressed ban dau', s.btns[0].getAttribute('aria-pressed'), 'false');
  s.btns[0].click();
  eq('toggle: bam -> type=text', s.doc.getElementById('cp-current').type, 'text');
  eq('toggle: bam -> aria-pressed=true', s.btns[0].getAttribute('aria-pressed'), 'true');
  eq('toggle: bam -> aria-label doi', s.btns[0].getAttribute('aria-label'), 'au.cpHide');
  eq('toggle: nut kia khong bi anh huong', s.btns[1].getAttribute('aria-pressed'), 'false');
  s.cancel.fire('click');
  eq('toggle: dong modal -> o ve type=password', s.doc.getElementById('cp-current').type, 'password');
  eq('toggle: dong modal -> aria-pressed reset', s.btns[0].getAttribute('aria-pressed'), 'false');

  // ===== 4. Validate — chan truoc khi goi Firebase =====
  const CASES = [
    [['', '', ''], 'au.errFillAll', 'ca 3 o rong'],
    [[PW_OLD, 'abc1234', 'abc1234'], 'au.cpErrShort', 'mat khau moi 7 ky tu'],
    [[PW_OLD, 'newpass1', 'newpass2'], 'au.errConfirm', 'xac nhan khong khop'],
    [[PW_OLD, PW_OLD, PW_OLD], 'au.cpErrSame', 'trung mat khau cu'],
  ];
  for (const [vals, want, mota] of CASES) {
    const x = setup();
    x.openBtn.fire('click');
    x.set(vals[0], vals[1], vals[2]);
    x.form.fire('submit');
    await wait();
    eq('validate ' + mota, x.msg().textContent, want);
    eq('validate ' + mota + ': modal VAN mo', x.overlay.hidden, false);
  }
  s = setup();
  s.openBtn.fire('click');
  s.set(PW_OLD, 'abcd1234', 'abcd1234');
  s.form.fire('submit');
  await wait();
  eq('validate: dung 8 ky tu -> QUA duoc nguong', s.msg().textContent, 'au.cpOk');

  s = setup();
  s.openBtn.fire('click');
  s.set(PW_OLD, '  pass with spaces  ', '  pass with spaces  ');
  s.form.fire('submit');
  await wait();
  eq('validate: KHONG trim, KHONG loc ky tu la', s.msg().textContent, 'au.cpOk');
  note('Khoang trang dau/cuoi la mot phan hop le cua mat khau — khong duoc trim.');

  // ===== 5. Thanh cong — bao trong modal roi tu dong, O LAI trang =====
  s = setup();
  s.openBtn.fire('click');
  s.set(PW_OLD, PW_NEW, PW_NEW);
  s.form.fire('submit');
  await wait(); await wait();
  eq('thanh cong: hien au.cpOk TRONG modal', s.msg().textContent, 'au.cpOk');
  check('thanh cong: thong bao mang class is-ok', s.msg().classList.contains('is-ok'));
  eq('thanh cong: 3 o da xoa', s.vals(), '||');
  eq('thanh cong: modal chua dong ngay', s.overlay.hidden, false);
  eq('thanh cong: chua toast khi modal con mo', s.toasts.length, 0);
  await wait(1900);
  eq('thanh cong: ~1.5s sau -> modal dong', s.overlay.hidden, true);
  eq('thanh cong: toast ngoai trang hien 1 lan', s.toasts, ['au.cpOk']);

  // ===== 6. Loi Firebase — O LAI trong modal =====
  const CODES = [
    ['auth/wrong-password', 'au.cpErrCurrent'],
    ['auth/invalid-credential', 'au.cpErrCurrent'],
    ['auth/too-many-requests', 'au.eTooMany'],
    ['auth/requires-recent-login', 'au.cpErrStale'],
    ['auth/network-request-failed', 'au.cpErrNetwork'],
    ['auth/khong-co-thuc', 'au.cpErrGeneric'],
  ];
  for (const [code, want] of CODES) {
    const x = setup({ reauth: () => Promise.reject({ code: code, message: 'RAW FIREBASE TEXT' }) });
    x.openBtn.fire('click');
    x.set(PW_OLD, PW_NEW, PW_NEW);
    x.form.fire('submit');
    await wait(); await wait();
    eq('loi ' + code, x.msg().textContent, want);
    eq('loi ' + code + ': modal KHONG dong', x.overlay.hidden, false);
    check('loi ' + code + ': khong in raw error ra UI', !/RAW FIREBASE/.test(x.msg().textContent));
    eq('loi ' + code + ': nut gui mo lai', x.submitBtn().disabled, false);
    eq('loi ' + code + ': khong toast', x.toasts.length, 0);
  }
  {
    const x = setup({ update: () => Promise.reject({ code: 'auth/weak-password' }) });
    x.openBtn.fire('click');
    x.set(PW_OLD, PW_NEW, PW_NEW);
    x.form.fire('submit');
    await wait(); await wait();
    eq('loi auth/weak-password (o buoc updatePassword)', x.msg().textContent, 'au.cpErrWeak');
  }

  // ===== 7. Khong bao gio log mat khau =====
  {
    const x = setup({ reauth: () => Promise.reject({ code: 'auth/la-hoac', message: PW_OLD }) });
    x.openBtn.fire('click');
    x.set(PW_OLD, PW_NEW, PW_NEW);
    x.form.fire('submit');
    await wait(); await wait();
    const dump = JSON.stringify(x.log);
    check('console KHONG chua mat khau cu', dump.indexOf(PW_OLD) === -1);
    check('console KHONG chua mat khau moi', dump.indexOf(PW_NEW) === -1);
    check('console CO ghi ma loi de con go', /la-hoac/.test(dump));
    note('err.message co the chua bat ky thu gi -> chi noi MA loi vao chuoi, khong log ca object.');
  }

  // ===== 8. Tai khoan khong co provider 'password' =====
  s = setup({ providerData: [{ providerId: 'google.com' }] });
  s.openBtn.fire('click');
  eq('social-only: bao au.cpNoPassword ngay khi mo', s.msg().textContent, 'au.cpNoPassword');
  eq('social-only: khoa nut gui', s.submitBtn().disabled, true);
  s = setup({ providerData: [{ providerId: 'google.com' }, { providerId: 'password' }] });
  s.openBtn.fire('click');
  eq('co ca provider password -> nut gui binh thuong', s.submitBtn().disabled, false);

  // ===== 9. Chan double-submit =====
  {
    let n = 0;
    const x = setup({ reauth: () => { n++; return new Promise(function () {}); } });
    x.openBtn.fire('click');
    x.set(PW_OLD, PW_NEW, PW_NEW);
    x.form.fire('submit');
    x.form.fire('submit');
    x.form.fire('submit');
    await wait();
    eq('bam gui 3 lan -> chi 1 lan goi Firebase', n, 1);
    eq('dang goi: nut bi khoa', x.submitBtn().disabled, true);
  }

  // ===== 10. Ba loi tim duoc o vong ra soat truoc khi push =====
  // Ca ba deu la loi THAT, da tai hien duoc truoc khi sua. Giu lai lam chot chan.

  // 10a. Dong roi mo lai trong vong FADE_MS: hen gio don dep cua lan dong TRUOC khong
  // duoc phep no sau khi da mo lai. Neu no, modal bi set hidden trong khi .is-open va
  // khoa cuon nen van con -> nguoi dung ket o trang khong cuon duoc, khong thay gi.
  s = setup();
  s.openBtn.fire('click');
  s.cancel.fire('click');
  await wait(80);              // nhanh hon FADE_MS (220ms)
  s.openBtn.fire('click');
  await wait(300);             // qua thoi diem hen gio cu se no
  eq('dong roi mo lai ngay: modal VAN hien', s.overlay.hidden, false);
  check('dong roi mo lai ngay: van con is-open', s.overlay.classList.contains('is-open'));
  note('Truoc khi sua: hidden=true ma is-open van con -> hop thoai bien mat, nen van bi khoa cuon.');

  // 10b. Trong 1.5s cho dong sau khi thanh cong, khong duoc gui them lan nua. Nut da
  // disabled nhung phim Enter trong o van kich hoat submit cua <form>.
  s = setup();
  s.openBtn.fire('click');
  s.set(PW_OLD, PW_NEW, PW_NEW);
  s.form.fire('submit');
  await wait(); await wait();
  eq('sau thanh cong: nut gui bi khoa suot thoi gian cho', s.submitBtn().disabled, true);
  s.form.fire('submit');       // gia lap gõ Enter them mot lan
  await wait();
  eq('sau thanh cong: gui them KHONG de len thong bao', s.msg().textContent, 'au.cpOk');
  note('Truoc khi sua: hien "au.errFillAll" de len "au.cpOk" vi 3 o vua bi xoa sach.');

  // 10c. Dang goi Firebase thi khong duoc dong modal. Dong luc nay nguoi dung dinh ninh
  // da huy, nhung yeu cau van chay tiep va mat khau van doi.
  for (const [ten, act] of DONG) {
    let xong;
    const x = setup({ reauth: () => new Promise((r) => { xong = r; }) });
    x.openBtn.fire('click');
    x.set(PW_OLD, PW_NEW, PW_NEW);
    x.form.fire('submit');
    await wait();
    act(x);
    await wait(300);
    eq('dang goi Firebase: ' + ten + ' KHONG dong duoc modal', x.overlay.hidden, false);
    xong();                    // cho request chay xong de khong treo test
    await wait(); await wait();
  }
  note('Chan dong khi dang goi la co y: tha ra thi "huy" va "van doi mat khau" cung xay ra.');

  note('Submit bang phim Enter di qua cung listener "submit" cua <form>, khong can test rieng.');
})();
