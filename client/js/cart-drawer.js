/* Mini-cart drawer trượt từ phải.
   Tái dùng getCart / saveCart / updateQty / removeFromCart / formatPrice / _updateAllBadges
   trong cart.js — KHÔNG viết lại logic lưu trữ. */
(function () {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function cart() { return (typeof getCart === 'function') ? getCart() : []; }
    function money(n) { return (typeof formatPrice === 'function') ? formatPrice(n) : (n + 'đ'); }

    var backdrop, drawer, bodyEl, totalEl, countEl;

    function build() {
        if (document.getElementById('cart-drawer')) return;

        backdrop = document.createElement('div');
        backdrop.className = 'cart-backdrop';
        backdrop.id = 'cart-backdrop';

        drawer = document.createElement('aside');
        drawer.className = 'cart-drawer';
        drawer.id = 'cart-drawer';
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
        drawer.setAttribute('aria-label', 'Giỏ hàng');
        drawer.setAttribute('aria-hidden', 'true');
        drawer.innerHTML =
            '<div class="cart-drawer-head">' +
                '<span class="cart-drawer-title">Giỏ hàng (<span id="cart-drawer-count">0</span>)</span>' +
                '<button type="button" class="cart-drawer-close" id="cart-drawer-close" aria-label="Đóng">&times;</button>' +
            '</div>' +
            '<div class="cart-drawer-body" id="cart-drawer-body"></div>' +
            '<div class="cart-drawer-foot">' +
                '<div class="cd-total"><span>Tổng cộng</span><span class="cd-total-val" id="cart-drawer-total">0đ</span></div>' +
                '<a class="cart-btn cart-btn-primary" href="cart.html">Thanh toán</a>' +
                '<a class="cart-btn cart-btn-ghost" href="cart.html">Xem giỏ hàng</a>' +
            '</div>';

        document.body.appendChild(backdrop);
        document.body.appendChild(drawer);

        bodyEl = document.getElementById('cart-drawer-body');
        totalEl = document.getElementById('cart-drawer-total');
        countEl = document.getElementById('cart-drawer-count');

        document.getElementById('cart-drawer-close').addEventListener('click', close);
        backdrop.addEventListener('click', close);

        // Tăng/giảm qty + xoá item (delegation)
        bodyEl.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-act]');
            if (!btn) return;
            var line = e.target.closest('.cart-line');
            if (!line) return;
            var name = line.getAttribute('data-name');
            var act = btn.getAttribute('data-act');
            if (act === 'inc' && typeof updateQty === 'function') updateQty(name, 1);
            else if (act === 'dec' && typeof updateQty === 'function') updateQty(name, -1);
            else if (act === 'remove' && typeof removeFromCart === 'function') removeFromCart(name);
            render(); // saveCart bên trong đã tự gọi _updateAllBadges
        });
    }

    // Đảm bảo cart link tĩnh (.ph-actions) cũng có badge để đồng bộ số realtime
    function ensurePhBadge() {
        var link = document.querySelector('.ph-actions a[aria-label="Giỏ hàng"]');
        if (link && !link.querySelector('.cart-badge')) {
            var b = document.createElement('span');
            b.className = 'cart-badge';
            b.textContent = '0';
            link.appendChild(b);
        }
    }

    function render() {
        var items = cart();
        var count = items.reduce(function (s, i) { return s + i.qty; }, 0);
        if (countEl) countEl.textContent = count;

        if (!items.length) {
            bodyEl.innerHTML = '<div class="cart-empty">Giỏ hàng của bạn đang trống.</div>';
        } else {
            bodyEl.innerHTML = items.map(function (it) {
                return '<div class="cart-line" data-name="' + esc(it.name) + '">' +
                    '<img class="cart-line-img" src="' + esc(it.img) + '" alt="">' +
                    '<div class="cart-line-main">' +
                        '<span class="cart-line-name">' + esc(it.name) + '</span>' +
                        '<span class="cart-line-price">' + money(it.price) + '</span>' +
                        '<span class="cart-qty">' +
                            '<button type="button" data-act="dec" aria-label="Giảm">&minus;</button>' +
                            '<span>' + it.qty + '</span>' +
                            '<button type="button" data-act="inc" aria-label="Tăng">+</button>' +
                        '</span>' +
                    '</div>' +
                    '<button type="button" class="cart-line-remove" data-act="remove">Xóa</button>' +
                '</div>';
            }).join('');
        }

        var total = items.reduce(function (s, i) { return s + i.price * i.qty; }, 0);
        if (totalEl) totalEl.textContent = money(total);
    }

    function open() {
        render();
        backdrop.classList.add('open');
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        document.body.classList.add('cart-drawer-open');
    }
    function close() {
        backdrop.classList.remove('open');
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('cart-drawer-open');
    }

    function init() {
        build();
        ensurePhBadge();
        render();
        if (typeof _updateAllBadges === 'function') _updateAllBadges();

        // 3. Mở drawer khi addToCart (bọc hàm gốc trong cart.js, giữ nguyên logic)
        if (typeof window.addToCart === 'function') {
            var orig = window.addToCart;
            window.addToCart = function (btn) {
                orig.call(this, btn);
                open();
            };
        }

        // Click icon giỏ hàng (icon inject của cart.js hoặc link tĩnh) → mở mini-cart
        document.addEventListener('click', function (e) {
            var trigger = e.target.closest('.cart-icon-btn, .ph-actions a[aria-label="Giỏ hàng"], [data-cart-open]');
            if (trigger) { e.preventDefault(); open(); }
        });

        // 5. Esc để đóng
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') close();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Cho phép mở/refresh từ nơi khác nếu cần
    window.CartDrawer = { open: function () { open(); }, close: close, render: render };
})();
