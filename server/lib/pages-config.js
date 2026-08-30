/* pages-config.js — bảng cấu hình từng trang EJS. DỮ LIỆU THUẦN, không require gì.

   Tách khỏi routes/pages.js để bộ test client require được mà KHÔNG kéo theo express:
   client/js/__tests__ có lời hứa "không cần cài gì thêm", nếu test phải nạp router thì
   lời hứa đó gãy. Đây cũng là chỗ duy nhất mô tả "trang nào tồn tại và render ra sao",
   nên test dùng nó để kiểm PATHS và views khớp nhau.

   Xem bảng đầy đủ các tham số layout trong CLAUDE.md. */

/*  --------------------------------------------------
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
module.exports = {
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
  /* --- Nhóm cần đăng nhập -------------------------------------------------------
     Không đụng gì tới luồng auth: auth.js / auth-helper.js / page-*.js giữ nguyên,
     server chỉ trả markup. auth.js có nhánh keyOf(redirect) === 'checkout' — logic
     redirect KHÔNG đổi (xem S-1). */
  login: {
    view: 'login', title: 'Đăng Nhập - BREEZE', i18nTitle: 'au.loginDocTitle',
    bodyClass: 'sitehdr', pageCss: ['auth.css'],
    useUtilsI18n: true, pageJs: ['auth.js', 'page-login.js'],
  },
  signup: {
    view: 'signup', title: 'Tạo Tài Khoản - BREEZE', i18nTitle: 'au.signupDocTitle',
    bodyClass: 'sitehdr', pageCss: ['auth.css'],
    useUtilsI18n: true, pageJs: ['auth.js'],
  },
  'forgot-password': {
    view: 'forgot-password', title: 'Quên Mật Khẩu - BREEZE', i18nTitle: 'au.forgotDocTitle',
    bodyClass: 'sitehdr', pageCss: ['auth.css'],
  },
  /* Đổi mật khẩu KHÔNG còn là trang riêng (Phase 2B): nó là modal trong chính trang này,
     nên change-password.js nạp ở đây. Phải đứng SAU page-profile.js — file đó export
     window.ProfileToast mà modal dùng để hiện dòng xác nhận ngoài trang. */
  profile: {
    view: 'profile', title: 'Cài Đặt Tài Khoản - BREEZE', i18nTitle: 'pf.docTitle',
    bodyClass: 'sitehdr', pageCss: ['profile.css'],
    useUtilsI18n: true, pageJs: ['payment-methods.js', 'page-profile.js', 'change-password.js'],
  },
  orders: {
    view: 'orders', title: 'Đơn Hàng Của Tôi - BREEZE', i18nTitle: 'title.orders',
    bodyClass: 'sitehdr', headExtra: 'orders-style', pageJs: ['page-orders.js'],
  },
  cart: {
    view: 'cart', title: 'Giỏ Hàng - BREEZE', i18nTitle: 'title.cart',
    bodyClass: 'sitehdr', headExtra: 'cart-style', pageJs: ['page-cart.js'],
  },

  /* --- Trang chủ ----------------------------------------------------------------
     Biến thể header thứ 3: <header> riêng có slider, KHÔNG dùng policy-header.
     page-index-slider.js KHÔNG nằm trong pageJs — nó ở giữa pages/index.ejs, ngay sau
     markup hero (xem lý do trong file đó). */
  index: {
    view: 'index', headerVariant: 'home',
    title: 'BREEZE - Thời trang', i18nTitle: 'title.index',
    bodyClass: 'home', pageCss: ['index-slide.css'],
  },

  /* --- Trang có tham số URL ----------------------------------------------------
     Server KHÔNG đọc query string: page-product.js / page-search.js vẫn tự lấy từ
     location.search y như cũ. Cố ý — đưa tham số URL vào to() là kịch bản biến S-1
     (to() cho qua khoá lạ nguyên văn) thành open redirect thật. */
  product: {
    view: 'product', headVariant: 'fragment', baseCss: 'sale.css',
    headExtra: 'product-style',
    title: 'Sản phẩm - BREEZE', i18nTitle: 'pd.docTitle',
    bodyClass: 'category-page sitehdr',
    useUtilsI18n: true, pageJs: ['page-product.js'], closeHtml: false,
  },
  search: {
    view: 'search',
    title: 'Kết quả tìm kiếm - BREEZE', i18nTitle: 'sr.docTitle',
    headExtra: 'search-style',
    bodyClass: 'category-page sitehdr',
    /* Trang DUY NHẤT bật ô tìm kiếm thật trong header. Mặc định của header.ejs là
       false, nên quên truyền ở trang khác thì hỏng về phía 'hiện icon'. */
    showSearchBox: true,
    useUtilsI18n: true, pageJs: ['page-search.js'],
  },

  sale: {
    view: 'category', headVariant: 'fragment', baseCss: 'sale.css',
    title: 'Khuyến Mãi - BREEZE', i18nTitle: 'title.sale', headline: 'Khuyến Mãi',
    bodyClass: 'category-page sitehdr', bodyData: { onsale: '1' },
    pageJs: ['filter.js', 'products-render.js'], closeHtml: false,
  },
};