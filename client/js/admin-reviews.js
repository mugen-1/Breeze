/* Admin Review API integration; permissions are enforced again by the backend. */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var reviews = null, modalReview = null, modalMode = null;
    var modalTrigger = null, previousOverflow = '', moderationStatus = null;
    var page = 1, total = 0, totalPages = 0, status = 'all';
    var listLoading = false, listError = false, detailLoading = false, detailError = false, moderating = false;
    var accessEpoch = 0, listEpoch = 0, modalEpoch = 0;
    function allowed() { return document.body.classList.contains('adm-authed'); }
    function request(url, options) {
        if (!window.AuthHelper || !window.AuthHelper.apiFetch) return Promise.reject(new Error('auth-not-ready'));
        return window.AuthHelper.apiFetch(url, options).then(function (response) {
            if (!response.ok) throw new Error('review-request-failed');
            return response.json();
        });
    }

    function lang() { return (window.__i18n && window.__i18n.current) || 'vi'; }
    function label(el, key) { el.setAttribute('data-i18n', key); el.textContent = t(key); }
    function text(value) { return (typeof value === 'string' && value !== '') || typeof value === 'number' ? String(value) : '—'; }
    function dateLabel(iso) {
        if (iso == null || iso === '') return '—';
        var date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '—';
        var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh',
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
        var values = {}; parts.forEach(function (part) { values[part.type] = part.value; });
        return values.day + '/' + values.month + '/' + values.year + ' - ' + values.hour + ':' + values.minute;
    }
    function purchaseLabel(review) {
        // Only an explicit backend-supplied boolean, never username, owner or order guesses.
        return review.verifiedPurchase === true ? t('adm.reviewPurchasedYes') :
            review.verifiedPurchase === false ? t('adm.reviewPurchasedNo') : '—';
    }
    function ratingNode(value) {
        var el = document.createElement('span'), rating = Number(value);
        el.className = 'adm-review-rating';
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) { el.textContent = '—'; return el; }
        el.textContent = '★'.repeat(rating) + '☆'.repeat(5 - rating);
        el.setAttribute('role', 'img'); el.setAttribute('aria-label', t('pd.reviewStar', { n: rating }));
        return el;
    }
    function statusNode(status) {
        var el = document.createElement('span');
        if (status !== 'visible' && status !== 'hidden') { el.textContent = '—'; return el; }
        el.className = 'pill ' + (status === 'visible' ? 'on' : 'off');
        el.textContent = t(status === 'visible' ? 'adm.reviewVisible' : 'adm.reviewHidden');
        return el;
    }
    function appendValue(el, value) {
        if (typeof value === 'string') el.textContent = value;
        else el.appendChild(value);
    }
    function cell(row, value, className) {
        var td = document.createElement('td');
        if (className) td.className = className;
        appendValue(td, value); row.appendChild(td); return td;
    }
    function actionButton(review, action, key) {
        var button = document.createElement('button'); button.type = 'button';
        button.className = 'adm-btn ghost small'; label(button, key);
        button.disabled = moderating || listLoading;
        button.setAttribute('data-admin-review-action', action);
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', action === 'detail' ? 'admin-review-detail-modal' : 'admin-review-confirm-modal');
        button.addEventListener('click', function () { openReviewModal(review, action === 'detail' ? 'detail' : 'moderation', button); });
        return button;
    }
    function reviewRow(review) {
        var row = document.createElement('tr'); row.setAttribute('data-admin-review-id', review.id == null ? '' : review.id);
        cell(row, text(review.user && review.user.displayName), 'adm-review-name');
        cell(row, text(review.product && review.product.name), 'adm-review-name');
        cell(row, ratingNode(review.rating));
        var comment = document.createElement('span'); comment.className = 'adm-review-comment';
        var chars = Array.from(text(review.comment)); comment.textContent = chars.slice(0, 120).join('') + (chars.length > 120 ? '…' : '');
        cell(row, comment);
        cell(row, purchaseLabel(review)); cell(row, dateLabel(review.createdAt), 'adm-review-date');
        cell(row, statusNode(review.status));
        var actions = document.createElement('div'); actions.className = 'adm-actions adm-review-actions';
        actions.appendChild(actionButton(review, 'detail', 'adm.reviewViewDetail'));
        if (review.id != null && (review.status === 'visible' || review.status === 'hidden')) {
            actions.appendChild(actionButton(review, review.status === 'visible' ? 'hide' : 'unhide',
                review.status === 'visible' ? 'adm.reviewHide' : 'adm.reviewUnhide'));
        }
        cell(row, actions); return row;
    }
    function renderTable() {
        var body = $('admin-reviews-body'); body.replaceChildren();
        body.setAttribute('aria-busy', String(listLoading));
        $('admin-review-status').disabled = listLoading || moderating;
        $('admin-review-pager').hidden = !total;
        $('admin-review-page').textContent = t('adm.pgPage') + ' ' + page + ' / ' + totalPages;
        $('admin-review-prev').disabled = listLoading || moderating || listError || page <= 1;
        $('admin-review-next').disabled = listLoading || moderating || listError || page >= totalPages;
        if (listLoading || listError) {
            var messageRow = document.createElement('tr'), message = cell(messageRow, t(listLoading ? 'com.loading' : 'adm.reviewLoadError'), 'adm-empty');
            message.setAttribute('colspan', '8');
            if (listError) {
                var retry = document.createElement('button'); retry.type = 'button'; retry.className = 'adm-btn ghost small';
                label(retry, 'adm.reviewRetry'); retry.addEventListener('click', function () { loadList(page); }); message.appendChild(retry);
            }
            body.appendChild(messageRow); return;
        }
        if (!reviews || !reviews.length) {
            var row = document.createElement('tr'), empty = cell(row, t('adm.reviewsEmpty'), 'adm-empty');
            empty.setAttribute('colspan', '8'); empty.setAttribute('data-i18n', 'adm.reviewsEmpty'); body.appendChild(row);
            return;
        }
        reviews.forEach(function (review) { body.appendChild(reviewRow(review)); });
    }
    function renderDetail() {
        var fields = $('admin-review-detail-fields'); fields.replaceChildren();
        if (detailLoading || detailError || !modalReview) {
            var group = document.createElement('div'), dd = document.createElement('dd');
            dd.textContent = t(detailError ? 'adm.reviewLoadError' : 'com.loading'); dd.setAttribute('role', 'status');
            if (detailError) {
                var retry = document.createElement('button'); retry.type = 'button'; retry.id = 'admin-review-detail-retry';
                retry.className = 'adm-btn ghost small'; label(retry, 'adm.reviewRetry');
                retry.addEventListener('click', function () { loadDetail(detailError); }); dd.appendChild(retry);
            }
            group.appendChild(dd); fields.appendChild(group); return;
        }
        var review = modalReview;
        var entries = [
            ['adm.users', text(review.user && review.user.displayName)],
            ['adm.products', text(review.product && review.product.name)],
            ['adm.reviewRating', ratingNode(review.rating)], ['adm.reviewDate', dateLabel(review.createdAt)],
            ['adm.reviewUpdatedAt', dateLabel(review.updatedAt)],
            ['pd.reviewPurchasedVariant', text(review.variant && [review.variant.size, review.variant.color].filter(Boolean).join(' / '))],
            ['adm.reviewPurchased', purchaseLabel(review)], ['adm.thStatus', statusNode(review.status)],
            ['adm.reviewComment', text(review.comment)]
        ];
        // Only render explicit public/Admin fields, never a raw response object.
        if (review.user && typeof review.user.email === 'string' && review.user.email) entries.splice(1, 0, ['adm.thEmail', review.user.email]);
        entries.forEach(function (entry) {
            var group = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
            if (entry[0] === 'adm.reviewComment') group.className = 'adm-review-full-comment';
            dt.textContent = t(entry[0]); appendValue(dd, entry[1]);
            group.appendChild(dt); group.appendChild(dd); fields.appendChild(group);
        });
        var productImage = $('admin-review-product-image'), imageUrl = review.product && review.product.imageUrl;
        productImage.hidden = typeof imageUrl !== 'string' || !imageUrl;
        productImage.alt = text(review.product && review.product.name);
        if (!productImage.hidden) productImage.src = imageUrl;
        else productImage.removeAttribute('src');
        var gallery = $('admin-review-gallery'); gallery.replaceChildren();
        var images = (Array.isArray(review.images) ? review.images : []).map(function (image) {
            return typeof image === 'string' ? image : image && image.url;
        }).filter(function (url) { return typeof url === 'string' && !!url; }).slice(0, 5);
        $('admin-review-detail-images').hidden = !images.length;
        images.forEach(function (url, i) {
            var image = document.createElement('img'); image.src = url; image.alt = t('pd.reviewPreview', { n: i + 1 });
            image.addEventListener('error', function () { image.hidden = true; }); gallery.appendChild(image);
        });
    }
    function renderConfirmation() {
        var hide = moderationStatus === 'hidden';
        label($('admin-review-confirm-title'), hide ? 'adm.reviewHideTitle' : 'adm.reviewUnhideTitle');
        label($('admin-review-confirm-message'), hide ? 'adm.reviewHideDescription' : 'adm.reviewUnhideDescription');
        label($('admin-review-confirm-ok'), hide ? 'adm.reviewHide' : 'adm.reviewUnhide');
        $('admin-review-confirm-ok').disabled = moderating;
        $('admin-review-confirm-cancel').disabled = moderating;
        if (!$('admin-review-confirm-feedback').hidden) $('admin-review-confirm-feedback').textContent = t(moderating ? 'com.loading' : 'adm.reviewModerationError');
    }
    function closeReviewModal(force) {
        if (moderating && !force) return;
        if (!modalMode) return;
        modalEpoch++; detailLoading = detailError = false;
        $('admin-review-detail-modal').classList.remove('open');
        $('admin-review-confirm-modal').classList.remove('open');
        $('admin-review-detail-fields').replaceChildren(); $('admin-review-gallery').replaceChildren();
        $('admin-review-detail-images').hidden = true;
        $('admin-review-product-image').hidden = true; $('admin-review-product-image').removeAttribute('src');
        $('admin-review-confirm-feedback').hidden = true; $('admin-review-confirm-feedback').textContent = '';
        $('admin-review-confirm-ok').disabled = false;
        $('admin-review-confirm-cancel').disabled = false;
        document.body.style.overflow = previousOverflow;
        var trigger = modalTrigger;
        if (!trigger || trigger.isConnected === false) trigger = document.querySelector('.adm-nav-item[data-nav="reviews"]');
        if (trigger) trigger.focus({ preventScroll: true });
        modalReview = modalMode = modalTrigger = moderationStatus = null;
    }
    function openReviewModal(review, mode, trigger) {
        if (!allowed() || moderating || listLoading || !reviews || reviews.indexOf(review) === -1) return;
        if (mode === 'moderation' && (review.id == null || (review.status !== 'visible' && review.status !== 'hidden'))) return;
        closeReviewModal();
        modalReview = review; modalMode = mode; modalTrigger = trigger;
        previousOverflow = document.body.style.overflow || '';
        document.body.style.overflow = 'hidden';
        if (mode === 'detail') {
            modalReview = null; loadDetail(review.id); $('admin-review-detail-modal').classList.add('open');
            $('admin-review-detail-close').focus({ preventScroll: true });
        } else {
            moderationStatus = review.status === 'visible' ? 'hidden' : 'visible';
            renderConfirmation(); $('admin-review-confirm-modal').classList.add('open');
            $('admin-review-confirm-cancel').focus({ preventScroll: true });
        }
    }
    function onModalKeydown(e) {
        if (!modalMode) return;
        if (e.key === 'Escape') { e.preventDefault(); closeReviewModal(); return; }
        if (e.key !== 'Tab') return;
        var controls = modalMode === 'detail' ? [$('admin-review-detail-close')] :
            [$('admin-review-confirm-cancel'), $('admin-review-confirm-ok')].filter(function (button) { return !button.disabled; });
        var retry = document.getElementById('admin-review-detail-retry');
        if (modalMode === 'detail' && detailError && retry) controls.push(retry);
        if (!controls.length) { e.preventDefault(); $('admin-review-confirm-modal').focus(); return; }
        var first = controls[0], last = controls[controls.length - 1];
        if (controls.indexOf(document.activeElement) === -1 || (!e.shiftKey && document.activeElement === last)) {
            e.preventDefault(); first.focus({ preventScroll: true });
        } else if (e.shiftKey && document.activeElement === first) {
            e.preventDefault(); last.focus({ preventScroll: true });
        }
    }
    function loadDetail(id) {
        var epoch = ++modalEpoch, access = accessEpoch;
        detailLoading = true; detailError = false; modalReview = null; renderDetail();
        return request('/api/admin/reviews/' + encodeURIComponent(id)).then(function (review) {
            if (epoch !== modalEpoch || access !== accessEpoch || !allowed()) return;
            if (!review || review.id !== id) throw new Error('invalid-review-detail');
            detailLoading = false; modalReview = review; renderDetail();
        }).catch(function () {
            if (epoch !== modalEpoch || access !== accessEpoch || !allowed()) return;
            detailLoading = false; detailError = id; renderDetail();
        });
    }
    function loadList(nextPage) {
        if (!allowed() || moderating) return Promise.resolve();
        var epoch = ++listEpoch, access = accessEpoch;
        page = Number.isInteger(nextPage) && nextPage > 0 ? nextPage : page;
        listLoading = true; listError = false; reviews = null; closeReviewModal(); renderTable();
        return request('/api/admin/reviews?page=' + page + '&limit=20&status=' + encodeURIComponent(status)).then(function (data) {
            if (epoch !== listEpoch || access !== accessEpoch || !allowed()) return;
            if (!data || !Array.isArray(data.reviews)) throw new Error('invalid-review-list');
            reviews = data.reviews; page = data.page; total = data.total; totalPages = data.totalPages;
            listLoading = false; renderTable();
        }).catch(function () {
            if (epoch !== listEpoch || access !== accessEpoch || !allowed()) return;
            listLoading = false; listError = true; renderTable();
        });
    }
    window.BreezeAdminReviews = Object.freeze({
        load: loadList,
        reset: function () {
            accessEpoch++; listEpoch++; moderating = listLoading = listError = false;
            reviews = null; page = 1; total = totalPages = 0; status = 'all'; $('admin-review-status').value = status;
            closeReviewModal(true); renderTable();
        }
    });
    document.addEventListener('DOMContentLoaded', function () {
        renderTable();
        $('admin-review-status').value = status;
        $('admin-review-status').addEventListener('change', function () { status = this.value; loadList(1); });
        $('admin-review-prev').addEventListener('click', function () { if (!this.disabled) loadList(page - 1); });
        $('admin-review-next').addEventListener('click', function () { if (!this.disabled) loadList(page + 1); });
        $('admin-review-detail-close').addEventListener('click', function () { closeReviewModal(); });
        $('admin-review-confirm-cancel').addEventListener('click', function () { closeReviewModal(); });
        ['admin-review-detail-modal', 'admin-review-confirm-modal'].forEach(function (id) {
            $(id).addEventListener('click', function (e) { if (e.target === $(id)) closeReviewModal(); });
            $(id).addEventListener('keydown', onModalKeydown);
        });
        $('admin-review-product-image').addEventListener('error', function () { this.hidden = true; this.removeAttribute('src'); });
        $('admin-review-confirm-ok').addEventListener('click', function () {
            if (modalMode !== 'moderation' || moderating || this.disabled || !allowed()) return;
            var epoch = accessEpoch, id = modalReview.id, hidden = moderationStatus === 'hidden';
            moderating = true;
            $('admin-review-confirm-feedback').hidden = false;
            renderConfirmation(); renderTable(); $('admin-review-confirm-modal').focus();
            request('/api/admin/reviews/' + encodeURIComponent(id) + '/visibility', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isHidden: hidden })
            }).then(function () {
                if (epoch !== accessEpoch || !allowed()) return;
                moderating = false; closeReviewModal(); return loadList(page);
            }).catch(function () {
                if (epoch !== accessEpoch || !allowed()) return;
                moderating = false; renderConfirmation(); renderTable();
            });
        });
        document.addEventListener('langchange', function () {
            renderTable();
            if (modalMode === 'detail') renderDetail();
            else if (modalMode === 'moderation') renderConfirmation();
        });
    });
})();
