// Breeze Shop API server.
// Bootstrapping step: Express app on port 3000 with a real SQL Server health check.
// Business logic (products, cart, orders, Firebase token verification) comes later.

// dotenv mặc định tìm .env theo THƯ MỤC ĐANG ĐỨNG lúc gõ lệnh, không theo vị trí
// file này. Chạy `node server/server.js` từ gốc repo sẽ nạp 0 biến, rồi lỗi mới bung
// ra tận db.js ("config.server property is required") — nhìn như SQL Server hỏng.
// Trỏ đường dẫn tuyệt đối để chạy từ đâu cũng đúng, và báo ngay tại đây nếu rỗng.
const ENV_PATH = require('path').join(__dirname, '.env');
const envResult = require('dotenv').config({ path: ENV_PATH });
if (Object.keys(envResult.parsed || {}).length === 0 && !process.env.DB_SERVER) {
  console.error(`[env] Không nạp được biến nào từ ${ENV_PATH}`);
  console.error('[env] Tạo file server/.env (copy từ server/.env.example) rồi chạy lại.');
  process.exit(1);
}

const path = require('path');
const express = require('express');
const { getPool, sql } = require('./db');
const { initFirebase } = require('./firebase');
const { cspNonce, logCspMode, buildCors, buildHelmet, buildApiLimiter, allowedOrigins } = require('./middleware/security');

const categoriesRouter = require('./routes/categories');
const productsRouter = require('./routes/products');
const meRouter = require('./routes/me');
const cartRouter = require('./routes/cart');
const ordersRouter = require('./routes/orders');
const vouchersRouter = require('./routes/vouchers');
const addressesRouter = require('./routes/addresses');
const paymentsRouter = require('./routes/payments');
const privacyRouter = require('./routes/privacy');
const accountRouter = require('./routes/account');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// --- EJS view engine ---------------------------------------------------------
// Master layout thay cho 21 file .html lặp header/drawer/footer. Route EJS được
// đăng ký TRƯỚC express.static (xem cuối file) và giữ nguyên URL '.html' cũ, nên
// 336 link tĩnh trong HTML không phải sửa và routes.js không phải đổi PATHS.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Hardening (Phase 5) -----------------------------------------------------
// helmet (security headers + CSP dùng nonce, BẬT THẬT — xem security.js),
// CORS whitelist (chỉ origin của client), body JSON giới hạn 100kb (chống payload
// khổng lồ). Rate limit đặt riêng cho /api ở dưới (không bóp file tĩnh).
// cspNonce PHẢI đứng trước helmet: header CSP đọc res.locals.cspNonce do nó sinh ra.
app.use(cspNonce);
app.use(buildHelmet());
app.use(buildCors());
// Báo cáo vi phạm CSP: PHẢI đứng TRƯỚC express.json + limiter chung — nó tự giới hạn
// body 10kb và có limiter riêng (lý do trong routes/csp-report.js).
app.use('/api/csp-report', require('./routes/csp-report'));
app.use(express.json({ limit: '100kb' }));
app.use('/api', buildApiLimiter());
console.log('[security] CORS whitelist:', allowedOrigins().join(', '));
logCspMode();   // CSP_MODE đang áp dụng (và vì sao, nếu bị ép về enforce)

// --- Health check ------------------------------------------------------------
// Opens (or reuses) the SQL Server pool and runs a trivial query to prove the
// connection is real, not just that the process is up.
// Endpoint CÔNG KHAI, không cần token: chỉ trả ok/error. Tên DB, login SQL, thông
// điệp và mã lỗi của driver là thông tin trinh sát (lộ tên instance, tài khoản, lý do
// fail) nên chỉ ghi vào log server, không bao giờ gửi ra client.
app.get('/api/health', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[health] SQL Server connection FAILED:', err.code, err.message);
    res.status(503).json({ status: 'error' });
  }
});

// --- Firebase Admin ----------------------------------------------------------
// Init sớm để báo lỗi ngay nếu thiếu service account (các route không-auth vẫn chạy).
try {
  initFirebase();
} catch (err) {
  console.error('[firebase] KHÔNG khởi tạo được Admin SDK:', err.message);
  console.error('[firebase] /api/me sẽ trả lỗi cho tới khi có server/firebase-service-account.json');
}

// --- API routes --------------------------------------------------------------
app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/me', meRouter);
app.use('/api/cart', cartRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/vouchers', vouchersRouter);
app.use('/api/account/addresses', addressesRouter);
app.use('/api/account/payment-methods', paymentsRouter);
app.use('/api/account/privacy-settings', privacyRouter);
// PHẢI mount SAU các nhánh con ở trên: '/api/account' khớp cả '/api/account/...' nên nếu
// đặt trước sẽ chặn mất addresses/payment-methods. Router này chỉ còn bắt phần đuôi
// chưa ai nhận: POST /verify-password và DELETE / (xoá tài khoản).
app.use('/api/account', accountRouter);
app.use('/api/admin', adminRouter);

// --- Static: ảnh đại diện -----------------------------------------------------
// Chỉ phục vụ ĐÚNG folder uploads/avatars (không phải cả uploads/), express.static
// không bật directory listing nên không liệt kê được file.
// Tên file mang phiên bản ('{uid}-{version}.webp') nên nội dung mỗi URL là BẤT BIẾN:
// đổi avatar = sinh URL mới, không bao giờ sửa file cũ. Nhờ vậy cache được thoải mái
// 1 năm + immutable — trình duyệt khỏi revalidate, mà đổi ảnh vẫn thấy ngay lập tức
// vì URL đã khác. Đây cũng là lý do client KHÔNG cần thêm '?t=' để phá cache.
// dotfiles:'deny': file tạm lúc ghi avatar mang tiền tố '.' (xem writeFileAtomic trong
// routes/me.js) — không bao giờ được phục vụ ra ngoài.
app.use('/avatars', express.static(path.join(__dirname, 'uploads', 'avatars'), {
  maxAge: '1y',
  immutable: true,
  dotfiles: 'deny',
}));

// --- Trang EJS ---------------------------------------------------------------
// PHẢI đứng TRƯỚC express.static: file .html cũ vẫn nằm trong client/ tới phase dọn
// dẹp, nếu static chạy trước thì nó trả file cũ và route EJS không bao giờ được gọi.
app.use(require('./routes/pages'));

// --- Chặn file nội bộ trong client/ -------------------------------------------
// client/ chứa cả thứ KHÔNG phải frontend: test, package*.json, tài liệu .md, và
// node_modules nếu ai chạy `npm install` trong client/ (đã xoá — frontend không dùng,
// Firebase nạp từ CDN). express.static phục vụ mọi file nằm trong thư mục nên phải chặn
// trước nó. Đây là blocklist — hướng lâu dài là whitelist, xem SEC-1 trong CLEANUP.md.
// So trên ĐƯỜNG DẪN ĐÃ GIẢI như express.static sẽ giải, không so chuỗi URL thô:
//   - decode trước: '/node%5Fmodules/...' là '/node_modules/...';
//   - path.join chuẩn hoá '/./' và (trên Windows) coi '\' là dấu phân cách, nên
//     '/js%5C__tests__/x.js' rơi đúng vào js/__tests__;
//   - hạ chữ thường: ổ đĩa Windows không phân biệt hoa thường, '/Node_Modules/' vẫn
//     trúng thư mục thật. Trên Linux việc này chỉ chặn thừa đường dẫn vốn không tồn tại.
// '..' không cần lo: express.static tự trả 403 khi gặp nó.
const CLIENT_ROOT = path.join(__dirname, '..', 'client');
const PRIVATE_STATIC = ['node_modules', 'js/__tests__', 'package.json', 'package-lock.json'];

app.use((req, res, next) => {
  let decoded;
  try {
    decoded = decodeURIComponent(req.path);
  } catch (e) {
    return next();   // URL mã hoá hỏng: express.static tự trả 400
  }
  const rel = path.relative(CLIENT_ROOT, path.join(CLIENT_ROOT, decoded))
    .split(path.sep).join('/').toLowerCase();
  // *.md: tài liệu nội bộ (README...) không bao giờ là thứ trình duyệt cần, và
  // dotfiles:'deny' không chặn chúng vì tên không bắt đầu bằng dấu chấm.
  if (rel.endsWith('.md') || PRIVATE_STATIC.some((p) => rel === p || rel.startsWith(p + '/'))) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  next();
});

// --- Static frontend ---------------------------------------------------------
// Tiện dev: phục vụ client/ ngay trên cùng origin => js/, css/, img/ và 3 trang .html
// không migrate (invoice, admin, checkout). 18 trang còn lại do routes/pages.js render.
// (fetch API cùng origin, không vướng CORS). Production sẽ tách CDN ở Phase 5.
// dotfiles:'deny' khai báo TƯỜNG MINH thay vì dựa vào mặc định 'ignore' của send 1.x:
// mọi đường dẫn có một đoạn bắt đầu bằng '.' (/.env, /.git/config, /.vscode/...) đều bị
// từ chối, kể cả khi dấu chấm nằm ở thư mục giữa. Với fallthrough mặc định, 403 đó rơi
// xuống 404 chung của Express — client không phân biệt được "bị chặn" hay "không có".
app.use(express.static(CLIENT_ROOT, { dotfiles: 'deny' }));

// --- Xử lý lỗi tập trung ------------------------------------------------------
// CORS origin lạ -> 403 rõ ràng (thay vì 500 mặc định). JSON body hỏng/quá lớn -> 400.
// Còn lại -> 500 chung, log server, không lộ chi tiết cho client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && typeof err.message === 'string' && err.message.startsWith('CORS_BLOCKED:')) {
    return res.status(403).json({ status: 'error', message: 'Origin không được phép gọi API này' });
  }
  if (err && (err.type === 'entity.too.large' || err.type === 'entity.parse.failed')) {
    return res.status(400).json({ status: 'error', message: 'Body request không hợp lệ hoặc quá lớn' });
  }
  console.error('[server] Lỗi không lường trước:', err && err.message);
  res.status(500).json({ status: 'error', message: 'Lỗi máy chủ' });
});

app.listen(PORT, () => {
  console.log(`[server] Breeze Shop API listening on http://localhost:${PORT}`);
  console.log(`[server] Health check: http://localhost:${PORT}/api/health`);
  console.log(`[server] Frontend:     http://localhost:${PORT}/index.html`);
});
