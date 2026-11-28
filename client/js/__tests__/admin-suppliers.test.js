/* Trang "Nhà cung cấp": js/admin-suppliers.js (hàm thuần + DOM giả) và phần markup / i18n / gắn tab.
   DOM giả KHÔNG phân tích innerHTML, nên module dựng DOM bằng createElement + textContent; test duyệt cây phần tử để
   chứng minh dữ liệu (kể cả payload XSS) chỉ nằm ở textContent, và nút ghi chỉ có khi có supplier:write.
   Không kiểm được CSS / focus thật / trình duyệt thật — phần đó phải kiểm tay trên trình duyệt. */
const fs = require('fs');
const path = require('path');
const { check, eq, note } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { makeDoc } = require('./helpers/dom');
const { adminMe, staffMe } = require('./helpers/me');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) throw new Error('KHÔNG đọc được ' + rel + ' — test phải FAIL, không skip');
  return fs.readFileSync(file, 'utf8');
};
const html = read('admin.html'), src = read('js/admin-suppliers.js'), adminJs = read('js/admin.js');
console.log('admin-suppliers.js');

const XSS = '<img src=x onerror=alert(1)>';
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const S1 = { id: 1, code: 'NCC-001', name: 'Vải ' + XSS, contact_name: 'Chị B', phone: '0901234567', email: 'a@b.vn', address: XSS,
  tax_code: null, note: null, is_active: true, created_at: '2026-11-27T01:02:00.000Z', updated_at: '2026-11-27T01:02:00.000Z' };
const S2 = { id: 2, code: 'NCC-002', name: 'Xưởng May', contact_name: null, phone: null, email: null, address: null, tax_code: '0312345678',
  note: 'Ghi chú', is_active: false, created_at: '2026-11-26T17:30:00.000Z', updated_at: '2026-11-26T17:30:00.000Z' };
const listBody = (list, extra) => Object.assign({ status: 'ok', page: 1, limit: 20, total: list.length, totalPages: list.length ? 1 : 0, suppliers: list }, extra || {});
const ADMIN = adminMe().permissions, STAFF = staffMe().permissions;

function setup(opts) {
  opts = opts || {};
  const doc = makeDoc(); doc.body.classList.add('adm-authed');
  const i18n = load('i18n.js').win.__i18n; i18n.current = opts.lang || 'vi';
  const calls = [], toasts = [], native = [];
  let responder = opts.responder || (() => resp(200, listBody([S1, S2])));
  const r = load('admin-suppliers.js', { doc, deps: ['utils-format.js', 'utils-i18n.js'],
    globals: { confirm: (...x) => { native.push(['confirm', x]); return true; }, alert: (...x) => { native.push(['alert', x]); } },
    window: { __i18n: i18n, ProfileToast: msg => toasts.push(msg),
      confirm: (...x) => { native.push(['confirm', x]); return true; }, alert: (...x) => { native.push(['alert', x]); },
      AuthHelper: { apiFetch: (url, o) => { calls.push({ url, method: (o && o.method) || 'GET', body: o && o.body ? JSON.parse(o.body) : null });
        return Promise.resolve(responder(url, o)); } } } });
  doc.fire('DOMContentLoaded');
  const get = id => doc.getElementById(id);
  return { ...r, doc, get, i18n, calls, toasts, native, api: r.win.BreezeAdminSuppliers, util: r.win.BreezeAdminSuppliers.util,
    respond: fn => { responder = fn; } };
}
const walk = (n, fn) => { fn(n); (n.children || []).forEach(c => walk(c, fn)); };
const allText = n => (n.textContent || '') + (n.children || []).map(allText).join('');
const findAll = (root, pred) => { const out = []; walk(root, n => { if (pred(n)) out.push(n); }); return out; };
const rows = r => r.get('sup-body').children.filter(row => row.getAttribute('data-supplier-id') !== null);
const buttons = row => findAll(row, n => n.tagName === 'BUTTON');
const btnTexts = row => buttons(row).map(b => b.textContent);
const fill = (r, values) => Object.entries(values).forEach(([k, v]) => { r.get('sup-f-' + k).value = v; });
const lastCall = r => r.calls[r.calls.length - 1];

(async function () {
  // ---- 1. Hàm thuần ----
  let r = setup();
  const V = r.util.validateSupplier;
  eq('hợp lệ: chỉ code + name', V({ code: ' ncc-01 ', name: ' A ' }, 'create'), {});
  eq('hợp lệ: đủ trường (SĐT có dấu cách, MST có gạch)', V({ code: 'NCC-1', name: 'A', contact_name: 'B', phone: '090 123 4567',
    email: 'x@y.vn', address: 'Q1', tax_code: '0312345678-001', note: 'n' }, 'create'), {});
  eq('sai từng trường -> đúng khoá lỗi', V({ code: 'A', name: '', contact_name: 'x'.repeat(121), phone: '090-123', email: 'a@b',
    address: 'x'.repeat(301), tax_code: '123', note: 'x'.repeat(501) }, 'create'), {
    code: 'admSup.err.code', name: 'admSup.err.name', contact_name: 'admSup.err.contact_name', phone: 'admSup.err.phone',
    email: 'admSup.err.email', address: 'admSup.err.address', tax_code: 'admSup.err.tax_code', note: 'admSup.err.note' });
  for (const code of ['ncc-ı', 'ncc-ß', 'NCC 1', 'NCC_1', 'A'.repeat(21), '', 'Đ1']) {
    eq('mã sai bị chặn: ' + JSON.stringify(code), V({ code, name: 'A' }, 'create'), { code: 'admSup.err.code' });
  }
  eq('email ngoài ASCII / có dấu cách bị chặn', [V({ code: 'AB', name: 'A', email: 'tú@a.vn' }), V({ code: 'AB', name: 'A', email: 'a b@c.d' })].map(Object.keys), [['email'], ['email']]);
  eq('sửa: không kiểm mã (ô khoá)', V({ code: '', name: 'A' }, 'edit'), {});
  eq('buildBody tạo: trim, trống -> ""', r.util.buildBody({ code: ' ncc-9 ', name: ' A ', phone: ' ', note: XSS }, 'create'),
    { code: 'ncc-9', name: 'A', contact_name: '', phone: '', email: '', address: '', tax_code: '', note: XSS });
  eq('buildBody sửa: gửi mã HIỆN TẠI, bỏ giá trị ô mã', r.util.buildBody({ code: 'KHAC', name: 'A' }, 'edit', 'NCC-001').code, 'NCC-001');
  const E = r.util.serverError;
  eq('serverError: field -> khoá theo ô; mã trùng / không sửa được -> ô Mã; 403 / 404 / 400 / 500 -> hộp chung', [
    E(400, { code: 'SUPPLIER_INVALID_INPUT', field: 'phone', message: 'Số điện thoại…' }), E(409, { code: 'SUPPLIER_CODE_EXISTS' }),
    E(400, { code: 'SUPPLIER_CODE_IMMUTABLE', field: 'code' }), E(400, { code: 'SUPPLIER_INVALID_INPUT', field: 'is_active' }),
    E(403, { code: 'FORBIDDEN' }), E(404, { code: 'SUPPLIER_NOT_FOUND' }), E(500, null)], [
    { field: 'phone', key: 'admSup.err.phone' }, { field: 'code', key: 'admSup.err.codeExists' }, { field: 'code', key: 'admSup.err.codeImmutable' },
    { key: 'admSup.err.invalid' }, { key: 'admSup.err.forbidden' }, { key: 'admSup.err.notFound' }, { key: 'admSup.err.generic' }]);
  eq('listUrl: limit 20, mã hoá q', r.util.listUrl(2, 'a&b=1 %', 'active'), '/api/admin/suppliers?page=2&limit=20&status=active&q=a%26b%3D1%20%25');
  eq('giờ VN', [r.util.formatVnTime('2026-11-26T17:30:00.000Z'), r.util.formatVnTime('rác'), r.util.formatVnTime(null)], ['27/11/2026 00:30', '—', '—']);

  // ---- 2. Markup tĩnh / script / CSP ----
  const ids = [...src.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
  const fieldIds = ['code', 'name', 'contact_name', 'phone', 'email', 'address', 'tax_code', 'note'].flatMap(f => ['sup-f-' + f, 'sup-e-' + f]);
  const missing = [...new Set(ids.concat(fieldIds))].filter(id => !html.includes('id="' + id + '"'));
  eq('mọi id script dùng có trong admin.html', missing, []);
  for (const f of ['code', 'name', 'contact_name', 'phone', 'email', 'address', 'tax_code', 'note']) {
    check('ô ' + f + ': có <label for>, aria-describedby trỏ dòng lỗi', html.includes('<label for="sup-f-' + f + '"')
      && new RegExp('id="sup-f-' + f + '"[^>]*aria-describedby="[^"]*sup-e-' + f).test(html));
  }
  check('ô tìm kiếm có <label for="sup-q">, ô trạng thái có <label for="sup-status">', html.includes('<label for="sup-q"') && html.includes('<label for="sup-status"'));
  check('modal NCC: role=dialog + aria-modal + aria-labelledby', /id="sup-modal" role="dialog" aria-modal="true" aria-labelledby="sup-modal-title"/.test(html));
  check('modal xác nhận: role=alertdialog + aria-describedby', /id="sup-confirm" role="alertdialog" aria-modal="true" aria-labelledby="sup-confirm-title" aria-describedby="sup-confirm-msg"/.test(html));
  check('hộp lỗi chung của 2 modal có role=alert', /id="sup-modal-err" role="alert"/.test(html) && /id="sup-confirm-err" role="alert"/.test(html));
  check('icon menu / nút Thêm có aria-hidden', /data-nav="suppliers"[^>]*>\s*<i class="fa fa-truck" aria-hidden="true">/.test(html)
    && /id="sup-add"[^>]*><i class="fa fa-plus" aria-hidden="true">/.test(html));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); // bỏ chú thích (chú thích có nhắc tên các API bị cấm)
  check('script (bỏ chú thích) không dùng innerHTML / confirm() / alert() / eval', code.length > 5000 && !/innerHTML|\bconfirm\(|\balert\(|\beval\(|new Function/.test(code));
  check('script đúng dạng src="js/…" (để server gắn ?v=), nạp SAU admin-audit.js, TRƯỚC admin.js',
    html.includes('<script src="js/admin-suppliers.js"></script>') && html.indexOf('js/admin-audit.js') < html.indexOf('js/admin-suppliers.js')
    && html.indexOf('js/admin-suppliers.js') < html.indexOf('js/admin.js'));
  const css = read('css/admin-suppliers.css');
  check('CSS: [hidden] thắng display của .adm-pager / .adm-btn trong trang + 2 modal (pager rỗng, nút Lưu ở chế độ xem)',
    /#view-suppliers \[hidden\], #sup-modal \[hidden\], #sup-confirm \[hidden\] \{ display:none !important; \}/.test(css));
  check('CSS: bảng không khung, không kẻ dòng (như tab Nhật ký)', /#view-suppliers \.adm-table-wrap \{ border:none; \}/.test(css)
    && /#view-suppliers table\.adm-table td \{ padding-top:16px; padding-bottom:16px; border-bottom:none; \}/.test(css));
  check('ô tìm + trạng thái có nhãn hiện (không ẩn)', /<label for="sup-q" data-i18n="admSup.searchLabel">/.test(html)
    && /<label for="sup-status" data-i18n="admSup.status">/.test(html));
  check('CSS riêng nạp SAU admin.css', html.includes('<link rel="stylesheet" href="css/admin-suppliers.css">')
    && html.indexOf('css/admin.css') < html.indexOf('css/admin-suppliers.css'));
  check('không handler inline trong phần markup NCC', !/id="(sup-[a-z_-]+|view-suppliers)"[^>]*\son[a-z]+=/.test(html));
  check('admin.js: NAV_VIEWS có suppliers; showView gọi load với BẢN SAO quyền; showState gọi reset',
    /suppliers: 'view-suppliers'/.test(adminJs) && /t === 'suppliers' && window\.BreezeAdminSuppliers\) window\.BreezeAdminSuppliers\.load\(1, _perms\.slice\(\)\)/.test(adminJs)
    && /which !== 'panel' && window\.BreezeAdminSuppliers\) window\.BreezeAdminSuppliers\.reset\(\)/.test(adminJs));
  const NAV = [...html.matchAll(/data-nav="([a-z]+)"(?: data-perm="([a-z_:|]+)")?/g)].map(m => [m[1], m[2] || null]);
  eq('mục menu Nhà cung cấp ngay sau Sản phẩm, cần supplier:read', NAV.slice(1, 3), [['products', 'product:read'], ['suppliers', 'supplier:read']]);

  // ---- 3. i18n: mọi khoá admSup.* đang dùng có đủ VI + EN, placeholder giống nhau ----
  const UI = r.i18n.UI;
  const used = new Set([...src.matchAll(/'(admSup\.[A-Za-z_.]+)'/g)].map(m => m[1]).filter(k => !k.endsWith('.')) // 'admSup.err.' + f: kiểm qua danh sách trường bên dưới
    .concat([...html.matchAll(/data-i18n(?:-[a-z]+)?="(admSup\.[A-Za-z_.]+)"/g)].map(m => m[1]))
    .concat(['code', 'name', 'contact_name', 'phone', 'email', 'address', 'tax_code', 'note'].flatMap(f => ['admSup.f.' + f, 'admSup.err.' + f]))
    .concat(['com.loading', 'com.cancel', 'com.close', 'adm.pgPage', 'adm.pgPrev', 'adm.pgNext']));
  const noLang = [...used].filter(k => typeof UI.vi[k] !== 'string' || !UI.vi[k].trim() || typeof UI.en[k] !== 'string' || !UI.en[k].trim());
  eq('mọi khoá đang dùng có đủ VI và EN, không rỗng', noLang, []);
  const ph = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  eq('placeholder giống nhau VI/EN', [...used].filter(k => ph(UI.vi[k]) !== ph(UI.en[k])), []);
  note(used.size + ' khoá kiểm VI/EN');

  // ---- 4. Admin: render + nút ghi ----
  r = setup();
  await r.api.load(1, ADMIN); await wait();
  eq('gọi đúng 1 request danh sách', r.calls.map(c => [c.method, c.url]), [['GET', '/api/admin/suppliers?page=1&limit=20&status=all']]);
  eq('2 dòng, đúng thứ tự', rows(r).map(x => x.getAttribute('data-supplier-id')), ['1', '2']);
  eq('cột dữ liệu (trống -> —)', rows(r).map(x => x.children.slice(0, 5).map(td => td.textContent)),
    [['NCC-001', 'Vải ' + XSS, 'Chị B', '0901234567', 'a@b.vn'], ['NCC-002', 'Xưởng May', '—', '—', '—']]);
  eq('badge trạng thái', rows(r).map(x => [x.children[5].children[0].className, x.children[5].children[0].textContent]),
    [['pill on', 'Đang hợp tác'], ['pill off', 'Ngừng hợp tác']]);
  eq('admin: Xem / Sửa / Ngừng – Mở lại theo trạng thái', rows(r).map(btnTexts), [['Xem', 'Sửa', 'Ngừng hợp tác'], ['Xem', 'Sửa', 'Mở lại hợp tác']]);
  eq('nút có aria-label kèm mã NCC', buttons(rows(r)[0]).map(b => b.getAttribute('aria-label')),
    ['Xem nhà cung cấp NCC-001', 'Sửa nhà cung cấp NCC-001', 'Ngừng hợp tác với nhà cung cấp NCC-001']);
  check('admin: nút Thêm hiện', r.get('sup-add').hidden === false);
  check('XSS chỉ nằm ở textContent, không phần tử nào có innerHTML', allText(r.get('sup-body')).includes(XSS)
    && findAll(r.get('sup-body'), n => n.innerHTML !== '').length === 0 && findAll(r.get('sup-body'), n => n.tagName === 'IMG').length === 0);

  // ---- 5. Staff: chỉ xem ----
  r = setup();
  await r.api.load(1, STAFF); await wait();
  eq('staff: mỗi dòng chỉ có Xem', rows(r).map(btnTexts), [['Xem'], ['Xem']]);
  check('staff: nút Thêm bị ẩn', r.get('sup-add').hidden === true);
  rows(r)[0].children[6].children[0].children[0].click();
  check('staff: Xem mở modal chế độ xem', r.get('sup-modal').classList.contains('open') && r.get('sup-form').hidden === true && r.get('sup-save').hidden === true);
  r.get('sup-cancel').click();
  r.get('sup-add').click();
  check('staff: bấm nút Thêm (nếu bị gỡ hidden) cũng không mở form', !r.get('sup-modal').classList.contains('open'));
  r.get('sup-form').fire('submit');
  eq('staff: không gửi request ghi nào', r.calls.filter(c => c.method !== 'GET').length, 0);

  r = setup();
  await r.api.load(1, ['dashboard:read']); await wait();
  eq('không có supplier:read -> không gọi API', r.calls.length, 0);

  // ---- 6. Tìm / lọc / phân trang ----
  r = setup({ responder: () => resp(200, listBody([S1], { page: 1, total: 41, totalPages: 3 })) });
  await r.api.load(1, ADMIN); await wait();
  check('pager hiện, Trước tắt, Sau bật', r.get('sup-pager').hidden === false && r.get('sup-prev').disabled === true && r.get('sup-next').disabled === false);
  eq('chữ trang', r.get('sup-page').textContent, (r.i18n.UI.vi['adm.pgPage']) + ' 1 / 3');
  r.get('sup-q').value = '  090 123 ';
  r.get('sup-search-form').fire('submit'); await wait();
  eq('tìm: trim, về trang 1', lastCall(r).url, '/api/admin/suppliers?page=1&limit=20&status=all&q=090%20123');
  r.get('sup-status').value = 'inactive'; r.get('sup-status').fire('change'); await wait();
  eq('lọc trạng thái giữ từ khoá, về trang 1', lastCall(r).url, '/api/admin/suppliers?page=1&limit=20&status=inactive&q=090%20123');
  r.get('sup-next').click(); await wait();
  check('Sau -> page=2', lastCall(r).url.startsWith('/api/admin/suppliers?page=2&'));
  r.respond(() => resp(200, listBody([])));
  r.get('sup-q').value = 'khongco'; r.get('sup-search-form').fire('submit'); await wait();
  eq('không có kết quả khi đang lọc -> "Không có nhà cung cấp phù hợp."', allText(r.get('sup-body')), 'Không có nhà cung cấp phù hợp.');
  r.respond(() => resp(500, { status: 'error' }));
  r.get('sup-search-form').fire('submit'); await wait();
  check('lỗi tải -> thông báo + nút Thử lại (không giả "trống")', allText(r.get('sup-body')).includes('Không tải được danh sách nhà cung cấp.')
    && findAll(r.get('sup-body'), n => n.tagName === 'BUTTON' && n.textContent === 'Thử lại').length === 1);

  // ---- 7. Thêm: kiểm sớm, lỗi theo ô từ server, thành công ----
  r = setup();
  await r.api.load(1, ADMIN); await wait();
  r.get('sup-add').click();
  check('mở modal thêm: tiêu đề, ô mã không khoá, focus ô mã', r.get('sup-modal').classList.contains('open')
    && r.get('sup-modal-title').textContent === 'Thêm nhà cung cấp' && r.get('sup-f-code').readOnly === false && r.get('sup-f-code')._focused === true);
  fill(r, { code: 'ncc-ı', name: '', phone: 'abc' });
  await r.get('sup-form').fire('submit'); await wait();
  eq('kiểm sớm: không gửi request', r.calls.filter(c => c.method === 'POST').length, 0);
  eq('lỗi hiện đúng ô + aria-invalid', ['code', 'name', 'phone', 'email'].map(f => [f, r.get('sup-e-' + f).hidden, r.get('sup-f-' + f).getAttribute('aria-invalid')]),
    [['code', false, 'true'], ['name', false, 'true'], ['phone', false, 'true'], ['email', true, 'false']]);
  eq('chữ lỗi theo i18n', r.get('sup-e-phone').textContent, r.i18n.UI.vi['admSup.err.phone']);
  r.respond((url, o) => (o && o.method === 'POST') ? resp(409, { status: 'error', code: 'SUPPLIER_CODE_EXISTS', message: 'Mã nhà cung cấp đã tồn tại' }) : resp(200, listBody([S1, S2])));
  fill(r, { code: 'ncc-001', name: 'Mới ' + XSS, phone: '090 999 8888' });
  r.get('sup-form').fire('submit'); await wait();
  const post = r.calls.filter(c => c.method === 'POST');
  eq('POST đúng body (trim, trống -> "")', post.map(c => [c.url, c.body]), [['/api/admin/suppliers', { code: 'ncc-001', name: 'Mới ' + XSS,
    contact_name: '', phone: '090 999 8888', email: '', address: '', tax_code: '', note: '' }]]);
  eq('409 mã trùng -> lỗi ở ô Mã, modal vẫn mở', [r.get('sup-e-code').textContent, r.get('sup-e-code').hidden, r.get('sup-modal').classList.contains('open')],
    ['Mã nhà cung cấp đã tồn tại.', false, true]);
  r.respond((url, o) => (o && o.method === 'POST') ? resp(400, { status: 'error', code: 'SUPPLIER_INVALID_INPUT', field: 'email', message: 'Email không đúng định dạng' })
    : resp(200, listBody([S1, S2])));
  r.i18n.current = 'en';
  fill(r, { code: 'NCC-010' });
  r.get('sup-form').fire('submit'); await wait();
  eq('lỗi field server -> câu theo ngôn ngữ đang dùng (EN), không lấy câu tiếng Việt của server', r.get('sup-e-email').textContent, r.i18n.UI.en['admSup.err.email']);
  r.i18n.current = 'vi';
  r.respond((url, o) => (o && o.method === 'POST') ? resp(403, { status: 'error', code: 'FORBIDDEN' }) : resp(200, listBody([S1, S2])));
  r.get('sup-form').fire('submit'); await wait();
  eq('403 -> hộp lỗi chung', [r.get('sup-modal-err').textContent, r.get('sup-modal-err').style.display], ['Tài khoản không có quyền thực hiện thao tác này.', 'block']);
  r.respond((url, o) => (o && o.method === 'POST') ? resp(201, { status: 'ok', supplier: { ...S1, id: 10, code: 'NCC-010' } }) : resp(200, listBody([S1, S2])));
  const before = r.calls.length;
  r.get('sup-form').fire('submit'); await wait();
  check('thành công: đóng modal, toast, tải lại trang 1', !r.get('sup-modal').classList.contains('open') && r.toasts.includes('Đã thêm nhà cung cấp NCC-010')
    && r.calls.slice(before).some(c => c.method === 'GET' && c.url.startsWith('/api/admin/suppliers?page=1&')));

  // ---- 8. Sửa: mã khoá, PUT gửi mã hiện tại ----
  rows(r)[0].children[6].children[0].children[1].click();
  check('mở modal sửa: mã readonly, điền sẵn, focus ô tên', r.get('sup-f-code').readOnly === true && r.get('sup-f-code').value === 'NCC-001'
    && r.get('sup-f-name').value === 'Vải ' + XSS && r.get('sup-modal-title').textContent === 'Sửa nhà cung cấp NCC-001' && r.get('sup-f-name')._focused === true);
  eq('chữ gợi ý ô mã khi sửa', r.get('sup-h-code').textContent, 'Mã nhà cung cấp không sửa được sau khi tạo.');
  r.get('sup-f-code').value = 'DOI-MA';
  r.get('sup-f-phone').value = '0909 000 111';
  r.respond((url, o) => (o && o.method === 'PUT') ? resp(200, { status: 'ok', supplier: S1 }) : resp(200, listBody([S1, S2])));
  r.get('sup-form').fire('submit'); await wait();
  const put = r.calls.filter(c => c.method === 'PUT');
  eq('PUT /:id, gửi mã HIỆN TẠI dù ô mã bị sửa', put.map(c => [c.url, c.body.code, c.body.phone]), [['/api/admin/suppliers/1', 'NCC-001', '0909 000 111']]);
  check('sửa xong: toast', r.toasts.includes('Đã lưu nhà cung cấp NCC-001'));

  // ---- 9. Xem: dữ liệu qua textContent ----
  rows(r)[0].children[6].children[0].children[0].click();
  const view = r.get('sup-view');
  check('chế độ xem: form ẩn, dl hiện, có địa chỉ XSS ở textContent', r.get('sup-form').hidden === true && view.hidden === false
    && allText(view).includes(XSS) && findAll(view, n => n.innerHTML !== '').length === 0);
  check('xem: nút Đóng', r.get('sup-cancel').textContent === 'Đóng' && r.get('sup-cancel')._focused === true);
  r.get('sup-modal').fire('keydown', { key: 'Escape' });
  check('Esc đóng modal', !r.get('sup-modal').classList.contains('open'));

  // ---- 10. Ngừng / mở lại: modal của trang, không confirm() trình duyệt ----
  rows(r)[0].children[6].children[0].children[2].click();
  check('mở modal xác nhận, focus nút Hủy', r.get('sup-confirm').classList.contains('open') && r.get('sup-confirm-cancel')._focused === true);
  eq('nội dung xác nhận ngừng (có tên + mã, qua textContent)', [r.get('sup-confirm-title').textContent, r.get('sup-confirm-msg').textContent.includes('Vải ' + XSS + ' (NCC-001)'),
    r.get('sup-confirm-ok').textContent, r.get('sup-confirm-ok').classList.contains('danger')], ['Ngừng hợp tác?', true, 'Ngừng hợp tác', true]);
  r.respond((url, o) => (o && o.method === 'PATCH') ? resp(500, { status: 'error' }) : resp(200, listBody([S1, S2])));
  r.get('sup-confirm-ok').click(); await wait();
  eq('lỗi -> giữ modal, báo lỗi', [r.get('sup-confirm').classList.contains('open'), r.get('sup-confirm-err').textContent],
    [true, 'Không đổi được trạng thái. Vui lòng thử lại.']);
  r.respond((url, o) => (o && o.method === 'PATCH') ? resp(200, { status: 'ok', supplier: { ...S1, is_active: false } }) : resp(200, listBody([S1, S2])));
  r.get('sup-confirm-ok').click(); await wait();
  const patch = r.calls.filter(c => c.method === 'PATCH');
  eq('PATCH /:id/status { is_active:false }', patch.map(c => [c.url, c.body]), [['/api/admin/suppliers/1/status', { is_active: false }],
    ['/api/admin/suppliers/1/status', { is_active: false }]]);
  check('thành công: đóng, toast', !r.get('sup-confirm').classList.contains('open') && r.toasts.includes('Đã ngừng hợp tác với NCC-001'));
  rows(r)[1].children[6].children[0].children[2].click();
  eq('mở lại hợp tác: tiêu đề + nút không đỏ', [r.get('sup-confirm-title').textContent, r.get('sup-confirm-ok').textContent,
    r.get('sup-confirm-ok').classList.contains('danger')], ['Mở lại hợp tác?', 'Mở lại hợp tác', false]);
  r.get('sup-confirm-cancel').click();
  eq('không lần nào gọi confirm() / alert() của trình duyệt', r.native, []);

  // ---- 11. Đổi ngôn ngữ / rời phiên ----
  r.i18n.current = 'en'; r.doc.fire('langchange');
  eq('đổi EN: vẽ lại từ dữ liệu đã tải, không gọi API', [rows(r).map(btnTexts)[0], rows(r)[0].children[5].children[0].textContent], [['View', 'Edit', 'Deactivate'], 'Active']);
  const n = r.calls.length;
  r.api.reset();
  eq('reset: xoá bảng, bộ lọc, ẩn nút Thêm, không gọi API', [rows(r).length, r.get('sup-q').value, r.get('sup-status').value, r.get('sup-add').hidden, r.calls.length],
    [0, '', 'all', true, n]);
})();
