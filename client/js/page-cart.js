// Script riêng của cart.html — tách ra từ thẻ <script> inline cuối trang.
// Phải load SAU cart.js (dùng getCart/updateQty/removeFromCart/money/startCheckout/CART_MAX_QTY)
// và SAU i18n.js (đọc window.__i18n).
// Nút trong bảng + nút Thanh toán mang data-action="cart-*"; một listener click ở cuối
// file điều phối (thay cho onclick="..." inline cũ — CSP chặn handler inline).
// changeQty / removeItem / checkout vẫn để global như cũ.

function _cp() {
    var lang = (window.__i18n && window.__i18n.current) || 'vi';
    return (window.__i18n && window.__i18n.T[lang] && window.__i18n.T[lang].cartPage) || {};
}

function renderCart() {
    var cp = _cp();
    var cart = getCart();
    var emptyEl = document.getElementById('cart-empty');
    var contentEl = document.getElementById('cart-content');
    var bodyEl = document.getElementById('cart-body');
    var totalEl = document.getElementById('cart-total-price');

    if (cart.length === 0) {
        emptyEl.style.display = 'block';
        contentEl.style.display = 'none';
        return;
    }

    emptyEl.style.display = 'none';
    contentEl.style.display = 'block';

    bodyEl.innerHTML = '';
    var total = 0;
    _cartStockIssue = false;

    cart.forEach(function(item) {
        var subtotal = item.price * item.qty;
        total += subtotal;
        // Hết/thiếu hàng: chỉ áp khi biết stock (giỏ server). Guest chưa biết stock -> bỏ qua.
        var soldOut = item.available === false || ((item.stock != null) && (item.qty > item.stock));
        if (soldOut) _cartStockIssue = true;
        var tag = soldOut ? ' <span class="cart-soldout-tag">Hết hàng</span>' : '';
        var tr = document.createElement('tr');
        if (soldOut) tr.className = 'cart-row-soldout';
        // esc(): tên sản phẩm và đường dẫn ảnh là dữ liệu (từ server hoặc giỏ khách trong
        // localStorage), ghép thẳng vào innerHTML là chèn được HTML/script.
        var id = esc(item.variant_id ? 'v' + item.variant_id : item.id);
        tr.innerHTML =
            '<td><img class="cart-item-img" src="' + esc(item.img) + '" alt="' + esc(item.name) + '"></td>' +
            '<td><div class="cart-item-name">' + esc(item.name) + tag + '</div>' +
                (item.size ? '<small>' + esc(window.__i18n.t('pd.thSize')) + ': ' + esc(item.size) + '</small>' : '') +
                (item.color ? '<small>' + esc(window.__i18n.t('co.metaColor')) + ': ' + esc(item.color) + '</small>' : '') + '</td>' +
            '<td>' + money(item.price) + '</td>' +
            '<td>' +
                '<div class="qty-control">' +
                    '<button class="qty-btn" data-action="cart-qty" data-id="' + id + '" data-delta="-1">−</button>' +
                    '<span class="qty-num">' + item.qty + '</span>' +
                    '<button class="qty-btn" data-action="cart-qty" data-id="' + id + '" data-delta="1"' +
                        (item.qty >= CART_MAX_QTY || item.available === false || (item.stock != null && item.qty >= item.stock) ? ' disabled' : '') + '>+</button>' +
                '</div>' +
            '</td>' +
            '<td class="item-price">' + money(subtotal) + '</td>' +
            '<td><button class="btn-remove" data-action="cart-remove" data-id="' + id + '" title="' + esc(cp.removeTitle || 'Xóa') + '"><i class="fa fa-times"></i></button></td>';
        bodyEl.appendChild(tr);
    });

    totalEl.textContent = money(total);

    // Chặn thanh toán nếu có sản phẩm hết hàng trong giỏ (đánh dấu, để khách tự bỏ).
    var coBtn = document.querySelector('.btn-checkout');
    if (coBtn) coBtn.disabled = _cartStockIssue;
    if (_cartStockIssue) {
        _showCheckoutMsg('Một số sản phẩm trong giỏ đã hết hàng. Vui lòng bỏ khỏi giỏ trước khi thanh toán.', true);
    } else {
        var msg = document.getElementById('checkout-msg');
        if (msg) msg.style.display = 'none';
    }
}
var _cartStockIssue = false;

window.renderCart = renderCart;

function changeQty(id, delta) { updateQty(id, delta); renderCart(); }
function removeItem(id) { removeFromCart(id); renderCart(); }

function _showCheckoutMsg(text, isError) {
    var msg = document.getElementById('checkout-msg');
    if (!msg) return;
    msg.style.display = 'block';
    msg.textContent = text;
    msg.style.color = isError ? '#e84118' : '#2e7d32';
}

function checkout() {
    // Chặn khi giỏ còn sản phẩm hết hàng (phòng khi nút vẫn bị kích hoạt).
    if (_cartStockIssue) {
        _showCheckoutMsg('Một số sản phẩm trong giỏ đã hết hàng. Vui lòng bỏ khỏi giỏ trước khi thanh toán.', true);
        return;
    }
    // Gate dùng chung (cart.js): guest -> login, admin -> báo lỗi, user -> checkout.html
    if (typeof window.startCheckout === 'function') {
        window.startCheckout({ onError: function (msg) { _showCheckoutMsg(msg, true); } });
    } else {
        window.location.href = window.BreezeRoutes.to('checkout');
    }
}

// Điều phối mọi nút data-action="cart-*". data-id có thể âm (món khách không có
// product_id, id cục bộ -Date.now()) — Number() giữ đúng dấu.
document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-action');
    var rawId = btn.getAttribute('data-id') || '';
    var id = rawId.charAt(0) === 'v' ? rawId : Number(rawId);
    if (act === 'cart-qty') changeQty(id, Number(btn.getAttribute('data-delta')));
    else if (act === 'cart-remove') removeItem(id);
    else if (act === 'cart-checkout') checkout();
});

// Ảnh sản phẩm lỗi -> ảnh dự phòng (thay cho onerror="..." inline). 'error' của <img>
// KHÔNG nổi bọt nên bắt ở pha capture (tham số true). Chỉ thử dự phòng MỘT lần: nếu
// chính ảnh dự phòng cũng lỗi thì dừng, không lặp vô hạn.
var CART_IMG_FALLBACK = 'img/gc8.png';
document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || !img.classList || !img.classList.contains('cart-item-img')) return;
    if (img.getAttribute('src') === CART_IMG_FALLBACK) return;
    img.src = CART_IMG_FALLBACK;
}, true);

document.addEventListener('DOMContentLoaded', renderCart);
document.addEventListener('langchange', renderCart);
document.addEventListener('cartchange', renderCart); // đồng bộ server / merge khi đăng nhập
