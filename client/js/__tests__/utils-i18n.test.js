/* utils-i18n.js — helper dịch dùng chung, gộp từ 8 bản y hệt nhau (TASK 4). */
const { eq, note } = require('./helpers/assert');
const { load } = require('./helpers/sandbox');

console.log('utils-i18n.js');

// i18n.js đã nạp xong -> uỷ quyền sang window.__i18n.t
let r = load('utils-i18n.js', {
  window: { __i18n: { t: function (k, p) { return 'DICH:' + k + (p ? JSON.stringify(p) : ''); } } },
});
eq('t la global', typeof r.sandbox.t, 'function');
eq('t uy quyen sang window.__i18n.t', r.sandbox.t('pf.save'), 'DICH:pf.save');
eq('t truyen tiep tham so', r.sandbox.t('inv.docTitleN', { id: 42 }), 'DICH:inv.docTitleN{"id":42}');

/* i18n.js CHUA nap (thu tu the <script> hien chua thong nhat giua cac trang —
   TASK 5 moi xu ly). Phai tra ve chinh khoa, KHONG duoc nem loi. */
r = load('utils-i18n.js', { window: {} });
eq('chua co window.__i18n -> tra ve chinh khoa', r.sandbox.t('pf.save'), 'pf.save');

r = load('utils-i18n.js', { window: { __i18n: {} } });
eq('co __i18n nhung thieu .t -> tra ve chinh khoa', r.sandbox.t('pf.save'), 'pf.save');

note('admin.js:tr(key, params, fallback) KHONG gop vao day — co tham so thu 3 va');
note('tra ve fallback khi khoa chua co ban dich, tuc la lam viec khac.');
