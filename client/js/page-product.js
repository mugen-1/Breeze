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
    var reviewBtn = document.getElementById('pd-review-open');
    var reviewOverlay = document.getElementById('pd-review-overlay');
    var reviewClose = document.getElementById('pd-review-close');
    var reviewImage = document.getElementById('pd-review-img');
    var reviewName = document.getElementById('pd-review-name');
    var reviewImageEmpty = document.getElementById('pd-review-image-empty');
    var reviewIsOpen = false, reviewPreviousOverflow = '', reviewReturnFocus = null;
    var reviewFormMode = 'create', ownerReview = null;
    var reviewEditVariantOption = null, reviewVariantWasDisabled = true;
    var deleteOverlay = document.getElementById('pd-review-delete-overlay');
    var deleteCancel = document.getElementById('pd-review-delete-cancel');
    var deleteConfirm = document.getElementById('pd-review-delete-confirm');
    var deleteFeedback = document.getElementById('pd-review-delete-feedback');
    var deleteReview = null, deletePreviousOverflow = '', deleteReturnFocus = null;
    var reviewForm = document.getElementById('pd-review-form');
    var reviewStarsBox = document.getElementById('pd-review-stars');
    var reviewStars = Array.prototype.slice.call(reviewStarsBox.querySelectorAll('[data-review-rating]'));
    var reviewVariant = document.getElementById('pd-review-variant');
    var reviewComment = document.getElementById('pd-review-comment');
    var reviewFiles = document.getElementById('pd-review-files');
    var reviewAddImage = document.getElementById('pd-review-add-image');
    var reviewPreviews = document.getElementById('pd-review-previews');
    var reviewSubmit = document.getElementById('pd-review-submit');
    var reviewRating = 0, reviewHoverRating = 0, reviewValidated = false;
    // Local, unsent image drafts only. Never a review store or purchased-variant source.
    var reviewImages = [], reviewImageErrors = [];
    var reviewPurchased = [], reviewKnownExists = false, reviewCanCreate = false;
    var reviewAccessKey = null, reviewFeedbackKey = null, reviewChecking = false, reviewSubmitting = false;
    var reviewRequestEpoch = 0, reviewSubmitEpoch = 0, reviewAccessController = null, reviewSubmitController = null;
    var reviewAuthUid = reviewUserId(), reviewVariantBeforeSubmit = true;
    var ownerEpoch = 0, ownerController = null, reviewEditing = null, reviewOriginalImages = [];
    var deleteSubmitting = false, deleteEpoch = 0, deleteController = null, deleteFeedbackKey = null;

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
        reviewBtn.disabled = false;
        loadRelated(p);
        document.dispatchEvent(new CustomEvent('breeze:product-loaded',{detail:{productId:p.id}}));
        refreshOwnerReview(true);
    }

    function showError(msg) {
        nameEl.textContent = msg;
        categoryEl.textContent = '';
        priceEl.textContent = '';
        descEl.textContent = '';
        detailEl.hidden = true;
        statusEl.textContent = '';
        if (addBtn) addBtn.disabled = true;
        reviewBtn.disabled = true;
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
            if (reviewIsOpen) renderReviewIdentity();
        }
        relatedProducts.forEach(function (p) {
            var el = document.querySelector('#pd-related-list .product-item[data-id="' + p.id + '"] .product-name');
            if (el) el.textContent = pName(p);
        });
        renderReviewRating();
        renderReviewImages();
        renderReviewMode();
        renderReviewCta();
        showReviewAccess(reviewAccessKey);
        Array.prototype.forEach.call(reviewVariant.options || [],function (option) {
            var item = reviewPurchased.find(function (p) { return String(p.variant_id) === option.value; });
            if (reviewEditing && reviewEditing.variant && String(reviewEditing.variant.id) === option.value) option.textContent = ownerVariantLabel(reviewEditing.variant);
            else if (item) option.textContent = purchasedLabel(item);
        });
        if (!deleteFeedback.hidden && deleteFeedbackKey) deleteFeedback.textContent = t(deleteFeedbackKey);
        reviewLabel(deleteConfirm,deleteSubmitting ? 'pd.reviewDeleting' : 'com.delete');
        updateReviewForm();
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
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('open')) closeSG(); });

    // Review identity and modal interactions remain on the current product page.
    function renderReviewIdentity() {
        reviewName.textContent = pName(current);
        var image = galleryImages.length ? galleryImages[galleryIndex] : '';
        reviewImage.alt = pName(current);
        reviewImage.hidden = !image;
        reviewImageEmpty.hidden = !!image;
        if (image) reviewImage.src = image;
        else reviewImage.removeAttribute('src');
    }
    function isOwnerReview(review) {
        // Presentation only. Edit/delete APIs independently enforce ownership on the server.
        return !!review && review.isOwner === true && review.id != null &&
            (!current || review.productId == null || String(review.productId) === String(current.id));
    }
    function reviewLabel(el, key) {
        el.setAttribute('data-i18n', key);
        el.textContent = t(key);
    }
    function renderReviewMode() {
        reviewForm.setAttribute('data-review-mode', reviewFormMode);
        reviewLabel(document.getElementById('pd-review-title'), reviewFormMode === 'edit' ? 'pd.editReview' : 'pd.writeReview');
        reviewLabel(reviewSubmit, reviewSubmitting ? 'pd.reviewSubmitting' : reviewFormMode === 'edit' ? 'pd.reviewSaveChanges' : 'pd.reviewSubmit');
    }
    function renderReviewCta() {
        reviewLabel(reviewBtn, reviewChecking ? 'pd.reviewChecking' : ownerReview || reviewKnownExists ? 'pd.editReview' : 'pd.reviewProduct');
    }
    function reviewUserId() {
        var helper = window.AuthHelper, user = helper && helper.getUser && helper.getUser();
        return user ? user.uid : null;
    }
    function showReviewAccess(key) {
        reviewAccessKey = key;
        var el = document.getElementById('pd-review-access'); el.textContent = key ? t(key) : ''; el.hidden = !key;
        var login = document.getElementById('pd-review-login'); login.href = window.BreezeRoutes.to('login');
        login.hidden = key !== 'pd.reviewLoginRequired';
    }
    function showReviewFeedback(key) {
        reviewFeedbackKey = key;
        var el = document.getElementById('pd-review-feedback'); el.textContent = key ? t(key) : ''; el.hidden = !key;
    }
    function purchasedLabel(item) {
        return [item.color_snapshot, item.size_snapshot ? t('pd.reviewVariantSize', {size:item.size_snapshot}) : '']
            .filter(Boolean).join(' / ') || t('pd.reviewVariantReference', {id:item.variant_id});
    }
    function populatePurchasedVariants(list) {
        reviewPurchased = list.slice();
        list.forEach(function (item) {
            var option = document.createElement('option'); option.value = String(item.variant_id);
            option.textContent = purchasedLabel(item); reviewVariant.appendChild(option);
        });
        reviewVariant.disabled = !list.length;
    }
    function reviewErrorKey(code, status) {
        if (status === 401) return 'pd.reviewLoginRequired';
        return ({REVIEW_NOT_ELIGIBLE:'pd.reviewNotEligible',REVIEW_ALREADY_EXISTS:'pd.reviewAlreadyExists',
            REVIEW_INVALID_RATING:'pd.reviewChooseRating',REVIEW_INVALID_VARIANT:'pd.reviewChoosePurchased',
            REVIEW_INVALID_COMMENT:'pd.reviewInvalidComment',REVIEW_TOO_MANY_IMAGES:'pd.reviewImageLimit',
            REVIEW_INVALID_IMAGE:'pd.reviewInvalidImage',REVIEW_IMAGE_TOO_LARGE:'pd.reviewImageSize',
            REVIEW_INVALID_IMAGES:'pd.reviewInvalidImages',REVIEW_NOT_FOUND:'pd.reviewNotFound'})[code] || 'pd.reviewRequestError';
    }
    function publishOwnerReview() {
        renderReviewCta();
        if (current) document.dispatchEvent(new CustomEvent('breeze:review-owner',{detail:{productId:current.id}}));
    }
    async function refreshOwnerReview(silent) {
        if (!current || !window.AuthHelper || !window.AuthHelper.isLoggedIn()) return null;
        var epoch = ++ownerEpoch;
        if (ownerController) ownerController.abort(); ownerController = new AbortController();
        try {
            var response = await window.AuthHelper.apiFetch('/api/products/' + current.id + '/reviews/me',{signal:ownerController.signal});
            var result = await response.json();
            if (epoch !== ownerEpoch) return null;
            if (!response.ok) { if (!silent) showReviewAccess(reviewErrorKey(result.code,response.status)); return null; }
            if (!result || result.review === undefined || result.review && !isOwnerReview(result.review)) throw new Error('REVIEW_OWNER_ERROR');
            ownerReview = result.review;
            reviewKnownExists = !!ownerReview; publishOwnerReview();
            return result;
        } catch (error) { if (!silent && epoch === ownerEpoch && error.name !== 'AbortError') showReviewAccess('pd.reviewRequestError'); return null; }
        finally { if (epoch === ownerEpoch) ownerController = null; }
    }
    async function requestReview(trigger,forceEdit) {
        if (!current || reviewBtn.disabled || reviewIsOpen || reviewChecking || reviewSubmitting || deleteSubmitting) return;
        trigger = trigger && trigger.focus ? trigger : reviewBtn;
        var helper = window.AuthHelper;
        if (!helper || !helper.isLoggedIn()) { showReviewAccess('pd.reviewLoginRequired'); return; }
        var epoch = ++reviewRequestEpoch;
        reviewAccessController = new AbortController();
        reviewChecking = true; reviewBtn.setAttribute('aria-busy','true'); renderReviewCta(); showReviewAccess(null);
        try {
            if (forceEdit || ownerReview || reviewKnownExists) {
                var owned = await refreshOwnerReview(false);
                if (epoch !== reviewRequestEpoch || !owned) return;
                if (owned.review) openReview(owned.review,trigger,owned.purchasedVariants);
                else showReviewAccess('pd.reviewNotFound');
                return;
            }
            var response = await helper.apiFetch('/api/products/' + current.id + '/review-eligibility',{signal:reviewAccessController.signal});
            var result = await response.json();
            if (epoch !== reviewRequestEpoch) return;
            if (!response.ok) { showReviewAccess(reviewErrorKey(result.code,response.status)); return; }
            reviewKnownExists = result.hasReviewed === true;
            if (reviewKnownExists) {
                var existing = await refreshOwnerReview(false);
                if (epoch === reviewRequestEpoch && existing && existing.review) openReview(existing.review,trigger,existing.purchasedVariants);
                return;
            }
            if (result.canReview !== true || !Array.isArray(result.purchasedVariants) || !result.purchasedVariants.length) {
                showReviewAccess('pd.reviewNotEligible'); return;
            }
            openReview(null,trigger,result.purchasedVariants);
        } catch (error) { if (epoch === reviewRequestEpoch && error.name !== 'AbortError') showReviewAccess('pd.reviewRequestError'); }
        finally {
            if (epoch === reviewRequestEpoch) { reviewChecking = false; reviewAccessController = null; reviewBtn.removeAttribute('aria-busy'); renderReviewCta(); }
        }
    }
    function ownerVariantLabel(variant) {
        return variant.label || purchasedLabel({variant_id:variant.id,size_snapshot:variant.size,color_snapshot:variant.color});
    }
    function populateReviewForm(review,purchased) {
        reviewEditing = review;
        reviewFormMode = 'edit';
        var rating = Number(review.rating);
        reviewRating = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 0;
        reviewComment.value = typeof review.comment === 'string' ? review.comment : '';
        updateReviewComment();
        populatePurchasedVariants(Array.isArray(purchased) ? purchased : []);
        // Prefill the historical snapshot. A missing completed-purchase identity stays
        // disabled; displaying past history must not turn it into a valid new choice.
        var variant = review.variant;
        if (variant && variant.id != null) {
            var option = Array.prototype.find.call(reviewVariant.options || [],function (item) { return item.value === String(variant.id); });
            if (option) option.textContent = ownerVariantLabel(variant);
            else {
                reviewVariantWasDisabled = reviewVariant.disabled;
                reviewEditVariantOption = document.createElement('option');
                reviewEditVariantOption.value = String(variant.id);
                reviewEditVariantOption.textContent = ownerVariantLabel(variant); reviewEditVariantOption.disabled = true;
                reviewVariant.appendChild(reviewEditVariantOption);
            }
            reviewVariant.value = String(variant.id);
        }
        reviewOriginalImages = (review.images || []).map(function (image) { return image.id; });
        (Array.isArray(review.images) ? review.images : []).forEach(function (image) {
            var url = typeof image === 'string' ? image : image && image.url;
            if (typeof url !== 'string' || !url) return;
            if (reviewImages.length >= 5) { reviewImageErrors = ['pd.reviewImageLimit']; return; }
            reviewImages.push({ id:image.id,url: url.indexOf('/') === 0 ? (window.API_BASE || '') + url : url, local: false });
        });
        renderReviewMode(); renderReviewRating(); renderReviewImages(); updateReviewForm();
    }
    function openReview(review, trigger, purchased) {
        if (!current || reviewBtn.disabled || reviewIsOpen) return;
        if (review && !isOwnerReview(review)) return;
        if (deleteReview) closeDeleteReview();
        // The existing size overlay can close on backdrop; keep one modal visible.
        if (overlay.classList.contains('open')) closeSG();
        resetReviewForm();
        if (review) populateReviewForm(review,purchased);
        else if (purchased) { populatePurchasedVariants(purchased); reviewCanCreate = true; }
        renderReviewIdentity();
        reviewPreviousOverflow = document.body.style.overflow || '';
        reviewReturnFocus = trigger || reviewBtn;
        reviewIsOpen = true;
        reviewOverlay.hidden = false;
        document.body.style.overflow = 'hidden';
        reviewClose.focus({ preventScroll: true });
    }
    function closeReview() {
        if (!reviewIsOpen) return;
        reviewIsOpen = false;
        reviewOverlay.hidden = true;
        resetReviewForm();
        document.body.style.overflow = reviewPreviousOverflow;
        (reviewReturnFocus && reviewReturnFocus.isConnected !== false ? reviewReturnFocus : reviewBtn).focus({ preventScroll: true });
        reviewReturnFocus = null;
    }
    reviewBtn.addEventListener('click', function () { requestReview(reviewBtn,false); });
    reviewClose.addEventListener('click', closeReview);
    reviewOverlay.addEventListener('click', function (e) { if (e.target === reviewOverlay) closeReview(); });
    reviewImage.addEventListener('error', function () {
        reviewImage.hidden = true;
        reviewImage.removeAttribute('src');
        reviewImageEmpty.hidden = false;
    });
    document.addEventListener('keydown', function (e) {
        if (!reviewIsOpen && !deleteReview) return;
        if (e.key === 'Escape') { e.preventDefault(); if (deleteReview) closeDeleteReview(); else closeReview(); }
        else if (e.key === 'Tab') {
            var controls = deleteReview ? [deleteCancel, deleteConfirm].filter(function (el) { return !el.disabled; }) :
                Array.prototype.slice.call(document.getElementById('pd-review-dialog')
                .querySelectorAll('button:not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled)'))
                .filter(function (el) { return !el.hidden && el.getAttribute('tabindex') !== '-1'; });
            if (!controls.length) controls = [deleteReview ? document.getElementById('pd-review-delete-dialog') : reviewClose];
            var first = controls[0], last = controls[controls.length - 1];
            if (controls.indexOf(document.activeElement) === -1 || (!e.shiftKey && document.activeElement === last)) {
                e.preventDefault(); first.focus({ preventScroll: true });
            } else if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus({ preventScroll: true });
            }
        }
    });

    function openDeleteReview(review, trigger) {
        if (!current || !isOwnerReview(review) || deleteReview || reviewSubmitting || reviewChecking) return;
        if (reviewIsOpen) closeReview();
        if (overlay.classList.contains('open')) closeSG();
        deleteReview = review;
        deleteReturnFocus = trigger || reviewBtn;
        deletePreviousOverflow = document.body.style.overflow || '';
        deleteFeedback.hidden = true; deleteFeedback.textContent = ''; deleteFeedbackKey = null;
        deleteConfirm.disabled = false;
        deleteOverlay.hidden = false;
        document.body.style.overflow = 'hidden';
        deleteCancel.focus({ preventScroll: true });
    }
    function closeDeleteReview(force) {
        if (deleteSubmitting && force !== true) return;
        if (!deleteReview) return;
        deleteReview = null;
        deleteOverlay.hidden = true;
        deleteFeedback.hidden = true; deleteFeedback.textContent = ''; deleteFeedbackKey = null;
        deleteConfirm.disabled = false;
        document.body.style.overflow = deletePreviousOverflow;
        (deleteReturnFocus && deleteReturnFocus.isConnected !== false ? deleteReturnFocus : reviewBtn).focus({ preventScroll: true });
        deleteReturnFocus = null;
    }
    deleteCancel.addEventListener('click', closeDeleteReview);
    deleteOverlay.addEventListener('click', function (e) { if (e.target === deleteOverlay) closeDeleteReview(); });
    deleteConfirm.addEventListener('click', async function () {
        if (!deleteReview || deleteSubmitting) return;
        var epoch = ++deleteEpoch, reviewId = deleteReview.id;
        deleteController = new AbortController(); deleteSubmitting = true;
        deleteConfirm.disabled = deleteCancel.disabled = true; reviewLabel(deleteConfirm,'pd.reviewDeleting');
        document.getElementById('pd-review-delete-dialog').setAttribute('aria-busy','true');
        document.getElementById('pd-review-delete-dialog').focus(); deleteFeedback.hidden = true;
        try {
            var response = await window.AuthHelper.apiFetch('/api/products/' + current.id + '/reviews/' + reviewId,{method:'DELETE',signal:deleteController.signal});
            if (!response.ok) { var error = await response.json(); throw {key:reviewErrorKey(error.code,response.status)}; }
            if (epoch !== deleteEpoch) return;
            closeDeleteReview(true); ownerReview = null; reviewKnownExists = false;
            resetReviewForm(); publishOwnerReview(); showReviewAccess('pd.reviewDeleted');
            document.dispatchEvent(new CustomEvent('breeze:review-changed',{detail:{productId:current.id,action:'deleted'}}));
            refreshOwnerReview(true);
        } catch (error) {
            if (epoch === deleteEpoch && error.name !== 'AbortError') {
                deleteFeedbackKey = error.key || 'pd.reviewRequestError'; deleteFeedback.textContent = t(deleteFeedbackKey); deleteFeedback.hidden = false;
            }
        } finally {
            if (epoch === deleteEpoch) {
                deleteSubmitting = false; deleteController = null; deleteConfirm.disabled = deleteCancel.disabled = false;
                document.getElementById('pd-review-delete-dialog').setAttribute('aria-busy','false'); reviewLabel(deleteConfirm,'com.delete');
                if (deleteReview) deleteCancel.focus({preventScroll:true});
            }
        }
    });

    // Public-list integration and owner presentation hooks; persistence stays in the APIs.
    // Owner input: {id, productId, isOwner, rating, variant: {id, size, color}, comment, images: [{id, url}]}.
    window.BreezeProductReviews = Object.freeze({
        getProductId: function () { return current ? current.id : null; },
        getOwnerReview: function () { return ownerReview; },
        setOwnerReview: function (review) {
            if (reviewIsOpen) closeReview();
            if (deleteReview) closeDeleteReview();
            ownerReview = isOwnerReview(review) ? review : null;
            reviewKnownExists = !!ownerReview; publishOwnerReview();
        },
        renderActions: function (review) {
            if (!isOwnerReview(review)) return null;
            var actions = document.createElement('div'); actions.className = 'pd-review-actions';
            ['edit', 'delete'].forEach(function (action) {
                var button = document.createElement('button'); button.type = 'button';
                button.className = 'pd-review-owner-action';
                reviewLabel(button, 'com.' + action);
                button.setAttribute('aria-haspopup', 'dialog');
                button.setAttribute('aria-controls', action === 'edit' ? 'pd-review-dialog' : 'pd-review-delete-dialog');
                button.addEventListener('click', function () {
                    if (action === 'edit') requestReview(button,true);
                    else openDeleteReview(review, button);
                });
                actions.appendChild(button);
            });
            return actions;
        }
    });

    function renderReviewRating() {
        var shown = reviewHoverRating || reviewRating;
        reviewStars.forEach(function (button, i) {
            button.querySelector('span').textContent = i < shown ? '★' : '☆';
            button.setAttribute('aria-checked', reviewRating === i + 1 ? 'true' : 'false');
            button.setAttribute('aria-label', t('pd.reviewStar', { n: i + 1 }));
            button.setAttribute('tabindex', i === (reviewRating ? reviewRating - 1 : 0) ? '0' : '-1');
        });
    }
    function hasPurchasedVariant() {
        // Only enabled completed-purchase options can authorize a selected identity in the UI.
        return !reviewVariant.disabled && !!reviewVariant.value && Array.prototype.some.call(reviewVariant.options || [], function (option) {
            return option.value === reviewVariant.value && !option.disabled;
        });
    }
    function reviewError(id, key) {
        var el = document.getElementById(id);
        el.textContent = key ? t(key) : '';
        el.hidden = !key;
    }
    function updateReviewForm() {
        reviewSubmit.disabled = reviewSubmitting || (reviewFormMode === 'create' && reviewKnownExists) || !reviewRating || !hasPurchasedVariant();
        var ratingInvalid = reviewValidated && !reviewRating, variantInvalid = reviewValidated && !reviewSubmitting && !hasPurchasedVariant();
        reviewError('pd-review-rating-error', ratingInvalid ? 'pd.reviewChooseRating' : null);
        reviewError('pd-review-variant-error', variantInvalid ? 'pd.reviewChoosePurchased' : null);
        reviewStarsBox.setAttribute('aria-invalid', String(!!ratingInvalid));
        reviewVariant.setAttribute('aria-invalid', String(!!variantInvalid));
        var imagesError = document.getElementById('pd-review-images-error');
        imagesError.textContent = reviewImageErrors.map(function (key) { return t(key); }).join(' ');
        imagesError.hidden = !reviewImageErrors.length;
        var feedback = document.getElementById('pd-review-feedback');
        if (!feedback.hidden && reviewFeedbackKey) feedback.textContent = t(reviewFeedbackKey);
    }
    function renderReviewImages() {
        reviewPreviews.replaceChildren();
        reviewImages.forEach(function (image, i) {
            var card = document.createElement('div'); card.className = 'pd-review-preview';
            var img = document.createElement('img'); img.src = image.url;
            img.alt = t('pd.reviewPreview', { n: i + 1 });
            var remove = document.createElement('button'); remove.type = 'button';
            remove.className = 'pd-review-remove-image';
            remove.disabled = reviewSubmitting;
            remove.setAttribute('aria-label', t('pd.reviewRemoveImage', { n: i + 1 }));
            remove.innerHTML = '<span aria-hidden="true">&times;</span>';
            remove.addEventListener('click', function () { removeReviewImage(image); reviewAddImage.focus({ preventScroll: true }); });
            img.addEventListener('error', function () {
                if (!reviewIsOpen || reviewImages.indexOf(image) === -1) return;
                removeReviewImage(image); reviewImageErrors = ['pd.reviewPreviewError']; updateReviewForm();
            });
            card.appendChild(img); card.appendChild(remove); reviewPreviews.appendChild(card);
        });
        reviewAddImage.disabled = reviewFiles.disabled = reviewSubmitting || reviewImages.length >= 5;
    }
    function removeReviewImage(image) {
        if (reviewSubmitting) return;
        var index = reviewImages.indexOf(image);
        if (index === -1) return;
        if (image.local) URL.revokeObjectURL(image.url);
        reviewImages.splice(index, 1);
        reviewImageErrors = [];
        renderReviewImages(); updateReviewForm();
    }
    function resetReviewForm() {
        reviewRating = reviewHoverRating = 0; reviewValidated = false;
        reviewComment.value = ''; reviewVariant.value = ''; reviewFiles.value = '';
        if (reviewEditVariantOption) {
            reviewVariant.removeChild(reviewEditVariantOption);
            reviewEditVariantOption = null;
            reviewVariant.disabled = reviewVariantWasDisabled;
        }
        reviewFormMode = 'create';
        reviewEditing = null; reviewOriginalImages = [];
        reviewPurchased = []; reviewCanCreate = false;
        // Clear both eligibility options and an edit-only option. Keep the real placeholder.
        var placeholder = document.createElement('option'); placeholder.value = ''; placeholder.disabled = true;
        placeholder.selected = true; reviewLabel(placeholder,'pd.reviewChooseVariant');
        reviewVariant.replaceChildren(placeholder); reviewVariant.disabled = true; reviewVariant.value = '';
        document.getElementById('pd-review-comment-count').textContent = '0 / 1000';
        reviewImages.forEach(function (image) { if (image.local) URL.revokeObjectURL(image.url); });
        reviewImages = []; reviewImageErrors = [];
        document.getElementById('pd-review-feedback').hidden = true;
        reviewFeedbackKey = null;
        renderReviewMode(); renderReviewRating(); renderReviewImages(); updateReviewForm();
    }
    reviewStarsBox.addEventListener('mouseover', function (e) {
        var button = e.target.closest('[data-review-rating]');
        if (!button) return;
        reviewHoverRating = Number(button.getAttribute('data-review-rating')); renderReviewRating();
    });
    reviewStarsBox.addEventListener('mouseleave', function () { reviewHoverRating = 0; renderReviewRating(); });
    reviewStarsBox.addEventListener('click', function (e) {
        var button = e.target.closest('[data-review-rating]');
        if (!button) return;
        reviewRating = Number(button.getAttribute('data-review-rating'));
        reviewHoverRating = 0; renderReviewRating(); updateReviewForm();
    });
    reviewStarsBox.addEventListener('keydown', function (e) {
        var button = e.target.closest('[data-review-rating]');
        if (!button || ['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].indexOf(e.key) === -1) return;
        var n = Number(button.getAttribute('data-review-rating'));
        if (e.key === 'Home') n = 1;
        else if (e.key === 'End') n = 5;
        else n = (n - 1 + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? 4 : 1)) % 5 + 1;
        e.preventDefault(); reviewRating = n; reviewHoverRating = 0;
        renderReviewRating(); updateReviewForm(); reviewStars[n - 1].focus();
    });
    reviewVariant.addEventListener('change', updateReviewForm);
    function updateReviewComment() {
        reviewComment.value = reviewComment.value.slice(0, 1000);
        // Do not leave half an emoji when a pasted value is trimmed at the UI limit.
        var last = reviewComment.value.charCodeAt(reviewComment.value.length - 1);
        if (last >= 0xD800 && last <= 0xDBFF) reviewComment.value = reviewComment.value.slice(0, -1);
        document.getElementById('pd-review-comment-count').textContent = reviewComment.value.length + ' / 1000';
    }
    reviewComment.addEventListener('input', updateReviewComment);
    reviewAddImage.addEventListener('click', function () { if (!reviewAddImage.disabled) reviewFiles.click(); });
    reviewFiles.addEventListener('change', function () {
        reviewImageErrors = [];
        function imageError(key) { if (reviewImageErrors.indexOf(key) === -1) reviewImageErrors.push(key); }
        if (!reviewIsOpen || reviewSubmitting) { reviewFiles.value = ''; return; }
        Array.prototype.forEach.call(reviewFiles.files || [], function (file) {
            if (!/^image\/(png|jpeg|webp)$/i.test(file.type || '')) { imageError('pd.reviewInvalidImage'); return; }
            if (file.size > 2*1024*1024) { imageError('pd.reviewImageSize'); return; }
            if (reviewImages.length >= 5) { imageError('pd.reviewImageLimit'); return; }
            try { reviewImages.push({ file: file, url: URL.createObjectURL(file), local: true }); }
            catch (_) { imageError('pd.reviewPreviewError'); }
        });
        reviewFiles.value = '';
        renderReviewImages(); updateReviewForm();
    });
    function setReviewSubmitting(busy) {
        if (busy) reviewVariantBeforeSubmit = reviewVariant.disabled;
        reviewSubmitting = busy;
        reviewStars.forEach(function (button) { button.disabled = busy; }); reviewComment.disabled = busy;
        reviewVariant.disabled = busy || reviewVariantBeforeSubmit;
        reviewForm.setAttribute('aria-busy',String(busy));
        renderReviewMode(); renderReviewImages(); updateReviewForm();
    }
    reviewForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (reviewSubmitting) return;
        reviewValidated = true; updateReviewForm();
        if (!reviewRating) { if (reviewStars[0]) reviewStars[0].focus(); return; }
        if (!hasPurchasedVariant()) return;
        var editing = reviewFormMode === 'edit', editId = reviewEditing && reviewEditing.id;
        if ((!editing && (!reviewCanCreate || reviewKnownExists)) || !window.AuthHelper || !window.AuthHelper.isLoggedIn()) {
            showReviewFeedback(reviewKnownExists ? 'pd.reviewAlreadyExists' : 'pd.reviewLoginRequired'); return;
        }
        var payload = new FormData(); payload.append('rating',String(reviewRating));
        payload.append('variant_id',reviewVariant.value); payload.append('comment',reviewComment.value);
        if (editing) payload.append('remove_image_ids',JSON.stringify(reviewOriginalImages.filter(function (id) {
            return !reviewImages.some(function (image) { return !image.local && image.id === id; });
        })));
        reviewImages.forEach(function (image) { if (image.local) payload.append('images',image.file); });
        var epoch = ++reviewSubmitEpoch;
        reviewSubmitController = new AbortController();
        setReviewSubmitting(true); showReviewFeedback(null);
        try {
            var response = await window.AuthHelper.apiFetch('/api/products/' + current.id + '/reviews' + (editing ? '/' + editId : ''),
                {method:editing ? 'PATCH' : 'POST',body:payload,signal:reviewSubmitController.signal});
            var result = await response.json();
            if (epoch !== reviewSubmitEpoch) return;
            if (!response.ok || response.status !== (editing ? 200 : 201) || !Number.isInteger(result.id) || result.id < 1 || editing && result.id !== editId) {
                if (result.code === 'REVIEW_ALREADY_EXISTS') { reviewKnownExists = true; reviewCanCreate = false; renderReviewCta(); }
                var key = reviewErrorKey(result.code,response.status);
                if (response.status === 401 || result.code === 'REVIEW_NOT_ELIGIBLE') { closeReview(); showReviewAccess(key); return; }
                if (reviewIsOpen) showReviewFeedback(key); else showReviewAccess(key);
                return;
            }
            reviewKnownExists = true;
            // Reload both sources; the submitted payload never substitutes for a public card.
            closeReview(); ownerReview = null; publishOwnerReview(); showReviewAccess(editing ? 'pd.reviewUpdated' : 'pd.reviewCreated');
            document.dispatchEvent(new CustomEvent(editing ? 'breeze:review-changed' : 'breeze:review-created',{detail:{productId:current.id,action:'updated'}}));
            refreshOwnerReview(true);
        } catch (error) {
            if (epoch === reviewSubmitEpoch && error.name !== 'AbortError') {
                if (reviewIsOpen) showReviewFeedback('pd.reviewRequestError'); else showReviewAccess('pd.reviewRequestError');
            }
        } finally {
            if (epoch === reviewSubmitEpoch) { reviewSubmitController = null; setReviewSubmitting(false); if (!reviewIsOpen) reviewVariant.disabled = true; }
        }
    });
    document.addEventListener('authchange',function () {
        var uid = reviewUserId();
        if (uid === reviewAuthUid) return;
        reviewAuthUid = uid; ++reviewRequestEpoch; ++reviewSubmitEpoch; ++ownerEpoch; ++deleteEpoch;
        if (reviewAccessController) reviewAccessController.abort(); if (reviewSubmitController) reviewSubmitController.abort();
        if (ownerController) ownerController.abort(); if (deleteController) deleteController.abort();
        reviewChecking = false; reviewKnownExists = false; ownerReview = null;
        deleteSubmitting = false; deleteConfirm.disabled = deleteCancel.disabled = false;
        document.getElementById('pd-review-delete-dialog').setAttribute('aria-busy','false'); reviewLabel(deleteConfirm,'com.delete');
        setReviewSubmitting(false); closeReview(); closeDeleteReview(true); resetReviewForm();
        reviewBtn.removeAttribute('aria-busy'); publishOwnerReview(); showReviewAccess(null); refreshOwnerReview(true);
    });
    reviewVariant.disabled = true;
    resetReviewForm();
    renderReviewCta();
    showReviewAccess(null);

})();
