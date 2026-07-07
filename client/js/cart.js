const CART_KEY = 'bookstore_cart';

function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
    catch (e) { return []; }
}

function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    _updateAllBadges();
}

function _updateAllBadges() {
    const total = getCart().reduce(function(s, i) { return s + i.qty; }, 0);
    document.querySelectorAll('.cart-badge').forEach(function(b) {
        b.textContent = total;
        b.style.display = total > 0 ? 'flex' : 'none';
    });
}

function addToCart(btn) {
    const item = btn.closest('.product-item');
    const nameEl = item.querySelector('.product-name') || item.querySelector('.product-cat');
    const salePriceEl = item.querySelector('.price-sale');
    const priceEl = salePriceEl || item.querySelector('.product-price');
    const imgEl = item.querySelector('img');

    const name = nameEl ? nameEl.textContent.trim() : 'Sản phẩm';
    const priceText = priceEl ? priceEl.textContent.trim() : '0';
    const price = parseInt(priceText.replace(/[^\d]/g, '')) || 0;
    const img = imgEl ? imgEl.getAttribute('src') : '';

    const cart = getCart();
    const existing = cart.find(function(p) { return p.name === name; });
    if (existing) {
        existing.qty++;
    } else {
        cart.push({ name: name, price: price, img: img, qty: 1 });
    }
    saveCart(cart);

    var lang = (window.__i18n && window.__i18n.current) || 'vi';
    var ct = window.__i18n && window.__i18n.T[lang] && window.__i18n.T[lang].cart;
    btn.textContent = ct ? ct.added : '✓ Đã thêm';
    btn.classList.add('added');
    setTimeout(function() {
        btn.textContent = ct ? ct.add : 'Thêm vào giỏ';
        btn.classList.remove('added');
    }, 1200);
}

function removeFromCart(name) {
    saveCart(getCart().filter(function(p) { return p.name !== name; }));
}

function updateQty(name, delta) {
    const cart = getCart();
    const item = cart.find(function(p) { return p.name === name; });
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
        saveCart(cart.filter(function(p) { return p.name !== name; }));
    } else {
        saveCart(cart);
    }
}

function formatPrice(n) {
    return n.toLocaleString('vi-VN') + 'đ';
}

function _injectCartIcon() {
    const header = document.querySelector('header');
    if (!header || header.querySelector('.cart-icon-btn')) return;
    const a = document.createElement('a');
    a.href = 'cart.html';
    a.className = 'cart-icon-btn';
    a.title = 'Giỏ hàng';
    a.innerHTML = '<i class="fa fa-shopping-cart"></i><span class="cart-badge">0</span>';
    header.appendChild(a);
}

function _injectAddToCartButtons() {
    document.querySelectorAll('.product-info').forEach(function(info) {
        if (info.querySelector('.btn-add-cart')) return;
        const btn = document.createElement('button');
        btn.className = 'btn-add-cart';
        btn.textContent = 'Thêm vào giỏ';
        btn.onclick = function() { addToCart(this); };
        info.appendChild(btn);
    });
}

function _initSearchPersist() {
    document.querySelectorAll('.stext').forEach(function(input) {
        var box = input.closest('.box');
        var sbox = input.closest('.sbox');

        function sync() {
            var hasVal = input.value.length > 0;
            if (sbox) sbox.classList.toggle('has-text', hasVal);
            if (box)  box.classList.toggle('has-text',  hasVal);
        }

        input.addEventListener('input', sync);
        sync(); // chạy ngay khi load (dành cho search.html đã có giá trị sẵn)
    });
}

document.addEventListener('DOMContentLoaded', function() {
    _injectCartIcon();
    _updateAllBadges();
    _injectAddToCartButtons();
    _initSearchPersist();
});
