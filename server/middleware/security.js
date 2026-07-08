// Hardening tổng thể (Phase 5, mục 4): helmet + CORS whitelist + rate limit.
// Gom một chỗ để chính sách bảo mật dễ đọc/chỉnh; server.js chỉ việc app.use(...).
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Origin trình duyệt được phép gọi API. Override qua ALLOWED_ORIGINS (ngăn cách
// bằng dấu phẩy) trong .env; không có thì dùng default dev (:3000 = Express phục
// vụ client, :5500 = VS Code Live Server), cả localhost lẫn 127.0.0.1.
const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

function allowedOrigins() {
  const raw = (process.env.ALLOWED_ORIGINS || '').trim();
  if (!raw) return DEFAULT_ORIGINS.slice();
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// CORS: chỉ cho phép origin trong whitelist. Request KHÔNG có header Origin
// (curl/Postman, health check server-to-server, điều hướng cùng-origin) được cho
// qua — CORS vốn chỉ do TRÌNH DUYỆT thực thi, nên chặn no-Origin không tăng bảo mật
// mà chỉ làm hỏng luồng verify bằng curl. Origin lạ -> Error (server.js trả 403).
function buildCors() {
  const whitelist = allowedOrigins();
  return cors({
    origin(origin, cb) {
      if (!origin || whitelist.includes(origin)) return cb(null, true);
      return cb(new Error('CORS_BLOCKED:' + origin));
    },
    credentials: true,
  });
}

// helmet: bật security headers mặc định, NHƯNG TẮT Content-Security-Policy.
// Lý do: client/ là site tĩnh dùng inline <script> ở mọi trang + CDN ngoài
// (Firebase gstatic, Google Fonts, cdnjs font-awesome). CSP mặc định của helmet
// chặn inline + cross-origin => vỡ toàn bộ frontend. CSP chặt (khai báo nguồn
// cho phép cụ thể) để dành làm sau, không nằm trong phạm vi hardening tối thiểu này.
function buildHelmet() {
  return helmet({ contentSecurityPolicy: false });
}

// Rate limit chung cho /api: chống brute-force/spam. 300 request / 15 phút / IP.
// Đủ thoáng cho thao tác mua sắm bình thường, đủ chặt để cản dò quét tự động.
function buildApiLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { status: 'error', message: 'Quá nhiều yêu cầu, vui lòng thử lại sau ít phút' },
  });
}

module.exports = { buildCors, buildHelmet, buildApiLimiter, allowedOrigins, DEFAULT_ORIGINS };
