// Script riêng của cart.html — tách ra từ thẻ <script> inline cuối trang.
// Phải load SAU cart.js (dùng getCart/updateQty/removeFromCart/money/startCheckout)
// và SAU i18n.js (đọc window.__i18n).
// changeQty / removeItem / checkout được gọi từ onclick trong HTML -> phải ở scope global.

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
        var soldOut = (item.stock != null) && (item.qty > item.stock);
        if (soldOut) _cartStockIssue = true;
        var tag = soldOut ? ' <span class="cart-soldout-tag">Hết hàng</span>' : '';
        var tr = document.createElement('tr');
        if (soldOut) tr.className = 'cart-row-soldout';
        tr.innerHTML =
            '<td><img class="cart-item-img" src="' + item.img + '" alt="' + item.name + '" onerror="this.src=\'img/gc8.png\'"></td>' +
            '<td><div class="cart-item-name">' + item.name + tag + '</div></td>' +
            '<td>' + money(item.price) + '</td>' +
            '<td>' +
                '<div class="qty-control">' +
                    '<button class="qty-btn" onclick="changeQty(' + item.id + ', -1)">−</button>' +
                    '<span class="qty-num">' + item.qty + '</span>' +
                    '<button class="qty-btn" onclick="changeQty(' + item.id + ', 1)">+</button>' +
                '</div>' +
            '</td>' +
            '<td class="item-price">' + money(subtotal) + '</td>' +
            '<td><button class="btn-remove" onclick="removeItem(' + item.id + ')" title="' + (cp.removeTitle || 'Xóa') + '"><i class="fa fa-times"></i></button></td>';
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
        window.location.href = 'checkout.html';
    }
}

document.addEventListener('DOMContentLoaded', renderCart);
document.addEventListener('langchange', renderCart);
document.addEventListener('cartchange', renderCart); // đồng bộ server / merge khi đăng nhập
