const { eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { El, makeDoc } = require('./helpers/dom');
(async () => {
  const doc = makeDoc();
  doc.getElementById('voucher-block').querySelector = () => El('div');
  const r = load('voucher.js', { deps: ['utils-i18n.js'], doc,
    globals: { sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} } },
    window: { __i18n: { t: key => key }, AuthHelper: { onChange() {},
      apiFetch: async () => ({ status: 200, json: async () => ({ valid: true,
        code: 'GIAMGIALANDAU', discountAmount: 15000, subtotal: 100000, total: 85000 }) }) } } });
  doc.fire('checkout:summary', { detail: { subtotal: 100000, ship: 20000 } });
  doc.getElementById('voucher-code').value = 'GIAMGIALANDAU';
  doc.getElementById('voucher-apply').click(); await wait();
  eq('voucher discount + STANDARD shipping', doc.getElementById('co-oi-total').textContent, '105.000₫');
  doc.fire('checkout:summary', { detail: { subtotal: 100000, ship: 35000 } });
  eq('fee refresh retains item-only voucher', doc.getElementById('co-oi-total').textContent, '120.000₫');
  r.win.BreezeVoucher.clear();
  eq('removing voucher retains shipping fee', doc.getElementById('co-oi-total').textContent, '135.000₫');
})().catch(e => { console.error(e); process.exitCode = 1; });
