/* Trang "Nhà cung cấp" — GET/POST/PUT/PATCH /api/admin/suppliers.
   Server mới là lớp chặn quyền (supplier:read / supplier:write); ở đây chỉ ẩn/hiện nút theo permissions của /api/me
   (admin.js truyền vào load()). Không có supplier:write -> chỉ xem, không có nút Thêm / Sửa / Ngừng – Mở lại.
   An toàn XSS: MỌI dữ liệu từ API vào DOM qua textContent, phần tử dựng bằng createElement — không innerHTML, không gán
   dữ liệu vào on* / href / style. Kiểm phía client chỉ để báo sớm; lỗi theo trường server trả về (field) là chuẩn.
   Xác nhận ngừng / mở lại bằng modal #sup-confirm của trang, không dùng confirm() / alert() của trình duyệt. */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var FIELDS = ['code', 'name', 'contact_name', 'phone', 'email', 'address', 'tax_code', 'note'];
    var MAX = { name: 200, contact_name: 120, email: 255, address: 300, note: 500 };
    var PAGE_SIZE = 20;
    var DASH = '—';

    function tr(key, params) { return typeof t === 'function' ? t(key, params) : key; }
    function setText(node, value) { node.textContent = value == null ? '' : String(value); return node; }
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) setText(node, text);
        return node;
    }
    // Nhãn tĩnh không tham số: gắn data-i18n để i18n.js tự áp lại khi đổi VI/EN.
    function label(node, key) { node.setAttribute('data-i18n', key); setText(node, tr(key)); return node; }
    function show(value) { return value == null || value === '' ? DASH : String(value); }

    // ================= Hàm thuần (xuất qua BreezeAdminSuppliers.util để test) =================
    // Cùng quy tắc với server/lib/suppliers.js. Trả { trường: khoá i18n } — rỗng = hợp lệ.
    // mode 'edit': không kiểm code (ô khoá, server so với mã hiện tại).
    function validateSupplier(values, mode) {
        var v = values || {}, errors = {};
        var str = function (k) { return typeof v[k] === 'string' ? v[k].trim() : ''; };
        if (mode !== 'edit') {
            var code = str('code');
            if (!/^[A-Za-z0-9-]+$/.test(code) || !/^[A-Z0-9-]{2,20}$/.test(code.toUpperCase())) errors.code = 'admSup.err.code';
        }
        var name = str('name');
        if (!name || name.length > MAX.name) errors.name = 'admSup.err.name';
        if (str('contact_name').length > MAX.contact_name) errors.contact_name = 'admSup.err.contact_name';
        var phone = str('phone').replace(/ /g, '');
        if (phone && !/^[0-9+]{8,20}$/.test(phone)) errors.phone = 'admSup.err.phone';
        var email = str('email');
        if (email && (email.length > MAX.email || !/^[\x21-\x7E]+$/.test(email) || !/^[^@]+@[^@]+\.[^@]+$/.test(email))) {
            errors.email = 'admSup.err.email';
        }
        if (str('address').length > MAX.address) errors.address = 'admSup.err.address';
        var tax = str('tax_code');
        if (tax && !/^[0-9-]{10,14}$/.test(tax)) errors.tax_code = 'admSup.err.tax_code';
        if (str('note').length > MAX.note) errors.note = 'admSup.err.note';
        return errors;
    }
    // Body gửi server: chuỗi đã trim (trống -> '' để server lưu NULL). Sửa: gửi kèm mã HIỆN TẠI (server cho qua).
    function buildBody(values, mode, currentCode) {
        var body = {};
        FIELDS.forEach(function (k) { body[k] = typeof values[k] === 'string' ? values[k].trim() : ''; });
        if (mode === 'edit') body.code = currentCode;
        return body;
    }
    // Lỗi từ server -> { field, key } (gắn vào ô) hoặc { key } (hộp lỗi chung). Không dùng câu tiếng Việt của server.
    function serverError(status, body) {
        var code = body && body.code, field = body && body.field;
        if (code === 'SUPPLIER_CODE_EXISTS') return { field: 'code', key: 'admSup.err.codeExists' };
        if (code === 'SUPPLIER_CODE_IMMUTABLE') return { field: 'code', key: 'admSup.err.codeImmutable' };
        if (code === 'SUPPLIER_INVALID_INPUT' && FIELDS.indexOf(field) !== -1) return { field: field, key: 'admSup.err.' + field };
        if (status === 403) return { key: 'admSup.err.forbidden' };
        if (status === 404) return { key: 'admSup.err.notFound' };
        if (status === 400) return { key: 'admSup.err.invalid' };
        return { key: 'admSup.err.generic' };
    }
    function listUrl(page, q, status) {
        var parts = ['page=' + page, 'limit=' + PAGE_SIZE, 'status=' + encodeURIComponent(status)];
        if (q) parts.push('q=' + encodeURIComponent(q));
        return '/api/admin/suppliers?' + parts.join('&');
    }
    var vnFormat = null;
    // ISO UTC -> 'dd/MM/yyyy HH:mm' giờ Việt Nam; rỗng / rác -> '—'.
    function formatVnTime(iso) {
        if (iso == null || iso === '') return DASH;
        var date = new Date(iso);
        if (isNaN(date.getTime())) return DASH;
        try {
            if (!vnFormat) {
                vnFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit',
                    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
            }
            var p = {};
            vnFormat.formatToParts(date).forEach(function (part) { p[part.type] = part.value; });
            return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
        } catch (e) { return DASH; }
    }

    // ================= Trạng thái =================
    var state = freshState();
    var accessEpoch = 0, listEpoch = 0;
    var modalTrigger = null, confirmTrigger = null, previousOverflow = '';
    function freshState() {
        return { perms: [], canWrite: false, list: null, page: 1, total: 0, totalPages: 0, status: 'all', q: '',
            loading: false, error: false,
            modal: null,     // { mode: 'create' | 'edit' | 'view', supplier, saving, errors: { trường: khoá }, general: khoá | null }
            confirm: null }; // { supplier, busy, error: khoá | null }
    }
    function allowed() { return document.body.classList.contains('adm-authed'); }
    function request(url, options) {
        if (!window.AuthHelper || !window.AuthHelper.apiFetch) return Promise.reject(new Error('auth-not-ready'));
        return window.AuthHelper.apiFetch(url, options).then(function (res) {
            return Promise.resolve().then(function () { return res.json(); }).catch(function () { return null; })
                .then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
        });
    }
    function toast(key, params) { if (typeof window.ProfileToast === 'function') window.ProfileToast(tr(key, params)); }

    // ================= Danh sách =================
    function loadList(nextPage) {
        if (!allowed()) return Promise.resolve();
        var epoch = ++listEpoch, access = accessEpoch;
        state.page = Number.isInteger(nextPage) && nextPage > 0 ? nextPage : state.page;
        state.loading = true; state.error = false; state.list = null;
        renderTable();
        return request(listUrl(state.page, state.q, state.status)).then(function (x) {
            if (epoch !== listEpoch || access !== accessEpoch || !allowed()) return;
            if (!x.ok || !x.body || !Array.isArray(x.body.suppliers)) throw new Error('supplier-list-failed');
            state.list = x.body.suppliers; state.page = x.body.page; state.total = x.body.total; state.totalPages = x.body.totalPages;
            state.loading = false; renderTable();
        }).catch(function () {
            if (epoch !== listEpoch || access !== accessEpoch || !allowed()) return;
            state.loading = false; state.error = true; renderTable();
        });
    }
    function statusPill(active) {
        return el('span', 'pill ' + (active ? 'on' : 'off'), tr(active ? 'admSup.statusActive' : 'admSup.statusInactive'));
    }
    function actionButton(textKey, ariaKey, supplier, onClick, extraClass) {
        var b = el('button', 'adm-btn ghost small' + (extraClass ? ' ' + extraClass : ''), tr(textKey));
        b.type = 'button';
        b.setAttribute('aria-label', tr(ariaKey, { code: supplier.code }));
        b.setAttribute('aria-haspopup', 'dialog');
        b.disabled = state.loading;
        b.addEventListener('click', function () { onClick(supplier, b); });
        return b;
    }
    function supplierRow(s) {
        var row = el('tr');
        row.setAttribute('data-supplier-id', String(s.id));
        [show(s.code), show(s.name), show(s.contact_name), show(s.phone), show(s.email)].forEach(function (v, i) {
            row.appendChild(el('td', i === 0 ? 'sup-code' : '', v));
        });
        var status = el('td'); status.appendChild(statusPill(!!s.is_active)); row.appendChild(status);
        var td = el('td'), actions = el('div', 'adm-actions');
        actions.appendChild(actionButton('admSup.view', 'admSup.viewAria', s, function (x, b) { openModal('view', x, b); }));
        if (state.canWrite) {
            actions.appendChild(actionButton('admSup.edit', 'admSup.editAria', s, function (x, b) { openModal('edit', x, b); }));
            actions.appendChild(s.is_active
                ? actionButton('admSup.stop', 'admSup.stopAria', s, openConfirm, 'sup-stop')
                : actionButton('admSup.resume', 'admSup.resumeAria', s, openConfirm, 'sup-resume'));
        }
        td.appendChild(actions); row.appendChild(td);
        return row;
    }
    function messageRow(key, retry) {
        var row = el('tr'), td = el('td', state.loading ? 'adm-loading' : 'adm-empty', tr(key));
        td.setAttribute('colspan', '7');
        if (retry) {
            var b = el('button', 'adm-btn ghost small sup-retry', tr('admSup.retry'));
            b.type = 'button';
            b.addEventListener('click', function () { loadList(state.page); });
            td.appendChild(b);
        }
        row.appendChild(td);
        return row;
    }
    function renderTable() {
        var body = $('sup-body');
        body.replaceChildren();
        body.setAttribute('aria-busy', String(state.loading));
        $('sup-add').hidden = !state.canWrite;
        $('sup-pager').hidden = !state.total;
        setText($('sup-page'), tr('adm.pgPage') + ' ' + state.page + ' / ' + Math.max(state.totalPages, 1));
        $('sup-prev').disabled = state.loading || state.error || state.page <= 1;
        $('sup-next').disabled = state.loading || state.error || state.page >= state.totalPages;
        if (state.loading) { body.appendChild(messageRow('com.loading')); return; }
        if (state.error) { body.appendChild(messageRow('admSup.loadError', true)); return; }
        if (!state.list || !state.list.length) {
            body.appendChild(messageRow(state.q || state.status !== 'all' ? 'admSup.noMatch' : 'admSup.empty'));
            return;
        }
        state.list.forEach(function (s) { body.appendChild(supplierRow(s)); });
    }

    // ================= Modal thêm / sửa / xem =================
    function input(field) { return $('sup-f-' + field); }
    function readForm() {
        var v = {};
        FIELDS.forEach(function (f) { v[f] = input(f).value || ''; });
        return v;
    }
    function fillForm(s) { FIELDS.forEach(function (f) { input(f).value = s && s[f] != null ? String(s[f]) : ''; }); }
    function renderErrors() {
        var m = state.modal, errors = (m && m.errors) || {};
        FIELDS.forEach(function (f) {
            var box = $('sup-e-' + f), key = errors[f];
            input(f).setAttribute('aria-invalid', key ? 'true' : 'false');
            box.hidden = !key;
            setText(box, key ? tr(key) : '');
        });
        var general = $('sup-modal-err');
        setText(general, m && m.general ? tr(m.general) : '');
        general.style.display = m && m.general ? 'block' : 'none';
    }
    function renderView(s) {
        var dl = $('sup-view');
        dl.replaceChildren();
        if (!s) return;
        FIELDS.map(function (f) { return ['admSup.f.' + f, show(s[f])]; })
            .concat([['admSup.thStatus', statusPill(!!s.is_active)], ['admSup.f.created', formatVnTime(s.created_at)],
                ['admSup.f.updated', formatVnTime(s.updated_at)]])
            .forEach(function (entry) {
                var group = el('div', 'sup-view-row'), dd = el('dd');
                group.appendChild(el('dt', '', tr(entry[0])));
                if (typeof entry[1] === 'string') setText(dd, entry[1]); else dd.appendChild(entry[1]);
                group.appendChild(dd); dl.appendChild(group);
            });
    }
    function renderModal() {
        var m = state.modal;
        if (!m) return;
        var view = m.mode === 'view', edit = m.mode === 'edit';
        var title = m.mode === 'create' ? tr('admSup.modalAdd') : tr(view ? 'admSup.modalView' : 'admSup.modalEdit', { code: m.supplier.code });
        setText($('sup-modal-title'), title);
        $('sup-form').hidden = view;
        $('sup-view').hidden = !view;
        if (view) renderView(m.supplier);
        $('sup-save').hidden = view;
        $('sup-save').disabled = m.saving;
        setText($('sup-save'), tr(m.saving ? 'admSup.saving' : 'admSup.save'));
        $('sup-cancel').disabled = m.saving;
        label($('sup-cancel'), view ? 'com.close' : 'com.cancel');
        var code = input('code');
        code.readOnly = edit;
        code.setAttribute('aria-readonly', edit ? 'true' : 'false');
        label($('sup-h-code'), edit ? 'admSup.codeLocked' : 'admSup.codeHint');
        FIELDS.forEach(function (f) { input(f).disabled = m.saving; });
        renderErrors();
    }
    function openModal(mode, supplier, trigger) {
        if (!allowed() || state.modal || state.confirm) return;
        if (mode !== 'view' && !state.canWrite) return;
        if (mode !== 'create' && (!supplier || !state.list || state.list.indexOf(supplier) === -1)) return;
        state.modal = { mode: mode, supplier: supplier || null, saving: false, errors: {}, general: null };
        modalTrigger = trigger || null;
        fillForm(mode === 'create' ? null : supplier);
        renderModal();
        previousOverflow = document.body.style.overflow || '';
        document.body.style.overflow = 'hidden';
        $('sup-modal').classList.add('open');
        var first = mode === 'view' ? $('sup-cancel') : input(mode === 'edit' ? 'name' : 'code');
        first.focus();
    }
    function restoreFocus(trigger) {
        var target = trigger && trigger.isConnected !== false ? trigger : document.querySelector('.adm-nav-item[data-nav="suppliers"]');
        if (target && target.focus) { try { target.focus(); } catch (e) { /* bỏ qua */ } }
    }
    function closeModal(force) {
        var m = state.modal;
        if (!m || (m.saving && !force)) return;
        state.modal = null;
        $('sup-modal').classList.remove('open');
        $('sup-view').replaceChildren();
        renderErrors();
        document.body.style.overflow = previousOverflow;
        var trigger = modalTrigger; modalTrigger = null;
        restoreFocus(trigger);
    }
    function submitModal(e) {
        if (e && e.preventDefault) e.preventDefault();
        var m = state.modal;
        if (!m || m.mode === 'view' || m.saving || !state.canWrite) return Promise.resolve();
        var values = readForm();
        m.errors = validateSupplier(values, m.mode); m.general = null;
        var invalid = FIELDS.filter(function (f) { return m.errors[f]; });
        if (invalid.length) { renderModal(); input(invalid[0]).focus(); return Promise.resolve(); }
        var edit = m.mode === 'edit', access = accessEpoch;
        var body = buildBody(values, m.mode, edit ? m.supplier.code : null);
        m.saving = true; renderModal();
        return request(edit ? '/api/admin/suppliers/' + encodeURIComponent(m.supplier.id) : '/api/admin/suppliers', {
            method: edit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        }).then(function (x) {
            if (access !== accessEpoch || state.modal !== m) return;
            m.saving = false;
            if (x.ok && x.body && x.body.supplier) {
                closeModal(true);
                toast(edit ? 'admSup.toastUpdated' : 'admSup.toastCreated', { code: x.body.supplier.code });
                return loadList(edit ? state.page : 1);
            }
            var err = serverError(x.status, x.body);
            if (err.field) m.errors[err.field] = err.key; else m.general = err.key;
            renderModal();
            if (err.field) input(err.field).focus();
        }, function () {
            if (access !== accessEpoch || state.modal !== m) return;
            m.saving = false; m.general = 'admSup.err.generic'; renderModal();
        });
    }

    // ================= Xác nhận ngừng / mở lại =================
    function renderConfirm() {
        var c = state.confirm;
        if (!c) return;
        var stop = !!c.supplier.is_active;
        setText($('sup-confirm-title'), tr(stop ? 'admSup.confirmStopTitle' : 'admSup.confirmResumeTitle'));
        setText($('sup-confirm-msg'), tr(stop ? 'admSup.confirmStop' : 'admSup.confirmResume', { name: c.supplier.name, code: c.supplier.code }));
        var ok = $('sup-confirm-ok');
        setText(ok, tr(c.busy ? 'admSup.saving' : (stop ? 'admSup.stop' : 'admSup.resume')));
        ok.classList.toggle('danger', stop);
        ok.disabled = c.busy; $('sup-confirm-cancel').disabled = c.busy;
        var err = $('sup-confirm-err');
        setText(err, c.error ? tr(c.error) : '');
        err.style.display = c.error ? 'block' : 'none';
    }
    function openConfirm(supplier, trigger) {
        if (!allowed() || !state.canWrite || state.modal || state.confirm || !state.list || state.list.indexOf(supplier) === -1) return;
        state.confirm = { supplier: supplier, busy: false, error: null };
        confirmTrigger = trigger || null;
        renderConfirm();
        previousOverflow = document.body.style.overflow || '';
        document.body.style.overflow = 'hidden';
        $('sup-confirm').classList.add('open');
        $('sup-confirm-cancel').focus();
    }
    function closeConfirm(force) {
        var c = state.confirm;
        if (!c || (c.busy && !force)) return;
        state.confirm = null;
        $('sup-confirm').classList.remove('open');
        document.body.style.overflow = previousOverflow;
        var trigger = confirmTrigger; confirmTrigger = null;
        restoreFocus(trigger);
    }
    function submitConfirm() {
        var c = state.confirm;
        if (!c || c.busy || !state.canWrite) return Promise.resolve();
        var access = accessEpoch, next = !c.supplier.is_active;
        c.busy = true; c.error = null; renderConfirm();
        return request('/api/admin/suppliers/' + encodeURIComponent(c.supplier.id) + '/status', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: next })
        }).then(function (x) {
            if (access !== accessEpoch || state.confirm !== c) return;
            c.busy = false;
            if (x.ok && x.body && x.body.supplier) {
                closeConfirm(true);
                toast(next ? 'admSup.toastResumed' : 'admSup.toastStopped', { code: x.body.supplier.code });
                return loadList(state.page);
            }
            c.error = x.status === 403 ? 'admSup.err.forbidden' : x.status === 404 ? 'admSup.err.notFound' : 'admSup.err.status';
            renderConfirm();
        }, function () {
            if (access !== accessEpoch || state.confirm !== c) return;
            c.busy = false; c.error = 'admSup.err.status'; renderConfirm();
        });
    }

    // Esc đóng (trừ lúc đang gửi), Tab / Shift+Tab xoay vòng trong các nút / ô đang hiện của modal.
    function trap(e, controls, close) {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key !== 'Tab') return;
        var list = controls().filter(function (n) { return n && !n.disabled && !n.hidden; });
        if (!list.length) { e.preventDefault(); return; }
        var first = list[0], last = list[list.length - 1], active = document.activeElement;
        if (list.indexOf(active) === -1 || (!e.shiftKey && active === last)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    }
    function modalControls() {
        var m = state.modal, list = [];
        if (m && m.mode !== 'view') FIELDS.forEach(function (f) { list.push(input(f)); });
        return list.concat([$('sup-cancel'), $('sup-save')]);
    }

    window.BreezeAdminSuppliers = Object.freeze({
        // perms: BẢN SAO permissions từ /api/me. Có supplier:write -> hiện nút ghi.
        load: function (page, perms) {
            state.perms = Array.isArray(perms) ? perms.slice() : [];
            state.canWrite = state.perms.indexOf('supplier:write') !== -1;
            if (state.perms.indexOf('supplier:read') === -1) { renderTable(); return Promise.resolve(); }
            return loadList(Number.isInteger(page) && page > 0 ? page : 1);
        },
        // Rời phiên: bỏ phản hồi đang chờ, đóng modal, xoá dữ liệu, bộ lọc và quyền.
        reset: function () {
            accessEpoch++; listEpoch++;
            closeModal(true); closeConfirm(true);
            state = freshState();
            $('sup-q').value = ''; $('sup-status').value = 'all';
            renderTable();
        },
        util: Object.freeze({ FIELDS: FIELDS.slice(), validateSupplier: validateSupplier, buildBody: buildBody,
            serverError: serverError, listUrl: listUrl, formatVnTime: formatVnTime })
    });

    document.addEventListener('DOMContentLoaded', function () {
        renderTable();
        $('sup-search-form').addEventListener('submit', function (e) {
            if (e && e.preventDefault) e.preventDefault();
            state.q = ($('sup-q').value || '').trim();
            loadList(1);
        });
        $('sup-status').addEventListener('change', function () { state.status = $('sup-status').value || 'all'; loadList(1); });
        $('sup-prev').addEventListener('click', function () { if (!$('sup-prev').disabled) loadList(state.page - 1); });
        $('sup-next').addEventListener('click', function () { if (!$('sup-next').disabled) loadList(state.page + 1); });
        $('sup-add').addEventListener('click', function () { openModal('create', null, $('sup-add')); });
        $('sup-form').addEventListener('submit', submitModal);
        $('sup-cancel').addEventListener('click', function () { closeModal(); });
        $('sup-confirm-cancel').addEventListener('click', function () { closeConfirm(); });
        $('sup-confirm-ok').addEventListener('click', submitConfirm);
        $('sup-modal').addEventListener('click', function (e) { if (e.target === $('sup-modal')) closeModal(); });
        $('sup-confirm').addEventListener('click', function (e) { if (e.target === $('sup-confirm')) closeConfirm(); });
        $('sup-modal').addEventListener('keydown', function (e) { trap(e, modalControls, function () { closeModal(); }); });
        $('sup-confirm').addEventListener('keydown', function (e) {
            trap(e, function () { return [$('sup-confirm-cancel'), $('sup-confirm-ok')]; }, function () { closeConfirm(); });
        });
        // Đổi VI/EN: vẽ lại từ dữ liệu đã tải, KHÔNG gọi lại API.
        document.addEventListener('langchange', function () { renderTable(); renderModal(); renderConfirm(); });
    });
})();
