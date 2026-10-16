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
// Nút "Thêm vào giỏ" mang data-action="add-to-cart"; cart.js bắt click đó (delegation ở
// document) và gọi addToCart — không phải file này.

(function () {
    /* Chi tiết sản phẩm ĐỘNG: đọc ?id (số) -> GET /api/products/:id.
       Đặt data-id lên .product-item để addToCart lấy đúng product_id (đồng bộ server-cart). */
    var API_BASE = window.API_BASE || '';

    function currentLang() {
        return (window.__i18n && window.__i18n.current) || localStorage.getItem('ql_lang') || 'en';
    }
    function pName(p) { return currentLang() === 'en' ? (p.name_en || p.name_vi) : (p.name_vi || p.name_en); }
    function pDesc(p) { return currentLang() === 'en' ? (p.description_en || p.description_vi || '') : (p.description_vi || p.description_en || ''); }
    function categoryName(p) {
        var pack = window.__i18n && window.__i18n.T && window.__i18n.T[currentLang()];
        var pages = pack && pack.page;
        return pages && Object.prototype.hasOwnProperty.call(pages, p.category_slug) ? pages[p.category_slug] : '';
    }

    var hasSizeGuide = false;
    var selectedColor = null;

    function renderColors(p) {
        var group = document.getElementById('pd-color-group');
        var box = document.getElementById('pd-colors');
        selectedColor = null;
        root.setAttribute('data-color-configured', p.color_configured ? 'true' : 'false');
        root.removeAttribute('data-color');
        group.hidden = !p.color_configured;
        box.innerHTML = p.color_configured ? (p.colors || []).map(function (c) {
            var marker = c.images && c.images.length
                ? '<img src="' + esc(c.images[0]) + '" alt="" loading="lazy">'
                : (c.swatch_hex ? '<span class="pd-swatch" style="background:' + esc(c.swatch_hex) + '"></span>' : '');
            return '<button type="button" class="pd-color' + (c.available ? '' : ' unavailable') +
                '" data-color-key="' + esc(c.key) + '" aria-pressed="false" aria-label="' +
                esc(c.label + (c.available ? '' : ' — ' + t('sr.soldOut'))) + '">' +
                marker + '<span>' + esc(c.label) + '</span></button>';
        }).join('') : '';
    }

    function renderSizes(p) {
        var head = document.querySelector('.pd-size-head');
        var box = document.getElementById('pd-sizes');
        hasSizeGuide = ['sanpham-ao', 'sanpham-quan'].indexOf(p.category_slug) !== -1;
        document.getElementById('sg-open').style.display = hasSizeGuide ? '' : 'none';
        if (head) head.style.display = p.size_configured || hasSizeGuide ? '' : 'none';
        var label = document.querySelector('.pd-size-label');
        if (label) label.style.display = p.size_configured ? '' : 'none';
        root.setAttribute('data-size-configured', p.size_configured ? 'true' : 'false');
        root.removeAttribute('data-variant-id');
        root.removeAttribute('data-size');
        var variants = (p.variants || []).filter(function (v) {
            return v.is_active !== false && (!p.color_configured || (selectedColor && v.color === selectedColor.key));
        });
        if (box) {
            box.style.display = p.size_configured ? '' : 'none';
            box.innerHTML = p.size_configured ? variants.filter(function (v) { return v.size != null; }).map(function (v) {
                return '<button type="button" class="pd-size" data-size="' + esc(v.size) +
                    '" data-variant-id="' + esc(v.id) + '" aria-pressed="false"' +
                    (v.available ? '' : ' disabled aria-disabled="true" title="' + esc(t('sr.soldOut')) + '"') +
                    '>' + esc(v.size) + '</button>';
            }).join('') : '';
        }
        if (!p.size_configured && variants.length) root.setAttribute('data-variant-id', variants[0].id);
        // Bảng quần áo và các khóa dịch giữ nguyên trong product.ejs.
    }

    function getId() {
        try {
            var raw = new URLSearchParams(window.location.search).get('id');
            if (raw === null || raw === '' || isNaN(Number(raw))) return null;
            return Number(raw);
        } catch (e) { return null; }
    }

    var root = document.getElementById('pd-root');
    var categoryEl = document.getElementById('pd-category');
    var nameEl = document.getElementById('pd-name');
    var priceEl = document.getElementById('pd-price');
    var descEl = document.getElementById('pd-desc');
    var detailEl = document.getElementById('pd-detail');
    var mainImg = document.getElementById('pd-main-img');
    var galleryEmpty = document.getElementById('pd-gallery-empty');
    var prevBtn = document.getElementById('pd-prev');
    var nextBtn = document.getElementById('pd-next');
    var thumbsWrap = document.getElementById('pd-thumbs');
    var addBtn = document.querySelector('.pd-add');
    var statusEl = document.getElementById('pd-selection-status');

    var current = null;
    var relatedProducts = [];
    var galleryImages = [];
    var galleryIndex = 0;
    var failedImages = new Set();

    function galleryAlt(p, index) {
        return pName(p) + (selectedColor ? ' — ' + selectedColor.label : '') +
            ' (' + (index + 1) + '/' + galleryImages.length + ')';
    }
    function showGalleryImage(index) {
        if (!current || !galleryImages.length) {
            mainImg.src = '';
            mainImg.hidden = true;
            galleryEmpty.hidden = false;
            prevBtn.disabled = nextBtn.disabled = true;
            return;
        }
        galleryIndex = (index + galleryImages.length) % galleryImages.length;
        mainImg.src = galleryImages[galleryIndex];
        mainImg.alt = galleryAlt(current, galleryIndex);
        mainImg.hidden = false;
        galleryEmpty.hidden = true;
        prevBtn.disabled = nextBtn.disabled = galleryImages.length < 2;
        Array.prototype.forEach.call(thumbsWrap.children, function (b, i) {
            b.classList.toggle('active', i === galleryIndex);
            b.setAttribute('aria-pressed', i === galleryIndex ? 'true' : 'false');
        });
    }

    function renderGallery(p) {
        var colorImages = selectedColor && Array.isArray(selectedColor.images)
            ? selectedColor.images.filter(function (src) { return src && !failedImages.has(src); }) : [];
        var productImages = Array.isArray(p.images)
            ? p.images.filter(function (src) { return src && !failedImages.has(src); }) : [];
        galleryImages = colorImages.length ? colorImages : productImages;
        galleryIndex = 0;
        thumbsWrap.replaceChildren();
        galleryImages.forEach(function (src, i) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'pd-thumb';
            b.setAttribute('aria-label', t('pd.imageN', { n: i + 1 }));
            b.setAttribute('aria-pressed', 'false');
            b.innerHTML = '<img src="' + esc(src) + '" alt="" loading="lazy">';
            b.addEventListener('click', function () { showGalleryImage(i); });
            thumbsWrap.appendChild(b);
        });
        showGalleryImage(0);
    }

    function renderAvailability(p) {
        var variantId = Number(root.getAttribute('data-variant-id'));
        var chosen = (p.variants || []).find(function (v) { return v.id === variantId; });
        var sellable = (p.variants || []).some(function (v) {
            return v.available && (!p.color_configured || !selectedColor || v.color === selectedColor.key);
        });
        var soldOut = !sellable || !!(chosen && !chosen.available);
        var needsColor = p.color_configured && !selectedColor;
        var needsSize = p.size_configured && !chosen;
        var ready = !soldOut && !needsColor && !needsSize && !!chosen;
        // cart.js chỉ dùng data-stock="0" để chặn thêm giỏ; nguồn quyết định là sellable variant.
        root.setAttribute('data-stock', soldOut ? 0 : 1);
        statusEl.textContent = soldOut ? t('sr.soldOut') :
            needsColor ? t('pd.selectColor') : needsSize ? t('pd.selectSize') : t('pd.inStock');
        statusEl.classList.toggle('is-soldout', soldOut);
        addBtn.disabled = !ready;
        addBtn.textContent = soldOut ? t('sr.soldOut') : t('pd.addToCart');
        addBtn.classList.toggle('sold-out', soldOut);
    }

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
        failedImages = new Set();
        root.setAttribute('data-id', p.id);       // <-- product_id cho addToCart
        categoryEl.textContent = categoryName(p);
        nameEl.textContent = pName(p);
        renderPrice(p);
        descEl.textContent = pDesc(p);
        detailEl.hidden = !pDesc(p);
        document.title = pName(p) + ' - BREEZE';
        renderColors(p);
        renderSizes(p);
        renderGallery(p);
        renderAvailability(p);
        loadRelated(p);
    }

    function showError(msg) {
        nameEl.textContent = msg;
        categoryEl.textContent = '';
        priceEl.textContent = '';
        descEl.textContent = '';
        detailEl.hidden = true;
        statusEl.textContent = '';
        if (addBtn) addBtn.disabled = true;
    }

    function relatedCard(p) {
        var image = p.images && p.images[0];
        var priceHTML = p.sale_price != null
            ? '<div class="product-price"><span class="price-default">' + money(p.price) + '</span> <span class="price-sale">' + money(p.sale_price) + '</span></div>'
            : '<div class="product-price">' + money(p.price) + '</div>';
        var nm = esc(pName(p));
        return '<li><div class="product-item reveal in" data-id="' + p.id + '" data-stock="' + p.stock +
            '" data-size-configured="' + !!p.size_configured + '" data-color-configured="' + !!p.color_configured + '"' +
            (!p.size_configured && !p.color_configured && p.variants && p.variants[0] ? ' data-variant-id="' + p.variants[0].id + '"' : '') + '>' +
            '<div class="product-top"><a href="' + window.BreezeRoutes.product(p.id) + '" class="product-thumb">' +
                (image ? '<img src="' + esc(image) + '" alt="' + nm + '" loading="lazy">' :
                    '<span class="pd-related-placeholder" aria-hidden="true">BREEZE</span>') + '</a></div>' +
            '<div class="product-info"><a href="' + window.BreezeRoutes.product(p.id) + '" class="product-name">' + nm + '</a>' + priceHTML + '</div>' +
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
            categoryEl.textContent = categoryName(current);
            nameEl.textContent = pName(current);
            renderPrice(current);
            descEl.textContent = pDesc(current);
            detailEl.hidden = !pDesc(current);
            document.title = pName(current) + ' - BREEZE';
            if (galleryImages.length) mainImg.alt = galleryAlt(current, galleryIndex);
            Array.prototype.forEach.call(thumbsWrap.children, function (b, i) {
                b.setAttribute('aria-label', t('pd.imageN', { n: i + 1 }));
            });
            var wasAdded = addBtn.classList.contains('added');
            renderAvailability(current);
            var cartPack = window.__i18n && window.__i18n.T[currentLang()] && window.__i18n.T[currentLang()].cart;
            if (wasAdded && !addBtn.disabled && cartPack) addBtn.textContent = cartPack.added;
        }
        relatedProducts.forEach(function (p) {
            var el = document.querySelector('#pd-related-list .product-item[data-id="' + p.id + '"] .product-name');
            if (el) el.textContent = pName(p);
        });
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

    // Chỉ chọn variant đang bán và còn hàng; không tự chọn size đầu tiên.
    document.getElementById('pd-colors').addEventListener('click', function (e) {
        var btn = e.target.closest('.pd-color');
        if (!btn || !current) return;
        selectedColor = (current.colors || []).find(function (c) { return c.key === btn.getAttribute('data-color-key'); });
        if (!selectedColor) return;
        this.querySelectorAll('.pd-color').forEach(function (c) { c.classList.remove('selected'); c.setAttribute('aria-pressed', 'false'); });
        btn.classList.add('selected');
        btn.setAttribute('aria-pressed', 'true');
        root.setAttribute('data-color', selectedColor.label);
        renderSizes(current);
        renderGallery(current);
        renderAvailability(current);
    });
    prevBtn.addEventListener('click', function () {
        if (!prevBtn.disabled) showGalleryImage(galleryIndex - 1);
    });
    nextBtn.addEventListener('click', function () {
        if (!nextBtn.disabled) showGalleryImage(galleryIndex + 1);
    });
    mainImg.addEventListener('error', function () {
        if (!current || !galleryImages.length) return;
        failedImages.add(galleryImages[galleryIndex]);
        renderGallery(current);
    });
    document.getElementById('pd-colors').addEventListener('error', function (e) {
        if (!e.target || e.target.tagName !== 'IMG') return;
        failedImages.add(e.target.getAttribute('src'));
        e.target.hidden = true;
    }, true);
    thumbsWrap.addEventListener('error', function (e) {
        if (!current || !e.target || e.target.tagName !== 'IMG') return;
        failedImages.add(e.target.getAttribute('src'));
        renderGallery(current);
    }, true);
    document.getElementById('pd-sizes').addEventListener('click', function (e) {
        var btn = e.target.closest('.pd-size');
        if (!btn || btn.disabled || !current) return;
        var variant = (current.variants || []).find(function (v) {
            return String(v.id) === btn.getAttribute('data-variant-id') && v.available && v.size != null &&
                (!current.color_configured || (selectedColor && v.color === selectedColor.key));
        });
        if (!variant) return;
        this.querySelectorAll('.pd-size').forEach(function (s) { s.classList.remove('selected'); s.setAttribute('aria-pressed', 'false'); });
        btn.classList.add('selected');
        btn.setAttribute('aria-pressed', 'true');
        root.setAttribute('data-variant-id', variant.id);
        root.setAttribute('data-size', variant.size);
        renderAvailability(current);
    });

    // Modal bảng size.
    var overlay = document.getElementById('sg-overlay');
    function openSG() {
        if (!hasSizeGuide) return;
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeSG() { overlay.classList.remove('open'); document.body.style.overflow = ''; }
    document.getElementById('sg-open').addEventListener('click', openSG);
    document.getElementById('sg-close').addEventListener('click', closeSG);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeSG(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSG(); });
})();
