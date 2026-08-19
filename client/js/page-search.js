// Script riêng của search.html — tách ra từ thẻ <script> inline cuối trang.
//
// Lấy sản phẩm THẬT từ /api/products rồi lọc phía client. Catalog ~50 sản phẩm
// (~16KB) nên lọc client là đủ; nếu sau này hàng nhiều lên thì chuyển sang tham
// số ?q= ở /api/products.
//
// RÀNG BUỘC THỨ TỰ LOAD — file này phải nằm CUỐI, sau:
//   - api-config.js  : cần window.API_BASE
//   - cart.js        : dùng lại window._injectAddToCartButtons()
//   - i18n.js        : cần window.__i18n
// và phải đứng SAU phần HTML của #search-input/#search-title/#results/#no-result,
// vì code đọc các phần tử này NGAY LÚC PARSE chứ không chờ DOMContentLoaded.

(function () {
    'use strict';

    var API_BASE = window.API_BASE || '';
    var keyword = (new URLSearchParams(window.location.search).get('q') || '').trim();

    var inputEl = document.getElementById('search-input');
    var titleEl = document.getElementById('search-title');
    var resultsEl = document.getElementById('results');
    var noResultEl = document.getElementById('no-result');
    var matched = [];

    if (inputEl) inputEl.value = keyword;   // giữ lại từ khoá để sửa & tìm tiếp

    function t(key, params) {
        return (window.__i18n && window.__i18n.t) ? window.__i18n.t(key, params) : key;
    }
    function lang() {
        return (window.__i18n && window.__i18n.current) || localStorage.getItem('ql_lang') || 'vi';
    }
    function productName(p) {
        return lang() === 'en' ? (p.name_en || p.name_vi) : (p.name_vi || p.name_en);
    }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Bỏ dấu để gõ không dấu vẫn ra: "quan nam" -> khớp "Quần Nam".
    // Lưu ý: đ/Đ KHÔNG tách được bằng NFD nên phải thay tay sau khi bỏ dấu thanh.
    function norm(s) {
        return String(s == null ? '' : s)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/đ/g, 'd')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Card DÙNG ĐÚNG markup trang danh mục (products-render.js): .product-item[data-id]
    // [data-stock] + .product-name + .product-price -> ăn nguyên CSS và nút thêm giỏ.
    function cardHTML(p) {
        var imgs = (p.images && p.images.length) ? p.images : ['img/breeze.png'];
        var imgDefault = imgs[0];
        var imgHover = imgs[1] || imgs[0];
        var nameEsc = esc(productName(p));

        var priceHTML = (p.sale_price != null)
            ? '<div class="product-price">' +
                  '<span class="price-default">' + money(p.price) + '</span> ' +
                  '<span class="price-sale">' + money(p.sale_price) + '</span>' +
              '</div>'
            : '<div class="product-price">' + money(p.price) + '</div>';

        var stock = Number(p.stock);
        var soldOut = Number.isFinite(stock) && stock <= 0;
        var stockAttr = Number.isFinite(stock) ? stock : '';

        return '' +
            '<li>' +
                '<div class="product-item reveal in' + (soldOut ? ' is-soldout' : '') + '"' +
                     ' data-id="' + p.id + '" data-stock="' + stockAttr + '">' +
                    '<div class="product-top">' +
                        '<a href="product.html?id=' + p.id + '" class="product-thumb">' +
                            '<img class="thumb-default" src="' + esc(imgDefault) + '" alt="' + nameEsc + '">' +
                            '<img class="thumb-hover thumb-fill" src="' + esc(imgHover) + '" alt="' + nameEsc + '">' +
                            (soldOut ? '<span class="soldout-badge">' + t('sr.soldOut') + '</span>' : '') +
                        '</a>' +
                    '</div>' +
                    '<div class="product-info">' +
                        '<a href="product.html?id=' + p.id + '" class="product-name">' + nameEsc + '</a>' +
                        priceHTML +
                    '</div>' +
                '</div>' +
            '</li>';
    }

    if (!keyword) {
        titleEl.textContent = t('sr.enterKeyword');
        return;
    }

    titleEl.textContent = t('sr.searching');

    fetch(API_BASE + '/api/products')
        .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(function (list) {
            // Khớp TẤT CẢ từ trong ô tìm kiếm (không cần đúng thứ tự):
            // "quan nam suong" vẫn ra "QUẦN NAM ỐNG SUÔNG".
            var tokens = norm(keyword).split(' ').filter(Boolean);
            matched = (list || []).filter(function (p) {
                var hay = norm((p.name_vi || '') + ' ' + (p.name_en || ''));
                return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
            });

            titleEl.innerHTML = t('sr.resultLine', { q: esc(keyword), n: matched.length });

            if (!matched.length) {
                noResultEl.style.display = 'block';
                return;
            }
            resultsEl.innerHTML = matched.map(cardHTML).join('');
            // Cards dựng sau DOMContentLoaded -> tự gọi để có nút "Thêm vào giỏ".
            if (typeof window._injectAddToCartButtons === 'function') {
                window._injectAddToCartButtons();
            }
        })
        .catch(function (err) {
            console.error('[search] không tải được sản phẩm:', err);
            titleEl.textContent = t('sr.loadErr', { msg: err.message });
        });

    // Đổi VI/EN: chỉ đổi chữ, không dựng lại card (giữ trạng thái nút thêm giỏ).
    document.addEventListener('langchange', function () {
        if (!keyword) { titleEl.textContent = t('sr.enterKeyword'); return; }
        titleEl.innerHTML = t('sr.resultLine', { q: esc(keyword), n: matched.length });
        matched.forEach(function (p) {
            var el = resultsEl.querySelector('.product-item[data-id="' + p.id + '"] .product-name');
            if (el) el.textContent = productName(p);
        });
        // Nhãn "Hết hàng" trên badge (dựng lúc render, không có data-i18n).
        resultsEl.querySelectorAll('.soldout-badge').forEach(function (b) {
            b.textContent = t('sr.soldOut');
        });
    });
})();
