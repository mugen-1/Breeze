/* checkout-payment.js — panel nhập thẻ / SĐT MoMo ở checkout.html (DOM giả).
   Mô phỏng thêm 1 hành vi trình duyệt: Enter trong ô input thuộc form mà keydown KHÔNG bị
   preventDefault -> form submit (implicit submission). Nhờ đó kiểm được "Enter không đặt hàng". */
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');

const PAN_VISA = '4242424242424242';
const PAN_MC = '5555555555554444';
const NOW = new Date();
const CUR = { m: NOW.getUTCMonth() + 1, y: NOW.getUTCFullYear() };

function brandOf(n) { return n[0] === '4' ? 'visa' : (/^5[1-5]/.test(n) ? 'mastercard' : 'other'); }

function setup(opts = {}) {
  const doc = makeDoc();
  const radios = ['visa', 'mastercard', 'cod', 'momo'].map(v => { const r = El('input'); r.name = 'payment'; r.value = v; return r; });
  Object.defineProperty(doc._qs, 'input[name="payment"]:checked', { get: () => radios.find(r => r.checked) || null });

  // Ô nhập là <input> thật (tagName INPUT) — keydown Enter chỉ bị chặn trên input.
  ['co-pay-number', 'co-pay-holder', 'co-pay-month', 'co-pay-year', 'co-pay-phone'].forEach(id => { doc._byId[id] = El('input', id); });
  const panel = doc.getElementById('co-pay-panel');
  panel.hidden = true;
  const inPanel = new Set();
  ['co-pay-save-card', 'co-pay-save-phone', 'co-pay-retry'].forEach(id => {
    const b = El('button', id); doc._byId[id] = b;
    b.setAttribute('data-action', { 'co-pay-save-card': 'pay-panel-save-card', 'co-pay-save-phone': 'pay-panel-save-momo', 'co-pay-retry': 'pay-panel-retry' }[id]);
    b.closest = () => b; inPanel.add(b);
  });
  ['co-pay-number', 'co-pay-holder', 'co-pay-month', 'co-pay-year', 'co-pay-phone'].forEach(id => inPanel.add(doc._byId[id]));
  panel.contains = el => inPanel.has(el);
  ['co-pay-card', 'co-pay-momo', 'co-pay-retry'].forEach(id => { doc.getElementById(id).hidden = true; });

  const form = doc.getElementById('co-form');
  let submits = 0; form.addEventListener('submit', () => submits++);

  const calls = [], events = [], storage = [];
  let db = { cards: (opts.cards || []).slice(), phone: opts.phone === undefined ? null : opts.phone };
  let authCb = null, gate = null;
  const lang = { prefix: '' };
  const res = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

  doc.addEventListener('checkout:payready', e => events.push(e.detail));
  const r = load('checkout-payment.js', {
    deps: ['routes.js', 'utils-i18n.js', 'card-utils.js'],
    doc,
    globals: { localStorage: { getItem: () => null, setItem: (k, v) => storage.push([k, v]) } },
    window: {
      location: { href: '' },
      matchMedia: opts.motion ? undefined : () => ({ matches: true }),
      __i18n: { t: (k, p) => lang.prefix + k + (p ? JSON.stringify(p) : '') },
      AuthHelper: {
        onChange: cb => { authCb = cb; },
        apiFetch: async (url, o) => {
          o = o || {};
          calls.push({ url, method: o.method || 'GET', body: o.body ? JSON.parse(o.body) : undefined });
          if (gate) await gate;
          if (o.method === 'GET' || !o.method) {
            if (opts.failLoad && opts.failLoad()) return res(500, {});
            if (url === '/api/account/payment-methods') return res(200, { payment_methods: db.cards.slice() });
            if (url === '/api/me') return res(200, { id: 1, role: 'customer', phone: db.phone });
          }
          if (url === '/api/account/payment-methods' && o.method === 'POST') {
            const b = JSON.parse(o.body);
            if (opts.post) return opts.post(b);
            db.cards.push({ id: 100 + db.cards.length, brand: brandOf(b.card_number), last4: b.card_number.slice(-4),
              holder_name: b.holder_name, exp_month: b.exp_month, exp_year: b.exp_year, is_default: db.cards.length === 0 });
            return res(201, { payment_methods: db.cards.slice() });
          }
          if (url === '/api/me/phone' && o.method === 'PATCH') {
            const b = JSON.parse(o.body);
            if (opts.patch) return opts.patch(b);
            db.phone = b.phone;
            return res(200, { id: 1, phone: db.phone, dob: '2000-01-02', gender: 'female', country: 'VN' });
          }
          throw new Error('unexpected ' + url);
        },
      },
    },
  });
  const h = {
    ...r, doc, radios, panel, form, calls, events, storage, lang, db,
    el: id => doc.getElementById(id),
    submits: () => submits,
    login: async () => { authCb({ uid: 'u1' }); await wait(); },
    hold: () => { let open; gate = new Promise(res2 => { open = res2; }); return () => { gate = null; open(); }; },
    select: v => { radios.forEach(x => { x.checked = x.value === v; }); doc.fire('change', { target: radios.find(x => x.value === v) }); },
    click: id => doc.fire('click', { target: doc.getElementById(id) }),
    // Enter trong input của form: nếu keydown không bị chặn -> trình duyệt submit form.
    enter: target => {
      let prevented = false;
      panel.fire('keydown', { key: 'Enter', target, preventDefault() { prevented = true; } });
      if (!prevented) form.fire('submit');
      return prevented;
    },
    fillCard: (num, holder = 'NGUYEN VAN A', m = '12', y = '2099') => {
      h.el('co-pay-number').value = num; h.el('co-pay-holder').value = holder;
      h.el('co-pay-month').value = m; h.el('co-pay-year').value = y;
    },
    api: (url, method) => calls.filter(c => c.url === url && (!method || c.method === method)),
    open: () => !panel.hidden,
    ready: () => r.win.BreezeCheckoutPayment.isReady(),
  };
  return h;
}

(async function () {
  console.log('checkout-payment.js');

  // ---- API công khai, không rò global ----
  let h = setup();
  eq('lo window.BreezeCheckoutPayment {isReady, refresh}', Object.keys(h.win.BreezeCheckoutPayment).sort(), ['isReady', 'refresh']);
  ['cache', 'saveCard', 'evaluate', 'load'].forEach(k => eq('IIFE khong ro global: ' + k, typeof h.sandbox[k], 'undefined'));
  eq('panel dong luc dau', h.open(), false);

  // ---- Chưa nạp xong mà đã chọn Visa -> "Đang kiểm tra…" ----
  h = setup();
  h.select('visa');
  eq('chua dang nhap/nap: panel mo trang thai dang kiem tra', [h.open(), h.el('co-pay-status').textContent], [true, 'co.payChecking']);
  eq('dang kiem tra: an ca 2 khoi nhap', [h.el('co-pay-card').hidden, h.el('co-pay-momo').hidden], [true, true]);
  eq('dang kiem tra: isReady=false', h.ready(), false);
  const release = h.hold();
  await h.login();
  eq('dang nap: van dang kiem tra', h.el('co-pay-status').textContent, 'co.payChecking');
  release(); await wait();
  eq('nap xong: goi song song cards + /api/me', [h.api('/api/account/payment-methods', 'GET').length, h.api('/api/me', 'GET').length], [1, 1]);
  eq('nap xong, chua co the: hien khoi the', [h.open(), h.el('co-pay-card').hidden, h.el('co-pay-status').textContent], [true, false, '']);

  // ---- Visa chưa có thẻ ----
  h = setup(); await h.login();
  h.select('visa');
  eq('Visa chua co the -> panel mo', h.open(), true);
  check('panel co .is-open', h.panel.classList.contains('is-open'));
  eq('Visa: khoi the hien, khoi MoMo an', [h.el('co-pay-card').hidden, h.el('co-pay-momo').hidden], [false, true]);
  eq('tieu de panel Visa', h.el('co-pay-panel-title').textContent, 'co.payTitleVisa');
  eq('Visa chua co the -> isReady=false', h.ready(), false);
  eq('mo panel KHONG tu focus o dau', h.el('co-pay-number')._focused, undefined);

  // ---- Đã có thẻ visa còn hạn ----
  h = setup({ cards: [{ id: 1, brand: 'visa', last4: '4242', exp_month: 12, exp_year: CUR.y + 2 }] }); await h.login();
  h.select('visa');
  eq('co the visa con han -> khong mo panel', h.open(), false);
  eq('co the visa con han -> isReady=true', h.ready(), true);
  h = setup({ cards: [{ id: 1, brand: 'visa', last4: '4242', exp_month: CUR.m, exp_year: CUR.y }] }); await h.login();
  h.select('visa');
  eq('the het han cuoi thang nay (UTC) van dung duoc', [h.open(), h.ready()], [false, true]);

  // ---- Chỉ có Mastercard mà chọn Visa; Visa hết hạn ----
  h = setup({ cards: [{ id: 1, brand: 'mastercard', last4: '4444', exp_month: 12, exp_year: CUR.y + 2 }] }); await h.login();
  h.select('visa');
  eq('chi co mastercard, chon Visa -> van mo', [h.open(), h.ready()], [true, false]);
  h.select('mastercard');
  eq('chon Mastercard -> dong', [h.open(), h.ready()], [false, true]);
  h = setup({ cards: [{ id: 1, brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2020 }] }); await h.login();
  h.select('visa');
  eq('visa het han -> van mo', [h.open(), h.ready()], [true, false]);
  h = setup({ cards: [{ id: 1, brand: 'amex', last4: '0005', exp_month: 12, exp_year: CUR.y + 2 }] }); await h.login();
  h.select('mastercard');
  eq('chi co amex -> Mastercard van mo', [h.open(), h.el('co-pay-panel-title').textContent], [true, 'co.payTitleMastercard']);

  // ---- Lưu thẻ thành công ----
  h = setup(); await h.login();
  h.select('visa');
  const evBefore = h.events.length;
  h.fillCard('4242 4242 4242 4242');
  h.doc.activeElement = h.el('co-pay-save-card');
  h.click('co-pay-save-card');
  eq('dang luu: nut bi khoa + nhan Dang luu', [h.el('co-pay-save-card').disabled, h.el('co-pay-save-card').textContent], [true, 'pf.saving']);
  h.click('co-pay-save-card');
  await wait();
  eq('bam dup -> chi 1 POST', h.api('/api/account/payment-methods', 'POST').length, 1);
  const posted = h.api('/api/account/payment-methods', 'POST')[0].body;
  eq('payload dung', posted, { card_number: PAN_VISA, holder_name: 'NGUYEN VAN A', exp_month: 12, exp_year: 2099, is_default: false, expected_brand: 'visa' });
  check('payload khong co CVV', !('cvv' in posted));
  eq('luu xong -> panel dong + isReady=true', [h.open(), h.ready()], [false, true]);
  check('luu xong -> phat checkout:payready ready=true', h.events.slice(evBefore).some(e => e.ready === true && e.method === 'visa'));
  eq('o so the bi xoa sau khi luu', h.el('co-pay-number').value, '');
  check('xac nhan "Da luu the Visa •••• 4242"', /co\.paySaved/.test(h.el('co-pay-saved').textContent) &&
    h.el('co-pay-saved').textContent.includes('Visa') && h.el('co-pay-saved').textContent.includes('4242'));
  eq('focus tra ve radio dang chon', h.radios[0]._focused, true);
  eq('nut mo lai sau khi luu', [h.el('co-pay-save-card').disabled, h.el('co-pay-save-card').textContent], [false, 'co.paySaveCard']);
  check('khong console nao chua so the', !h.log.some(l => l.join(' ').includes(PAN_VISA) || l.join(' ').includes('4242 4242')));
  eq('khong ghi localStorage', h.storage.length, 0);
  check('khong global nao chua so the', !Object.keys(h.sandbox).concat(Object.keys(h.win)).some(k => {
    try { return JSON.stringify(h.sandbox[k] !== undefined ? h.sandbox[k] : h.win[k]).includes(PAN_VISA); } catch (_) { return false; }
  }));

  // ---- Thẻ mới = id chưa có trong cache cũ (không phải phần tử đầu) ----
  h = setup({ cards: [{ id: 7, brand: 'mastercard', last4: '4444', exp_month: 12, exp_year: CUR.y + 2 }] }); await h.login();
  h.select('visa'); h.fillCard('4111 1111 1111 1111'); h.click('co-pay-save-card'); await wait();
  check('xac nhan lay dung the vua them (1111), khong lay the cu', h.el('co-pay-saved').textContent.includes('1111') && !h.el('co-pay-saved').textContent.includes('4444'));

  // ---- Số Mastercard trong panel Visa -> lỗi brand, không gọi API ----
  h = setup(); await h.login();
  h.select('visa'); h.fillCard(PAN_MC); h.click('co-pay-save-card'); await wait();
  eq('so Mastercard vao panel Visa -> loi brand', [h.el('co-pay-number-err').hidden, h.el('co-pay-number-err').textContent], [false, 'co.payErrBrandVisa']);
  eq('loi brand -> o so the aria-invalid', h.el('co-pay-number').getAttribute('aria-invalid'), 'true');
  eq('loi brand -> KHONG goi API', h.api('/api/account/payment-methods', 'POST').length, 0);
  h.select('mastercard'); h.fillCard(PAN_VISA); h.click('co-pay-save-card'); await wait();
  eq('so Visa vao panel Mastercard -> loi brand', h.el('co-pay-number-err').textContent, 'co.payErrBrandMastercard');

  // ---- Validate client khác ----
  h = setup(); await h.login(); h.select('visa');
  h.fillCard('', '', '', ''); h.click('co-pay-save-card'); await wait();
  eq('form trong -> 3 loi', [h.el('co-pay-number-err').textContent, h.el('co-pay-holder-err').textContent, h.el('co-pay-exp-err').textContent],
    ['pf.errCardNumber', 'pf.errCardHolder', 'pf.errExpMonth']);
  h.fillCard('4242 4242 4242 4243', 'A', '13', '2099'); h.click('co-pay-save-card'); await wait();
  eq('sai Luhn / thang 13', [h.el('co-pay-number-err').textContent, h.el('co-pay-exp-err').textContent], ['pf.errCardNumberBad', 'pf.errExpMonth']);
  h.fillCard(PAN_VISA, 'A', '1', '2020'); h.click('co-pay-save-card'); await wait();
  eq('the het han', h.el('co-pay-exp-err').textContent, 'pf.errCardExpired');
  eq('loi validate -> khong goi API', h.api('/api/account/payment-methods', 'POST').length, 0);

  // ---- Enter trong ô panel không submit #co-form ----
  h = setup(); await h.login(); h.select('visa');
  h.fillCard(PAN_VISA);
  check('Enter trong o so the -> preventDefault', h.enter(h.el('co-pay-number')));
  await wait();
  eq('Enter KHONG submit #co-form (khong dat hang)', h.submits(), 0);
  eq('Enter kich hoat Luu the cua panel', h.api('/api/account/payment-methods', 'POST').length, 1);
  h = setup({ phone: null }); await h.login(); h.select('momo');
  h.el('co-pay-phone').value = '0901234567';
  h.enter(h.el('co-pay-phone')); await wait();
  eq('Enter trong o SĐT -> luu so, khong dat hang', [h.submits(), h.api('/api/me/phone', 'PATCH').length], [0, 1]);
  const btnEnter = setup(); await btnEnter.login(); btnEnter.select('visa');
  let pd = false;
  btnEnter.panel.fire('keydown', { key: 'Enter', target: btnEnter.el('co-pay-save-card'), preventDefault() { pd = true; } });
  eq('Enter tren NUT khong bi chan (nut tu kich hoat click)', pd, false);

  // ---- MoMo ----
  h = setup({ phone: null }); await h.login();
  h.select('momo');
  eq('MoMo chua co SĐT -> panel MoMo', [h.open(), h.el('co-pay-momo').hidden, h.el('co-pay-card').hidden], [true, false, true]);
  eq('tieu de MoMo', h.el('co-pay-panel-title').textContent, 'co.payTitleMomo');
  h.click('co-pay-save-phone'); await wait();
  eq('SĐT trong -> loi, khong goi API', [h.el('co-pay-phone-err').textContent, h.api('/api/me/phone').length], ['co.payErrPhoneEmpty', 0]);
  for (const bad of ['0281234567', '0121234567', '0412345678', '0612345678', '090123456', '+14155552671']) {
    h.el('co-pay-phone').value = bad; h.click('co-pay-save-phone'); await wait();
    eq('SĐT ' + bad + ' -> loi di dong', h.el('co-pay-phone-err').textContent, 'co.payErrPhone');
  }
  eq('SĐT sai -> khong goi API', h.api('/api/me/phone').length, 0);
  h.el('co-pay-phone').value = '+84 912 345 678'; h.click('co-pay-save-phone'); await wait();
  eq('SĐT dung -> PATCH /api/me/phone chi {phone} da chuan hoa', h.api('/api/me/phone', 'PATCH')[0].body, { phone: '0912345678' });
  eq('luu SĐT xong -> dong + isReady=true', [h.open(), h.ready()], [false, true]);
  check('xac nhan so MoMo', h.el('co-pay-saved').textContent.includes('co.payMomoLabel') && h.el('co-pay-saved').textContent.includes('0912345678'));
  h = setup({ phone: '0281234567' }); await h.login(); h.select('momo');
  eq('SĐT ho so khong hop le -> mo + dien san so cu', [h.open(), h.el('co-pay-phone').value], [true, '0281234567']);
  h = setup({ phone: '0901 234 567' }); await h.login(); h.select('momo');
  eq('SĐT ho so hop le (sau chuan hoa) -> khong mo', [h.open(), h.ready()], [false, true]);

  // ---- COD ----
  h = setup(); await h.login();
  h.select('visa'); eq('Visa mo', h.open(), true);
  h.select('cod');
  eq('chon COD -> an panel + isReady=true', [h.open(), h.ready()], [false, true]);
  check('COD -> phat payready ready=true', h.events.at(-1).ready === true && h.events.at(-1).method === 'cod');
  h = setup(); h.select('cod');
  eq('COD khi chua nap -> khong panel, san sang', [h.open(), h.ready()], [false, true]);

  // ---- Xoá ô số thẻ: đổi phương thức, pagehide ----
  h = setup(); await h.login(); h.select('visa');
  h.fillCard(PAN_VISA);
  h.select('mastercard');
  eq('doi phuong thuc -> xoa o so the', h.el('co-pay-number').value, '');
  h.el('co-pay-number').value = PAN_MC;
  h.win._l.pagehide();
  eq('pagehide -> xoa o so the', h.el('co-pay-number').value, '');

  // ---- Lỗi lưu ----
  h = setup({ post: () => ({ ok: false, status: 401, json: async () => ({}) }) }); await h.login();
  h.select('visa'); h.fillCard(PAN_VISA); h.click('co-pay-save-card'); await wait();
  eq('401 -> dieu huong login?redirect=checkout', h.win.location.href, 'login.html?redirect=checkout');
  h = setup({ post: () => ({ ok: false, status: 400, json: async () => ({ status: 'error', message: 'Số thẻ không phải thẻ Visa' }) }) }); await h.login();
  h.select('visa'); h.fillCard(PAN_VISA); h.click('co-pay-save-card'); await wait();
  eq('400 -> hien message server trong panel', [h.el('co-pay-err').hidden, h.el('co-pay-err').textContent], [false, 'Số thẻ không phải thẻ Visa']);
  eq('400 -> panel van mo, nut mo lai', [h.open(), h.el('co-pay-save-card').disabled], [true, false]);
  h = setup({ post: () => ({ ok: false, status: 500, json: async () => ({ message: 'internal detail' }) }) }); await h.login();
  h.select('visa'); h.fillCard(PAN_VISA); h.click('co-pay-save-card'); await wait();
  eq('500 -> thong bao chung, khong lo message', h.el('co-pay-err').textContent, 'co.paySaveErr');
  h = setup({ patch: () => ({ ok: false, status: 401, json: async () => ({}) }) }); await h.login();
  h.select('momo'); h.el('co-pay-phone').value = '0901234567'; h.click('co-pay-save-phone'); await wait();
  eq('PATCH 401 -> login', h.win.location.href, 'login.html?redirect=checkout');

  // ---- Lỗi tải + Thử lại ----
  let failing = true;
  h = setup({ failLoad: () => failing }); await h.login();
  h.select('visa');
  eq('tai loi -> panel bao loi + nut Thu lai', [h.open(), h.el('co-pay-status').textContent, h.el('co-pay-retry').hidden], [true, 'co.payLoadErr', false]);
  eq('tai loi -> isReady=false', h.ready(), false);
  failing = false;
  h.click('co-pay-retry'); await wait();
  eq('Thu lai thanh cong -> hien khoi the', [h.el('co-pay-retry').hidden, h.el('co-pay-card').hidden, h.el('co-pay-status').textContent], [true, false, '']);

  // ---- Back/Forward: radio được khôi phục mà không có 'change' ----
  h = setup(); await h.login();
  h.radios[0].checked = true;          // trình duyệt tự tick lại, không bắn change
  eq('truoc pageshow chua danh gia', h.open(), false);
  h.win._l.pageshow();
  eq('pageshow -> danh gia lai radio da tick', h.open(), true);

  // ---- Đổi ngôn ngữ ----
  h = setup(); await h.login(); h.select('visa');
  h.fillCard(PAN_MC); h.click('co-pay-save-card'); await wait();
  h.lang.prefix = 'EN:'; h.doc.fire('langchange');
  eq('langchange: dich lai tieu de, loi, nut', [h.el('co-pay-panel-title').textContent, h.el('co-pay-number-err').textContent, h.el('co-pay-save-card').textContent],
    ['EN:co.payTitleVisa', 'EN:co.payErrBrandVisa', 'EN:co.paySaveCard']);

  // ---- refresh() ----
  h = setup(); await h.login(); h.select('visa');
  h.db.cards.push({ id: 3, brand: 'visa', last4: '1111', exp_month: 12, exp_year: CUR.y + 1 });
  eq('refresh() -> Promise<true> khi da co the moi', await h.win.BreezeCheckoutPayment.refresh(), true);
  eq('refresh() -> dong panel', h.open(), false);

  // ---- Có animation: đóng thì inert ngay, hidden sau ≤200ms ----
  h = setup({ motion: true }); await h.login(); h.select('visa');
  eq('mo: khong inert', [h.panel.inert, h.panel.getAttribute('inert')], [false, null]);
  h.select('cod');
  eq('dang dong: inert ngay, chua hidden', [h.panel.inert, h.open(), h.panel.classList.contains('is-open')], [true, true, false]);
  await wait(230);
  eq('sau 200ms -> hidden', h.open(), false);
  h.select('visa'); h.select('cod'); await wait(60); h.select('visa'); await wait(230);
  eq('dong roi mo lai nhanh: hen gio cu khong an panel vua mo', [h.open(), h.panel.inert], [true, false]);
})();
