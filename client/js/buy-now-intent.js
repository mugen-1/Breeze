/* Pending Buy now is separate from the guest cart. No credentials or prices.
   The cart API has no idempotency key: a lost POST response is never retried
   automatically, even after reload. This is not an exactly-once server protocol. */
(function () {
    'use strict';
    var KEY = 'breeze_buy_now_intent', TTL = 15 * 60 * 1000;
    var flight = null, authWait = null;
    function error(key) { var e = new Error(key); e.purchaseKey = key; return e; }
    function tr(key) { return window.__i18n && window.__i18n.t ? window.__i18n.t(key) : key; }
    function clear() { try { sessionStorage.removeItem(KEY); } catch (_) {} }
    function read() {
        var raw;
        try { raw = sessionStorage.getItem(KEY); } catch (_) { throw error('pd.purchaseStorage'); }
        if (!raw) return null;
        var p;
        try { p = JSON.parse(raw); } catch (_) { clear(); return null; }
        if (!p || p.version !== 1 || !/^[a-f0-9]{32}$/.test(p.id) ||
            !Number.isInteger(p.productId) || p.productId < 0 || !Number.isInteger(p.variantId) || p.variantId <= 0 ||
            p.quantity !== 1 || !Number.isFinite(p.createdAt) || p.createdAt > Date.now() || Date.now() - p.createdAt >= TTL ||
            ['new', 'checking', 'processing', 'completed', 'failed', 'uncertain'].indexOf(p.state) < 0 ||
            (p.ownerUid !== undefined && (typeof p.ownerUid !== 'string' || !p.ownerUid || p.ownerUid.length > 128))) {
            clear(); return null;
        }
        // Copy only the supported fields. Storage is untrusted; never read a URL.
        return { version: 1, id: p.id, productId: p.productId, variantId: p.variantId, quantity: 1,
            createdAt: p.createdAt, state: p.state, ownerUid: p.ownerUid };
    }
    function write(p) {
        try {
            sessionStorage.setItem(KEY, JSON.stringify(p));
            var saved = JSON.parse(sessionStorage.getItem(KEY));
            if (!saved || saved.id !== p.id || saved.state !== p.state) throw Error('not saved');
        } catch (_) { throw error('pd.purchaseStorage'); }
    }
    function create(productId, variantId) {
        if (!Number.isInteger(productId) || productId < 0 || !Number.isInteger(variantId) || variantId <= 0) {
            throw error('pd.purchaseUnavailable');
        }
        var previous = read();
        if (previous && ['processing', 'uncertain'].indexOf(previous.state) >= 0) throw error('pd.purchaseUnknown');
        var bytes = new Uint8Array(16);
        if (!window.crypto || !window.crypto.getRandomValues) throw error('pd.purchaseStorage');
        window.crypto.getRandomValues(bytes);
        var id = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        write({ version: 1, id: id, productId: productId, variantId: variantId, quantity: 1, createdAt: Date.now(), state: 'new' });
        return id;
    }
    function requested() { return new URLSearchParams(window.location.search).has('purchase'); }
    function active() {
        var query = new URLSearchParams(window.location.search), p = read();
        if (query.get('redirect') !== 'cart' || query.getAll('purchase').length !== 1 || !p || p.id !== query.get('purchase')) {
            throw error('pd.purchaseExpired');
        }
        return p;
    }
    function whenAuthReady() {
        var helper = window.AuthHelper;
        if (!helper || typeof helper.onChange !== 'function') return Promise.reject(error('pd.purchaseAuth'));
        if (helper.ready) return Promise.resolve();
        if (!authWait) {
            authWait = new Promise(function (resolve, reject) {
                var timeout = setTimeout(function () { authWait = null; reject(error('pd.purchaseAuth')); }, 25000);
                helper.onChange(function () { clearTimeout(timeout); resolve(); });
            });
        }
        return authWait;
    }
    function sameUser(uid) {
        var helper = window.AuthHelper, user = helper && helper.getUser();
        return helper && helper.ready === true && helper.isLoggedIn() && user && user.uid === uid;
    }
    function responseKey(response, data) {
        if (response.status === 401) return 'au.notLoggedIn';
        if (response.status === 429) return 'pd.purchaseRateLimit';
        if (data && data.error === 'BLACKLISTED') return 'acc.blocked';
        if (response.status === 404 || response.status === 409) return 'pd.purchaseUnavailable';
        return 'acc.errAddCart';
    }
    function resume(uid, role) {
        var p;
        try { p = active(); } catch (e) { return Promise.reject(e); }
        if (flight) return flight.id === p.id && flight.uid === uid ? flight.promise : Promise.reject(error('pd.purchaseUnknown'));
        if (p.ownerUid && p.ownerUid !== uid) return Promise.reject(error('au.notLoggedIn'));
        if (role !== 'customer') return Promise.reject(error('acc.adminBlocked'));
        if (p.state === 'completed') return Promise.resolve();
        if (p.state === 'processing' || p.state === 'uncertain') return Promise.reject(error('pd.purchaseUnknown'));
        var controller = new AbortController(), sent = false, rejected = false;
        function guard() {
            if (controller.signal.aborted || !sameUser(uid)) throw error('au.notLoggedIn');
            if (active().id !== p.id) throw error('pd.purchaseExpired');
        }
        var operation = { id: p.id, uid: uid, controller: controller };
        flight = operation;
        operation.promise = Promise.resolve().then(async function () {
            await whenAuthReady(); guard();
            p.ownerUid = uid; p.state = 'checking'; write(p);
            if (typeof window.whenCartReady !== 'function') throw error('pd.purchaseSync');
            try { await window.whenCartReady(uid); } catch (_) { throw error('pd.purchaseSync'); }
            guard();
            var productResponse = await window.AuthHelper.apiFetch('/api/products/' + p.productId, { signal: controller.signal });
            guard();
            if (!productResponse.ok) throw error(responseKey(productResponse));
            var product = await productResponse.json(); guard();
            var variant = product && Array.isArray(product.variants) && product.variants.find(function (v) { return v.id === p.variantId; });
            if (!product || product.id !== p.productId || product.is_active === false || !variant || !variant.available || variant.is_active === false ||
                (product.size_configured && variant.size == null) ||
                (product.color_configured && !(product.colors || []).some(function (c) { return c.key === variant.color && c.available; }))) {
                throw error('pd.purchaseUnavailable');
            }
            var beforeResponse = await window.AuthHelper.apiFetch('/api/cart', { signal: controller.signal }); guard();
            if (!beforeResponse.ok) throw error(responseKey(beforeResponse));
            var before = await beforeResponse.json(); guard();
            if (!before || !Array.isArray(before.items)) throw error('acc.errAddCart');
            var old = before.items.find(function (item) { return item.variant_id === p.variantId; });
            var quantity = old ? old.quantity : 0;
            if (!Number.isInteger(quantity) || quantity < 0) throw error('acc.errAddCart');
            if (quantity >= CART_MAX_QTY) throw error('pd.purchaseMax');
            // Persist BEFORE the mutation. A new document finding this marker
            // must treat the result as unknown, never submit the POST again.
            p.state = 'processing'; write(p); guard();
            sent = true;
            var response = await window.AuthHelper.apiFetch('/api/cart', { method: 'POST', signal: controller.signal,
                body: JSON.stringify({ product_id: p.productId, variant_id: p.variantId, quantity: 1, mode: 'add' }) });
            guard();
            if (!response.ok && [400, 401, 403, 404, 409, 429].indexOf(response.status) >= 0) {
                rejected = true;
                var failure = await response.json().catch(function () { return {}; });
                throw error(responseKey(response, failure));
            }
            if (!response.ok) throw error('pd.purchaseUnknown');
            var data = await response.json(); guard();
            var added = data && Array.isArray(data.items) && data.items.find(function (item) {
                return item.product_id === p.productId && item.variant_id === p.variantId;
            });
            if (!added || !Number.isInteger(added.quantity) || added.quantity <= quantity) throw error('pd.purchaseUnknown');
            p.state = 'completed'; write(p); clear();
        }).catch(function (e) {
            p.state = sent && !rejected ? 'uncertain' : 'failed';
            try { var stored = read(); if (stored && stored.id === p.id) write(p); } catch (_) {}
            throw sent && !rejected ? error('pd.purchaseUnknown') : e.purchaseKey ? e : error('acc.errAddCart');
        }).finally(function () { if (flight === operation) flight = null; });
        return operation.promise;
    }
    function recovery() {
        if (!requested()) return;
        var el = document.getElementById('login-msg'), p;
        if (!el) return;
        try { p = read(); } catch (_) {}
        // Use the existing form feedback area and link styles; no layout change.
        function link(key, href) {
            var gap = document.createElement('span'); gap.textContent = ' · '; el.appendChild(gap);
            var a = document.createElement('a'); a.className = 'auth-details'; a.textContent = tr(key); a.href = href;
            a.setAttribute('data-i18n', key);
            a.addEventListener('click', clear); el.appendChild(a);
        }
        if (p && (p.state === 'processing' || p.state === 'uncertain')) link('pd.purchaseCheckCart', window.BreezeRoutes.to('cart'));
        if (p) link('pd.purchaseBack', window.BreezeRoutes.product(p.productId));
        link('pd.purchaseCancel', window.BreezeRoutes.to('login'));
    }
    window.BreezePurchase = Object.freeze({ create: create, requested: requested, resume: resume, cancel: clear,
        whenAuthReady: whenAuthReady, recovery: recovery });
    document.addEventListener('authchange', function () {
        if (flight && !sameUser(flight.uid)) flight.controller.abort();
    });
    window.addEventListener('pagehide', function () { if (flight) flight.controller.abort(); });
    if (window.BreezeRoutes.is('login')) {
        if (!requested()) clear();
        else {
            var el = document.getElementById('login-msg');
            if (el) {
                try {
                    var p = active();
                    el.textContent = tr(p.state === 'processing' || p.state === 'uncertain' ? 'pd.purchaseUnknown' : 'pd.purchaseLogin');
                } catch (e) { el.textContent = tr(e.purchaseKey || 'pd.purchaseExpired'); }
                el.style.display = 'block'; recovery();
            }
        }
    }
})();
