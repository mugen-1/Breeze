/* cart.js — giỏ hàng client.
   - Khách CHƯA đăng nhập: dùng localStorage như cũ (offline, không cần server).
   - Đã đăng nhập (AuthHelper có user): mọi thao tác đồng bộ qua API /api/cart (Bearer token).
     Khi đăng nhập mà localStorage còn giỏ cũ -> merge lên server 1 lần rồi xoá localStorage.
   - Giữ NGUYÊN API đồng bộ: getCart / saveCart / addToCart / updateQty / removeFromCart /
     _updateAllBadges / _injectAddToCartButtons — để cart-drawer.js, cart.html,
     products-render.js không phải đổi. _cart (in-memory) là nguồn sự thật ở CẢ hai chế độ.
     (formatPrice từng nằm ở đây, nay là money() dùng chung trong js/utils-format.js.)
   - Mỗi lần giỏ đổi phát sự kiện document 'cartchange' để các view render lại. */

var CART_KEY = 'bookstore_cart';
// Trần số lượng một dòng giỏ — PHẢI khớp MAX_QTY ở server/routes/cart.js (server trả 400
// nếu vượt). page-cart.js và cart-drawer.js đọc biến này để khoá nút "+".
var CART_MAX_QTY = 99;

var _cart = [];            // nguồn sự thật in-memory (cả guest lẫn server mode)
var _serverMode = false;   // true khi đã đăng nhập & đồng bộ server
var _entering = false;     // chống chạy chồng khi vào server mode
// Giỏ gắn với DANH TÍNH: mỗi tài khoản một giỏ (server), khách một giỏ riêng (localStorage).
var _uid = null;           // uid Firebase của chủ giỏ đang hiển thị; null = khách
var _authResolved = false; // đã biết chắc đang là khách hay tài khoản nào chưa

function _lang() {
    return (window.__i18n && window.__i18n.current) || localStorage.getItem('ql_lang') || 'vi';
}
// Tra từ điển UI (js/i18n.js). Trả về khoá nếu i18n chưa nạp -> không bao giờ throw.
function _t(key, params) {
    return (window.__i18n && window.__i18n.t) ? window.__i18n.t(key, params) : key;
}

function getCart() { return _cart; }
function cartItemKey(it) { return it.variant_id ? 'v' + it.variant_id : String(it.id); }
function cartItemMatches(it, key) { return cartItemKey(it) === String(key); }

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
        variant_id: it.variant_id,
        size: it.size || null,
        color: it.color || null,
        available: it.available,
        name_vi: it.name_vi,
        name_en: it.name_en,
        name: name,
        price: it.unit_price,
        img: it.image || 'img/breeze.png',
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

    var forUid = _uid;   // giỏ đang tải là của tài khoản này; đổi người giữa chừng -> bỏ kết quả

    // Chỉ id sản phẩm THẬT (số dương) mới merge lên server; bỏ id cục bộ âm (item không có product_id).
    var guest = _readLocal().filter(function (g) { return typeof g.id === 'number' && g.id >= 0; });
    // Xoá NGAY giỏ khách: từ lúc này giỏ thuộc về tài khoản vừa đăng nhập, không được
    // rơi lại cho khách hay tài khoản khác dùng chung máy (kể cả khi merge dưới đây lỗi).
    _writeLocal([]);

    var chain = _serverGet();
    if (guest.length) {
        // merge tuần tự (cộng dồn) rồi lấy lại giỏ server làm chuẩn
        chain = chain.then(function () {
            return guest.reduce(function (p, g) {
                return p.then(function () {
                    // Kẹp ở trần: giỏ khách cũ (trước khi có trần) có thể lớn hơn 99 —
                    // gửi nguyên thì server trả 400 và món đó mất hẳn, vì giỏ khách đã xoá.
                    return window.AuthHelper.apiFetch('/api/cart', {
                        method: 'POST',
                        body: JSON.stringify({ product_id: g.id, variant_id: g.variant_id, quantity: Math.min(g.qty, CART_MAX_QTY), mode: 'add' }),
                    }).then(function (r) { if (!r.ok) _cartToast(_t('pd.cartReview')); });
                });
            }, Promise.resolve());
        }).then(_serverGet);
    }

    chain.then(function (data) {
        if (_uid !== forUid) return;   // đã đăng xuất / đổi tài khoản -> KHÔNG hiện giỏ vừa tải
        _applyServerCart(data);
    }).catch(function (e) {
        console.error('[cart] không đồng bộ được giỏ server:', e);
        // giữ nguyên giỏ hiện có, vẫn cho phép thử lại lần sau
    }).finally(function () {
        _entering = false;
        // Đổi tài khoản trong lúc đang tải -> tải lại giỏ của tài khoản hiện tại.
        if (_uid && _uid !== forUid) _enterServerMode();
    });
}

function _exitServerMode() {
    _serverMode = false;
    _cart = _readLocal();   // về giỏ của khách trên máy này
    _notify();
}

// Đổi danh tính (đăng nhập / đăng xuất / đổi tài khoản) -> nạp lại giỏ đúng chủ.
// Badge vì thế luôn là số của người đang đăng nhập, không dùng chung với khách hay user khác.
function _onAuth(user) {
    var uid = user ? user.uid : null;
    if (_authResolved && uid === _uid) return;   // cùng một người -> khỏi nạp lại
    _authResolved = true;
    _uid = uid;

    if (uid) {
        _serverMode = false;   // buộc nạp lại từ đầu khi đổi sang tài khoản khác
        _cart = [];            // không để giỏ của chủ cũ hiện trong lúc chờ server
        _notify();
        _enterServerMode();
    } else {
        _exitServerMode();
    }
}

// ---- thao tác giỏ ----
// Toast báo lỗi giỏ hàng (vd tài khoản bị khoá mua hàng). Tự chứa vì cart.js chạy
// trên hầu hết mọi trang — KHÔNG dùng alert() theo quy ước của project.
function _cartToast(msg) {
    if (!document.getElementById('cart-toast-style')) {
        var st = document.createElement('style');
        st.id = 'cart-toast-style';
        st.textContent =
            '.cart-toast{position:fixed;left:50%;bottom:32px;transform:translate(-50%,12px);z-index:3000;' +
            'background:var(--c-ink,#0e0e0e);color:var(--c-bg,#fff);font-family:var(--font-ui,\'Jost\',sans-serif);' +
            'font-size:14px;letter-spacing:.02em;padding:12px 22px;border-radius:999px;' +
            'box-shadow:0 10px 30px rgba(14,14,14,.22);opacity:0;pointer-events:none;' +
            'transition:opacity .3s ease,transform .3s ease;}' +
            '.cart-toast.is-on{opacity:1;transform:translate(-50%,0);}';
        document.head.appendChild(st);
    }
    var t = document.createElement('div');
    t.className = 'cart-toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-on'); });
    setTimeout(function () {
        t.classList.remove('is-on');
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 2600);
}

// Server từ chối một thao tác giỏ (MỌI status không ok: 400 vượt trần, 401 hết phiên,
// 403 blacklist, 5xx...): hoàn tác thay đổi lạc quan + toast, rồi trả null để lời gọi
// bỏ qua _applyServerCart. Body lỗi KHÔNG phải giỏ hàng — áp nó vào là giỏ hiện trống.
// Chỉ 403 mới hiện message của server (giữ như cũ); lỗi khác dùng câu i18n, vì message
// server là chữ kỹ thuật tiếng Việt, không dịch.
function _rejectCartChange(r, rollback, fallbackKey) {
    return r.json().catch(function () { return {}; }).then(function (data) {
        rollback();
        _notify();
        var msg = data.error === 'BLACKLISTED' ? _t('acc.blocked')
            : (r.status === 403 && data.message) ? data.message
            : _t(fallbackKey);
        _cartToast(msg);
        return null;
    });
}

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

// Đọc trạng thái hết hàng từ .product-item (data-stock="0"). Dùng cho card + nút.
function _isSoldOut(item) {
    return !!item && item.getAttribute('data-stock') === '0';
}

// Khách bấm thêm giỏ TRƯỚC khi biết trạng thái đăng nhập (giỏ đang để rỗng chờ xác định):
// nạp lại giỏ khách đã lưu để lần ghi sau không xoá mất món của lần truy cập trước.
function _hydrateGuestIfNeeded() {
    if (!_authResolved && !_serverMode && _cart.length === 0) _cart = _readLocal();
}

function addToCart(btn) {
    const item = btn.closest('.product-item');
    if (!item || _isSoldOut(item)) return false;
    var variantId = Number(item.getAttribute('data-variant-id')) || null;
    var size = item.getAttribute('data-size') || null;
    var color = item.getAttribute('data-color') || null;
    var configured = item.getAttribute('data-size-configured');
    var colorConfigured = item.getAttribute('data-color-configured');
    if ((configured === 'true' || colorConfigured === 'true') && !variantId) {
        if (item.id !== 'pd-root') window.location.href = window.BreezeRoutes.product(Number(item.getAttribute('data-id')));
        else _cartToast(_t(colorConfigured === 'true' && !color ? 'pd.selectColor' : 'pd.selectSize'));
        return false;
    }
    // Static home cards have no variant metadata: resolve before adding, including guest carts.
    if (configured === null && colorConfigured === null && item.getAttribute('data-id') !== null) {
        btn.disabled = true;
        fetch((window.API_BASE || '') + '/api/products/' + encodeURIComponent(item.getAttribute('data-id')))
            .then(function (r) { if (!r.ok) throw new Error('product ' + r.status); return r.json(); })
            .then(function (p) {
                item.setAttribute('data-size-configured', p.size_configured ? 'true' : 'false');
                item.setAttribute('data-color-configured', p.color_configured ? 'true' : 'false');
                item.setAttribute('data-stock', p.stock);
                if (!p.size_configured && !p.color_configured && p.variants && p.variants[0]) item.setAttribute('data-variant-id', p.variants[0].id);
                window.addToCart(btn);
            }).catch(function () { _cartToast(_t('acc.errAddCart')); })
            .finally(function () { btn.disabled = false; });
        return false;
    }
    _hydrateGuestIfNeeded();
    const nameEl = item.querySelector('.product-name') || item.querySelector('.product-cat');
    const salePriceEl = item.querySelector('.price-sale');
    const priceEl = salePriceEl || item.querySelector('.product-price');
    const imgEl = item.querySelector('img');

    const name = nameEl ? nameEl.textContent.trim() : _t('acc.product');
    const priceText = priceEl ? priceEl.textContent.trim() : '0';
    const price = parseInt(priceText.replace(/[^\d]/g, '')) || 0;
    const img = imgEl ? imgEl.getAttribute('src') : '';

    var rawId = item.getAttribute('data-id');
    var id = (rawId !== null && rawId !== '' && !isNaN(Number(rawId))) ? Number(rawId) : null;
    var key = variantId ? 'v' + variantId : String(id);

    if (_serverMode) {
        if (id === null) {
            console.warn('[cart] không có product_id, bỏ qua đồng bộ server cho:', name);
            return;
        }
        var srvItem = _cart.find(function (p) { return cartItemMatches(p, key); });
        if (srvItem && srvItem.qty >= CART_MAX_QTY) {
            _cartToast(_t('acc.maxQty', { max: CART_MAX_QTY }));
            return;
        }
        var prevQty = srvItem ? srvItem.qty : null;   // để rollback nếu server chặn
        var newQty = (srvItem ? srvItem.qty : 0) + 1;
        if (srvItem) srvItem.qty = newQty;
        else _cart.push({ id: id, variant_id: variantId, size: size, color: color, name: name, price: price, img: img, qty: 1 });
        _notify();
        _flashAdded(btn);
        window.AuthHelper.apiFetch('/api/cart', {
            method: 'POST',
            body: JSON.stringify({ product_id: id, variant_id: variantId || undefined, quantity: newQty, mode: 'set' }),
        }).then(function (r) {
            if (!r.ok) {
                // Rollback đúng thay đổi lạc quan vừa làm (không phải xoá cả giỏ).
                return _rejectCartChange(r, function () {
                    if (prevQty !== null) { srvItem.qty = prevQty; }
                    else { _cart = _cart.filter(function (p) { return !cartItemMatches(p, key); }); }
                }, 'acc.errAddCart');
            }
            return r.json();
        }).then(function (data) { if (data) _applyServerCart(data); })
          .catch(function (e) { console.error('[cart] thêm giỏ lỗi:', e); });
        return true;
    }

    // guest: dedupe theo id THẬT; sản phẩm không có id -> cấp id cục bộ âm & duy nhất (-Date.now()).
    // name KHÔNG còn là định danh remove/update (id âm là duy nhất) — name chỉ để gộp dòng trùng tên
    // trong nhóm không-id, tránh bug cũ removeFromCart(null) xoá sạch mọi item không id.
    const existing = id !== null
        ? _cart.find(function (p) { return cartItemMatches(p, key); })
        : _cart.find(function (p) { return p.id < 0 && p.name === name; });
    // Giỏ khách cũng kẹp trần: vượt 99 thì lúc đăng nhập merge lên server sẽ bị 400.
    if (existing && existing.qty >= CART_MAX_QTY) {
        _cartToast(_t('acc.maxQty', { max: CART_MAX_QTY }));
        return;
    }
    if (existing) existing.qty++;
    else _cart.push({ id: (id !== null ? id : -Date.now()), variant_id: variantId, size: size, color: color, name: name, price: price, img: img, qty: 1 });
    saveCart(_cart);
    _flashAdded(btn);
    return true;
}

function removeFromCart(id) {
    var item = _cart.find(function (p) { return cartItemMatches(p, id); });
    if (_serverMode) {
        if (!item) return;
        var idx = _cart.indexOf(item);
        _cart = _cart.filter(function (p) { return p !== item; });
        _notify();
        window.AuthHelper.apiFetch('/api/cart/' + (item.variant_id ? 'variant/' + item.variant_id : item.id), { method: 'DELETE' })
            .then(function (r) {
                if (!r.ok) {
                    // Đặt món lại đúng chỗ cũ — trừ khi trong lúc chờ, giỏ đã được nạp
                    // lại từ server và đã có nó (tránh hiện 2 dòng trùng).
                    return _rejectCartChange(r, function () {
                        if (_cart.some(function (p) { return cartItemKey(p) === cartItemKey(item); })) return;
                        _cart.splice(Math.min(idx, _cart.length), 0, item);
                    }, 'acc.errUpdCart');
                }
                return r.json();
            })
            .then(function (data) { if (data) _applyServerCart(data); })
            .catch(function (e) { console.error('[cart] xoá giỏ lỗi:', e); });
        return;
    }
    saveCart(_cart.filter(function (p) { return !cartItemMatches(p, id); }));
}

function updateQty(id, delta) {
    const item = _cart.find(function (p) { return cartItemMatches(p, id); });
    if (!item) return;
    // Nút "+" đã bị khoá ở trần (page-cart.js, cart-drawer.js); chặn thêm ở đây cho mọi
    // đường gọi khác. Chỉ chặn chiều TĂNG: giỏ cũ lỡ vượt trần vẫn giảm xuống được.
    if (delta > 0 && item.qty + delta > CART_MAX_QTY) return;
    if (delta > 0 && (item.available === false || (item.stock != null && item.qty + delta > item.stock))) return;

    if (_serverMode) {
        var prevQty = item.qty;
        var newQty = item.qty + delta;
        if (newQty <= 0) { removeFromCart(id); return; }
        item.qty = newQty;
        _notify();
        window.AuthHelper.apiFetch('/api/cart', {
            method: 'POST',
            body: JSON.stringify({ product_id: item.id, variant_id: item.variant_id, quantity: newQty, mode: 'set' }),
        }).then(function (r) {
            if (!r.ok) {
                return _rejectCartChange(r, function () {
                    item.qty = prevQty;         // rollback thay đổi lạc quan
                }, 'acc.errUpdCart');
            }
            return r.json();
        }).then(function (data) { if (data) _applyServerCart(data); })
          .catch(function (e) { console.error('[cart] cập nhật giỏ lỗi:', e); });
        return;
    }

    item.qty += delta;
    if (item.qty <= 0) saveCart(_cart.filter(function (p) { return !cartItemMatches(p, id); }));
    else saveCart(_cart);
}


function _injectAddToCartButtons() {
    document.querySelectorAll('.product-info').forEach(function (info) {
        if (info.querySelector('.btn-add-cart, .btn-soldout')) return;
        if (info.closest('[data-no-cart]')) return; // vùng chỉ để xem, không chèn nút thêm giỏ
        var item = info.closest('.product-item');
        const btn = document.createElement('button');
        if (_isSoldOut(item)) {
            // Hết hàng: nút "Hết hàng" bị vô hiệu (KHÔNG class btn-add-cart để i18n không đổi nhãn).
            btn.className = 'btn-soldout';
            btn.textContent = _t('sr.soldOut');
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
        } else {
            btn.className = 'btn-add-cart';
            btn.textContent = _t('pd.addToCart');
            btn.onclick = function () { addToCart(this); };
        }
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

// Nút gắn data-action — thay cho onclick="..." inline cũ (CSP chặn handler inline).
// Gắn ở document nên nút sinh sau (render động) cũng nhận.
//   add-to-cart   : nút "Thêm vào giỏ" của trang sản phẩm. Gọi window.addToCart chứ KHÔNG
//                   gọi thẳng hàm trong file này: cart-drawer.js thay window.addToCart bằng
//                   bản bọc (thêm xong thì mở drawer) — onclick cũ cũng gọi đúng bản đó.
//   submit-search : kính lúp ô tìm kiếm ở header trang chủ (<a href="#">). form.submit()
//                   chứ không requestSubmit() — giữ đúng hành vi onclick cũ.
document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var act = el.getAttribute('data-action');
    if (act === 'add-to-cart') {
        window.addToCart(el);
    } else if (act === 'submit-search') {
        e.preventDefault();
        var form = el.closest('form');
        if (form) form.submit();
    }
});

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

/* ---- Gate thanh toán dùng chung (cart.html + cart-drawer.js) ----
   Luồng:
   - Giỏ rỗng                 -> onError('Giỏ hàng ... trống').
   - Chưa đăng nhập           -> login.html?redirect=checkout.html (login xong quay lại checkout).
   - Đã đăng nhập & là admin  -> onError('Tài Khoản Không Đúng ...') — admin không được đặt đơn.
   - Đã đăng nhập, user thường -> chuyển tới checkout.html.
   onError(msg): cách hiển thị lỗi tuỳ trang (cart.html dùng ô message, drawer dùng alert). */
function startCheckout(opts) {
    opts = opts || {};
    var onError = (typeof opts.onError === 'function') ? opts.onError
        : function (m) { window.alert(m); };

    if (getCart().length === 0) {
        onError(_t('acc.cartEmpty'));
        return;
    }

    if (!(window.AuthHelper && window.AuthHelper.isLoggedIn())) {
        window.location.href = window.BreezeRoutes.to('login', { redirect: 'checkout' });
        return;
    }

    // Đã đăng nhập: kiểm tra role qua /api/me (admin không được thanh toán).
    window.AuthHelper.apiFetch('/api/me')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (me) {
            if (me && me.role === 'admin') {
                onError(_t('acc.adminBlocked'));
                return;
            }
            window.location.href = window.BreezeRoutes.to('checkout');
        })
        .catch(function () {
            // Không kiểm tra được role (mạng lỗi) -> vẫn cho user thường tiếp tục.
            window.location.href = window.BreezeRoutes.to('checkout');
        });
}
window.startCheckout = startCheckout;

document.addEventListener('DOMContentLoaded', function () {
    // Header KHÔNG còn icon giỏ riêng — lối vào giỏ nằm trong menu icon tài khoản
    // (js/account-menu.js). Badge số lượng cũng gắn trên icon tài khoản đó.
    if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
        // Chưa biết ai đang dùng máy -> để giỏ RỖNG, chưa đọc localStorage:
        // giỏ khách không được hiện cho tài khoản vừa đăng nhập và ngược lại.
        // _onAuth bên dưới nạp đúng giỏ ngay khi biết: khách -> localStorage, user -> server.
        _cart = [];
    } else {
        _cart = _readLocal();   // trang không nạp auth-helper: chỉ có chế độ khách
    }
    _updateAllBadges();
    _injectAddToCartButtons();
    _initSearchPersist();

    // Nối trạng thái đăng nhập (nếu trang có auth-helper). onChange gọi ngay nếu đã sẵn sàng.
    if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
        window.AuthHelper.onChange(_onAuth);
    }
});
