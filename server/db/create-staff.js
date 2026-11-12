'use strict';
// Tạo tài khoản NHÂN VIÊN (role 'staff'): Firebase Auth + dbo.users trong một lệnh.
//
// Usage (chạy trong server/):
//   node db/create-staff.js <email> "<Tên hiển thị>"              -> sinh mật khẩu ngẫu nhiên, in ĐÚNG 1 lần
//   node db/create-staff.js <email> "<Tên hiển thị>" --password   -> tự nhập mật khẩu (ẩn ký tự, nhập 2 lần)
//
// - KHÔNG nhận mật khẩu qua tham số dòng lệnh / stdin pipe: lộ vào lịch sử shell và danh sách
//   tiến trình. --password bắt buộc terminal tương tác (PowerShell, cmd, terminal VS Code;
//   Git Bash/mintty: chạy `winpty node db/create-staff.js ...`).
// - Mật khẩu tự nhập KHÔNG bao giờ được in ra màn hình hay log.
// - Từ chối: email trong ADMIN_EMAILS; email đã có trên Firebase; email đã có trong dbo.users
//   (so LOWER(email), không phân biệt hoa thường).
// - Ghi SQL lỗi sau khi đã tạo Firebase -> xoá user Firebase vừa tạo (không để lần đăng nhập
//   đầu tự tạo dòng role 'customer').
// Đổi role tài khoản ĐÃ CÓ thì dùng db/set-role.js.
const crypto = require('crypto');

const MIN_FIREBASE = 6;    // Firebase Auth từ chối mật khẩu ngắn hơn
const MIN_STRONG = 12;     // ngắn hơn -> cảnh báo, hỏi y/N
const GENERATED_LENGTH = 20;
const MAX_NAME = 150;      // dbo.users.display_name NVARCHAR(150)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEAK_WARNING = 'chỉ dùng local, đổi trước khi public qua Cloudflare';
// Mật khẩu phổ biến (so chữ thường). Không cần đầy đủ — mục đích là chặn lỡ tay đặt mật khẩu dễ đoán.
const COMMON = new Set(['123456', '1234567', '12345678', '123456789', '1234567890', '12345678910', '111111', '000000',
  '123123', '654321', '666666', '888888', '987654321', '112233', '121212', 'password', 'password1', 'password12',
  'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'qwerty', 'qwerty123', 'qwertyuiop', 'qwerty123456', 'asdfgh',
  'asdfghjkl', 'zxcvbnm', '1qaz2wsx', 'qazwsx', 'abc123', 'abc12345', 'abcd1234', 'a123456', '123456a', 'iloveyou',
  'iloveyou1', 'admin', 'admin123', 'admin@123', 'administrator', 'welcome', 'welcome1', 'welcome123', 'letmein',
  'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'superman', 'batman', 'trustno1', 'master',
  'changeme', 'default', 'secret', 'matkhau', 'matkhau123', 'matkhau@123', 'breeze', 'breeze123', 'breeze@123',
  'breezeshop', 'nhanvien', 'nhanvien123', 'staff123', 'staff@123']);
const LOWER = 'abcdefghijkmnpqrstuvwxyz', UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ', DIGITS = '23456789', SYMBOLS = '!#$%&*+-=?@_';

class StaffError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; Object.assign(this, extra); }
}

// ---- Tham số dòng lệnh ------------------------------------------------------
function parseArgs(argv) {
  const usage = 'Usage: node db/create-staff.js <email> "<Tên hiển thị>" [--password]';
  const positional = [];
  let ask = false;
  for (const a of argv) {
    if (a === '--password') ask = true;
    else if (/^--password[=:]/i.test(a) || /^-p/.test(a)) {
      throw new StaffError('PASSWORD_ARG', 'Không nhận mật khẩu qua tham số dòng lệnh (lộ vào lịch sử shell). ' +
        'Dùng --password (không kèm giá trị) để nhập ẩn, rồi xoá dòng lệnh vừa gõ khỏi lịch sử shell.\n' + usage);
    } else if (a.startsWith('-')) throw new StaffError('USAGE', 'Tham số không hỗ trợ: ' + a + '\n' + usage);
    else positional.push(a);
  }
  if (positional.length < 2) throw new StaffError('USAGE', usage);
  if (positional.length > 2) {
    throw new StaffError('USAGE', 'Thừa tham số. Tên có dấu cách phải đặt trong ngoặc kép; mật khẩu KHÔNG truyền qua tham số.\n' + usage);
  }
  const email = positional[0].trim().toLowerCase();
  const displayName = positional[1].trim();
  // Không in lại giá trị: gõ nhầm thứ tự có thể đưa mật khẩu vào vị trí email.
  if (!EMAIL_RE.test(email) || email.length > 255) throw new StaffError('BAD_EMAIL', 'Email không hợp lệ (tham số thứ nhất).\n' + usage);
  if (!displayName || displayName.length > MAX_NAME) {
    throw new StaffError('BAD_NAME', 'Tên hiển thị phải có 1–' + MAX_NAME + ' ký tự');
  }
  return { email, displayName, askPassword: ask };
}

// ---- Mật khẩu -----------------------------------------------------------------
function pick(chars) { return chars[crypto.randomInt(chars.length)]; }
// 20 ký tự, đủ 4 nhóm (thường/HOA/số/ký hiệu), bỏ ký tự dễ nhầm (0 O o 1 l I).
function generatePassword(length = GENERATED_LENGTH) {
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const out = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (out.length < length) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

// Lý do mật khẩu yếu (rỗng = ổn). Chỉ trả lý do, KHÔNG trả lại mật khẩu.
function passwordWarnings(password, { email = '', displayName = '' } = {}) {
  const p = String(password), lower = p.toLowerCase(), reasons = [];
  if ([...p].length < MIN_STRONG) reasons.push('ngắn hơn ' + MIN_STRONG + ' ký tự');
  // Từ phổ biến + số/ký hiệu ở đuôi (Password2026!, breeze@123) cũng tính là phổ biến.
  const base = lower.replace(/[^a-z]+$/, '');
  if (COMMON.has(lower) || (base.length >= 4 && COMMON.has(base))) reasons.push('nằm trong danh sách mật khẩu phổ biến');
  else if (/^(.)\1+$/.test(p)) reasons.push('chỉ lặp một ký tự');
  else if ('01234567890123456789'.includes(lower) || '98765432109876543210'.includes(lower) ||
    'abcdefghijklmnopqrstuvwxyz'.includes(lower) || 'qwertyuiopasdfghjklzxcvbnm'.includes(lower)) reasons.push('là dãy ký tự liên tiếp');
  const local = String(email).split('@')[0].toLowerCase();
  const nameParts = String(displayName).toLowerCase().split(/\s+/).filter(w => w.length >= 4);
  if ((local.length >= 4 && lower.includes(local)) || nameParts.some(w => lower.includes(w))) reasons.push('chứa email hoặc tên');
  return reasons;
}

// ---- Nhập từ terminal ---------------------------------------------------------
// Ẩn hoàn toàn (không in '*' để không lộ độ dài). Cần TTY: pipe/redirect bị từ chối.
function promptHidden(question, { stdin = process.stdin, stdout = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new StaffError('NO_TTY', 'Cần terminal tương tác để nhập mật khẩu ẩn (không nhận qua pipe). ' +
        'Git Bash: chạy `winpty node db/create-staff.js ...`'));
      return;
    }
    stdout.write(question);
    let chars = [];
    const done = (err, value) => {
      stdin.removeListener('data', onData); stdin.setRawMode(false); stdin.pause(); stdout.write('\n');
      if (err) reject(err); else resolve(value);
    };
    function onData(chunk) {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') { done(null, chars.join('')); chars = []; return; }
        if (ch === '\u0003') { chars = []; done(new StaffError('ABORTED', 'Đã huỷ.')); return; }
        if (ch === '\u007f' || ch === '\b') chars.pop();
        else if (ch >= ' ') chars.push(ch);
      }
    }
    stdin.setRawMode(true); stdin.setEncoding('utf8'); stdin.resume(); stdin.on('data', onData);
  });
}

function promptLine(question, { stdin = process.stdin, stdout = process.stdout } = {}) {
  const rl = require('readline').createInterface({ input: stdin, output: stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function terminalIo() {
  const color = !!process.stdout.isTTY;
  return {
    interactive: !!process.stdin.isTTY && typeof process.stdin.setRawMode === 'function',
    out: line => process.stdout.write(line + '\n'),
    err: line => process.stderr.write(line + '\n'),
    warn: line => process.stdout.write((color ? '\x1b[33m' : '') + line + (color ? '\x1b[0m' : '') + '\n'),
    promptHidden: q => promptHidden(q),
    confirm: async q => /^(y|yes)$/i.test(String(await promptLine(q)).trim()),
  };
}

// Mật khẩu tự nhập: 2 lần khớp, >= 6 ký tự (Firebase), yếu -> cảnh báo vàng + hỏi y/N (mặc định N).
async function askPassword(io, who) {
  const first = await io.promptHidden('Mật khẩu (ẩn ký tự): ');
  const second = await io.promptHidden('Nhập lại mật khẩu: ');
  if (first !== second) throw new StaffError('PASSWORD_MISMATCH', 'Hai lần nhập mật khẩu không khớp. Không tạo tài khoản.');
  if ([...first].length < MIN_FIREBASE) {
    throw new StaffError('PASSWORD_TOO_SHORT', 'Mật khẩu phải có ít nhất ' + MIN_FIREBASE + ' ký tự (yêu cầu của Firebase). Không tạo tài khoản.');
  }
  const reasons = passwordWarnings(first, who);
  if (reasons.length) {
    io.warn('⚠ Mật khẩu yếu (' + reasons.join('; ') + '): ' + WEAK_WARNING + '.');
    if (!await io.confirm('Vẫn dùng mật khẩu này? (y/N): ')) throw new StaffError('PASSWORD_DECLINED', 'Đã huỷ — chưa tạo tài khoản nào.');
  }
  return first;
}

// ---- Firebase + SQL -----------------------------------------------------------
// Kiểm trước khi hỏi mật khẩu: không bắt người dùng gõ mật khẩu rồi mới báo trùng.
async function preflight({ auth, pool, sql, adminEmails }, email) {
  if (adminEmails.has(email)) {
    throw new StaffError('EMAIL_IS_ADMIN', 'Email nằm trong ADMIN_EMAILS — tài khoản này sẽ tự lên admin khi đăng nhập. Không tạo staff.');
  }
  const dup = await pool.request().input('email', sql.VarChar(255), email)
    .query('SELECT TOP 1 id, role FROM dbo.users WHERE LOWER(email) = LOWER(@email);');
  if (dup.recordset.length) {
    throw new StaffError('EMAIL_IN_DB', 'Email đã có trong dbo.users (id ' + dup.recordset[0].id + ', role ' +
      dup.recordset[0].role + '). Đổi role tài khoản có sẵn bằng db/set-role.js.');
  }
  try {
    await auth.getUserByEmail(email);
  } catch (err) {
    if (err && err.code === 'auth/user-not-found') return;
    throw new StaffError('FIREBASE_LOOKUP_FAILED', 'Không kiểm tra được email trên Firebase (' + safeCode(err) + ').');
  }
  throw new StaffError('EMAIL_IN_FIREBASE', 'Email đã có trên Firebase — không ghi đè. Đổi role bằng db/set-role.js nếu cần.');
}

function safeCode(err) {
  return err && typeof err.code === 'string' && /^[a-z0-9/_-]+$/i.test(err.code) ? err.code : 'unknown-error';
}

// Cùng cấu trúc upsertUser/syncUser của middleware/auth.js: khoá trong transaction rồi MERGE
// theo firebase_uid. Khác duy nhất: role = 'staff' và không đặt last_login (chưa đăng nhập).
async function upsertStaffRow(pool, sql, uid, email, displayName) {
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    // Khoá lại + kiểm trùng email lần nữa: có thể ai đó vừa đăng ký cùng email sau preflight.
    const clash = await new sql.Request(tx).input('email', sql.VarChar(255), email).input('uid', sql.VarChar(128), uid)
      .query('SELECT TOP 1 id FROM dbo.users WITH (UPDLOCK, HOLDLOCK) WHERE LOWER(email) = LOWER(@email) AND firebase_uid <> @uid;');
    if (clash.recordset.length) throw new StaffError('EMAIL_IN_DB', 'Email vừa xuất hiện trong dbo.users (id ' + clash.recordset[0].id + ').');
    const result = await new sql.Request(tx)
      .input('uid', sql.VarChar(128), uid)
      .input('email', sql.VarChar(255), email)
      .input('displayName', sql.NVarChar(150), displayName)
      .query(`
        MERGE dbo.users AS target
        USING (SELECT @uid AS firebase_uid) AS src
          ON target.firebase_uid = src.firebase_uid
        WHEN MATCHED THEN
          UPDATE SET email = @email, display_name = @displayName, role = 'staff'
        WHEN NOT MATCHED THEN
          INSERT (firebase_uid, email, display_name, role)
          VALUES (@uid, @email, @displayName, 'staff');

        SELECT id, firebase_uid, email, display_name, role
        FROM dbo.users
        WHERE firebase_uid = @uid;
      `);
    const row = result.recordset[0];
    if (!row || row.role !== 'staff') throw new StaffError('SQL_UNEXPECTED', 'Dòng dbo.users sau MERGE không phải role staff.');
    await tx.commit();
    return row;
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* chưa begin hoặc đã rollback */ }
    throw err;
  }
}

async function createStaff({ auth, pool, sql }, { email, displayName, password }) {
  let fbUser;
  try {
    fbUser = await auth.createUser({ email, password, displayName, emailVerified: true });
  } catch (err) {
    if (err && err.code === 'auth/email-already-exists') throw new StaffError('EMAIL_IN_FIREBASE', 'Email đã có trên Firebase — không ghi đè.');
    throw new StaffError('FIREBASE_CREATE_FAILED', 'Firebase không tạo được tài khoản (' + safeCode(err) + ').');
  }
  try {
    return { uid: fbUser.uid, row: await upsertStaffRow(pool, sql, fbUser.uid, email, displayName) };
  } catch (sqlErr) {
    const reason = sqlErr instanceof StaffError ? sqlErr.message : 'lỗi SQL (' + safeCode(sqlErr) + ')';
    try {
      await auth.deleteUser(fbUser.uid);
    } catch (delErr) {
      throw new StaffError('ROLLBACK_FAILED', 'CRITICAL: ghi dbo.users thất bại (' + reason + ') VÀ không xoá được user Firebase vừa tạo (' +
        safeCode(delErr) + '). Xoá tay trong Firebase Console > Authentication: UID ' + fbUser.uid + ', email ' + email + '.', { uid: fbUser.uid });
    }
    throw new StaffError('SQL_FAILED', 'Ghi dbo.users thất bại (' + reason + '). Đã xoá user Firebase vừa tạo — chưa có gì thay đổi.');
  }
}

// ---- Luồng chính ----------------------------------------------------------------
// Trả exit code. deps (object, hoặc hàm async trả object — chỉ gọi SAU khi tham số hợp lệ,
// để gõ sai lệnh không mở kết nối SQL/Firebase) và io tiêm từ ngoài để test.
async function run(argv, depsOrConnect, io) {
  try {
    const args = parseArgs(argv);
    if (args.askPassword && io.interactive === false) {
      throw new StaffError('NO_TTY', '--password cần terminal tương tác để nhập ẩn (không nhận qua pipe). ' +
        'Git Bash: chạy `winpty node db/create-staff.js ...`');
    }
    const deps = typeof depsOrConnect === 'function' ? await depsOrConnect() : depsOrConnect;
    await preflight(deps, args.email);
    const generated = !args.askPassword;
    const password = generated ? generatePassword() : await askPassword(io, args);
    const { uid, row } = await createStaff(deps, { ...args, password });
    io.out('');
    io.out('✔ Đã tạo tài khoản nhân viên (role staff).');
    io.out('  Email:         ' + row.email);
    io.out('  Tên hiển thị:  ' + row.display_name);
    io.out('  Firebase UID:  ' + uid);
    io.out('  dbo.users.id:  ' + row.id);
    if (generated) {
      io.out('');
      io.out('  Mật khẩu (CHỈ HIỆN 1 LẦN — lưu ngay vào trình quản lý mật khẩu, không gửi qua chat):');
      io.out('    ' + password);
    } else {
      io.out('  Mật khẩu:      (do bạn tự nhập — không in ra)');
    }
    io.out('');
    io.out('Bước tiếp:');
    io.out('  1. Đăng nhập ở login.html bằng email trên -> vào trang quản trị, thấy pill "Nhân viên".');
    io.out('  2. Đổi mật khẩu: trang quản trị -> bấm user card đáy menu trái -> Hồ sơ -> Mật khẩu "Đổi".');
    io.out('  3. Đổi mật khẩu staff TRƯỚC khi bật Cloudflare Tunnel (site public) — xem CHECKLIST-STAFF.md.');
    return 0;
  } catch (err) {
    if (err instanceof StaffError) io.err((err.code === 'ROLLBACK_FAILED' ? '' : 'LỖI: ') + err.message);
    else io.err('LỖI: ' + safeCode(err));   // không in message/stack lạ: có thể chứa dữ liệu nhạy cảm
    return 1;
  }
}

async function main() {
  return run(process.argv.slice(2), async () => {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
    const { getPool, sql } = require('../db');
    const { getAuth } = require('../firebase');
    const { adminEmailSet } = require('../middleware/auth');
    return { auth: getAuth(), pool: await getPool(), sql, adminEmails: adminEmailSet() };
  }, terminalIo());
}

if (require.main === module) {
  main().then(code => process.exit(code), err => {
    process.stderr.write('LỖI: ' + safeCode(err) + '\n');
    process.exit(1);
  });
}

module.exports = { parseArgs, generatePassword, passwordWarnings, promptHidden, askPassword, preflight,
  upsertStaffRow, createStaff, run, StaffError, WEAK_WARNING };
