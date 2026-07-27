// Breeze Shop API server.
// Bootstrapping step: Express app on port 3000 with a real SQL Server health check.
// Business logic (products, cart, orders, Firebase token verification) comes later.

require('dotenv').config();

const path = require('path');
const express = require('express');
const { getPool, sql } = require('./db');
const { initFirebase } = require('./firebase');
const { buildCors, buildHelmet, buildApiLimiter, allowedOrigins } = require('./middleware/security');

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

// --- Hardening (Phase 5) -----------------------------------------------------
// helmet (security headers, CSP tắt vì frontend tĩnh dùng inline script + CDN),
// CORS whitelist (chỉ origin của client), body JSON giới hạn 100kb (chống payload
// khổng lồ). Rate limit đặt riêng cho /api ở dưới (không bóp file tĩnh).
app.use(buildHelmet());
app.use(buildCors());
app.use(express.json({ limit: '100kb' }));
app.use('/api', buildApiLimiter());
console.log('[security] CORS whitelist:', allowedOrigins().join(', '));

// --- Health check ------------------------------------------------------------
// Opens (or reuses) the SQL Server pool and runs a trivial query to prove the
// connection is real, not just that the process is up.
app.get('/api/health', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      "SELECT DB_NAME() AS db, SUSER_SNAME() AS login, GETDATE() AS serverTime"
    );
    const row = result.recordset[0];

    console.log('[health] SQL Server OK ->', row);

    res.json({
      status: 'ok',
      database: row.db,
      login: row.login,
      serverTime: row.serverTime,
    });
  } catch (err) {
    console.error('[health] SQL Server connection FAILED:', err.message);

    res.status(500).json({
      status: 'error',
      message: 'Cannot connect to SQL Server',
      detail: err.message,
      code: err.code,
    });
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
// không bật directory listing nên không liệt kê được file. Mount TRƯỚC client/ vì
// client/ không có thư mục 'avatars' — giữ đường dẫn này tách bạch với site tĩnh.
// Ảnh ghi đè cùng tên khi user đổi avatar; express.static gửi ETag + max-age=0 nên
// trình duyệt revalidate mỗi lần, đổi ảnh là thấy ngay, không kẹt cache.
app.use('/avatars', express.static(path.join(__dirname, 'uploads', 'avatars')));

// --- Static frontend ---------------------------------------------------------
// Tiện dev: phục vụ client/ ngay trên cùng origin => mở http://localhost:3000/sanpham-ao.html
// (fetch API cùng origin, không vướng CORS). Production sẽ tách CDN ở Phase 5.
app.use(express.static(path.join(__dirname, '..', 'client')));

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
