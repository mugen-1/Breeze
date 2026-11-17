/* Tab "Nhật ký hoạt động" — GET /api/admin/audit-logs, CHỈ ĐỌC.
   Server mới là lớp chặn quyền; ở đây chỉ ẩn/hiện theo permissions của /api/me (admin.js truyền vào load()).
   An toàn XSS: MỌI dữ liệu từ API vào DOM qua setText() = textContent, phần tử dựng bằng createElement.
   Không gán chuỗi HTML chứa dữ liệu, không gán dữ liệu vào on* / href / style, không ghi response ra console / storage. */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    // Khớp ACTIONS / ENTITY_TYPES của server/lib/audit.js (test so với mã nguồn server).
    var ACTIONS = ['PRODUCT_CREATE', 'PRODUCT_UPDATE', 'PRODUCT_HIDE', 'PRODUCT_VARIANT_CHANGE',
        'ORDER_STATUS_CHANGE', 'ORDER_SHIPPING_CHANGE', 'ORDER_DELETE',
        'USER_BLACKLIST', 'USER_UNBLACKLIST', 'REVIEW_VISIBILITY', 'ROLE_CHANGE',
        'ORDER_PLACE', 'ORDER_CANCEL_BY_CUSTOMER', 'REVIEW_CREATE', 'REVIEW_UPDATE', 'REVIEW_DELETE'];
    var ENTITY_TYPES = ['order', 'product', 'user', 'review'];
    var ROLES = ['admin', 'staff', 'customer', 'cli'];
    var DASH = '—';

    function tr(key, params) { return typeof t === 'function' ? t(key, params) : key; }
    function setText(el, value) { el.textContent = value == null ? '' : String(value); return el; }
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) setText(node, text);
        return node;
    }

    // ================= Hàm thuần (xuất qua BreezeAdminAudit.util để test) =================
    var vnFormat = null;
    // ISO UTC -> 'dd/MM/yyyy HH:mm:ss' theo giờ Việt Nam, KHÔNG theo múi giờ trình duyệt.
    // null / chuỗi rác / ngày không tồn tại -> '—' (không ném lỗi).
    function formatVnTime(iso) {
        if (iso == null || iso === '') return DASH;
        var date = new Date(iso);
        if (isNaN(date.getTime())) return DASH;
        // V8 tự "cuộn" ngày không tồn tại (2026-02-30 -> 02/03) thay vì báo sai -> kiểm phần ngày là ngày lịch có thật.
        var ymd = typeof iso === 'string' && /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
        if (ymd) {
            var check = new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
            if (check.getUTCMonth() !== Number(ymd[2]) - 1 || check.getUTCDate() !== Number(ymd[3])) return DASH;
        }
        try {
            if (!vnFormat) {
                vnFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit',
                    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
            }
            var p = {};
            vnFormat.formatToParts(date).forEach(function (part) { p[part.type] = part.value; });
            return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute + ':' + p.second;
        } catch (e) { return DASH; }
    }
    // Nhãn dịch của action / entity / role; chưa có bản dịch (giá trị lạ) -> nguyên chuỗi gốc.
    function labelOf(kind, value) {
        var raw = value == null ? '' : String(value), key = 'admAudit.' + kind + '.' + raw, text = tr(key);
        return (typeof text !== 'string' || text === '' || text === key) ? raw : text;
    }
    // Quyết định giao diện CHỈ theo permission (không theo tên role).
    function viewOptions(perms) {
        var list = Array.isArray(perms) ? perms : [];
        var admin = list.indexOf('audit:read_admin') !== -1, customer = list.indexOf('audit:read_customer') !== -1;
        return { showIp: admin, showUserAgent: admin, showGroup: admin && customer, customerOnlyNote: !admin };
    }
    // Làm phẳng: khoá lồng nối bằng '.', mảng -> chuỗi JSON, null -> 'null', object rỗng lồng -> '{}', chuỗi nguyên văn.
    function flatten(value, prefix, out) {
        out = out || []; prefix = prefix || '';
        if (Array.isArray(value)) out.push([prefix, JSON.stringify(value)]);
        else if (value !== null && typeof value === 'object') {
            var keys = Object.keys(value);
            if (!keys.length) { if (prefix !== '') out.push([prefix, '{}']); }
            else keys.forEach(function (k) { flatten(value[k], prefix === '' ? k : prefix + '.' + k, out); });
        } else out.push([prefix, value === null ? 'null' : String(value)]);
        return out;
    }
    // Bảng so sánh Khóa | Trước | Sau. before null -> chỉ cột Sau; after null -> chỉ cột Trước.
    // Khoá không có ở một phía -> '—'; khoá theo thứ tự xuất hiện đầu (Trước rồi Sau). rows rỗng -> "Không có dữ liệu thay đổi".
    function diffRows(before, after) {
        var hasB = before != null, hasA = after != null, keys = [];
        var bm = Object.create(null), am = Object.create(null);
        (hasB ? flatten(before) : []).forEach(function (e) { if (!(e[0] in bm)) keys.push(e[0]); bm[e[0]] = e[1]; });
        (hasA ? flatten(after) : []).forEach(function (e) { if (!(e[0] in bm) && !(e[0] in am)) keys.push(e[0]); am[e[0]] = e[1]; });
        var columns = (hasB ? ['before'] : []).concat(hasA ? ['after'] : []);
        var rows = keys.map(function (k) {
            var inB = k in bm, inA = k in am;
            return { key: k === '' ? DASH : k, before: hasB ? (inB ? bm[k] : DASH) : null, after: hasA ? (inA ? am[k] : DASH) : null,
                changed: hasB && hasA && (inB !== inA || bm[k] !== am[k]) };
        });
        return { columns: columns, rows: rows };
    }
    // URL theo bộ lọc ĐÃ ÁP DỤNG. Không có quyền chọn nhóm (staff) -> không gửi group; "Tất cả" -> không gửi group.
    function buildUrl(applied, page, opts) {
        var q = [];
        function add(name, value) { if (value != null && value !== '') q.push(name + '=' + encodeURIComponent(value)); }
        if (opts && opts.showGroup) add('group', applied.group);
        add('actor_user_id', applied.actor_user_id); add('action', applied.action);
        add('entity_type', applied.entity_type); add('entity_id', applied.entity_id);
        add('from', applied.from); add('to', applied.to); add('page', String(page));
        return '/api/admin/audit-logs?' + q.join('&');
    }

    // ================= Trạng thái =================
    function emptyFilters() { return { group: '', actor_user_id: '', action: '', entity_type: '', entity_id: '', from: '', to: '' }; }
    var state = freshState();
    var seq = 0, accessEpoch = 0;   // seq: bỏ phản hồi cũ đến sau; accessEpoch: bỏ phản hồi của phiên đã reset
    function freshState() {
        return { perms: [], opts: viewOptions([]), applied: emptyFilters(), page: 1, data: null, status: 'idle', error: null, open: {} };
    }
    function allowed() { return document.body.classList.contains('adm-authed'); }

    // ================= Gọi API =================
    function fetchPage(page) {
        if (!allowed()) return Promise.resolve();
        var my = ++seq, access = accessEpoch;
        state.page = page; state.status = 'loading'; state.error = null; state.data = null; state.open = {};
        render();
        var url = buildUrl(state.applied, page, state.opts);
        return Promise.resolve().then(function () {
            if (!window.AuthHelper || !window.AuthHelper.apiFetch) throw new Error('auth-not-ready');
            return window.AuthHelper.apiFetch(url);
        }).then(function (res) {
            return Promise.resolve().then(function () { return res.json(); }).catch(function () { return null; })
                .then(function (body) { return { res: res, body: body }; });
        }).then(function (x) {
            if (my !== seq || access !== accessEpoch || !allowed()) return;
            var status = x.res.status, body = x.body;
            if (x.res.ok && body && Array.isArray(body.logs)) { state.data = body; state.status = 'ok'; }
            else if (status === 401) setError('auth');
            else if (status === 403) setError('forbidden');
            else if (status === 400) setError('bad', body && typeof body.message === 'string' ? body.message : '');
            else setError('network');
            render();
        }, function () {
            if (my !== seq || access !== accessEpoch || !allowed()) return;
            setError('network'); render();
        });
    }
    function setError(kind, message) { state.status = 'error'; state.error = { kind: kind, message: message || '' }; }

    // ================= Bộ lọc =================
    function readForm() {
        var f = emptyFilters();
        if (state.opts.showGroup) f.group = $('audit-group').value || '';
        f.actor_user_id = $('audit-actor').value || '';
        f.action = $('audit-action').value || '';
        f.entity_type = $('audit-entity-type').value || '';
        f.entity_id = $('audit-entity-id').value || '';
        f.from = $('audit-from').value || '';
        f.to = $('audit-to').value || '';
        return f;
    }
    function writeEntityInputs(type, id) { $('audit-entity-type').value = type || ''; $('audit-entity-id').value = id || ''; }
    function showFilterError(text) { var box = $('audit-filter-error'); setText(box, text); box.hidden = false; }
    function clearFilterError() { var box = $('audit-filter-error'); setText(box, ''); box.hidden = true; }
    function apply(filters) { clearFilterError(); state.applied = filters; return fetchPage(1); }
    function onSubmit(e) {
        if (e && e.preventDefault) e.preventDefault();
        var f = readForm();
        if (f.from && f.to && f.from > f.to) { showFilterError(tr('admAudit.errRange')); return; }
        apply(f);
    }
    function onClear() {
        $('audit-group').value = ''; $('audit-actor').value = ''; $('audit-action').value = '';
        writeEntityInputs('', ''); $('audit-from').value = ''; $('audit-to').value = '';
        apply(emptyFilters());
    }
    function copyApplied() { var f = emptyFilters(); Object.keys(f).forEach(function (k) { f[k] = state.applied[k]; }); return f; }
    function onEntityClick(type, id) {   // áp dụng ngay, giữ các bộ lọc đã áp dụng khác
        var f = copyApplied(); f.entity_type = type; f.entity_id = id;
        writeEntityInputs(type, id); apply(f);
    }
    function onChipClear() {             // dùng bộ lọc đã áp dụng, không đọc ô đang gõ dở
        var f = copyApplied(); f.entity_type = ''; f.entity_id = '';
        writeEntityInputs('', ''); apply(f);
    }

    // ================= Vẽ =================
    function columns() {
        var cols = [['time', 'admAudit.colTime'], ['actor', 'admAudit.actor'], ['action', 'admAudit.action'],
            ['entity', 'admAudit.colEntity'], ['detail', 'admAudit.details']];
        if (state.opts.showIp) cols.push(['ip', 'admAudit.colIp']);
        return cols;
    }
    function fillSelect(select, values, kind) {
        var current = select.value || '';
        var nodes = [el('option', '', tr('admAudit.any'))];
        nodes[0].value = '';
        values.forEach(function (v) { var o = el('option', '', labelOf(kind, v)); o.value = v; nodes.push(o); });
        select.replaceChildren.apply(select, nodes);
        select.value = current;
    }
    function renderHead() {
        var head = $('audit-head');
        head.replaceChildren.apply(head, columns().map(function (c) {
            var th = el('th', '', tr(c[1])); th.setAttribute('scope', 'col'); return th;
        }));
    }
    function renderChip() {
        var a = state.applied, on = !!(a.entity_type && a.entity_id);
        $('audit-chip').hidden = !on;
        setText($('audit-chip-text'), on ? tr('admAudit.viewing', { type: labelOf('entity', a.entity_type), id: a.entity_id }) : '');
    }
    function statusRow(text, withRetry) {
        var row = el('tr'), td = el('td', 'adm-empty');
        td.setAttribute('colspan', String(columns().length));
        td.appendChild(el('span', '', text));
        if (withRetry) {
            var btn = el('button', 'adm-btn small audit-retry', tr('admAudit.retry'));
            btn.setAttribute('type', 'button');
            btn.addEventListener('click', function () { fetchPage(state.page); });   // bộ lọc đã áp dụng + trang hiện tại
            td.appendChild(el('span', '', ' ')); td.appendChild(btn);
        }
        row.appendChild(td);
        return row;
    }
    function actorCell(log) {
        var td = el('td');
        var name = log.actor_deleted === true ? tr('admAudit.deleted')
            : (typeof log.actor_email === 'string' && log.actor_email !== '' ? log.actor_email : DASH);
        td.appendChild(el('div', 'audit-actor-name', name));
        var sub = el('div', 'audit-actor-sub');
        var role = typeof log.actor_role === 'string' ? log.actor_role : '';
        sub.appendChild(el('span', ROLES.indexOf(role) !== -1 ? 'pill role-' + role : 'pill', labelOf('role', role)));
        if (log.actor_user_id != null) sub.appendChild(el('span', 'audit-actor-id', '#' + log.actor_user_id));
        td.appendChild(sub);
        return td;
    }
    function entityText(log) {
        var type = labelOf('entity', log.entity_type);
        return log.entity_id == null || log.entity_id === '' ? type : type + ' #' + log.entity_id;
    }
    function entityCell(log) {
        var td = el('td');
        if (log.entity_id == null || log.entity_id === '') { td.appendChild(el('span', '', entityText(log))); return td; }
        var btn = el('button', 'audit-entity-link', entityText(log));
        btn.setAttribute('type', 'button');
        btn.addEventListener('click', function () { onEntityClick(String(log.entity_type), String(log.entity_id)); });
        td.appendChild(btn);
        return td;
    }
    function detailContent(log) {
        var td = el('td');
        td.setAttribute('colspan', String(columns().length));
        var meta = el('div', 'audit-meta');
        meta.appendChild(el('div', '', tr('admAudit.logId') + ': ' + (log.id == null ? DASH : log.id)));
        meta.appendChild(el('div', '', tr('admAudit.colEntity') + ': ' + entityText(log)));
        if (state.opts.showUserAgent) {
            meta.appendChild(el('div', '', tr('admAudit.userAgent') + ': ' + (log.user_agent == null || log.user_agent === '' ? DASH : log.user_agent)));
        }
        td.appendChild(meta);
        var diff = diffRows(log.before, log.after);
        if (!diff.columns.length || !diff.rows.length) { td.appendChild(el('p', 'audit-empty-diff', tr('admAudit.noChanges'))); return td; }
        var table = el('table', 'audit-diff'), thead = el('thead'), headRow = el('tr'), tbody = el('tbody');
        [['key', 'admAudit.key']].concat(diff.columns.map(function (c) { return [c, 'admAudit.' + c]; })).forEach(function (c) {
            var th = el('th', '', tr(c[1])); th.setAttribute('scope', 'col'); headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        diff.rows.forEach(function (r) {
            var tr2 = el('tr', r.changed ? 'audit-changed' : '');
            tr2.appendChild(el('td', 'inner audit-key', r.key));
            diff.columns.forEach(function (c) { tr2.appendChild(el('td', 'inner audit-val', r[c])); });
            tbody.appendChild(tr2);
        });
        table.appendChild(thead); table.appendChild(tbody);
        td.appendChild(table);
        return td;
    }
    function logRows(log, index) {
        var row = el('tr'), detail = el('tr', 'oi-detail'), open = !!state.open[log.id], detailId = 'audit-detail-' + index;
        detail.setAttribute('id', detailId);
        detail.hidden = !open;
        row.appendChild(el('td', 'audit-time', formatVnTime(log.created_at)));
        row.appendChild(actorCell(log));
        row.appendChild(el('td', '', labelOf('action', log.action)));
        row.appendChild(entityCell(log));
        var cell = el('td'), btn = el('button', 'adm-btn ghost small audit-toggle', tr(open ? 'admAudit.hideDetails' : 'admAudit.details'));
        btn.setAttribute('type', 'button');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-controls', detailId);
        btn.addEventListener('click', function () {
            var now = !state.open[log.id];
            if (now) state.open[log.id] = true; else delete state.open[log.id];
            detail.hidden = !now;
            btn.setAttribute('aria-expanded', now ? 'true' : 'false');
            setText(btn, tr(now ? 'admAudit.hideDetails' : 'admAudit.details'));
        });
        cell.appendChild(btn);
        row.appendChild(cell);
        if (state.opts.showIp) row.appendChild(el('td', 'audit-ip', log.ip == null || log.ip === '' ? DASH : log.ip));
        detail.appendChild(detailContent(log));
        return [row, detail];
    }
    function renderPager() {
        var pager = $('audit-pager'), d = state.data;
        var show = state.status === 'ok' && d && Number(d.total) > 0;
        pager.hidden = !show;
        if (!show) return;
        var size = Number.isInteger(d.page_size) && d.page_size > 0 ? d.page_size : 50;
        var pages = Math.max(1, Math.ceil(Number(d.total) / size)), page = Number(d.page) || state.page;
        setText($('audit-page'), tr('admAudit.pageInfo', { page: page, pages: pages, total: d.total }));
        $('audit-prev').disabled = page <= 1;
        $('audit-next').disabled = page >= pages;
    }
    function render() {
        renderHead();
        renderChip();
        var body = $('audit-body'), rows = [];
        if (state.status === 'loading') rows.push(statusRow(tr('admAudit.loading')));
        else if (state.status === 'error') {
            var k = state.error && state.error.kind;
            if (k === 'auth') rows.push(statusRow(tr('pf.sessionExpired')));
            else if (k === 'forbidden') rows.push(statusRow(tr('admAudit.forbidden')));
            else if (k === 'bad') rows.push(statusRow(state.error.message || tr('admAudit.loadError')));
            else rows.push(statusRow(tr('admAudit.loadError'), true));
        } else if (state.status === 'ok') {
            if (!state.data.logs.length) rows.push(statusRow(tr('admAudit.empty')));
            state.data.logs.forEach(function (log, i) { rows.push.apply(rows, logRows(log, i)); });
        }
        body.replaceChildren.apply(body, rows);
        renderPager();
    }
    function applyVisibility() {
        $('audit-group-wrap').hidden = !state.opts.showGroup;
        $('audit-customer-note').hidden = !state.opts.customerOnlyNote;
    }

    window.BreezeAdminAudit = Object.freeze({
        // admin.js gọi khi mở tab: page 1, giữ bộ lọc đã áp dụng; perms = bản sao permissions của /api/me.
        load: function (page, perms) {
            state.perms = Array.isArray(perms) ? perms.slice() : [];
            state.opts = viewOptions(state.perms);
            applyVisibility();
            return fetchPage(Number.isInteger(page) && page > 0 ? page : 1);
        },
        // Rời phiên (đăng xuất / không qua cổng): bỏ mọi phản hồi đang chờ, xoá dữ liệu, bộ lọc và quyền.
        reset: function () {
            accessEpoch++; seq++;
            state = freshState();
            ['audit-group', 'audit-actor', 'audit-action', 'audit-entity-type', 'audit-entity-id', 'audit-from', 'audit-to']
                .forEach(function (id) { $(id).value = ''; });
            clearFilterError(); applyVisibility(); render();
        },
        util: Object.freeze({ ACTIONS: ACTIONS.slice(), ENTITY_TYPES: ENTITY_TYPES.slice(), ROLES: ROLES.slice(),
            formatVnTime: formatVnTime, labelOf: labelOf, viewOptions: viewOptions, flatten: flatten, diffRows: diffRows, buildUrl: buildUrl })
    });

    document.addEventListener('DOMContentLoaded', function () {
        fillSelect($('audit-action'), ACTIONS, 'action');
        fillSelect($('audit-entity-type'), ENTITY_TYPES, 'entity');
        applyVisibility();
        render();
        $('audit-filters').addEventListener('submit', onSubmit);
        $('audit-clear').addEventListener('click', onClear);
        $('audit-chip-clear').addEventListener('click', onChipClear);
        $('audit-prev').addEventListener('click', function () { if (!$('audit-prev').disabled) fetchPage(state.page - 1); });
        $('audit-next').addEventListener('click', function () { if (!$('audit-next').disabled) fetchPage(state.page + 1); });
        // Đổi VI/EN: vẽ lại từ dữ liệu đã tải (giữ hàng chi tiết đang mở), KHÔNG gọi lại API.
        document.addEventListener('langchange', function () {
            fillSelect($('audit-action'), ACTIONS, 'action');
            fillSelect($('audit-entity-type'), ENTITY_TYPES, 'entity');
            if ($('audit-filter-error').hidden === false) showFilterError(tr('admAudit.errRange'));
            render();
        });
    });
})();
