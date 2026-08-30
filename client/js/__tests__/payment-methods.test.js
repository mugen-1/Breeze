/* payment-methods.js — thẻ đã lưu ở tab "Phương thức thanh toán" của profile.html.

   Trọng tâm file này: bug ① — race giữa `hidden` và `.is-open` khi đóng rồi mở lại modal
   trước lúc hiệu ứng fade kết thúc. Cùng khuôn với mục tương ứng trong
   page-profile.test.js (modal địa chỉ / xoá tài khoản) và mục 10a trong
   change-password.test.js. */
const { check, eq, note } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { makeDoc } = require('./helpers/dom');

function setup() {
  const doc = makeDoc();
  // Khớp markup thật: overlay có sẵn thuộc tính hidden trong profile.ejs.
  doc.getElementById('pm-modal-overlay').hidden = true;

  const r = load('payment-methods.js', {
    deps: ['routes.js', 'utils-i18n.js'],
    doc: doc,
    window: {
      location: { hash: '' },
      __i18n: { current: 'vi', t: function (k) { return 'T:' + k; } },
      AuthHelper: {
        onChange: function () {},
        isLoggedIn: function () { return true; },
        apiFetch: function () {
          return Promise.resolve({ ok: true, status: 200,
            json: function () { return Promise.resolve([]); } });
        },
      },
    },
  });
  // init() chờ DOMContentLoaded vì DOM giả có readyState 'loading'.
  doc.fire('DOMContentLoaded');
  r.doc = doc;
  return r;
}

(async function () {
  console.log('payment-methods.js');

  // Toàn bộ nằm trong 1 IIFE — chỉ window.PaymentMethods được lộ ra ngoài.
  let r = setup();
  ['openModal', 'closeModal', 'byId', 'renderCards', 'submit']
    .forEach(function (k) { eq('IIFE khong ro global: ' + k, typeof r.sandbox[k], 'undefined'); });
  eq('lo dung window.PaymentMethods', typeof r.win.PaymentMethods, 'object');

  /* ===== Bug (1): dong roi mo lai truoc khi hieu ung fade xong =====
     closeModal hẹn giờ gỡ modal khỏi layout (hidden = true) SAU hiệu ứng. Không giữ
     timer id để huỷ thì mở lại trong lúc nó còn treo sẽ để nó nổ vô điều kiện: hidden bị
     đá về true trong khi .is-open vẫn bật -> hộp thoại biến mất, mà nền VẪN khoá cuộn
     nên ESC cũng không ăn (listener gắn trên overlay đang display:none).
     Cửa sổ dính lỗi là 220ms — đúng tầm một nhịp nhấp đúp. */
  r = setup();
  const ov = r.doc.getElementById('pm-modal-overlay');

  r.doc.getElementById('pm-add').fire('click');
  eq('the: mo modal -> hidden=false', ov.hidden, false);
  check('the: mo modal -> co .is-open', ov.classList.contains('is-open'));

  r.doc.getElementById('pm-cancel').fire('click');
  await wait(80);                    // nhanh hơn 220ms
  r.doc.getElementById('pm-add').fire('click');
  eq('the: mo lai ngay -> hidden=false', ov.hidden, false);

  await wait(320);                   // qua mốc hẹn giờ CŨ của lần đóng trước
  eq('the: hen gio cu KHONG dong modal vua mo', ov.hidden, false);
  check('the: van con .is-open', ov.classList.contains('is-open'));
  eq('the: nen van khoa cuon dung trang thai dang mo', r.doc.body.style.overflow, 'hidden');

  note('Bien timer dat ten rieng (_pmCloseTimer) du file nay chi co mot modal —');
  note('de doc cho khop voi _addrCloseTimer / _delCloseTimer ben page-profile.js.');
})();
