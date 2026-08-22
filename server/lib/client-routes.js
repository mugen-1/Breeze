/* client-routes.js — nạp client/js/routes.js vào server, KHÔNG chép lại bảng PATHS.

   VÌ SAO KHÔNG CHÉP TAY
   CLAUDE.md chốt: routes.js là nơi DUY NHẤT biết đuôi '.html'. Nếu server giữ một bản
   PATHS thứ hai thì lời chốt đó chết ngay: đổi route sẽ phải sửa 2 chỗ, và chỗ quên
   sửa hỏng ngầm không có lỗi console — đúng loại bug mà TASK 7 sinh ra routes.js để
   diệt. Nên ở đây nạp thẳng file client bằng vm với một `window` giả.

   routes.js là script trình duyệt thuần (IIFE gán vào window), không require gì, nên
   sandbox chỉ cần đúng một object `window`. Nạp một lần lúc boot; sửa routes.js thì
   phải khởi động lại server (giống mọi file server khác). */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROUTES_JS = path.join(__dirname, '..', '..', 'client', 'js', 'routes.js');

function load() {
  const src = fs.readFileSync(ROUTES_JS, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: ROUTES_JS });

  const R = sandbox.window.BreezeRoutes;
  if (!R || !R.PATHS || typeof R.to !== 'function') {
    throw new Error('[client-routes] routes.js không tạo ra window.BreezeRoutes hợp lệ');
  }
  return R;
}

const routes = load();

/* URL tuyệt đối để dùng trong href của partial: PATHS trả đường dẫn TƯƠNG ĐỐI
   ('cart.html') vì client luôn đứng ở gốc site. Server render ra cùng chuỗi đó,
   giữ y hệt href cũ trong HTML tĩnh — đây là điều kiện để so byte-identical. */
function href(key, query) {
  return routes.to(key, query);
}

module.exports = {
  PATHS: routes.PATHS,
  to: routes.to,
  keyOf: routes.keyOf,
  href,
  /* Danh sách khoá trang, dùng để đăng ký route hàng loạt. */
  keys: Object.keys(routes.PATHS),
};
