/* Hộp thư CSKH: API + SSE và mốc đã đọc dùng chung cho Admin. */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); }, api = window.BreezeSupportAPI;
    var model = { status: 'unavailable', conversations: [], page: 1, totalPages: 0 }, selectedId = null;
    var rowButtons = [], items = [], nextBefore = null, epoch = 0, listSeq = 0, threadSeq = 0;
    var listBusy = false, historyBusy = false, threadReady = false, sending = false, draft = null, statusKey = '';
    var selectedCache = null, live = null, liveDirty = false, liveTimer, connectionKey = '', activeView = false, historyTail = null;
    var readBusy = false, readSeq = 0, readConfirmed = null, readCount = null, threadOpen = false, pageActive = true;
    var historyReset = 0, renderedReset = 0, historyRevision = null;
    function uid() { var user = window.AuthHelper && window.AuthHelper.getUser(); return user ? user.uid : null; }
    function allowed() { return !!(api && document.body.classList.contains('adm-authed') && uid() && api.matches(uid())); }
    function tr(key) { return window.__i18n && window.__i18n.t ? window.__i18n.t(key) : key; }
    function node(tag, cls, text) { var el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = String(text); return el; }
    function label(el, key) { el.setAttribute('data-i18n', key); el.textContent = tr(key); }
    function dateLabel(value) {
        if (!value) return '';
        var date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toLocaleString(window.__i18n && window.__i18n.current === 'en' ? 'en-GB' : 'vi-VN') : '';
    }
    function selected() { return model.conversations.find(function (item) { return item.id === selectedId; }) || selectedCache; }
    function active(token, user) { return token === epoch && allowed() && api.matches(user); }
    function later(a, b) {
        if (!a) return b; if (!b) return a;
        return a.length > b.length || (a.length === b.length && a > b) ? a : b;
    }
    function maybeRead() {
        if (!activeView || !threadOpen || !pageActive || document.hidden || !allowed() || !selected() || !threadReady || historyBusy || sending || readBusy) return;
        var region = $('admin-support-messages').parentNode;
        if (Number.isFinite(region.clientHeight) && region.scrollHeight - region.clientHeight - region.scrollTop > 16) return;
        var target = null;
        items.forEach(function (m) { if (m.kind === 'customer') target = later(target, m.id); });
        if (!target || later(readConfirmed, target) === readConfirmed) return;
        var token = epoch, user = uid(), cid = selectedId, run = readSeq, succeeded = false;
        readBusy = true;
        api.request('/api/admin/support/conversations/' + encodeURIComponent(cid) + '/read', { method: 'POST', body: { messageId: target,
            ...(readCount ? { messageCount: readCount } : {}) } }, user)
            .then(function (data) {
                if (!active(token, user) || cid !== selectedId || run !== readSeq) return;
                if (data.conversationId !== cid || typeof data.readMessageId !== 'string' || !/^[1-9]\d*$/.test(data.readMessageId)) throw new Error('support-invalid-read');
                readConfirmed = later(readConfirmed, data.readMessageId); succeeded = true;
                // Fetch SQL state instead of clearing a possibly newer unread row
                // optimistically. This also invalidates a stale inbox GET in flight.
                if (activeView && !document.hidden) load(model.page, true);
            }).catch(function (e) {
                if (!active(token, user) || cid !== selectedId || run !== readSeq) return;
                if (e.status === 409 && e.code === 'SUPPORT_HISTORY_CHANGED') history(false, true);
                else if ([401, 403, 404].indexOf(e.status) >= 0) fail(e, cid);
                else { statusKey = e.status === 429 ? api.errorKey(e) : 'admSupport.readError'; renderThread(); }
            }).then(function () {
                if (active(token, user) && cid === selectedId && run === readSeq) {
                    readBusy = false; if (succeeded) maybeRead();
                }
            });
    }
    function renderMessages() {
        var list = $('admin-support-messages'), region = list.parentNode, scrollTop = region.scrollTop;
        list.replaceChildren();
        // The waiting notice belongs only to the customer's widget. Keep it in
        // the snapshot so pagination and shared read acknowledgements stay intact.
        var visible = items.filter(function (message) { return message.kind !== 'system'; });
        visible.forEach(function (message, index) {
            var row = node('div', 'adm-support-message adm-support-message--' + message.kind +
                (api.sameGroup(visible[index - 1], message) ? ' is-continuation' : ''));
            row.appendChild(node('p', '', message.text));
            if (!api.sameGroup(message, visible[index + 1])) {
                var sender = message.senderName || tr(message.kind === 'admin' ? 'admSupport.admin' : 'admSupport.customer');
                var time = dateLabel(message.createdAt);
                row.appendChild(node('span', 'adm-support-message-caption', sender + (time ? ' · ' + time : '')));
            }
            list.appendChild(row);
        });
        // Inbox/read-state redraws must not move someone reading older messages.
        region.scrollTop = scrollTop;
    }
    function renderThread() {
        var conversation = selected(), title = $('admin-support-contact'), email = $('admin-support-email'), kind = $('admin-support-kind');
        var canReply = !!conversation && threadReady && allowed();
        $('admin-support-reply').disabled = !canReply || (historyBusy && !threadReady) || sending;
        $('admin-support-send').disabled = !canReply || historyBusy || sending || !$('admin-support-reply').value.trim();
        $('admin-support-thread-state').hidden = !!conversation && (items.length > 0 || threadReady);
        label($('admin-support-thread-message'), historyBusy ? 'admSupport.loading' : conversation ? 'admSupport.error' : 'admSupport.choose');
        $('admin-support-messages').hidden = !conversation || !items.length;
        $('admin-support-messages').setAttribute('aria-busy', String(historyBusy));
        $('admin-support-thread-refresh').disabled = !conversation || historyBusy || sending;
        $('admin-support-older').hidden = !nextBefore || !conversation;
        $('admin-support-older').disabled = historyBusy || sending;
        email.hidden = !conversation || !conversation.email; kind.hidden = !conversation;
        email.textContent = conversation && conversation.email || '';
        if (conversation) {
            title.removeAttribute('data-i18n'); title.textContent = conversation.name || tr('admSupport.customer');
            label(kind, conversation.kind === 'guest' ? 'admSupport.guest' : 'admSupport.customer');
        } else { label(title, 'admSupport.thread'); kind.textContent = ''; }
        var status = $('admin-support-unavailable');
        status.removeAttribute('data-i18n'); status.textContent = statusKey ? tr(statusKey) : ''; status.hidden = !statusKey;
        $('admin-support-connection').textContent = connectionKey ? tr(connectionKey) : '';
        $('admin-support-connection').hidden = !connectionKey;
        renderMessages();
    }
    function renderList() {
        var list = $('admin-support-list'), state = $('admin-support-list-state'); list.replaceChildren(); rowButtons = [];
        state.hidden = model.conversations.length > 0; list.setAttribute('aria-busy', String(listBusy));
        label($('admin-support-list-message'), { loading: 'admSupport.loading', error: 'admSupport.error', unavailable: 'admSupport.unavailable' }[model.status] || 'admSupport.empty');
        state.setAttribute('role', model.status === 'error' ? 'alert' : 'status');
        $('admin-support-refresh').disabled = listBusy || sending || !allowed();
        $('admin-support-pager').hidden = model.totalPages <= 1;
        $('admin-support-page').textContent = model.totalPages ? model.page + ' / ' + model.totalPages : '';
        $('admin-support-prev').disabled = listBusy || sending || model.page <= 1;
        $('admin-support-next').disabled = listBusy || sending || model.page >= model.totalPages;
        model.conversations.forEach(function (conversation) {
            var button = node('button', 'adm-support-row' + (conversation.unread ? ' is-unread' : ''));
            button.type = 'button'; button.disabled = sending;
            button.setAttribute('aria-controls', 'admin-support-messages'); button.setAttribute('aria-current', String(conversation.id === selectedId));
            var top = node('span', 'adm-support-row-top');
            top.appendChild(node('span', 'adm-support-row-name', conversation.name || tr('admSupport.customer')));
            if (conversation.unread) {
                var dot = node('span', 'adm-support-unread-dot'); dot.setAttribute('aria-hidden', 'true'); top.appendChild(dot);
                top.appendChild(node('span', 'adm-support-sr-only', tr('admSupport.unread')));
            }
            button.appendChild(top); button.appendChild(node('span', 'adm-support-row-preview', conversation.preview || ''));
            var time = dateLabel(conversation.updatedAt); if (time) button.appendChild(node('span', 'adm-support-row-date', time));
            button.addEventListener('click', function () { select(conversation.id); });
            rowButtons.push({ id: conversation.id, button: button }); list.appendChild(button);
        });
    }
    function render() { renderList(); renderThread(); }
    function stopLive() {
        var previous = live; live = null; liveDirty = false; clearTimeout(liveTimer); liveTimer = null; connectionKey = '';
        if (previous) previous.close();
    }
    function flushLive() {
        if (!liveDirty || liveTimer || !activeView || !allowed() || listBusy || historyBusy || sending) return;
        liveTimer = setTimeout(function () {
            liveTimer = null;
            if (!liveDirty || !activeView || !allowed() || listBusy || historyBusy || sending) return;
            liveDirty = false; load(model.page, true); if (selected()) history(false, true);
        }, 100);
    }
    function ensureLive() {
        if (!api || !api.watch || live || !activeView || document.hidden || !allowed()) return;
        var token = epoch;
        live = api.watch('/api/admin/support/events', uid(), {
            onChange: function (data) {
                if (token === epoch) {
                    if (data && (data.resetAll || (Array.isArray(data.resetConversations) && data.resetConversations.indexOf(selectedId) >= 0))) {
                        ++historyReset; ++readSeq; readBusy = false;
                    }
                    liveDirty = true; flushLive();
                }
            },
            onState: function (state) {
                if (token !== epoch) return;
                connectionKey = { connecting: 'support.connecting', reconnecting: 'support.reconnecting', unavailable: 'support.realtimeUnavailable' }[state] || '';
                renderThread();
            },
            onError: function (e) { if (token === epoch) { stopLive(); fail(e); } }
        });
    }
    function hide() { activeView = false; stopLive(); renderThread(); }
    function clearThread() {
        ++readSeq; readBusy = false; readConfirmed = null; readCount = null; threadOpen = false;
        historyReset = renderedReset = 0; historyRevision = null;
        ++threadSeq; selectedId = null; selectedCache = null; items = []; nextBefore = null; historyTail = null; threadReady = false;
        historyBusy = false; sending = false; draft = null; statusKey = '';
        $('admin-support-reply').value = ''; $('admin-support').setAttribute('data-thread-open', 'false');
    }
    function reset() {
        ++epoch; stopLive(); activeView = false; ++listSeq; listBusy = false;
        model = { status: 'unavailable', conversations: [], page: 1, totalPages: 0 }; clearThread(); render();
    }
    function fail(error, cid) {
        if (error.code === 'SUPPORT_IDENTITY_CHANGED') return;
        if (error.status === 401 || error.status === 403) { reset(); model.status = 'error'; statusKey = 'support.authExpired'; }
        else if (error.status === 404) {
            clearThread(); statusKey = 'admSupport.expired';
            model.conversations = model.conversations.filter(function (c) { return c.id !== cid; });
        } else statusKey = api.errorKey(error);
        render();
    }
    function load(page, pushed) {
        if (!allowed()) { reset(); return Promise.resolve(); }
        if (sending) return Promise.resolve();
        activeView = true;
        var token = epoch, user = uid(), seq = ++listSeq;
        listBusy = true; model.status = 'loading'; renderList();
        return api.request('/api/admin/support/conversations?page=' + (page || 1), {}, user).then(function (data) {
            if (!active(token, user) || seq !== listSeq) return;
            if (!Array.isArray(data.conversations) || !data.conversations.every(function (c) { return typeof c.id === 'string'; })) throw new Error('support-invalid-list');
            model = { status: data.conversations.length ? 'ready' : 'empty', conversations: data.conversations, page: data.page, totalPages: data.totalPages };
            var updated = model.conversations.find(function (c) { return c.id === selectedId; });
            if (updated) selectedCache = updated;
            else if (!pushed) clearThread();
        }).catch(function (e) {
            if (!active(token, user) || seq !== listSeq) return;
            if (e.status === 401 || e.status === 403) { fail(e); return; }
            model.status = 'error'; statusKey = api.errorKey(e);
        }).then(function () { if (active(token, user) && seq === listSeq) { listBusy = false; render(); ensureLive(); flushLive(); } });
    }
    function history(append, pushed) {
        if (!allowed() || !selected() || historyBusy || sending) return Promise.resolve();
        var token = epoch, user = uid(), seq = ++threadSeq, cid = selectedId, reset = historyReset, reload = false;
        var region = $('admin-support-messages').parentNode, oldHeight = region.scrollHeight, oldTop = region.scrollTop, before = append && nextBefore;
        historyBusy = true; statusKey = 'support.loading'; renderThread();
        return api.request('/api/admin/support/conversations/' + encodeURIComponent(cid) + '/messages' +
            (before ? '?before=' + encodeURIComponent(before) : ''), {}, user).then(function (data) {
            if (!active(token, user) || seq !== threadSeq || cid !== selectedId) return;
            if (!Array.isArray(data.messages) || !data.messages.every(api.validMessage)) throw new Error('support-invalid-history');
            var revision = typeof data.historyRevision === 'string' ? data.historyRevision : null;
            if (append && revision !== historyRevision) { reload = true; return; }
            var previousRead = readConfirmed;
            var fromSQL = typeof data.readMessageId === 'string' ? data.readMessageId : null;
            readConfirmed = reset !== renderedReset || revision !== historyRevision ? fromSQL : later(readConfirmed, fromSQL);
            readCount = typeof data.messageCount === 'string' ? data.messageCount : null;
            // A lost POST response may have committed. A subsequent history GET
            // can confirm that cursor without sending the same acknowledgement.
            if (readConfirmed !== previousRead && selected().unread && !listBusy && activeView && !document.hidden) load(model.page, true);
            var overlap = pushed && revision === historyRevision && reset === renderedReset && historyTail && data.messages.some(function (m) { return m.id === historyTail; });
            var atBottom = !Number.isFinite(region.clientHeight) || oldHeight - region.clientHeight - oldTop < 80;
            items = append ? api.merge(data.messages, items) : overlap ? api.merge(items, data.messages) : data.messages;
            if (!append) historyTail = data.messages.length ? data.messages[data.messages.length - 1].id : null;
            if (!append) renderedReset = reset;
            historyRevision = revision;
            if (!overlap) nextBefore = data.nextBefore || null;
            threadReady = true; statusKey = ''; renderThread();
            region.scrollTop = append ? oldTop + region.scrollHeight - oldHeight : pushed && overlap && !atBottom ? oldTop : region.scrollHeight;
        }).catch(function (error) {
            if (active(token, user) && seq === threadSeq && cid === selectedId) fail(error, cid);
        }).then(function () { if (active(token, user) && seq === threadSeq) {
            historyBusy = false; render();
            if (reload) { history(false, true); return; }
            flushLive(); maybeRead();
        } });
    }
    function select(cid) {
        if (!allowed() || sending) return;
        if (selectedId !== cid) {
            clearThread(); selectedId = cid; selectedCache = model.conversations.find(function (c) { return c.id === cid; }) || null;
        } else if (historyBusy) return;
        threadOpen = true;
        $('admin-support').setAttribute('data-thread-open', 'true'); render(); $('admin-support-contact').focus(); history(false);
    }
    function submit(event) {
        if (event) event.preventDefault();
        if (!allowed() || !selected() || !threadReady || historyBusy || sending || !$('admin-support-reply').value.trim()) return;
        var token = epoch, user = uid(), cid = selectedId, text = $('admin-support-reply').value;
        try { if (!draft || draft.text !== text || draft.cid !== cid) draft = { text: text, cid: cid, key: api.uuid() }; }
        catch (_) { statusKey = 'support.requestError'; renderThread(); return; }
        sending = true; statusKey = 'support.sending'; render();
        api.request('/api/admin/support/conversations/' + encodeURIComponent(cid) + '/messages', {
            method: 'POST', body: { text: text, clientMessageId: draft.key }
        }, user).then(function (result) {
            if (!active(token, user) || cid !== selectedId) return;
            if (!api.validMessage(result.message) || result.conversationId !== cid) throw new Error('support-invalid-send');
            items = api.merge(items, [result.message]); draft = null; statusKey = '';
            if ($('admin-support-reply').value === text) $('admin-support-reply').value = '';
            var conversation = selected(); conversation.preview = result.message.text; conversation.updatedAt = result.message.createdAt;
            render(); var region = $('admin-support-messages').parentNode; region.scrollTop = region.scrollHeight;
        }).catch(function (error) { if (active(token, user) && cid === selectedId) fail(error, cid); })
            .then(function () {
                if (active(token, user) && cid === selectedId) {
                    sending = false; render(); flushLive(); maybeRead();
                    if ($('view-feedback').style.display !== 'none') $('admin-support-reply').focus();
                }
            });
    }
    window.BreezeAdminSupport = Object.freeze({ reset: reset, load: load, hide: hide });
    document.addEventListener('DOMContentLoaded', function () {
        reset();
        $('admin-support-form').addEventListener('submit', submit);
        $('admin-support-reply').addEventListener('input', renderThread);
        $('admin-support-reply').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
        });
        $('admin-support-refresh').addEventListener('click', function () { load(model.page); });
        $('admin-support-thread-refresh').addEventListener('click', function () { history(false); });
        $('admin-support-older').addEventListener('click', function () { if (nextBefore) history(true); });
        $('admin-support-prev').addEventListener('click', function () { if (model.page > 1) load(model.page - 1); });
        $('admin-support-next').addEventListener('click', function () { if (model.page < model.totalPages) load(model.page + 1); });
        $('admin-support-back').addEventListener('click', function () {
            threadOpen = false;
            $('admin-support').setAttribute('data-thread-open', 'false');
            var row = rowButtons.find(function (item) { return item.id === selectedId; }); if (row) row.button.focus();
        });
        document.addEventListener('langchange', function () { if (allowed()) render(); else reset(); });
        if (window.AuthHelper) window.AuthHelper.onChange(reset);
        $('admin-support-messages').parentNode.addEventListener('scroll', maybeRead);
        document.addEventListener('visibilitychange', function () { if (document.hidden) stopLive(); else ensureLive(); });
        window.addEventListener('pagehide', function () { pageActive = false; stopLive(); });
        window.addEventListener('pageshow', function () { pageActive = true; ensureLive(); });
    });
})();
