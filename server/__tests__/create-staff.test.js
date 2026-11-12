'use strict';

// db/create-staff.js — Firebase, SQL và terminal đều là bản giả tiêm vào run(); KHÔNG tạo
// tài khoản thật. Mọi test kiểm thêm: mật khẩu tự nhập không xuất hiện trong bất kỳ dòng in nào.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const realSql = require('mssql');
const staff = require('../db/create-staff');
const { parseArgs, generatePassword, passwordWarnings, promptHidden, run, WEAK_WARNING } = staff;

const STRONG = 'Tq7#vLx9!mW2pRz';
const result = (rows = []) => ({ recordset: rows, rowsAffected: [rows.length] });

function world(opts = {}) {
  const st = { fbUsers: new Map(opts.fbUsers || []), sqlRows: (opts.sqlRows || []).map(r => ({ ...r })), events: [], queries: [] };
  const auth = {
    async getUserByEmail(email) {
      st.events.push('fb:lookup');
      if (opts.lookupError) throw Object.assign(new Error('PRIVATE'), { code: opts.lookupError });
      if (st.fbUsers.has(email)) return { uid: st.fbUsers.get(email) };
      throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
    },
    async createUser(p) {
      st.events.push('fb:create'); st.created = p;
      if (opts.createError) throw Object.assign(new Error('PRIVATE ' + p.password), { code: opts.createError });
      st.fbUsers.set(p.email, 'uid-new'); return { uid: 'uid-new' };
    },
    async deleteUser(uid) {
      st.events.push('fb:delete:' + uid);
      if (opts.deleteError) throw Object.assign(new Error('PRIVATE'), { code: opts.deleteError });
      st.fbUsers.forEach((v, k) => { if (v === uid) st.fbUsers.delete(k); });
    },
  };
  class Transaction {
    async begin() { st.events.push('tx:begin'); }
    async commit() { st.events.push('tx:commit'); }
    async rollback() { st.events.push('tx:rollback'); }
  }
  class Request {
    constructor(tx) { this.tx = tx; this.p = {}; }
    input(n, t, v) { this.p[n] = v; return this; }
    async query(raw) {
      const q = raw.replace(/\s+/g, ' ').trim(), p = this.p;
      st.queries.push({ q, p, tx: !!this.tx });
      const same = r => String(r.email).toLowerCase() === String(p.email).toLowerCase();
      if (q.startsWith('SELECT TOP 1 id, role FROM dbo.users WHERE LOWER(email) = LOWER(@email)')) return result(st.sqlRows.filter(same));
      if (q.startsWith('SELECT TOP 1 id FROM dbo.users WITH (UPDLOCK, HOLDLOCK) WHERE LOWER(email) = LOWER(@email) AND firebase_uid <> @uid')) {
        if (opts.raceRow) return result([{ id: 77 }]);
        return result(st.sqlRows.filter(r => same(r) && r.firebase_uid !== p.uid));
      }
      if (q.startsWith('MERGE dbo.users')) {
        if (opts.mergeError) throw Object.assign(new Error('PRIVATE SQL'), { code: 'EREQUEST' });
        const row = { id: 501, firebase_uid: p.uid, email: p.email, display_name: p.displayName, role: opts.mergeRole || 'staff' };
        st.sqlRows.push(row); return result([row]);
      }
      throw new Error('Unexpected SQL: ' + q);
    }
  }
  const pool = { request: () => new Request(null) };
  const sql = { ...realSql, Transaction, Request };
  const lines = { out: [], err: [], warn: [] };
  const answers = [...(opts.typed || [])];
  const io = {
    out: l => lines.out.push(l), err: l => lines.err.push(l), warn: l => lines.warn.push(l),
    promptHidden: async q => { st.events.push('prompt'); if (opts.noTty) throw new staff.StaffError('NO_TTY', 'Cần terminal'); return answers.shift(); },
    confirm: async q => { st.events.push('confirm'); return opts.confirm === true; },
  };
  const deps = { auth, pool, sql, adminEmails: new Set(opts.admins || []) };
  return { st, deps, io, lines, all: () => [...lines.out, ...lines.err, ...lines.warn].join('\n'),
    go: argv => run(argv, deps, io) };
}

// ---- Tham số ----
test('parseArgs: chuẩn hoá email chữ thường, giữ tên có dấu cách', () => {
  assert.deepEqual(parseArgs(['  NV.A@Example.Test ', ' Nguyễn Văn A ']), { email: 'nv.a@example.test', displayName: 'Nguyễn Văn A', askPassword: false });
  assert.equal(parseArgs(['a@b.vn', 'Tên', '--password']).askPassword, true);
  assert.equal(parseArgs(['--password', 'a@b.vn', 'Tên']).askPassword, true);
});
test('parseArgs: KHÔNG nhận mật khẩu qua tham số, và không in lại giá trị đó', () => {
  for (const argv of [['a@b.vn', 'Tên', '--password=Secret123'], ['a@b.vn', 'Tên', '--password:Secret123'],
    ['a@b.vn', 'Tên', '-pSecret123'], ['a@b.vn', 'Tên', '-p', 'Secret123']]) {
    assert.throws(() => parseArgs(argv), e => e.code === 'PASSWORD_ARG' && !e.message.includes('Secret123'), argv.join(' '));
  }
  // Mật khẩu kèm sau --password bị coi là tham số thừa -> từ chối, không in ra.
  assert.throws(() => parseArgs(['a@b.vn', 'Tên', '--password', 'Secret123']), e => e.code === 'USAGE' && !e.message.includes('Secret123'));
});
test('parseArgs: thiếu/thừa tham số, email sai, tên rỗng/quá dài, cờ lạ', () => {
  assert.throws(() => parseArgs([]), e => e.code === 'USAGE');
  assert.throws(() => parseArgs(['a@b.vn']), e => e.code === 'USAGE');
  assert.throws(() => parseArgs(['a@b.vn', 'Nguyễn', 'Văn']), e => e.code === 'USAGE' && /ngoặc kép/.test(e.message));
  assert.throws(() => parseArgs(['MatKhau@123', 'Tên']), e => e.code === 'BAD_EMAIL' && !e.message.includes('MatKhau@123'));
  assert.throws(() => parseArgs(['a@b.vn', '   ']), e => e.code === 'BAD_NAME');
  assert.throws(() => parseArgs(['a@b.vn', 'x'.repeat(151)]), e => e.code === 'BAD_NAME');
  assert.throws(() => parseArgs(['a@b.vn', 'Tên', '--force']), e => e.code === 'USAGE');
});

// ---- Mật khẩu ----
test('generatePassword: >= 16 ký tự (20), đủ 4 nhóm, không ký tự dễ nhầm, mỗi lần khác nhau', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = generatePassword();
    assert.equal(p.length, 20);
    assert.match(p, /[a-z]/); assert.match(p, /[A-Z]/); assert.match(p, /[0-9]/); assert.match(p, /[!#$%&*+\-=?@_]/);
    assert.doesNotMatch(p, /[0O1lIo]/);
    assert.deepEqual(passwordWarnings(p), [], 'mật khẩu sinh ra không bị coi là yếu');
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});
test('passwordWarnings: ngắn, phổ biến, lặp, dãy liên tiếp, chứa email/tên; mạnh thì rỗng', () => {
  assert.deepEqual(passwordWarnings(STRONG, { email: 'nv@example.test', displayName: 'Nhân Viên' }), []);
  assert.ok(passwordWarnings('Abc#123x').some(r => /ngắn hơn 12/.test(r)));
  for (const p of ['password123', 'Password123', 'QWERTY123', 'breeze@123', 'matkhau123', 'qwerty123456',
    'Password2026!!', 'Breeze@2026#', 'Welcome!123456', 'Admin@123456']) {
    assert.ok(passwordWarnings(p).some(r => /phổ biến/.test(r)), p);
  }
  assert.ok(passwordWarnings('123456789012').some(r => /liên tiếp/.test(r)));
  assert.ok(passwordWarnings('aaaaaaaaaaaaaa').some(r => /lặp/.test(r)));
  assert.ok(passwordWarnings('1234567890123').some(r => /liên tiếp/.test(r)));
  assert.ok(passwordWarnings('qwertyuiopasdf').some(r => /liên tiếp/.test(r)));
  assert.ok(passwordWarnings('xx-nhanvien.a-2026!', { email: 'nhanvien.a@x.vn' }).some(r => /email hoặc tên/.test(r)));
  assert.ok(passwordWarnings('Truc!Nguyen#2026x', { displayName: 'Nguyen Truc' }).some(r => /email hoặc tên/.test(r)));
});

// ---- Luồng chính ----
test('mặc định: sinh mật khẩu, tạo Firebase (emailVerified) + dbo.users role staff, in mật khẩu ĐÚNG 1 lần', async () => {
  const w = world();
  assert.equal(await w.go(['NV@Example.test', 'Nhân Viên A']), 0);
  const pw = w.st.created.password;
  assert.deepEqual({ ...w.st.created, password: '*' }, { email: 'nv@example.test', password: '*', displayName: 'Nhân Viên A', emailVerified: true });
  assert.equal(pw.length >= 16, true);
  assert.equal(w.all().split(pw).length - 1, 1, 'mật khẩu sinh ra in đúng 1 lần');
  assert.deepEqual(w.st.events, ['fb:lookup', 'fb:create', 'tx:begin', 'tx:commit']);
  const merge = w.st.queries.find(x => x.q.startsWith('MERGE'));
  assert.ok(merge.tx, 'MERGE chạy trong transaction');
  assert.match(merge.q, /INSERT \(firebase_uid, email, display_name, role\) VALUES \(@uid, @email, @displayName, 'staff'\)/);
  assert.deepEqual(merge.p, { uid: 'uid-new', email: 'nv@example.test', displayName: 'Nhân Viên A' });
  assert.ok(w.st.queries.findIndex(x => /WITH \(UPDLOCK, HOLDLOCK\)/.test(x.q)) < w.st.queries.indexOf(merge), 'khoá + kiểm trùng trước MERGE');
  assert.match(w.all(), /Hồ sơ -> Mật khẩu "Đổi"/);
  assert.match(w.all(), /Cloudflare Tunnel/);
  assert.deepEqual(w.lines.err, []);
});
test('--password: nhập ẩn 2 lần, mật khẩu KHÔNG bao giờ in ra', async () => {
  const w = world({ typed: [STRONG, STRONG] });
  assert.equal(await w.go(['nv@example.test', 'NV', '--password']), 0);
  assert.equal(w.st.created.password, STRONG);
  assert.equal(w.st.events.filter(e => e === 'prompt').length, 2);
  assert.ok(!w.all().includes(STRONG), 'không in mật khẩu tự nhập');
  assert.match(w.all(), /do bạn tự nhập — không in ra/);
  assert.deepEqual(w.lines.warn, [], 'mật khẩu mạnh -> không cảnh báo, không hỏi');
  assert.ok(!w.st.events.includes('confirm'));
});
test('--password: hai lần không khớp -> dừng, không tạo gì', async () => {
  const w = world({ typed: [STRONG, STRONG + 'x'] });
  assert.equal(await w.go(['nv@example.test', 'NV', '--password']), 1);
  assert.ok(!w.st.events.includes('fb:create'));
  assert.match(w.lines.err.join(), /không khớp/);
  assert.ok(!w.all().includes(STRONG));
});
test('--password: < 6 ký tự (Firebase) -> từ chối luôn, không hỏi y/N', async () => {
  const w = world({ typed: ['Ab1!x', 'Ab1!x'] });
  assert.equal(await w.go(['nv@example.test', 'NV', '--password']), 1);
  assert.ok(!w.st.events.includes('confirm') && !w.st.events.includes('fb:create'));
  assert.ok(!w.all().includes('Ab1!x'));
});
for (const weak of ['Abc#12345x', 'password1234', 'breeze@123']) {
  test('--password yếu "' + weak.length + ' ký tự": cảnh báo vàng + y/N; N (mặc định) -> không tạo', async () => {
    const w = world({ typed: [weak, weak], confirm: false });
    assert.equal(await w.go(['nv@example.test', 'NV', '--password']), 1);
    assert.equal(w.lines.warn.length, 1);
    assert.ok(w.lines.warn[0].includes(WEAK_WARNING), 'đúng câu: ' + WEAK_WARNING);
    assert.equal(WEAK_WARNING, 'chỉ dùng local, đổi trước khi public qua Cloudflare');
    assert.ok(!w.st.events.includes('fb:create'));
    assert.ok(!w.all().includes(weak), 'cảnh báo không lặp lại mật khẩu');
  });
}
test('--password yếu + trả lời y -> vẫn tạo, mật khẩu không in ra', async () => {
  const w = world({ typed: ['Abc#12345x', 'Abc#12345x'], confirm: true });
  assert.equal(await w.go(['nv@example.test', 'NV', '--password']), 0);
  assert.equal(w.st.created.password, 'Abc#12345x');
  assert.ok(!w.all().includes('Abc#12345x'));
});
test('--password không có terminal (pipe) -> từ chối, không tạo', async () => {
  const w = world({ noTty: true });
  assert.equal(await w.go(['nv@example.test', 'NV', '--password']), 1);
  assert.ok(!w.st.events.includes('fb:create'));
});

test('email trong ADMIN_EMAILS -> từ chối TRƯỚC mọi thao tác Firebase/SQL', async () => {
  const w = world({ admins: ['boss@example.test'], typed: [STRONG, STRONG] });
  assert.equal(await w.go(['Boss@Example.TEST', 'Sếp', '--password']), 1);
  assert.deepEqual([w.st.events, w.st.queries], [[], []]);
  assert.match(w.lines.err.join(), /ADMIN_EMAILS/);
});
test('email đã có trong dbo.users (khác hoa/thường) -> từ chối trước khi hỏi mật khẩu, so LOWER(email)', async () => {
  const w = world({ sqlRows: [{ id: 12, email: 'NV@EXAMPLE.TEST', role: 'customer', firebase_uid: 'old' }], typed: [STRONG, STRONG] });
  assert.equal(await w.go(['nv@example.test', 'NV', '--password']), 1);
  assert.match(w.st.queries[0].q, /WHERE LOWER\(email\) = LOWER\(@email\)/);
  assert.deepEqual(w.st.events, [], 'không hỏi mật khẩu, không đụng Firebase');
  assert.match(w.lines.err.join(), /id 12, role customer.*set-role\.js/);
});
test('email đã có trên Firebase -> từ chối, không ghi đè, không hỏi mật khẩu', async () => {
  const w = world({ fbUsers: [['nv@example.test', 'uid-old']], typed: [STRONG, STRONG] });
  assert.equal(await w.go(['nv@example.test', 'NV', '--password']), 1);
  assert.deepEqual(w.st.events, ['fb:lookup']);
});
test('Firebase báo email đã tồn tại lúc tạo (đua) -> từ chối, không ghi SQL', async () => {
  const w = world({ createError: 'auth/email-already-exists' });
  assert.equal(await w.go(['nv@example.test', 'NV']), 1);
  assert.ok(!w.st.events.includes('tx:begin'));
  assert.match(w.lines.err.join(), /không ghi đè/);
});
test('lỗi tra cứu Firebase khác user-not-found -> dừng, không tạo', async () => {
  const w = world({ lookupError: 'auth/internal-error' });
  assert.equal(await w.go(['nv@example.test', 'NV']), 1);
  assert.deepEqual(w.st.events, ['fb:lookup']);
  assert.match(w.lines.err.join(), /auth\/internal-error/);
});
test('lỗi tạo Firebase không làm lộ mật khẩu (message SDK không được in)', async () => {
  const w = world({ createError: 'auth/invalid-password', typed: [STRONG, STRONG] });
  assert.equal(await w.go(['nv@example.test', 'NV', '--password']), 1);
  assert.ok(!w.all().includes(STRONG) && !w.all().includes('PRIVATE'));
});

test('ghi SQL lỗi -> rollback + XOÁ user Firebase vừa tạo', async () => {
  const w = world({ mergeError: true });
  assert.equal(await w.go(['nv@example.test', 'NV']), 1);
  assert.deepEqual(w.st.events, ['fb:lookup', 'fb:create', 'tx:begin', 'tx:rollback', 'fb:delete:uid-new']);
  assert.equal(w.st.fbUsers.size, 0);
  assert.match(w.lines.err.join(), /Đã xoá user Firebase vừa tạo/);
  assert.ok(!w.all().includes(w.st.created.password), 'thất bại thì không in mật khẩu sinh ra');
  assert.ok(!w.all().includes('PRIVATE'));
});
test('email xuất hiện trong dbo.users giữa chừng (đua) -> rollback + xoá Firebase', async () => {
  const w = world({ raceRow: true });
  assert.equal(await w.go(['nv@example.test', 'NV']), 1);
  assert.ok(w.st.events.includes('fb:delete:uid-new'));
  assert.ok(!w.st.queries.some(x => x.q.startsWith('MERGE')));
});
test('MERGE trả role khác staff -> coi là lỗi, rollback + xoá Firebase', async () => {
  const w = world({ mergeRole: 'customer' });
  assert.equal(await w.go(['nv@example.test', 'NV']), 1);
  assert.deepEqual(w.st.events.slice(-2), ['tx:rollback', 'fb:delete:uid-new']);
});
test('SQL lỗi VÀ xoá Firebase cũng lỗi -> CRITICAL kèm UID/email để xoá tay', async () => {
  const w = world({ mergeError: true, deleteError: 'auth/internal-error' });
  assert.equal(await w.go(['nv@example.test', 'NV']), 1);
  assert.match(w.lines.err.join(), /^CRITICAL: .*UID uid-new, email nv@example\.test/);
  assert.ok(!w.all().includes(w.st.created.password));
});

// ---- Nhập ẩn trên terminal ----
function fakeTty(isTTY = true) {
  const stdin = new EventEmitter(), writes = [];
  Object.assign(stdin, { isTTY, raw: [], setRawMode(v) { stdin.raw.push(v); }, setEncoding() {}, resume() {}, pause() {} });
  return { stdin, stdout: { write: s => writes.push(s) }, writes };
}
test('promptHidden: không in ký tự nào (kể cả *), xử lý backspace, Enter, raw mode bật/tắt', async () => {
  const t = fakeTty();
  const p = promptHidden('MK: ', t);
  t.stdin.emit('data', 'abX'); t.stdin.emit('data', '\b'); t.stdin.emit('data', '\u007fc'); t.stdin.emit('data', 'd\r');
  assert.equal(await p, 'acd');
  assert.deepEqual(t.writes, ['MK: ', '\n']);
  assert.deepEqual(t.stdin.raw, [true, false]);
  assert.equal(t.stdin.listenerCount('data'), 0);
});
test('promptHidden: Ctrl+C huỷ; không phải TTY -> từ chối (không đọc từ pipe)', async () => {
  const t = fakeTty();
  const p = promptHidden('MK: ', t);
  t.stdin.emit('data', 'abc\u0003');
  await assert.rejects(p, e => e.code === 'ABORTED');
  assert.deepEqual(t.stdin.raw, [true, false]);
  await assert.rejects(promptHidden('MK: ', fakeTty(false)), e => e.code === 'NO_TTY');
});

test('tham số sai -> báo lỗi TRƯỚC khi kết nối SQL/Firebase', async () => {
  const w = world();
  let connected = 0;
  for (const argv of [[], ['a@b.vn', 'Tên', '--password=x'], ['sai-email', 'Tên']]) {
    assert.equal(await run(argv, async () => { connected++; return w.deps; }, w.io), 1);
  }
  assert.equal(connected, 0);
  // --password trong môi trường không có terminal (pipe, CI) -> dừng trước khi kết nối.
  assert.equal(await run(['nv@example.test', 'NV', '--password'], async () => { connected++; return w.deps; }, { ...w.io, interactive: false }), 1);
  assert.equal(connected, 0);
  assert.match(w.lines.err.at(-1), /terminal tương tác/);
  assert.equal(await run(['nv@example.test', 'NV'], async () => { connected++; return w.deps; }, w.io), 0);
  assert.equal(connected, 1);
});
test('require script KHÔNG tự chạy (chỉ chạy khi gọi trực tiếp bằng node)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'db', 'create-staff.js'), 'utf8');
  assert.match(src, /if \(require\.main === module\) \{\s*main\(\)/);
  assert.doesNotMatch(src.split('async function main()')[0], /require\('dotenv'\)|require\('\.\.\/db'\)|require\('\.\.\/firebase'\)/,
    'dotenv/db/firebase chỉ nạp trong main()');
});
test('adminEmailSet export từ middleware/auth.js (cùng một cách đọc ADMIN_EMAILS)', () => {
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = ' Boss@Example.test , ,b@x.vn';
  try { assert.deepEqual([...require('../middleware/auth').adminEmailSet()], ['boss@example.test', 'b@x.vn']); }
  finally { if (saved === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = saved; }
});
