/* pages.js — router cho các trang render bằng EJS.

   NGUYÊN TẮC ĐƯỜNG DẪN
   Route giữ NGUYÊN URL '.html' cũ, lấy thẳng từ PATHS trong client/js/routes.js
   (qua lib/client-routes.js). Nhờ vậy:
     - 336 link tĩnh trong HTML không phải sửa,
     - BreezeRoutes.currentPageKey() vẫn trả đúng khoá,
     - file .html cũ còn nguyên trong client/ làm bản đối chiếu, chỉ cần gỡ route
       là site quay lại y như trước.
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

/* Healthcheck của view engine — chứng minh EJS render được, không dính gì tới trang
   thật. Xoá ở phase dọn dẹp. */
router.get('/ejs-healthcheck', (req, res) => {
  res.render('ejs-healthcheck', { now: new Date().toISOString() });
});

/* --- Bảng cấu hình từng trang --------------------------------------------------
   Mỗi mục = tham số truyền vào layout. Không có logic nghiệp vụ ở đây: trang nào cũng
   chỉ là "render markup", dữ liệu vẫn do JS phía client gọi API như cũ.

     headVariant  'standard' | 'fragment'   (xem lý do trong partials/head.ejs)
     baseCss      'global.css' | 'sale.css' — KHÔNG đổi sale.css sang global.css:
                  6 trang danh mục được tạo kiểu bằng selector KHÔNG scope trong
                  sale.css, còn nhánh body.category-page trong global.css chỉ được
                  chỉnh cho search.html. Đổi là nhảy sang nhánh của trang khác.
     useUtilsI18n chỉ bật ở trang thật sự cần (7/21 trang cũ có nó)
     pageJs       NHÓM 6 — script riêng trang
-------------------------------------------------------------------------------- */
const PAGES = {
  chinhsachgiaohang: {
    view: 'chinhsachgiaohang',
    title: 'Chính sách giao hàng - BREEZE',
    i18nTitle: 'title.shipping',
    bodyClass: 'policy-page',
    pageCss: ['chinhsach-doitra.css'],
  },
  chinhsachdoitra: {
    view: 'chinhsachdoitra',
    title: 'Chính sách đổi trả - BREEZE',
    i18nTitle: 'title.returns',
    bodyClass: 'policy-page',
    pageCss: ['chinhsach-doitra.css'],
  },
  chinhsachbaomat: {
    view: 'chinhsachbaomat',
    title: 'Chính sách bảo mật - BREEZE',
    i18nTitle: 'title.privacy',
    bodyClass: 'policy-page',
    pageCss: ['chinhsach-doitra.css'],
  },

  /* --- 6 trang danh mục: CÙNG MỘT view 'category', chỉ khác tham số -------------
     headVariant 'fragment' vì 6 file cũ không có <!DOCTYPE>/<html>/<head>/<meta>.
     Giữ nguyên để không đổi chế độ render (quirks -> standards) giữa đợt migrate;
     xem ghi chú trong partials/head.ejs.
     'sale' không có slug danh mục nên dùng cờ onsale thay cho category. */
  'sanpham-ao': {
    view: 'category', headVariant: 'fragment', baseCss: 'sale.css',
    title: 'Áo - BREEZE', i18nTitle: 'title.shirt', headline: 'Áo',
    bodyClass: 'category-page sitehdr', bodyData: { category: 'sanpham-ao' },
    pageJs: ['filter.js', 'products-render.js'], closeHtml: false,
  },
  'sanpham-quan': {
    view: 'category', headVariant: 'fragment', baseCss: 'sale.css',
    title: 'Quần - BREEZE', i18nTitle: 'title.pants', headline: 'Quần',
    bodyClass: 'category-page sitehdr', bodyData: { category: 'sanpham-quan' },
    pageJs: ['filter.js', 'products-render.js'], closeHtml: false,
  },
  'sanpham-giay': {
    view: 'category', headVariant: 'fragment', baseCss: 'sale.css',
    title: 'Giày & Dép - BREEZE', i18nTitle: 'title.shoes', headline: 'Giày & Dép',
    bodyClass: 'category-page sitehdr', bodyData: { category: 'sanpham-giay' },
    pageJs: ['filter.js', 'products-render.js'], closeHtml: false,
  },
  handbags: {
    view: 'category', headVariant: 'fragment', baseCss: 'sale.css',
    title: 'Túi Xách - BREEZE', i18nTitle: 'title.handbags',
    /* 'Handbags' (tiếng Anh) là chữ có sẵn trong handbags.html cũ — 5 trang kia để
       tiếng Việt. Giữ nguyên để không đổi DOM; i18n.js ghi đè ngay lúc chạy nên
       người dùng không thấy khác biệt. Ghi vào mục "Phát hiện thêm". */
    headline: 'Handbags',
    bodyClass: 'category-page sitehdr', bodyData: { category: 'handbags' },
    pageJs: ['filter.js', 'products-render.js'], closeHtml: false,
  },
  'gold-jewellery': {
    view: 'category', headVariant: 'fragment', baseCss: 'sale.css',
    title: 'Phụ Kiện - BREEZE', i18nTitle: 'title.accessories', headline: 'Phụ Kiện',
    bodyClass: 'category-page sitehdr', bodyData: { category: 'gold-jewellery' },
    pageJs: ['filter.js', 'products-render.js'], closeHtml: false,
  },
  sale: {
    view: 'category', headVariant: 'fragment', baseCss: 'sale.css',
    title: 'Khuyến Mãi - BREEZE', i18nTitle: 'title.sale', headline: 'Khuyến Mãi',
    bodyClass: 'category-page sitehdr', bodyData: { onsale: '1' },
    pageJs: ['filter.js', 'products-render.js'], closeHtml: false,
  },
};

/* Đăng ký route theo đúng URL cũ trong PATHS. Không tự chế đường dẫn: khoá nào không
   có trong PATHS là lỗi cấu hình, phải nổ lúc boot chứ không im lặng 404 lúc chạy. */
Object.keys(PAGES).forEach((key) => {
  const cfg = PAGES[key];
  const urlPath = R.PATHS[key];
  if (!urlPath) throw new Error('[pages] khoá "' + key + '" không có trong PATHS của routes.js');

  router.get('/' + urlPath, (req, res) => {
    res.render('layouts/main', Object.assign({ page: cfg.view, pageKey: key }, cfg));
  });
});

module.exports = router;
module.exports.PATHS = R.PATHS;
