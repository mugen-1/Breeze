// Cấu hình 1 chỗ duy nhất cho base URL của backend API.
// '' = gọi TƯƠNG ĐỐI ('/api/...'), tức cùng origin với trang — Express phục vụ cả trang
// lẫn API. Trước đây ghi cứng 'http://localhost:3000': mở trang qua 127.0.0.1:3000 thì
// mọi lệnh gọi API thành KHÁC origin (localhost ≠ 127.0.0.1), vướng CORS và bị CSP
// connect-src 'self' chặn. Relative thì luôn khớp origin trang, không cần nới CSP.
// Hệ quả: VS Code Live Server (:5500) không gọi được API nữa — mở trang qua :3000.
// Khi API tách sang domain riêng: đặt URL đầy đủ ở đây VÀ thêm domain đó vào connect-src
// (server/middleware/security.js).
window.API_BASE = '';
