/* pages.js — router cho các trang render bằng EJS.

   NGUYÊN TẮC ĐƯỜNG DẪN
   Route giữ NGUYÊN URL '.html' cũ, lấy thẳng từ PATHS trong client/js/routes.js
   (qua lib/client-routes.js). Nhờ vậy:
     - 336 link tĩnh trong HTML không phải sửa,
     - BreezeRoutes.currentPageKey() vẫn trả đúng khoá,
     - đối chiếu với bản HTML gốc vẫn làm được qua git: server/tools/verify-all.js
       lấy 18 file cũ từ commit 21ca387 ra so DOM.
   Muốn bỏ đuôi '.html' sau này: sửa PATHS trong routes.js, router này đi theo. */

const express = require('express');
const R = require('../lib/client-routes');

const router = express.Router();

/* Mọi view đều cần bảng đường dẫn để dựng href. Gắn một lần ở đây thay vì truyền
   thủ công trong từng res.render() — quên truyền một chỗ là partial ném lỗi. */
router.use((req, res, next) => {
  res.locals.R = R;
  next();
});

/* Bảng cấu hình từng trang nằm ở lib/pages-config.js — dữ liệu thuần, không require
   gì, để bộ test client kiểm được mà không phải nạp express. */
const PAGES = require('../lib/pages-config');

/* Đăng ký route theo đúng URL cũ trong PATHS. Không tự chế đường dẫn: khoá nào không
   có trong PATHS là lỗi cấu hình, phải nổ lúc boot chứ không im lặng 404 lúc chạy. */
Object.keys(PAGES).forEach((key) => {
  const cfg = PAGES[key];
  const urlPath = R.PATHS[key];
  if (!urlPath) throw new Error('[pages] khoá "' + key + '" không có trong PATHS của routes.js');

  const handler = (req, res) => {
    res.render('layouts/main', Object.assign({ page: cfg.view, pageKey: key }, cfg));
  };
  router.get('/' + urlPath, handler);
  /* express.static đang serve index.html ở '/'. Route EJS đứng trước nó nên phải nhận
     luôn '/', nếu không '/' sẽ trả file cũ còn '/index.html' trả bản EJS — hai bản khác
     nhau trên cùng một trang. keyOf('/') vốn đã trả 'index' nên client không đổi gì. */
  if (key === 'index') router.get('/', handler);
});

module.exports = router;
module.exports.PATHS = R.PATHS;
