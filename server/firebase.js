// Khởi tạo Firebase Admin SDK (đọc service account từ FIREBASE_SERVICE_ACCOUNT).
// firebase-admin v14 dùng API modular (firebase-admin/app, firebase-admin/auth).
// Khởi tạo lười (lazy) + idempotent: gọi bao nhiêu lần cũng chỉ init 1 lần.
const path = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth: adminGetAuth } = require('firebase-admin/auth');

let app = null;

function initFirebase() {
  if (app) return app;
  if (getApps().length) {
    app = getApps()[0];
    return app;
  }

  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT || './firebase-service-account.json';
  // Resolve tương đối so với thư mục server/ (không phụ thuộc cwd).
  const resolved = path.isAbsolute(saPath) ? saPath : path.resolve(__dirname, saPath);

  // require sẽ ném lỗi rõ ràng nếu file không tồn tại / sai JSON.
  const serviceAccount = require(resolved);

  app = initializeApp({ credential: cert(serviceAccount) });

  console.log('[firebase] Admin SDK initialized (project:', serviceAccount.project_id + ')');
  return app;
}

// Trả về Auth service, đảm bảo đã init.
function getAuth() {
  initFirebase();
  return adminGetAuth();
}

// Verify mật khẩu của user qua Identity Toolkit REST API.
// Admin SDK KHÔNG verify được password (đó là thao tác phía client), nên phải gọi
// endpoint accounts:signInWithPassword bằng Firebase Web API key (public — cùng key
// trong client/js/firebase-config.js). returnSecureToken:false để không nhận token thừa.
// Trả: { ok:true } nếu đúng; { ok:false, reason } nếu sai/hết lượt/không xác định.
//   reason có thể: 'INVALID_PASSWORD' | 'INVALID_LOGIN_CREDENTIALS' | 'EMAIL_NOT_FOUND'
//                | 'TOO_MANY_ATTEMPTS_TRY_LATER' | '' (không rõ)
async function verifyPassword(email, password) {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) throw new Error('FIREBASE_WEB_API_KEY chưa được cấu hình trong .env');
  if (!email) return { ok: false, reason: 'EMAIL_NOT_FOUND' };

  const url =
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' +
    encodeURIComponent(apiKey);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: false }),
  });
  if (resp.ok) return { ok: true };

  let reason = '';
  try {
    const j = await resp.json();
    reason = (j && j.error && j.error.message) || '';
  } catch (e) { /* body không phải JSON — bỏ qua */ }
  return { ok: false, reason };
}

module.exports = { initFirebase, getAuth, verifyPassword };
