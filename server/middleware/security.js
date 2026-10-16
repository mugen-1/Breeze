// Hardening tổng thể (Phase 5, mục 4): helmet (kèm CSP có nonce) + CORS whitelist + rate limit.
// Gom một chỗ để chính sách bảo mật dễ đọc/chỉnh; server.js chỉ việc app.use(...).
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

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

// Nonce CSP: 16 byte ngẫu nhiên MỖI REQUEST, gắn vào res.locals để EJS in ra
// (<script nonce="...">) và để buildHelmet() đưa vào header. PHẢI mount TRƯỚC helmet.
// Chỉ thẻ <script> inline mang đúng nonce của lần tải này mới được chạy — kẻ tấn công
// chèn được HTML cũng không đoán được giá trị.
function cspNonce(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
}

// CSP BẬT THẬT (enforce): trình duyệt CHẶN mọi thứ ngoài danh sách dưới, và vẫn báo về
// report-uri. Đã chạy Report-Only trước, tới khi gỡ hết code inline (script theme của 3
// trang tĩnh -> js/theme-boot.js; mọi onclick/onsubmit/onerror -> data-action +
// addEventListener) và duyệt đủ 21 trang ra 0 báo cáo. Hệ quả cho code mới: KHÔNG viết
// on*="...", href="javascript:", hay <script> inline thiếu nonce — sẽ im lặng không chạy.
//
// CÔNG TẮC: biến môi trường CSP_MODE (server/.env, hoặc launch.json của VS Code — biến
// đặt sẵn trong môi trường thắng .env). Khởi động lại server sau khi đổi.
//   enforce (mặc định) — chặn thật + báo;
//   report             — KHÔNG chặn, chỉ báo về /api/csp-report (thử thay đổi lớn, hoặc
//                        tìm xem CSP có phải thủ phạm không mà vẫn biết nó SẼ chặn gì);
//   off                — không gửi header CSP. Chỉ để test; các header khác của helmet
//                        (Referrer-Policy, X-Frame-Options...) VẪN còn.
// Hai lưới an toàn, đều rơi về enforce:
//   - NODE_ENV=production -> LUÔN enforce, CSP_MODE bị bỏ qua: một dòng CSP_MODE=off
//     còn sót trong .env khi deploy không được phép tắt bảo vệ trên site thật;
//   - giá trị lạ (gõ sai) -> enforce.
//
// useDefaults:false — chỉ dùng ĐÚNG danh sách dưới. Mặc định của helmet kèm thêm
// upgrade-insecure-requests (làm hỏng dev qua http://localhost khi bật thật) và các
// nguồn rộng 'https:' cho style/font. Muốn thêm directive thì thêm tường minh ở đây.
//
// Nonce CHỈ ở script-src. Không đưa vào style-src: có nonce thì trình duyệt BỎ QUA
// 'unsafe-inline', mà style="..." và 4 khối <style> trong partials/*-style.ejs cần nó.
//
// img-src giữ data: vì 3 ảnh CSS là SVG data-URI (mũi tên <select> ở checkout.css x2,
// profile.css x1); blob: cho ảnh xem trước khi đổi avatar (page-profile.js).
const CSP_MODES = ['enforce', 'report', 'off'];

// -> { mode, raw, why }: mode là chế độ THẬT SỰ áp dụng; raw là CSP_MODE người dùng đặt;
// why = null | 'production' (bị NODE_ENV=production ép) | 'invalid' (giá trị lạ).
function cspModeInfo() {
  const raw = String(process.env.CSP_MODE || '').trim();
  const asked = raw.toLowerCase();
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    return { mode: 'enforce', raw, why: asked && asked !== 'enforce' ? 'production' : null };
  }
  if (!asked) return { mode: 'enforce', raw, why: null };
  if (!CSP_MODES.includes(asked)) return { mode: 'enforce', raw, why: 'invalid' };
  return { mode: asked, raw, why: null };
}
function cspMode() { return cspModeInfo().mode; }

// In chế độ CSP lúc khởi động — tắt để test mà quên bật lại là lỗ bảo mật âm thầm, nên
// chế độ khác enforce in bằng console.warn cho nổi bật.
function logCspMode() {
  const { mode, raw, why } = cspModeInfo();
  if (why === 'production') {
    console.warn(`[security] NODE_ENV=production -> bỏ qua CSP_MODE="${raw}", CSP luôn chặn thật`);
  } else if (why === 'invalid') {
    console.warn(`[security] CSP_MODE="${raw}" không hợp lệ (enforce | report | off) -> dùng enforce`);
  }
  if (mode === 'off') console.warn('[security] !!! CSP ĐANG TẮT (CSP_MODE=off) — chỉ để test, nhớ bật lại !!!');
  else if (mode === 'report') console.warn('[security] CSP chỉ BÁO, không chặn (CSP_MODE=report)');
  else console.log('[security] CSP: chặn thật (enforce)');
}

function buildHelmet() {
  const mode = cspMode();
  if (mode === 'off') return helmet({ contentSecurityPolicy: false });
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      reportOnly: mode === 'report',
      directives: {
        defaultSrc: ["'self'"],
        // Nguồn script ngoài thu hẹp tới ĐÚNG thư mục phiên bản đang dùng (dấu '/' cuối
        // = mọi file nằm dưới đó). Không cho cả host: cdn.jsdelivr.net phục vụ MỌI gói
        // npm, www.gstatic.com chứa nhiều thư viện Google khác — kẻ chèn được HTML sẽ nạp
        // được <script src> từ đó mà CSP vẫn cho qua. SRI không che được lỗ này (SRI chỉ
        // bảo vệ thẻ script do mình viết). Nâng phiên bản = sửa ở đây + tính lại hash SRI.
        scriptSrc: [
          "'self'",
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
          'https://www.gstatic.com/firebasejs/9.23.0/',         // Firebase SDK
          'https://cdn.jsdelivr.net/npm/chart.js@4.4.6/',       // Chart.js (admin)
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: [
          "'self'",
          'https://identitytoolkit.googleapis.com',   // Firebase Auth: đăng nhập/ký, gửi email
          'https://securetoken.googleapis.com',       // Firebase Auth: làm mới ID token
          'https://www.googleapis.com',
        ],
        frameSrc: ['https://webgc-8a445.firebaseapp.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        // Trình duyệt POST từng vi phạm về đây -> log server (routes/csp-report.js).
        reportUri: ['/api/csp-report'],
      },
    },
  });
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

// Rate limit theo TỪNG USER (không theo IP) cho thao tác nhạy cảm cần mật khẩu.
// Vì sao không dùng IP: nhiều user có thể chung 1 IP (NAT/công ty/wifi công cộng) —
// giới hạn theo IP sẽ khoá nhầm người vô can. Khoá theo req.user.id (đã qua
// verifyFirebaseToken nên không giả mạo được); nếu chưa xác thực thì lùi về IP.
function buildUserActionLimiter(opts) {
  const o = opts || {};
  return rateLimit({
    windowMs: o.windowMs || 60 * 1000,
    limit: o.limit || 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // ipKeyGenerator: gom IPv6 theo /64 — không có nó, 1 người dùng IPv6 có thể đổi
    // địa chỉ trong dải của mình để lách sạch giới hạn.
    keyGenerator: (req) => (req.user && req.user.id ? 'u:' + req.user.id : 'ip:' + ipKeyGenerator(req.ip)),
    message: {
      status: 'error',
      message: o.message || 'Bạn đã thao tác quá nhiều lần, vui lòng thử lại sau',
    },
  });
}

module.exports = {
  cspNonce, cspMode, cspModeInfo, logCspMode, buildCors, buildHelmet, buildApiLimiter, buildUserActionLimiter, allowedOrigins, DEFAULT_ORIGINS,
};
