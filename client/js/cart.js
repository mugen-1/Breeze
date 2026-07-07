/* cart.js — giỏ hàng client.
   - Khách CHƯA đăng nhập: dùng localStorage như cũ (offline, không cần server).
   - Đã đăng nhập (AuthHelper có user): mọi thao tác đồng bộ qua API /api/cart (Bearer token).
     Khi đăng nhập mà localStorage còn giỏ cũ -> merge lên server 1 lần rồi xoá localStorage.
   - Giữ NGUYÊN API đồng bộ: getCart / saveCart / addToCart / updateQty / removeFromCart /
     formatPrice / _updateAllBadges / _injectAddToCartButtons — để cart-drawer.js, cart.html,
     products-render.js không phải đổi. _cart (in-memory) là nguồn sự thật ở CẢ hai chế độ.
   - Mỗi lần giỏ đổi phát sự kiện document 'cartchange' để các view render lại. */

var CART_KEY = 'bookstore_cart';

var _cart = [];            // nguồn sự thật in-memory (cả guest lẫn server mode)
var _serverMode = false;   // true khi đã đăng nhập & đồng bộ server
var _entering = false;     // chống chạy chồng khi vào server mode

function _lang() {
    return (window.__i18n && window.__i18n.current) || localStorage.getItem('ql_lang') || 'vi';
}

function getCart() { return _cart; }

function _readLocal() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
    catch (e) { return []; }
}
function _writeLocal(cart) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }

// Ghi giỏ (dùng bởi các nhánh GUEST cũ). Ở server mode chỉ cập nhật in-memory + thông báo.
function saveCart(cart) {
    _cart = cart;
    if (!_serverMode) _writeLocal(cart);
    _notify();
}

function _notify() {
    _updateAllBadges();
    document.dispatchEvent(new CustomEvent('cartchange'));
}

function _updateAllBadges() {
    const total = _cart.reduce(function (s, i) { return s + i.qty; }, 0);
    document.querySelectorAll('.cart-badge').forEach(function (b) {
        b.textContent = total;
        b.style.display = total > 0 ? 'flex' : 'none';
    });
}

// ---- server sync ----
function _serverGet() {
    return window.AuthHelper.apiFetch('/api/cart').then(function (r) {
        if (!r.ok) throw new Error('GET /api/cart ' + r.status);
        return r.json();
    });
}

// map item server -> shape local { id, name, name_vi, name_en, price, img, qty, stock }
function _mapServerItem(it) {
    var name = (_lang() === 'en') ? (it.name_en || it.name_vi) : (it.name_vi || it.name_en);
    return {
        id: it.product_id,
        name_vi: it.name_vi,
        name_en: it.name_en,
        name: name,
        price: it.unit_price,
        img: it.image || 'img/gucci.png',
        qty: it.quantity,
        stock: it.stock,
    };
}

function _applyServerCart(data) {
    _cart = (data && data.items ? data.items : []).map(_mapServerItem);
    _notify();
}

// Lấy lại giỏ từ server (vd sau khi đặt đơn — server đã xoá giỏ). No-op ở guest mode.
function refreshCart() {
    if (!_serverMode) return Promise.resolve();
    return _serverGet().then(_applyServerCart).catch(function (e) {
        console.error('[cart] refresh lỗi:', e);
    });
}
window.refreshCart = refreshCart;

// Chuyển sang server mode khi user đăng nhập: merge giỏ guest (nếu có) rồi lấy giỏ server.
function _enterServerMode() {
    if (_entering) return;
    _entering = true;
    _serverMode = true;

    var guest = _readLocal().filter(function (g) { return g.id != null; });

    var chain = _serverGet();
    if (guest.length) {
        // merge tuần tự (cộng dồn) rồi lấy lại giỏ server làm chuẩn
        chain = chain.then(function () {
            return guest.reduce(function (p, g) {
                return p.then(function () {
                    return window.AuthHelper.apiFetch('/api/cart', {
                        method: 'POST',
                        body: JSON.stringify({ product_id: g.id, quantity: g.qty, mode: 'add' }),
                    });
                });
            }, Promise.resolve());
        }).then(_serverGet);
    }

    chain.then(function (data) {
        _writeLocal([]);           // giỏ guest đã lên server, xoá để không merge lại
        _applyServerCart(data);
    }).catch(function (e) {
        console.error('[cart] không đồng bộ được giỏ server:', e);
        // giữ nguyên giỏ hiện có, vẫn cho phép thử lại lần sau
    }).finally(function () { _entering = false; });
}

function _exitServerMode() {
    _serverMode = false;
    _cart = _readLocal();
    _notify();
}

function _onAuth(user) {
    if (user && !_serverMode) _enterServerMode();
    else if (!user && _serverMode) _exitServerMode();
}

// ---- thao tác giỏ ----
function _flashAdded(btn) {
    if (!btn) return;
    var lang = _lang();
    var ct = window.__i18n && window.__i18n.T[lang] && window.__i18n.T[lang].cart;
    btn.textContent = ct ? ct.added : '✓ Đã thêm';
    btn.classList.add('added');
    setTimeout(function () {
        btn.textContent = ct ? ct.add : 'Thêm vào giỏ';
        btn.classList.remove('added');
    }, 1200);
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

    var rawId = item.getAttribute('data-id');
    var id = (rawId !== null && rawId !== '' && !isNaN(Number(rawId))) ? Number(rawId) : null;

    if (_serverMode) {
        if (id === null) {
            console.warn('[cart] không có product_id, bỏ qua đồng bộ server cho:', name);
            return;
        }
        var srvItem = _cart.find(function (p) { return p.id === id; });
        var newQty = (srvItem ? srvItem.qty : 0) + 1;
        if (srvItem) srvItem.qty = newQty;
        else _cart.push({ id: id, name: name, price: price, img: img, qty: 1 });
        _notify();
        _flashAdded(btn);
        window.AuthHelper.apiFetch('/api/cart', {
            method: 'POST',
            body: JSON.stringify({ product_id: id, quantity: newQty, mode: 'set' }),
        }).then(function (r) { return r.json(); }).then(_applyServerCart)
          .catch(function (e) { console.error('[cart] thêm giỏ lỗi:', e); });
        return;
    }

    // guest: dedupe theo id nếu có, ngược lại theo name
    const existing = id !== null
        ? _cart.find(function (p) { return p.id === id; })
        : _cart.find(function (p) { return p.name === name; });
    if (existing) existing.qty++;
    else _cart.push({ id: id, name: name, price: price, img: img, qty: 1 });
    saveCart(_cart);
    _flashAdded(btn);
}

function removeFromCart(name) {
    var item = _cart.find(function (p) { return p.name === name; });
    if (_serverMode) {
        if (!item) return;
        _cart = _cart.filter(function (p) { return p !== item; });
        _notify();
        window.AuthHelper.apiFetch('/api/cart/' + item.id, { method: 'DELETE' })
            .then(function (r) { return r.json(); }).then(_applyServerCart)
            .catch(function (e) { console.error('[cart] xoá giỏ lỗi:', e); });
        return;
    }
    saveCart(_cart.filter(function (p) { return p.name !== name; }));
}

function updateQty(name, delta) {
    const item = _cart.find(function (p) { return p.name === name; });
    if (!item) return;

    if (_serverMode) {
        var newQty = item.qty + delta;
        if (newQty <= 0) { removeFromCart(name); return; }
        item.qty = newQty;
        _notify();
        window.AuthHelper.apiFetch('/api/cart', {
            method: 'POST',
            body: JSON.stringify({ product_id: item.id, quantity: newQty, mode: 'set' }),
        }).then(function (r) { return r.json(); }).then(_applyServerCart)
          .catch(function (e) { console.error('[cart] cập nhật giỏ lỗi:', e); });
        return;
    }

    item.qty += delta;
    if (item.qty <= 0) saveCart(_cart.filter(function (p) { return p.name !== name; }));
    else saveCart(_cart);
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
    document.querySelectorAll('.product-info').forEach(function (info) {
        if (info.querySelector('.btn-add-cart')) return;
        const btn = document.createElement('button');
        btn.className = 'btn-add-cart';
        btn.textContent = 'Thêm vào giỏ';
        btn.onclick = function () { addToCart(this); };
        info.appendChild(btn);
    });
}

function _initSearchPersist() {
    document.querySelectorAll('.stext').forEach(function (input) {
        var box = input.closest('.box');
        var sbox = input.closest('.sbox');

        function sync() {
            var hasVal = input.value.length > 0;
            if (sbox) sbox.classList.toggle('has-text', hasVal);
            if (box) box.classList.toggle('has-text', hasVal);
        }

        input.addEventListener('input', sync);
        sync();
    });
}

// Đổi ngôn ngữ: cập nhật tên hiển thị các item server (guest item giữ nguyên tên đã lưu).
document.addEventListener('langchange', function () {
    if (!_serverMode) return;
    var lang = _lang();
    _cart.forEach(function (it) {
        if (it.name_vi || it.name_en) {
            it.name = (lang === 'en') ? (it.name_en || it.name_vi) : (it.name_vi || it.name_en);
        }
    });
    _notify();
});

document.addEventListener('DOMContentLoaded', function () {
    _injectCartIcon();
    _cart = _readLocal();       // khởi tạo giỏ guest; server mode sẽ ghi đè khi authchange
    _updateAllBadges();
    _injectAddToCartButtons();
    _initSearchPersist();

    // Nối trạng thái đăng nhập (nếu trang có auth-helper). onChange gọi ngay nếu đã sẵn sàng.
    if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
        window.AuthHelper.onChange(_onAuth);
    }
});
