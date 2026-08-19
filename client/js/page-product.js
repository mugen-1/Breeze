// Script riêng của product.html — tách ra từ thẻ <script> inline cuối trang.
//
// RÀNG BUỘC THỨ TỰ LOAD — phải nằm sau:
//   - api-config.js : cần window.API_BASE
//   - i18n.js       : cần window.__i18n
//   - cart.js       : dùng window._injectAddToCartButtons() cho card sản phẩm liên quan
// và phải đứng SAU markup của #pd-root/#pd-sizes/#sg-overlay/#sg-open/#sg-close,
// vì code đọc các phần tử này và gắn listener NGAY LÚC PARSE (không chờ
// DOMContentLoaded), lại không kiểm tra null -> dời lên trước là vỡ ngay.
//
// Nút "Thêm vào giỏ" dùng onclick="addToCart(this)" trong HTML; addToCart nằm ở
// cart.js chứ không phải file này.

(function () {
    /* Chi tiết sản phẩm ĐỘNG: đọc ?id (số) -> GET /api/products/:id.
       Đặt data-id lên .product-item để addToCart lấy đúng product_id (đồng bộ server-cart). */
    var API_BASE = window.API_BASE || '';

    function currentLang() {
        return (window.__i18n && window.__i18n.current) || localStorage.getItem('ql_lang') || 'en';
    }
    function pName(p) { return currentLang() === 'en' ? (p.name_en || p.name_vi) : (p.name_vi || p.name_en); }
    function pDesc(p) { return currentLang() === 'en' ? (p.description_en || p.description_vi || '') : (p.description_vi || p.description_en || ''); }

    // Size theo danh mục. Mặc định: áo/quần dùng S/M/L/XL.
    // Giày (sanpham-giay) dùng size số 41–44 (trái -> phải).
    var DEFAULT_SIZE = {
        sizes: ['S', 'M', 'L', 'XL'],
        guide: {
            cols: ['Size', 'Ngực', 'Dài áo', 'Vai'],
            rows: [['S', '92', '67', '43'], ['M', '98', '69', '45'], ['L', '104', '71', '47'], ['XL', '110', '73', '49']]
        }
    };
    var SIZE_BY_CATEGORY = {
        'sanpham-giay': {
            sizes: ['41', '42', '43', '44'],
            guide: {
                cols: ['Size', 'Dài chân (cm)'],
                rows: [['41', '26.0'], ['42', '26.7'], ['43', '27.3'], ['44', '28.0']]
            }
        }
    };
    //ẩn hẳn phần chọn size + link/bảng size.
    var NO_SIZE_CATEGORIES = ['gold-jewellery', 'handbags'];

    function renderSizes(categorySlug) {
        var head = document.querySelector('.pd-size-head');
        var box = document.getElementById('pd-sizes');
        if (NO_SIZE_CATEGORIES.indexOf(categorySlug) !== -1) {
            if (head) head.style.display = 'none';
            if (box) { box.style.display = 'none'; box.innerHTML = ''; }
            return;
        }
        if (head) head.style.display = '';
        if (box) box.style.display = '';

        var cfg = SIZE_BY_CATEGORY[categorySlug] || DEFAULT_SIZE;
        if (box) {
            box.innerHTML = cfg.sizes.map(function (s, i) {
                return '<button type="button" class="pd-size' + (i === 0 ? ' selected' : '') +
                    '" data-size="' + esc(s) + '">' + esc(s) + '</button>';
            }).join('');
        }
        var g = cfg.guide;
        var gHead = document.querySelector('.sg-table thead t');
        if (gHead) gHead.innerHTML = g.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('');
        var body = document.querySelector('.sg-table tbody');
        if (body) {
            body.innerHTML = g.rows.map(function (row) {
                return '<t>' + row.map(function (cell) { return '<td>' + esc(cell) + '</td>'; }).join('') + '</t>';
            }).join('');
        }
    }

    function getId() {
        try {
            var raw = new URLSearchParams(window.location.search).get('id');
            if (raw === null || raw === '' || isNaN(Number(raw))) return null;
            return Number(raw);
        } catch (e) { return null; }
    }

    var root = document.getElementById('pd-root');
    var nameEl = document.getElementById('pd-name');
    var priceEl = document.getElementById('pd-price');
    var descEl = document.getElementById('pd-desc');
    var mainImg = document.getElementById('pd-main-img');
    var thumbsWrap = document.getElementById('pd-thumbs');
    var addBtn = document.querySelector('.pd-add');

    var current = null;
    var relatedProducts = [];

    function renderPrice(p) {
        if (p.sale_price != null) {
            priceEl.innerHTML =
                '<span class="price-default" style="text-decoration:line-through;color:#999;margin-right:10px;">' + money(p.price) + '</span>' +
                '<span class="price-sale">' + money(p.sale_price) + '</span>';
        } else {
            priceEl.textContent = money(p.price);
        }
    }

    function renderProduct(p) {
        current = p;
        root.setAttribute('data-id', p.id);       // <-- product_id cho addToCart
        nameEl.textContent = pName(p);
        renderPrice(p);
        descEl.textContent = pDesc(p);
        document.title = pName(p) + ' - BREEZE';
        renderSizes(p.category_slug);

        var imgs = (p.images && p.images.length) ? p.images : ['img/breeze.png'];
        mainImg.src = imgs[0];
        mainImg.alt = pName(p);

        thumbsWrap.innerHTML = '';
        imgs.forEach(function (src, i) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'pd-thumb' + (i === 0 ? ' active' : '');
            b.innerHTML = '<img src="' + esc(src) + '" alt="' + esc(pName(p)) + '">';
            b.addEventListener('click', function () {
                mainImg.src = src;
                thumbsWrap.querySelectorAll('.pd-thumb').forEach(function (t) { t.classList.remove('active'); });
                b.classList.add('active');
            });
            thumbsWrap.appendChild(b);
        });

        // Tồn kho: stock <= 0 => hết hàng. Set data-stock để addToCart (cart.js) chặn thêm giỏ.
        var st = Number(p.stock);
        var soldOut = Number.isFinite(st) && st <= 0;
        root.setAttribute('data-stock', Number.isFinite(st) ? st : '');
        if (addBtn) {
            addBtn.disabled = soldOut;
            addBtn.textContent = soldOut ? t('sr.soldOut') : t('pd.addToCart');
            addBtn.classList.toggle('sold-out', soldOut);
            var note = document.getElementById('pd-soldout-note');
            if (soldOut) {
                if (!note) {
                    note = document.createElement('p');
                    note.id = 'pd-soldout-note';
                    note.className = 'pd-soldout-note';
                    note.textContent = 'Sản phẩm tạm hết hàng.';
                    addBtn.parentNode.insertBefore(note, addBtn.nextSibling);
                }
                note.style.display = 'block';
            } else if (note) {
                note.style.display = 'none';
            }
        }
        loadRelated(p);
    }

    function showError(msg) {
        nameEl.textContent = msg;
        priceEl.textContent = '';
        descEl.textContent = '';
        if (addBtn) addBtn.disabled = true;
    }

    function relatedCard(p) {
        var imgs = (p.images && p.images.length) ? p.images : ['img/breeze.png'];
        var priceHTML = p.sale_price != null
            ? '<div class="product-price"><span class="price-default">' + money(p.price) + '</span> <span class="price-sale">' + money(p.sale_price) + '</span></div>'
            : '<div class="product-price">' + money(p.price) + '</div>';
        var nm = esc(pName(p));
        return '<li><div class="product-item reveal in" data-id="' + p.id + '">' +
            '<div class="product-top"><a href="product.html?id=' + p.id + '" class="product-thumb">' +
                '<img src="' + esc(imgs[0]) + '" alt="' + nm + '"></a></div>' +
            '<div class="product-info"><a href="product.html?id=' + p.id + '" class="product-name">' + nm + '</a>' + priceHTML + '</div>' +
            '</div></li>';
    }

    function loadRelated(p) {
        if (!p.category_slug) return;
        fetch(API_BASE + '/api/products?category=' + encodeURIComponent(p.category_slug))
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (list) {
                relatedProducts = (list || []).filter(function (x) { return x.id !== p.id; }).slice(0, 4);
                var ul = document.getElementById('pd-related-list');
                if (!ul || !relatedProducts.length) return;
                ul.innerHTML = relatedProducts.map(relatedCard).join('');
                if (typeof window._injectAddToCartButtons === 'function') window._injectAddToCartButtons();
                var ct = window.__i18n && window.__i18n.T[currentLang()] && window.__i18n.T[currentLang()].cart;
                if (ct) ul.querySelectorAll('.btn-add-cart:not(.added)').forEach(function (b) { b.textContent = ct.add; });
            })
            .catch(function (e) { console.error('[product] related lỗi:', e); });
    }

    // Đổi ngôn ngữ: cập nhật tên/giá/mô tả sản phẩm chính + tên card liên quan.
    document.addEventListener('langchange', function () {
        if (current) {
            nameEl.textContent = pName(current);
            renderPrice(current);
            descEl.textContent = pDesc(current);
            document.title = pName(current) + ' - BREEZE';
            mainImg.alt = pName(current);
        }
        relatedProducts.forEach(function (p) {
            var el = document.querySelector('#pd-related-list .product-item[data-id="' + p.id + '"] .product-name');
            if (el) el.textContent = pName(p);
        });
        // Nút thêm giỏ: giữ đúng trạng thái Hết hàng / Thêm vào giỏ.
        if (addBtn && !addBtn.classList.contains('added')) {
            addBtn.textContent = addBtn.classList.contains('sold-out')
                ? t('sr.soldOut') : t('pd.addToCart');
        }
    });

    // Fetch sản phẩm chính.
    var id = getId();
    if (id === null) {
        showError((window.__i18n ? window.__i18n.t('pd.notFound') : 'Không tìm thấy sản phẩm'));
    } else {
        if (addBtn) addBtn.disabled = true;
        fetch(API_BASE + '/api/products/' + id)
            .then(function (r) {
                if (r.status === 404) throw new Error('NOTFOUND');
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(renderProduct)
            .catch(function (e) {
                console.error('[product] fetch lỗi:', e);
                showError(e.message === 'NOTFOUND' ? 'Không tìm thấy sản phẩm' : 'Không tải được sản phẩm');
            });
    }

    // Chọn size (tĩnh).
    document.getElementById('pd-sizes').addEventListener('click', function (e) {
        var btn = e.target.closest('.pd-size');
        if (!btn) return;
        this.querySelectorAll('.pd-size').forEach(function (s) { s.classList.remove('selected'); });
        btn.classList.add('selected');
    });

    // Modal bảng size.
    var overlay = document.getElementById('sg-overlay');
    function openSG() { overlay.classList.add('open'); document.body.style.overflow = 'hidden'; }
    function closeSG() { overlay.classList.remove('open'); document.body.style.overflow = ''; }
    document.getElementById('sg-open').addEventListener('click', openSG);
    document.getElementById('sg-close').addEventListener('click', closeSG);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeSG(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSG(); });
})();
