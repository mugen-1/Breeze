/* Widget CSKH: API + SSE, draft chỉ trong bộ nhớ. */
(function () {
    'use strict';

    function init() {
        if (document.getElementById('breeze-support')) return;
        if (window.BreezeRoutes && window.BreezeRoutes.is('admin')) return;

        var root, launcher, panel, closeBtn, guest, nameInput, emailInput, message;
        var bindings = [], authEpoch = 0, identity, permitted = false;
        var accessPending = false, roleChecked = false;
        var api = window.BreezeSupportAPI, items = [], conversation = null, nextBefore = null;
        var loadSeq = 0, loaded = false, loading = false, sending = false, denied = false, draft = null, statusKey = '';
        var live = null, liveDirty = false, liveTimer, connectionKey = '', historyTail = null;
        var historyReset = 0, renderedReset = 0, historyRevision = null;

        function node(tag, className, parent) {
            var el = document.createElement(tag);
            if (className) el.className = className;
            if (parent) parent.appendChild(el);
            return el;
        }
        function label(el, key, attr) {
            bindings.push({ el: el, key: key, attr: attr });
            return el;
        }
        function tr(key, params) {
            return window.__i18n && window.__i18n.t ? window.__i18n.t(key, params) : key;
        }
        function textLabels() {
            bindings.forEach(function (b) {
                if (b.attr) b.el.setAttribute(b.attr, tr(b.key));
                else b.el.textContent = tr(b.key);
            });
            if (typeof renderState === 'function' && send) { renderState(); renderMessages(false); }
        }
        function icon(parent, name) {
            var el = node('i', 'fa fa-' + name, parent);
            el.setAttribute('aria-hidden', 'true');
        }
        function field(parent, id, key, type) {
            var wrap = node('div', 'breeze-support-field', parent);
            var caption = label(node('label', '', wrap), key);
            caption.setAttribute('for', id);
            var input = node('input', '', wrap);
            input.id = id;
            input.type = type;
            input.name = id;
            input.required = true;
            input.maxLength = type === 'email' ? 254 : 150;
            input.autocomplete = type === 'email' ? 'email' : 'name';
            return input;
        }

        root = node('div', 'breeze-support', document.body);
        root.id = 'breeze-support';
        root.hidden = true; // Chưa biết role: không hiện thoáng qua cho Admin.

        launcher = node('button', 'breeze-support-launcher', root);
        launcher.type = 'button';
        launcher.setAttribute('aria-controls', 'breeze-support-panel');
        launcher.setAttribute('aria-expanded', 'false');
        launcher.setAttribute('aria-haspopup', 'dialog');
        icon(launcher, 'comments-o');
        label(node('span', '', launcher), 'support.contact');

        panel = node('div', 'breeze-support-panel', root);
        panel.id = 'breeze-support-panel';
        panel.hidden = true;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-labelledby', 'breeze-support-title');

        var head = node('div', 'breeze-support-head', panel);
        var avatar = node('span', 'breeze-support-avatar', head);
        avatar.textContent = 'B';
        avatar.setAttribute('aria-hidden', 'true');
        var heading = node('div', 'breeze-support-heading', head);
        var title = node('h2', 'breeze-support-brand', heading);
        title.textContent = 'BREEZE';
        title.id = 'breeze-support-title';
        var refresh = label(node('button', 'breeze-support-refresh', head), 'support.refresh', 'aria-label');
        refresh.type = 'button';
        icon(refresh, 'refresh');
        closeBtn = label(node('button', 'breeze-support-close', head), 'support.close', 'aria-label');
        closeBtn.type = 'button';
        icon(closeBtn, 'times');

        var log = label(node('div', 'breeze-support-messages', panel), 'support.messages', 'aria-label');
        log.setAttribute('role', 'log');
        log.setAttribute('aria-live', 'polite');
        var welcome = node('div', 'breeze-support-chat-message', log);
        var senderAvatar = node('span', 'breeze-support-avatar breeze-support-avatar-small', welcome);
        senderAvatar.textContent = 'B';
        senderAvatar.setAttribute('aria-hidden', 'true');
        var content = node('div', 'breeze-support-message-content', welcome);
        var greeting = node('p', 'breeze-support-greeting', content);
        greeting.lang = 'vi';
        // Nội dung cố định theo yêu cầu, kể cả hai khoảng trắng trước "bạn".
        greeting.textContent = 'xin chào quý kháchh, chúng tôi có thể giúp gì cho  bạn.';
        node('span', 'breeze-support-sender', content).textContent = 'BREEZE';
        var older = label(node('button', 'breeze-support-older', log), 'support.older');
        older.type = 'button'; older.hidden = true;
        var transcript = node('div', 'breeze-support-transcript', log);

        // Thông tin khách nằm trong vùng cuộn; thanh soạn tin luôn ở đáy khung chat.
        guest = node('fieldset', 'breeze-support-guest', log);
        label(node('legend', '', guest), 'support.details');
        nameInput = field(guest, 'breeze-support-name', 'support.name', 'text');
        emailInput = field(guest, 'breeze-support-email', 'support.email', 'email');
        nameInput.setAttribute('form', 'breeze-support-form');
        emailInput.setAttribute('form', 'breeze-support-form');

        var form = node('form', 'breeze-support-form', panel);
        form.id = 'breeze-support-form';
        form.setAttribute('aria-describedby', 'breeze-support-unavailable');
        var foot = node('div', 'breeze-support-foot', form);
        var composer = node('div', 'breeze-support-composer', foot);
        var messageLabel = label(node('label', 'breeze-support-sr-only', composer), 'support.message');
        messageLabel.setAttribute('for', 'breeze-support-message');
        message = node('textarea', '', composer);
        message.id = 'breeze-support-message';
        message.name = 'breeze-support-message';
        message.rows = 1;
        message.required = true;
        message.setAttribute('aria-describedby', 'breeze-support-unavailable');
        label(message, 'support.placeholder', 'placeholder');
        var send = label(node('button', 'breeze-support-send', foot), 'support.send', 'aria-label');
        send.type = 'submit';
        send.disabled = true;
        send.setAttribute('aria-describedby', 'breeze-support-unavailable');
        icon(send, 'paper-plane-o');
        var unavailable = node('p', 'breeze-support-unavailable', form);
        unavailable.id = 'breeze-support-unavailable';
        unavailable.setAttribute('role', 'status');
        unavailable.setAttribute('aria-live', 'polite');
        var connectionLabel = node('p', 'breeze-support-unavailable', form);
        connectionLabel.setAttribute('role', 'status'); connectionLabel.setAttribute('aria-live', 'polite');

        function renderState() {
            guest.hidden = identity !== null || !!conversation;
            guest.disabled = guest.hidden || loading || sending;
            message.disabled = sending || denied;
            send.disabled = !permitted || !loaded || loading || sending || denied || !message.value.trim();
            refresh.disabled = loading || sending;
            older.hidden = !nextBefore;
            older.disabled = loading || sending;
            panel.setAttribute('aria-busy', String(loading || sending));
            unavailable.textContent = statusKey ? tr(statusKey) : '';
            unavailable.hidden = !statusKey;
            connectionLabel.textContent = connectionKey ? tr(connectionKey) : ''; connectionLabel.hidden = !connectionKey;
        }
        function stopLive() {
            var previous = live; live = null; liveDirty = false; clearTimeout(liveTimer); liveTimer = null; connectionKey = '';
            if (previous) previous.close();
        }
        function flushLive() {
            if (!liveDirty || liveTimer || loading || sending || panel.hidden || !permitted) return;
            liveTimer = setTimeout(function () {
                liveTimer = null;
                if (!liveDirty || loading || sending || panel.hidden || !permitted) return;
                liveDirty = false; loadHistory(false, true);
            }, 100);
        }
        function ensureLive() {
            if (!api || !api.watch || live || panel.hidden || document.hidden || !permitted || denied || !loaded || (identity === null && !conversation)) return;
            var epoch = authEpoch;
            live = api.watch('/api/support/events', identity, {
                onChange: function (data) { if (epoch === authEpoch) { if (data && data.reset) ++historyReset; liveDirty = true; flushLive(); } },
                onState: function (state) {
                    if (epoch !== authEpoch) return;
                    connectionKey = { connecting: 'support.connecting', reconnecting: 'support.reconnecting', unavailable: 'support.realtimeUnavailable' }[state] || '';
                    renderState();
                },
                onError: function (e) { if (epoch === authEpoch) { stopLive(); fail(e); renderState(); } }
            });
        }
        function stamp(value) {
            var date = new Date(value);
            return Number.isFinite(date.getTime()) ? date.toLocaleString(window.__i18n && window.__i18n.current === 'en' ? 'en-GB' : 'vi-VN') : '';
        }
        function renderMessages(bottom) {
            transcript.replaceChildren();
            items.forEach(function (item, index) {
                var row = node('div', 'breeze-support-chat-message breeze-support-chat-message--' + item.kind +
                    (api.sameGroup(items[index - 1], item) ? ' is-continuation' : ''), transcript);
                var bubble = node('div', 'breeze-support-message-content', row);
                node('p', 'breeze-support-greeting', bubble).textContent = item.text;
                if (!api.sameGroup(item, items[index + 1])) {
                    var sender = item.kind === 'system' ? tr('admSupport.system') : item.kind === 'admin' ? 'BREEZE' : tr('support.you');
                    var time = stamp(item.createdAt);
                    node('span', 'breeze-support-sender', bubble).textContent = sender + (time ? ' · ' + time : '');
                }
            });
            if (bottom) log.scrollTop = log.scrollHeight;
        }
        function fail(e) {
            if (e.code === 'SUPPORT_IDENTITY_CHANGED') return;
            if (e.status === 403) {
                stopLive();
                permitted = false; roleChecked = false; clearDraft(); items = []; conversation = null; historyTail = null;
                renderMessages(false); syncVisibility();
            } else if (e.status === 401 && identity === null) {
                stopLive();
                conversation = null; items = []; nextBefore = null; historyTail = null; loaded = true;
                nameInput.value = emailInput.value = '';
                statusKey = 'support.sessionExpired'; renderMessages(false);
            } else {
                if (e.status === 401) {
                    stopLive();
                    denied = true; loaded = false; conversation = null; items = []; nextBefore = null; historyTail = null;
                    renderMessages(false);
                }
                statusKey = api.errorKey(e);
            }
        }
        function loadHistory(append, pushed) {
            if (!api || !permitted || loading || sending) return Promise.resolve();
            var epoch = authEpoch, seq = ++loadSeq, uid = identity, oldHeight = log.scrollHeight, oldTop = log.scrollTop, reset = historyReset, reload = false;
            loading = true; statusKey = 'support.loading'; renderState();
            var before = append && nextBefore;
            var work = append || (pushed && conversation) ? Promise.resolve({ conversation: conversation }) : api.request('/api/support/conversation', {}, uid);
            return work.then(function (result) {
                if (epoch !== authEpoch || seq !== loadSeq) return null;
                if (!result.conversation) return { conversation: null, messages: [], nextBefore: null };
                return api.request('/api/support/conversation/messages' + (before ? '?before=' + encodeURIComponent(before) : ''), {}, uid);
            }).then(function (data) {
                if (!data || epoch !== authEpoch || seq !== loadSeq) return;
                if (!Array.isArray(data.messages) || !data.messages.every(api.validMessage)) throw new Error('support-invalid-history');
                // Only a previous SQL snapshot proves continuity. A recent POST
                // acknowledgement can overlap while hiding a long reconnect gap.
                var revision = typeof data.historyRevision === 'string' ? data.historyRevision : null;
                if (append && revision !== historyRevision) { reload = true; return; }
                var overlap = pushed && revision === historyRevision && reset === renderedReset && historyTail && data.messages.some(function (m) { return m.id === historyTail; });
                var atBottom = !Number.isFinite(log.clientHeight) || oldHeight - log.clientHeight - oldTop < 80;
                conversation = data.conversation;
                if (!overlap) nextBefore = data.nextBefore || null;
                items = append ? api.merge(data.messages, items) : overlap ? api.merge(items, data.messages) : data.messages;
                if (!append) historyTail = data.messages.length ? data.messages[data.messages.length - 1].id : null;
                if (!append) renderedReset = reset;
                historyRevision = revision;
                loaded = true; denied = false; statusKey = '';
                renderMessages(!append && (!pushed || atBottom || !overlap));
                if (append) log.scrollTop = oldTop + log.scrollHeight - oldHeight;
                else if (pushed && overlap && !atBottom) log.scrollTop = oldTop;
            }).catch(function (e) { if (epoch === authEpoch && seq === loadSeq) fail(e); })
                .then(function () { if (epoch === authEpoch && seq === loadSeq) {
                    loading = false; renderState();
                    if (reload) { loadHistory(false, true); return; }
                    ensureLive(); flushLive();
                } });
        }
        function submit(e) {
            if (e) e.preventDefault();
            if (!api || !permitted || !loaded || loading || sending || denied || !message.value.trim()) return;
            if (form.reportValidity && !form.reportValidity()) return;
            var epoch = authEpoch, uid = identity, text = message.value;
            var firstGuest = uid === null && !conversation;
            var name = nameInput.value.trim(), email = emailInput.value.trim();
            if (firstGuest && (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) { statusKey = 'support.invalid'; renderState(); return; }
            try {
                if (!draft || draft.text !== text || (firstGuest && (draft.name !== name || draft.email !== email))) {
                    draft = { text: text, key: api.uuid(), name: name, email: email };
                }
            } catch (error) { statusKey = 'support.requestError'; renderState(); return; }
            var data = { text: text, clientMessageId: draft.key };
            if (firstGuest) { data.name = name; data.email = email; }
            sending = true; statusKey = 'support.sending'; renderState();
            api.request(firstGuest ? '/api/support/guest-session' : '/api/support/messages', { method: 'POST', body: data }, uid).then(function (result) {
                if (epoch !== authEpoch) return;
                if (!api.validMessage(result.message) || typeof result.conversationId !== 'string') throw new Error('support-invalid-send');
                if (result.systemMessage && (!api.validMessage(result.systemMessage) || result.systemMessage.kind !== 'system')) throw new Error('support-invalid-send');
                conversation = { id: result.conversationId };
                items = api.merge(items, [result.message].concat(result.systemMessage ? [result.systemMessage] : []));
                if (uid === null && window.BreezeSupportSession) window.BreezeSupportSession.activate();
                if (message.value === text) message.value = '';
                draft = null; statusKey = ''; nameInput.value = emailInput.value = '';
                renderMessages(true);
            }).catch(function (error) { if (epoch === authEpoch) fail(error); })
                .then(function () { if (epoch === authEpoch) { sending = false; renderState(); ensureLive(); flushLive(); if (!panel.hidden && permitted) message.focus(); } });
        }

        function close(restoreFocus) {
            stopLive();
            var wasOpen = !panel.hidden;
            panel.hidden = true;
            launcher.hidden = false;
            launcher.setAttribute('aria-expanded', 'false');
            if (wasOpen && restoreFocus && !root.hidden) launcher.focus();
        }
        function blockingOverlay() {
            if (document.body.classList.contains('drawer-open') ||
                document.body.classList.contains('cart-drawer-open')) return true;
            if (document.querySelector('#fd-drawer.open')) return true;
            return Array.prototype.some.call(document.querySelectorAll('[aria-modal="true"], dialog[open]'), function (el) {
                // Menu/mini-cart đóng bằng transform vẫn có client rect. Phải xét
                // trạng thái ẩn trước, không coi kích thước layout là đang mở.
                if (root.contains(el) || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
                var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
                if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
                return el.getClientRects().length > 0;
            });
        }
        function syncVisibility() {
            var hidden = !permitted || blockingOverlay();
            if (hidden) close(false);
            if (root.hidden !== hidden) root.hidden = hidden;
        }
        launcher.addEventListener('click', function () {
            syncVisibility();
            if (root.hidden) return;
            if (!panel.hidden) { close(true); return; }
            panel.hidden = false;
            launcher.hidden = true;
            launcher.setAttribute('aria-expanded', 'true');
            closeBtn.focus();
            loadHistory(false);
        });
        closeBtn.addEventListener('click', function () { close(true); });
        root.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !panel.hidden) {
                e.preventDefault();
                e.stopPropagation();
                close(true);
            }
        });
        form.addEventListener('submit', submit);
        message.addEventListener('input', renderState);
        message.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
        });
        refresh.addEventListener('click', function () { loadHistory(false); });
        older.addEventListener('click', function () { if (nextBefore) loadHistory(true); });

        function clearDraft() {
            nameInput.value = emailInput.value = message.value = '';
            draft = null;
        }
        function onAuth(user) {
            var epoch = ++authEpoch;
            var nextIdentity = user ? user.uid : null;
            if (identity !== nextIdentity) {
                clearDraft(); items = []; conversation = null; nextBefore = null; historyTail = null; loaded = false;
                renderMessages(false);
            }
            ++loadSeq; loading = false; sending = false; denied = false; statusKey = '';
            identity = nextIdentity;
            permitted = false;
            close(false);
            root.hidden = true;
            guest.hidden = !!user;
            guest.disabled = !!user;
            accessPending = false;
            roleChecked = false;
            if (!user) {
                permitted = true;
                renderState();
                syncVisibility();
                return;
            }
            accessPending = true;
            // Firebase user không chứa role của SQL. Dùng API xác định quyền hiện có.
            Promise.resolve().then(function () {
                return window.AuthHelper.apiFetch('/api/me');
            }).then(function (r) {
                if (!r.ok) throw new Error('support-role-unavailable');
                return r.json();
            }).then(function (me) {
                if (epoch !== authEpoch) return;
                accessPending = false;
                if (!me || me.firebase_uid !== user.uid || (me.role !== 'customer' && me.role !== 'admin' && me.role !== 'staff')) return;
                roleChecked = true;   // đã biết role -> không gọi lại /api/me khi quay lại trang
                if (me.role !== 'customer') return;   // admin/staff dùng hộp thư quản trị, không hiện widget
                permitted = true;
                textLabels();
                syncVisibility();
            }).catch(function () {
                if (epoch === authEpoch) accessPending = false;
                // Lỗi quyền/mạng: giữ ẩn. Thử lại khi quay về trang hoặc có mạng.
            });
        }
        function retryAccess() {
            if (permitted || roleChecked || accessPending || !window.AuthHelper) return;
            var user = window.AuthHelper.getUser();
            if (user) onAuth(user);
        }
        document.addEventListener('langchange', textLabels);
        document.addEventListener('supportsessionchange', function (e) {
            if (identity === null && e.detail && e.detail.ended && conversation) { fail({ status: 401 }); renderState(); }
        });
        window.addEventListener('online', retryAccess);
        window.addEventListener('focus', retryAccess);
        window.addEventListener('resize', syncVisibility);
        document.addEventListener('visibilitychange', function () { if (document.hidden) stopLive(); else ensureLive(); });
        window.addEventListener('pagehide', stopLive);
        window.addEventListener('pageshow', ensureLive);
        if (window.MutationObserver) {
            new window.MutationObserver(function (records) {
                if (records.some(function (r) { return !root.contains(r.target); })) syncVisibility();
            }).observe(document.body, { subtree: true, childList: true, attributes: true,
                attributeFilter: ['class', 'hidden', 'open', 'style', 'aria-hidden'] });
        }
        textLabels();
        if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
            window.AuthHelper.onChange(onAuth);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
