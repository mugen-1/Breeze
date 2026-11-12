/* account-details.js — khối "Chi tiết tài khoản" dùng chung cho trang profile và
   section Hồ sơ của admin. Test logic thuần trên DOM giả. */
const fs = require('fs');
const path = require('path');
const { check, eq } = require('./helpers/assert');
const { load, wait } = require('./helpers/sandbox');
const { makeDoc } = require('./helpers/dom');

console.log('account-details.js');
// Bỏ comment trước khi soi mã: chú thích có nhắc chữ "innerHTML" để cảnh báo.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'account-details.js'), 'utf8').replace(/\/\/.*$/gm, '');
check('never writes innerHTML', !/innerHTML/.test(SRC));
check('sends no user id — only the 4 editable fields', /JSON\.stringify\(v\)/.test(SRC) && !/uid|user_id|firebase_uid/.test(SRC));

function setup(api) {
  const doc = makeDoc(), g = id => doc.getElementById(id);
  const calls = [];
  const r = load('account-details.js', {
    doc, deps: ['utils-i18n.js'],
    window: {
      __i18n: { current: 'vi', t: k => 'T:' + k },
      AuthHelper: {
        apiFetch(p, o) {
          calls.push({ p, method: (o && o.method) || 'GET', body: o && o.body });
          const res = typeof api === 'function' ? api(p, o) : (api || { ok: true, status: 200, body: {} });
          if (res instanceof Error) return Promise.reject(res);
          return Promise.resolve({ ok: res.ok !== false, status: res.status || 200,
            json: () => res.badJson ? Promise.reject(new Error('x')) : Promise.resolve(res.body === undefined ? {} : res.body) });
        }
      }
    }
  });
  return { doc, g, calls, AD: r.win.BreezeAccountDetails, log: r.log };
}

(async function () {
  const s = setup();
  const AD = s.AD;
  check('exports the shared API', ['nameOf', 'fmtDate', 'fill', 'fillFromFirebase', 'formValues', 'validate', 'save', 'init']
    .every(k => typeof AD[k] === 'function'));
  eq('reads no DOM while loading', Object.keys(s.doc._byId).length, 0);

  eq('nameOf: display_name first', AD.nameOf({ display_name: 'An', email: 'x@y.z' }), 'An');
  eq('nameOf: Firebase displayName', AD.nameOf({ displayName: 'Bình' }), 'Bình');
  eq('nameOf: falls back to part before @', AD.nameOf({ email: 'chi@example.test' }), 'chi');
  eq('nameOf: nothing -> pf.you', AD.nameOf({}), 'T:pf.you');
  eq('fmtDate: empty -> dash', AD.fmtDate(null), '—');
  eq('fmtDate: invalid -> dash', AD.fmtDate('not a date'), '—');
  check('fmtDate: valid date shows the year', AD.fmtDate('2026-10-01T08:30:00Z').includes('2026'));

  const evil = '<img src=x onerror=alert(1)>';
  AD.fill({ display_name: evil, email: 'a@b.c', created_at: null, last_login: '2026-11-01T01:02:03Z',
    phone: null, dob: '2000-02-29T00:00:00.000Z', gender: 'female', country: 'JP' });
  eq('fill: name via textContent (HTML stays text)', s.g('ad-name').textContent, evil);
  eq('fill: innerHTML never touched', s.g('ad-name').innerHTML, '');
  eq('fill: email', s.g('ad-email').textContent, 'a@b.c');
  eq('fill: missing created_at -> dash', s.g('ad-created').textContent, '—');
  check('fill: last login formatted', s.g('ad-last').textContent.includes('2026'));
  eq('fill: null phone -> empty input', s.g('ad-phone').value, '');
  eq('fill: ISO dob -> YYYY-MM-DD', s.g('ad-dob').value, '2000-02-29');
  eq('fill: gender + country', [s.g('ad-gender').value, s.g('ad-country').value], ['female', 'JP']);

  AD.fillFromFirebase({ displayName: 'FB', email: 'fb@x.y' });
  eq('fillFromFirebase: name + email only', [s.g('ad-name').textContent, s.g('ad-email').textContent], ['FB', 'fb@x.y']);

  eq('validate: bad phone', AD.validate({ phone: 'abc!!' }), 'T:pf.errPhone');
  eq('validate: future dob', AD.validate({ phone: '', dob: '2999-01-01' }), 'T:pf.errDobFuture');
  eq('validate: valid', AD.validate({ phone: '+84 912-345 678', dob: '1999-12-31' }), null);

  // ---- save / init ----
  const notes = [], saved = [];
  const opts = { notify: (m, ok) => notes.push([m, ok]), onSaved: u => saved.push(u) };
  AD.init(opts);
  eq('init: dob max = today', s.g('ad-dob').max, new Date().toISOString().slice(0, 10));
  const btn = s.g('ad-save');
  btn.textContent = 'Lưu thay đổi';

  s.g('ad-phone').value = 'abc!!!';
  btn.fire('click'); await wait();
  check('invalid phone: no request, error notice', s.calls.length === 0 && notes[0][0] === 'T:pf.errPhone' && notes[0][1] === false);

  s.g('ad-phone').value = '  0912 345 678  '; s.g('ad-dob').value = '2000-02-29';
  s.g('ad-gender').value = 'female'; s.g('ad-country').value = 'JP';
  const reply = { id: 1, email: 'a@b.c', phone: '0912 345 678' };
  const s2 = setup({ ok: true, status: 200, body: reply });
  ['ad-phone', 'ad-dob', 'ad-gender', 'ad-country'].forEach(id => { s2.g(id).value = s.g(id).value; });
  const notes2 = [], saved2 = [];
  s2.AD.init({ notify: (m, ok) => notes2.push([m, ok]), onSaved: u => saved2.push(u) });
  const b2 = s2.g('ad-save'); b2.textContent = 'Lưu thay đổi';
  b2.fire('click');
  check('while saving: button disabled + "saving" label', b2.disabled === true && b2.textContent === 'T:pf.saving');
  b2.fire('click');   // bấm dồn
  await wait();
  eq('double click sends ONE request', s2.calls.length, 1);
  eq('PUT /api/me', [s2.calls[0].method, s2.calls[0].p], ['PUT', '/api/me']);
  eq('body has exactly the 4 fields, phone trimmed', JSON.parse(s2.calls[0].body),
    { phone: '0912 345 678', dob: '2000-02-29', gender: 'female', country: 'JP' });
  check('success: onSaved gets server reply, then success notice', saved2[0] === reply || JSON.stringify(saved2[0]) === JSON.stringify(reply));
  eq('success notice', notes2[notes2.length - 1], ['T:pf.savedChanges', undefined]);
  check('button restored after save', b2.disabled === false && b2.textContent === 'Lưu thay đổi');

  async function outcome(res) {
    const x = setup(res); const n = [];
    x.AD.init({ notify: (m, ok) => n.push([m, ok]) });
    x.g('ad-save').fire('click'); await wait();
    return { n, x };
  }
  let o = await outcome({ ok: false, status: 401, body: {} });
  eq('401: silent (authexpired handles it)', o.n.length, 0);
  o = await outcome({ ok: false, status: 400, body: { message: 'Số điện thoại không hợp lệ' } });
  eq('400: shows server message as error', o.n[0], ['Số điện thoại không hợp lệ', false]);
  o = await outcome({ ok: false, status: 500, badJson: true });
  eq('500 without JSON: generic error', o.n[0], ['T:pf.errSaveChanges', false]);
  o = await outcome(new Error('offline'));
  eq('network error: generic error', o.n[0], ['T:pf.errSaveChanges', false]);
  check('network error is logged', o.x.log.some(l => l[0] === 'console.error'));
  o = await outcome({ ok: true, status: 200, body: { email: 'z@z.z', phone: '0909' } });
  eq('default onSaved = fill', o.x.g('ad-phone').value, '0909');
})();
