/* Public reviews: SQL/API data only. Owner actions use the authenticated owner API. */
(function () {
    'use strict';
    var section = document.getElementById('pd-reviews');
    if (!section) return;
    var list = document.getElementById('pd-reviews-list');
    var filters = Array.prototype.slice.call(document.querySelectorAll('#pd-reviews-filters [data-review-filter]'));
    var summary = document.getElementById('pd-reviews-summary');
    var empty = document.getElementById('pd-reviews-empty');
    var pagination = document.getElementById('pd-reviews-pagination');
    var previous = document.getElementById('pd-reviews-prev'), next = document.getElementById('pd-reviews-next');
    var productId = null, filter = 'all', page = 1, data = null, state = 'idle', epoch = 0, controller = null;
    var filterKeys = {all:'pd.reviewFilterAll',images:'pd.reviewFilterImages',
        '5':'pd.reviewFilter5','4':'pd.reviewFilter4','3':'pd.reviewFilter3','2':'pd.reviewFilter2','1':'pd.reviewFilter1'};
    function label(el, key, params) {
        // Counts and API text are dynamic; the global translator must not replace them.
        el.removeAttribute('data-i18n'); el.textContent = t(key, params);
    }
    function text(tag, className, value) {
        var el = document.createElement(tag); el.className = className; el.textContent = value; return el;
    }
    function stars(rating) { var filled = Math.floor(rating); return '★'.repeat(filled) + '☆'.repeat(5 - filled); }
    function timestamp(value) {
        var date = value ? new Date(value) : new Date(NaN);
        if (!Number.isFinite(date.getTime())) return '—';
        // Vietnam uses UTC+7 year-round; keep this display independent of the viewer's timezone.
        var local = new Date(date.getTime() + 7*60*60*1000);
        function pad(n) { return String(n).padStart(2,'0'); }
        return pad(local.getUTCDate()) + '/' + pad(local.getUTCMonth()+1) + '/' + local.getUTCFullYear() +
            ' - ' + pad(local.getUTCHours()) + ':' + pad(local.getUTCMinutes());
    }
    function card(review) {
        var article = document.createElement('article'); article.className = 'pd-review-card';
        var header = document.createElement('div'); header.className = 'pd-review-card-header';
        header.appendChild(text('h3','pd-review-author',review.displayName || t('pd.reviewUnnamed')));
        var rating = text('span','pd-review-card-stars',stars(review.rating));
        rating.setAttribute('role','img'); rating.setAttribute('aria-label',t('pd.reviewStar',{n:review.rating}));
        header.appendChild(rating);
        var time = text('time','pd-review-date',timestamp(review.createdAt));
        if (review.createdAt && Number.isFinite(new Date(review.createdAt).getTime())) time.dateTime = new Date(review.createdAt).toISOString();
        header.appendChild(time); article.appendChild(header);
        var variant = review.variant || {};
        var variantText = [variant.color,variant.size ? t('pd.reviewVariantSize',{size:variant.size}) : ''].filter(Boolean).join(' / ');
        article.appendChild(text('p','pd-review-card-variant',t('pd.reviewVariantLabel',{variant:variantText || '—'})));
        if (review.comment) article.appendChild(text('p','pd-review-card-comment',review.comment));
        var images = document.createElement('div'); images.className = 'pd-review-card-images';
        (review.images || []).slice(0,5).forEach(function (image,index) {
            if (!/^\/review-images\/[a-f0-9]{32}\.webp$/.test(image.url || '')) return;
            var link = document.createElement('a'); link.href = (window.API_BASE || '') + image.url;
            link.target = '_blank'; link.rel = 'noopener noreferrer';
            var img = document.createElement('img'); img.src = link.href; img.alt = t('pd.reviewPreview',{n:index+1});
            img.loading = 'lazy'; img.width = img.height = 96;
            img.addEventListener('error',function () { link.hidden = true; });
            link.appendChild(img); images.appendChild(link);
        });
        if (images.children.length) article.appendChild(images);
        // Match the authenticated owner endpoint, never names or client-supplied user IDs.
        var bridge = window.BreezeProductReviews;
        var owner = bridge && bridge.getOwnerReview && bridge.getOwnerReview();
        if (owner && owner.isOwner === true && owner.id === review.id) {
            var actions = bridge.renderActions(owner); if (actions) article.appendChild(actions);
        }
        return article;
    }
    function render() {
        var busy = state === 'loading', ready = state === 'ready', stats = data && data.summary;
        section.setAttribute('aria-busy',String(busy));
        document.getElementById('pd-reviews-loading').hidden = !busy;
        document.getElementById('pd-reviews-error').hidden = state !== 'error';
        summary.hidden = !stats || state === 'error';
        if (stats) {
            var average = stats.averageRating;
            document.getElementById('pd-reviews-score').textContent = stats.totalReviews ? Number(average).toFixed(1) + ' / 5' : '— / 5';
            document.getElementById('pd-reviews-stars').textContent = stars(stats.totalReviews ? average : 0);
            label(document.getElementById('pd-reviews-total'),stats.totalReviews ? 'pd.reviewTotalCount' : 'pd.reviewNoReviews',{count:stats.totalReviews});
            summary.setAttribute('aria-label',stats.totalReviews ? t('pd.reviewSummaryLabel',{rating:average,count:stats.totalReviews}) : t('pd.reviewNoReviews'));
        }
        filters.forEach(function (button) {
            var key = button.getAttribute('data-review-filter'), active = filter === key;
            button.classList.toggle('is-active',active); button.setAttribute('aria-pressed',String(active));
            var count = stats ? key === 'all' ? stats.totalReviews : key === 'images' ? stats.reviewsWithImages : stats.ratingCounts[key] : null;
            button.removeAttribute('data-i18n'); button.textContent = t(filterKeys[key]) + (count === null ? '' : ' (' + count + ')');
        });
        list.replaceChildren();
        if (ready) data.reviews.forEach(function (review) { list.appendChild(card(review)); });
        empty.hidden = !ready || data.reviews.length !== 0;
        if (ready) label(document.getElementById('pd-reviews-empty-description'),data.summary.totalReviews ? 'pd.reviewFilteredEmpty' : 'pd.reviewEmptyDescription');
        pagination.hidden = !ready || data.totalPages <= 1;
        previous.disabled = !ready || data.page <= 1; next.disabled = !ready || data.page >= data.totalPages;
        document.getElementById('pd-reviews-page').textContent = ready ? data.page + ' / ' + Math.max(1,data.totalPages) : '';
    }
    async function loadReviews() {
        if (productId === null) return;
        var requestEpoch = ++epoch;
        if (controller) controller.abort(); controller = new AbortController();
        state = 'loading'; render();
        var query = new URLSearchParams({page:String(page),limit:'10'});
        if (/^[1-5]$/.test(filter)) query.set('rating',filter);
        if (filter === 'images') query.set('hasImages','true');
        try {
            var response = await fetch((window.API_BASE || '') + '/api/products/' + productId + '/reviews?' + query.toString(),{signal:controller.signal});
            if (!response.ok) throw new Error('REVIEW_LIST_ERROR');
            var result = await response.json();
            if (requestEpoch !== epoch) return;
            if (!result || !Array.isArray(result.reviews) || !result.summary || !Number.isInteger(result.page)) throw new Error('REVIEW_LIST_ERROR');
            data = result; page = result.page; state = 'ready'; render();
        } catch (error) {
            if (requestEpoch === epoch && error.name !== 'AbortError') { state = 'error'; render(); }
        }
    }
    filters.forEach(function (button) {
        button.addEventListener('click',function () { filter = button.getAttribute('data-review-filter'); page = 1; loadReviews(); });
    });
    previous.addEventListener('click',function () { if (!previous.disabled) { page--; loadReviews(); } });
    next.addEventListener('click',function () { if (!next.disabled) { page++; loadReviews(); } });
    document.getElementById('pd-reviews-retry').addEventListener('click',loadReviews);
    document.addEventListener('langchange',render);
    function start(id) {
        if (!Number.isInteger(id) || id < 0 || id === productId) return;
        productId = id; filter = 'all'; page = 1; data = null; loadReviews();
    }
    document.addEventListener('breeze:product-loaded',function (event) { start(event.detail.productId); });
    document.addEventListener('breeze:review-created',function (event) {
        if (event.detail.productId !== productId) return;
        filter = 'all'; page = 1; loadReviews();
    });
    document.addEventListener('breeze:review-changed',function (event) {
        if (event.detail.productId === productId) loadReviews();
    });
    document.addEventListener('breeze:review-owner',function (event) {
        if (event.detail.productId === productId) render();
    });
    render();
    // The Product fetch may finish while this external script is still downloading.
    if (window.BreezeProductReviews) start(window.BreezeProductReviews.getProductId());
})();
