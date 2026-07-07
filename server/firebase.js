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

module.exports = { initFirebase, getAuth };
