/* Transport CSKH: cookie phiên + Firebase, giữ đúng danh tính của thao tác UI.
   Không lưu draft, token hay transcript vào storage; không tự retry POST. */
(function () {
    'use strict';
    function error(code, status) { var e = new Error(code); e.code = code; e.status = status || 0; return e; }
    function identity() {
        var helper = window.AuthHelper, user = helper && helper.getUser();
        return user ? user.uid : null;
    }
    function matches(uid) { return !!(window.AuthHelper && window.AuthHelper.ready && identity() === uid); }
    var guestPosts = [];
    function request(path, options, uid) {
        options = options || {};
        if (!matches(uid)) return Promise.reject(error('SUPPORT_IDENTITY_CHANGED'));
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timedOut = false, timer;
        var timeout = new Promise(function (_resolve, reject) {
            timer = setTimeout(function () {
                timedOut = true;
                if (controller) controller.abort();
                reject(error('SUPPORT_TIMEOUT'));
            }, 25000);
        });
        var work = Promise.resolve().then(function () {
            return window.BreezeSupportSession ? window.BreezeSupportSession.prepare(uid) : null;
        }).then(function () {
            return window.AuthHelper.getToken();
        }).then(function (token) {
            if (timedOut) throw error('SUPPORT_TIMEOUT');
            if (!matches(uid)) throw error('SUPPORT_IDENTITY_CHANGED');
            if (uid !== null && !token) throw error('SUPPORT_AUTH_REQUIRED', 401);
            var opts = { method: options.method || 'GET', credentials: 'include', cache: 'no-store', headers: {} };
            if (token) opts.headers.Authorization = 'Bearer ' + token;
            if (options.body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(options.body); }
            if (controller) opts.signal = controller.signal;
            return fetch((window.API_BASE || '') + path, opts);
        }).then(function (response) {
            if (!matches(uid)) throw error('SUPPORT_IDENTITY_CHANGED');
            return response.json().catch(function () { throw error('SUPPORT_BAD_RESPONSE', response.status); }).then(function (data) {
                if (!matches(uid)) throw error('SUPPORT_IDENTITY_CHANGED');
                if (!response.ok) throw error(data && data.code || 'SUPPORT_REQUEST_FAILED', response.status);
                return data;
            });
        });
        var result = Promise.race([work, timeout]).then(function (data) { clearTimeout(timer); return data; }, function (e) { clearTimeout(timer); throw e; });
        if (uid === null && options.method === 'POST') {
            guestPosts.push(result);
            function done() { guestPosts = guestPosts.filter(function (p) { return p !== result; }); }
            result.then(done, done);
        }
        return result;
    }
    function uuid() {
        var crypto = window.crypto;
        if (crypto && crypto.randomUUID) return crypto.randomUUID();
        if (!crypto || !crypto.getRandomValues) throw error('SUPPORT_CRYPTO_UNAVAILABLE');
        var bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
        var hex = Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    }
    function merge(first, second) {
        var seen = Object.create(null);
        return first.concat(second).filter(function (m) { if (seen[m.id]) return false; seen[m.id] = true; return true; }).sort(function (a, b) {
            var time = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
            // SQL BIGINT IDs exceed Number's exact range. Compare decimal strings.
            return time || a.id.length - b.id.length || a.id.localeCompare(b.id);
        });
    }
    // Group only adjacent messages from the same human sender, up to five minutes apart.
    function sameGroup(first, second) {
        if (!first || !second || !first.createdAt || !second.createdAt || first.kind === 'system' || first.kind !== second.kind) return false;
        if (first.kind === 'admin' && (first.senderUserId != null || second.senderUserId != null ?
            first.senderUserId !== second.senderUserId : first.senderName !== second.senderName)) return false;
        var gap = new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
        return Number.isFinite(gap) && gap >= 0 && gap <= 5 * 60 * 1000;
    }
    function validMessage(value) {
        return !!(value && typeof value.id === 'string' && /^[1-9]\d*$/.test(value.id) &&
            ['customer', 'admin', 'system'].indexOf(value.kind) >= 0 && typeof value.text === 'string');
    }
    function errorKey(e) {
        if (e.status === 429) return 'support.rateLimit';
        if (e.status === 409) return 'support.conflict';
        if (e.status === 400 || e.status === 415) return 'support.invalid';
        if (e.status === 401) return 'support.authExpired';
        return 'support.requestError';
    }
    var watches = [];
    function parser(dispatch) {
        var buffer = '', name = '', lines = [], size = 0;
        return function (chunk) {
            buffer += chunk;
            var match;
            while ((match = /\r\n|\r|\n/.exec(buffer))) {
                if (match[0] === '\r' && match.index === buffer.length - 1) break;
                var line = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
                if (!line) {
                    if (lines.length) dispatch(name || 'message', lines.join('\n'));
                    name = ''; lines = []; size = 0;
                } else if (line[0] !== ':') {
                    var colon = line.indexOf(':'), field = colon < 0 ? line : line.slice(0, colon);
                    var value = colon < 0 ? '' : line.slice(colon + 1); if (value[0] === ' ') value = value.slice(1);
                    if (field === 'event') name = value;
                    if (field === 'data') { size += value.length; if (size > 65536) throw error('SUPPORT_BAD_STREAM'); lines.push(value); }
                }
            }
            if (buffer.length > 65536) throw error('SUPPORT_BAD_STREAM');
        };
    }
    function watch(path, uid, callbacks) {
        callbacks = callbacks || {};
        function call(name, value, kind) {
            try { if (callbacks[name]) callbacks[name](value, kind); }
            catch (_) { console.error('[support-stream] UI callback failed'); }
        }
        if (typeof TextDecoder !== 'function' || typeof AbortController !== 'function') {
            call('onState', 'unavailable'); return { close: function () {} };
        }
        var closed = false, sequence = 0, retryTimer, currentController, failures = 0, state = 'connecting';
        var handle = { uid: uid, close: close, retry: function () {
            if (!closed && state === 'reconnecting') { clearTimeout(retryTimer); if (currentController) currentController.abort(); connect(); }
        } };
        function status(value) { state = value; call('onState', value); }
        function close() {
            if (closed) return; closed = true; ++sequence; clearTimeout(retryTimer);
            if (currentController) currentController.abort();
            watches = watches.filter(function (item) { return item !== handle; }); status('closed');
        }
        async function connect() {
            if (closed) return;
            if (!matches(uid)) { close(); return; }
            var run = ++sequence, controller = new AbortController(), reader, headerTimer, idleTimer, retryAfter = 0;
            currentController = controller;
            function current() { return !closed && run === sequence && matches(uid); }
            function idle() { clearTimeout(idleTimer); idleTimer = setTimeout(function () { controller.abort(); }, 45000); }
            try {
                var deadline = new Promise(function (_resolve, reject) {
                    controller.signal.addEventListener('abort', function () { reject(error('SUPPORT_STREAM_CLOSED')); }, { once: true });
                    headerTimer = setTimeout(function () { controller.abort(); reject(error('SUPPORT_TIMEOUT')); }, 25000);
                });
                var connection = Promise.resolve().then(function () { return window.AuthHelper.getToken(); }).then(function (token) {
                    if (!current() || controller.signal.aborted) throw error('SUPPORT_IDENTITY_CHANGED');
                    if (uid !== null && !token) throw error('SUPPORT_AUTH_REQUIRED', 401);
                    var headers = { Accept: 'text/event-stream' }; if (token) headers.Authorization = 'Bearer ' + token;
                    return fetch((window.API_BASE || '') + path, { headers: headers, credentials: 'include', cache: 'no-store', signal: controller.signal });
                });
                var response = await Promise.race([connection, deadline]); clearTimeout(headerTimer);
                if (!current()) { controller.abort(); return; }
                if (response.status === 204) { close(); call('onState', 'unavailable'); return; }
                if (!response.ok) {
                    var seconds = Number(response.headers && response.headers.get('retry-after'));
                    if (Number.isFinite(seconds) && seconds > 0) retryAfter = Math.min(seconds * 1000, 900000);
                    throw error('SUPPORT_STREAM_FAILED', response.status);
                }
                if (!response.headers || !/^text\/event-stream\b/i.test(response.headers.get('content-type') || '') || !response.body || !response.body.getReader) throw error('SUPPORT_BAD_STREAM');
                reader = response.body.getReader(); var decoder = new TextDecoder(); idle();
                var feed = parser(function (kind, raw) {
                    if (!current()) return;
                    if (['ready', 'change', 'auth-lost', 'unavailable'].indexOf(kind) < 0) return;
                    var data; try { data = JSON.parse(raw); } catch (_) { throw error('SUPPORT_BAD_STREAM'); }
                    if (kind === 'auth-lost') {
                        close(); call('onError', error('SUPPORT_AUTH_REQUIRED', data && data.status === 403 ? 403 : 401));
                    } else if (kind === 'unavailable') throw error('SUPPORT_STREAM_UNAVAILABLE', 503);
                    else {
                        if (kind === 'ready') { failures = 0; status('live'); }
                        call('onChange', data, kind);
                    }
                });
                while (current()) {
                    var packet = await reader.read();
                    if (packet.done) throw error('SUPPORT_STREAM_CLOSED');
                    idle(); feed(decoder.decode(packet.value, { stream: true }));
                }
            } catch (e) {
                if (!closed && run === sequence) {
                    if (!matches(uid)) close();
                    else if (e.status === 401 || e.status === 403) { close(); call('onError', e); }
                    else {
                        status('reconnecting');
                        retryTimer = setTimeout(connect, Math.max(retryAfter, Math.min(30000, 1000 * Math.pow(2, Math.min(failures++, 5)))));
                    }
                }
            } finally {
                clearTimeout(headerTimer); clearTimeout(idleTimer); controller.abort();
                if (reader) reader.cancel().catch(function () {});
                if (currentController === controller) currentController = null;
            }
        }
        watches.push(handle); status('connecting'); connect(); return handle;
    }
    if (window.AuthHelper && window.AuthHelper.onChange) window.AuthHelper.onChange(function () {
        watches.slice().forEach(function (item) { if (!matches(item.uid)) item.close(); });
    });
    window.addEventListener('online', function () { watches.slice().forEach(function (item) { item.retry(); }); });
    window.addEventListener('pagehide', function () { watches.slice().forEach(function (item) { item.close(); }); });
    window.BreezeSupportAPI = Object.freeze({ request: request, uuid: uuid, matches: matches, merge: merge, sameGroup: sameGroup, validMessage: validMessage, errorKey: errorKey, watch: watch,
        whenGuestIdle: function () { return Promise.all(guestPosts.slice().map(function (p) { return p.catch(function () {}); })); } });
})();
