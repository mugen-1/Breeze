/* routes.js — bảng đường dẫn tập trung + nhận diện trang hiện tại.
   Nạp SỚM (nhóm cấu hình, sau api-config.js) vì account-menu.js gọi
   currentPageKey() ngay lúc parse.

   VÌ SAO CÓ FILE NÀY
   Trước đây tên file .html bị dùng làm KHOÁ TRA CỨU ở 6 chỗ (i18n.js, account-menu.js,
   auth.js). Khi URL đổi từ /cart.html sang /cart thì khoá 'cart.html' không khớp nữa —
   và KHÔNG có lỗi console, chỉ là tiêu đề không dịch, lời chào hiện sai chỗ, giỏ hàng
   không vẽ lại. Loại hỏng ngầm đó rất khó phát hiện khi test nhanh.

   File này KHÔNG đổi route. Site vẫn chạy nguyên với URL .html hiện tại. Nó chỉ gỡ bỏ
   giả định "URL phải có đuôi .html" ra khỏi code, để lần migrate EJS bật được route
   không đuôi mà không vỡ.

   KHOÁ TRANG = tên file bỏ đuôi. Không phát minh hệ tên mới: 21 tên file hiện tại đều
   là slug hợp lệ và không trùng nhau, nên 'cart.html' -> 'cart' là đủ. */

window.BreezeRoutes = (function () {
    'use strict';

    /* Chỗ DUY NHẤT trong toàn bộ client biết đuôi .html.
       Migrate EJS: chỉ cần bỏ '.html' ở đây là toàn site đổi theo. */
    var PATHS = {
        index:               'index.html',
        cart:                'cart.html',
        checkout:            'checkout.html',
        orders:              'orders.html',
        product:             'product.html',
        search:              'search.html',
        invoice:             'invoice.html',
        admin:               'admin.html',
        profile:             'profile.html',
        login:               'login.html',
        signup:              'signup.html',
        'forgot-password':   'forgot-password.html',
        chinhsachbaomat:     'chinhsachbaomat.html',
        chinhsachdoitra:     'chinhsachdoitra.html',
        chinhsachgiaohang:   'chinhsachgiaohang.html',
        'sanpham-ao':        'sanpham-ao.html',
        'sanpham-quan':      'sanpham-quan.html',
        'sanpham-giay':      'sanpham-giay.html',
        handbags:            'handbags.html',
        'gold-jewellery':    'gold-jewellery.html',
        sale:                'sale.html'
    };

    /* Rút khoá trang từ một đường dẫn/href bất kỳ.
       Chấp nhận cả hai dạng URL để giai đoạn chuyển tiếp không vỡ:
         'cart.html' | 'cart' | '/cart/' | '/CART.HTML' | 'cart.html?x=1#y'  -> 'cart'
       Rỗng hoặc '/' -> 'index' (trang chủ). */
    function keyOf(input) {
        var s = String(input == null ? '' : input);
        s = s.split('?')[0].split('#')[0];          // bỏ query + hash
        s = s.replace(/\/+$/, '');                  // bỏ dấu / ở cuối
        s = s.substring(s.lastIndexOf('/') + 1);    // lấy phần cuối đường dẫn
        s = s.toLowerCase();
        if (s.slice(-5) === '.html') s = s.slice(0, -5);
        return s || 'index';
    }

    function currentPageKey() {
        try { return keyOf(location.pathname); }
        catch (e) { return 'index'; }
    }

    function is(key) { return currentPageKey() === key; }

    /* Dựng đường dẫn tới một trang. query là object tuỳ chọn.
       to('login', { redirect: 'checkout' }) -> 'login.html?redirect=checkout'
       Khoá lạ -> trả về chính khoá đó, KHÔNG ném lỗi (tránh làm chết cả trang chỉ
       vì một chỗ gõ sai tên). */
    function to(key, query) {
        var p = PATHS[key] || key;
        if (!query) return p;
        var parts = [];
        for (var k in query) {
            if (Object.prototype.hasOwnProperty.call(query, k) &&
                query[k] !== undefined && query[k] !== null && query[k] !== '') {
                parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(query[k]));
            }
        }
        return parts.length ? p + '?' + parts.join('&') : p;
    }

    function product(id) { return to('product', { id: id }); }

    return {
        PATHS: PATHS,
        keyOf: keyOf,
        currentPageKey: currentPageKey,
        is: is,
        to: to,
        product: product
    };
})();
