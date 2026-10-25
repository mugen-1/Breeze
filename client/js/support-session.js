/* Shared HttpOnly guest session: no token, identity or chat in browser storage.
   Every living BREEZE page sends activity; the last page's final signal starts
   the five-minute grace period. Background freezing/network failure can expire it. */
(function () {
    'use strict';
    var helper = window.AuthHelper, api = window.BreezeSupportAPI;
    if (!helper || !api) return;
    var active = false, suspended = false, timer, pending = null, pendingUid, prepared = false, preparedUid;
    var beatBusy = false, channel = null, serial = 0;
    function identity() { var user = helper.getUser(); return user ? user.uid : null; }
    function failure(status) { var e = new Error('SUPPORT_SESSION_UNAVAILABLE'); e.code = 'SUPPORT_SESSION_UNAVAILABLE'; e.status = status || 0; return e; }
    function notify(ended) {
        document.dispatchEvent(new CustomEvent('supportsessionchange', { detail: { ended: !!ended } }));
    }
    function broadcast() { if (channel) try { channel.postMessage({ type: 'changed' }); } catch (_) {} }
    function stop() { clearTimeout(timer); timer = null; }
    function schedule() {
        stop();
        if (!suspended && identity() === null) timer = setTimeout(beat, 30000);
    }
    async function post(path, uid, keepalive) {
        var controller = new AbortController(), timeout;
        var deadline = new Promise(function (_resolve, reject) { timeout = setTimeout(function () { controller.abort(); reject(failure()); }, 25000); });
        var work = Promise.resolve().then(function () { return uid === null ? null : helper.getToken(); }).then(function (token) {
            if (identity() !== uid || controller.signal.aborted) throw failure(401);
            if (uid !== null && !token) throw failure(401);
            var headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = 'Bearer ' + token;
            return fetch((window.API_BASE || '') + path, { method: 'POST', credentials: 'include', cache: 'no-store', headers: headers,
                body: '{}', keepalive: !!keepalive, signal: controller.signal });
        }).then(function (r) {
            return r.json().then(function (data) { if (!r.ok) throw failure(r.status); return data; });
        });
        try { return await Promise.race([work, deadline]); }
        catch (e) { throw e.code === 'SUPPORT_SESSION_UNAVAILABLE' ? e : failure(e.status); }
        finally { clearTimeout(timeout); }
    }
    function prepare(uid, force) {
        if (identity() !== uid) return Promise.reject(failure(401));
        if (pending && pendingUid === uid) return pending;
        if (!force && prepared && preparedUid === uid) return Promise.resolve();
        var run = ++serial; pendingUid = uid; prepared = false; active = false; stop();
        var work = Promise.resolve().then(function () { return uid !== null ? api.whenGuestIdle() : null; })
            .then(function () { return post('/api/support/session', uid); })
            .catch(function (e) {
                if (uid === null && e.status === 401) return { role: 'guest', active: false };
                throw e;
            }).then(function (data) {
                if (identity() !== uid || run !== serial) throw failure(401);
                if (!data || ['guest', 'customer', 'admin'].indexOf(data.role) < 0 || typeof data.active !== 'boolean') throw failure();
                prepared = true; preparedUid = uid; active = uid === null && data.active; schedule();
                notify(!active); if (data.merged || data.discarded) broadcast();
                return data;
            });
        pending = work;
        work.then(function () { if (pending === work) pending = null; }, function () {
            if (pending === work) pending = null;
            if (uid === null && run === serial && identity() === null) schedule();
        });
        return work;
    }
    async function beat() {
        stop(); if (suspended || identity() !== null || beatBusy) return;
        beatBusy = true; var run = serial;
        try {
            var data = await post('/api/support/heartbeat', null);
            if (run === serial && identity() === null) {
                var ended = active && !data.active; active = !!data.active;
                if (ended) { prepared = false; notify(true); broadcast(); }
            }
        } catch (e) {
            if (run === serial && identity() === null && e.status === 401) { active = false; prepared = false; notify(true); broadcast(); }
        } finally { beatBusy = false; schedule(); }
    }
    function refresh() { return prepare(identity(), true); }
    function retry() { if (!suspended) refresh().catch(function () {}); }
    window.BreezeSupportSession = Object.freeze({ prepare: prepare, refresh: refresh,
        activate: function () { if (identity() === null) { active = true; prepared = true; preparedUid = null; schedule(); broadcast(); } } });
    if (typeof window.BroadcastChannel === 'function') {
        try { channel = new window.BroadcastChannel('breeze-support-session'); channel.onmessage = function (e) { if (e.data && e.data.type === 'changed') retry(); }; } catch (_) {}
    }
    helper.onChange(function () { refresh().catch(function () {}); });
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    window.addEventListener('pageshow', function () { suspended = false; retry(); });
    window.addEventListener('pagehide', function () {
        suspended = true; stop();
        // Keepalive final activity is metadata only. It cannot revive an expired session.
        if (active && identity() === null) post('/api/support/heartbeat', null, true).catch(function () {});
    });
})();
