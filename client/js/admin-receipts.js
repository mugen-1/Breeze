/* Trang "Nhập kho" — phiếu nhập kho qua /api/admin/receipts (+ /api/admin/suppliers, /api/admin/products để chọn).
   Server mới là lớp chặn quyền và chuyển trạng thái; ở đây chỉ ẩn / hiện nút theo permissions của /api/me (admin.js truyền
   vào load()): receipt:create (lập / sửa / gửi / huỷ nháp – chờ duyệt), receipt:approve (duyệt / từ chối / huỷ phiếu đã
   duyệt), receipt:receive (nhận hàng).
   An toàn XSS: MỌI dữ liệu từ API vào DOM qua textContent, phần tử dựng bằng createElement — không innerHTML, không gán
   dữ liệu vào on* / href / style. Xác nhận / lý do bằng modal của trang (#rcp-action), không dùng hộp thoại trình duyệt.
   Mọi nút gửi bị khoá trong lúc chờ server (chống bấm 2 lần); server vẫn khoá phiếu + kiểm trạng thái. */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var STATUSES = ['draft', 'pending', 'approved', 'received', 'cancelled'];
    var ACTORS = ['created', 'submitted', 'approved', 'rejected', 'received', 'cancelled'];
    var PAGE_SIZE = 20, SUPPLIER_PAGES = 20, PRODUCT_RESULTS = 20;
    var MAX_ITEMS = 200, MAX_QTY = 100000, MAX_COST = 1000000000, MAX_NOTE = 500, MAX_REASON = 250;
    var DASH = '—';
    var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    function tr(key, params) { return typeof t === 'function' ? t(key, params) : key; }
    function setText(node, value) { node.textContent = value == null ? '' : String(value); return node; }
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) setText(node, text);
        return node;
    }
    function label(node, key) { node.setAttribute('data-i18n', key); setText(node, tr(key)); return node; }
    function show(value) { return value == null || value === '' ? DASH : String(value); }
    function fmtMoney(n) { return typeof money === 'function' ? money(n) : String(n); }
    function fmtNum(n) { return Number(n || 0).toLocaleString('vi-VN'); }
    function button(className, text, onClick) {
        var b = el('button', className, text);
        b.type = 'button';
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }

    // ================= Hàm thuần (xuất qua BreezeAdminReceipts.util để test) =================
    // Ô SL / giá: chỉ chữ số; bỏ dấu chấm, phẩy, khoảng trắng (người dùng gõ "1.500.000"). Sai -> null.
    function parseAmount(raw) {
        if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 ? raw : null;
        var s = String(raw == null ? '' : raw).replace(/[\s.,]/g, '');
        return /^\d{1,10}$/.test(s) ? Number(s) : null;
    }
    // d = { supplierId, expectedDate, note, items: [{ qty, cost }] } -> { supplier?, expected_date?, note?, items?, rows: { i: { qty?, cost? } } }.
    function validateDraft(d) {
        var errors = { rows: {} };
        if (!(Number.isInteger(d.supplierId) && d.supplierId > 0)) errors.supplier = 'admRcp.err.supplier';
        if (d.expectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(d.expectedDate)) errors.expected_date = 'admRcp.err.expected_date';
        if (String(d.note || '').trim().length > MAX_NOTE) errors.note = 'admRcp.err.note';
        var items = d.items || [];
        if (!items.length) errors.items = 'admRcp.err.items';
        else if (items.length > MAX_ITEMS) errors.items = 'admRcp.err.tooMany';
        items.forEach(function (it, i) {
            var row = {}, q = parseAmount(it.qty), c = parseAmount(it.cost);
            if (q === null || q < 1 || q > MAX_QTY) row.qty = 'admRcp.err.qty';
            if (c === null || c > MAX_COST || String(it.cost == null ? '' : it.cost).trim() === '') row.cost = 'admRcp.err.cost';
            if (row.qty || row.cost) errors.rows[i] = row;
        });
        return errors;
    }
    function hasErrors(e) { return !!(e.supplier || e.expected_date || e.note || e.items || Object.keys(e.rows).length); }
    function buildBody(d) {
        return { supplier_id: d.supplierId, note: String(d.note || '').trim(), expected_date: d.expectedDate || '',
            items: (d.items || []).map(function (it) {
                return { product_id: it.product_id, variant_id: it.variant_id, quantity: parseAmount(it.qty), unit_cost: parseAmount(it.cost) };
            }) };
    }
    // Lỗi server -> { supplier?, field?: { name, key }, rows?: { index: khoá }, general?: khoá, state?: trạng thái hiện tại }.
    function serverError(status, body) {
        var code = body && body.code, out = {};
        if (code === 'RECEIPT_ITEMS_INVALID' || code === 'RECEIPT_STOCK_OVERFLOW') {
            out.rows = {};
            (Array.isArray(body.items) ? body.items : []).forEach(function (x) {
                if (Number.isInteger(x.index)) out.rows[x.index] = code === 'RECEIPT_STOCK_OVERFLOW' ? 'admRcp.reason.OVERFLOW' : 'admRcp.reason.' + x.reason;
            });
            out.general = 'admRcp.err.rowsInvalid';
            return out;
        }
        if (code === 'RECEIPT_SUPPLIER_INACTIVE') { out.supplier = 'admRcp.err.supplierInactive'; return out; }
        if (code === 'RECEIPT_SUPPLIER_NOT_FOUND') { out.supplier = 'admRcp.err.supplierNotFound'; return out; }
        if (code === 'RECEIPT_INVALID_STATE') { out.general = 'admRcp.err.state'; out.state = body.current_status || null; return out; }
        if (code === 'RECEIPT_INVALID_INPUT' && body.field) {
            if (body.field === 'supplier_id') { out.supplier = 'admRcp.err.supplier'; return out; }
            if (body.field === 'quantity' || body.field === 'unit_cost') {
                out.rows = {}; out.rows[body.index] = body.field === 'quantity' ? 'admRcp.err.qty' : 'admRcp.err.cost';
                out.general = 'admRcp.err.rowsInvalid'; return out;
            }
            if (body.field === 'reason') { out.field = { name: 'reason', key: 'admRcp.err.reason' }; return out; }
            if (body.field === 'note' || body.field === 'expected_date') { out.field = { name: body.field, key: 'admRcp.err.' + body.field }; return out; }
            if (body.field === 'items') { out.field = { name: 'items', key: 'admRcp.err.items' }; return out; }
        }
        out.general = status === 403 ? 'admRcp.err.forbidden' : status === 404 ? 'admRcp.err.notFound'
            : status === 400 ? 'admRcp.err.invalid' : 'admRcp.err.generic';
        return out;
    }
    // Nút thao tác theo trạng thái + quyền (server vẫn kiểm lại). can = { create, approve, receive }.
    function availableActions(status, can) {
        var c = can || {};
        if (status === 'draft') return c.create ? ['edit', 'submit', 'cancel'] : [];
        if (status === 'pending') return (c.approve ? ['approve', 'reject'] : []).concat(c.create ? ['cancel'] : []);
        if (status === 'approved') return (c.receive ? ['receive'] : []).concat(c.approve ? ['cancel'] : []);
        return [];
    }
    function listUrl(page, q, status, supplierId) {
        var parts = ['page=' + page, 'limit=' + PAGE_SIZE, 'status=' + encodeURIComponent(status)];
        if (supplierId) parts.push('supplier_id=' + encodeURIComponent(supplierId));
        if (q) parts.push('q=' + encodeURIComponent(q));
        return '/api/admin/receipts?' + parts.join('&');
    }
    // Lọc sản phẩm trên trình duyệt: theo tên (VI), slug, hoặc đúng id; tối đa 20 kết quả.
    function filterProducts(products, q) {
        var s = String(q || '').trim().toLowerCase();
        if (!s) return [];
        // Sản phẩm đang ẩn (is_active false) không hiện trong kết quả tìm.
        return (products || []).filter(function (p) {
            if (p.is_active === false) return false;
            return String(p.id) === s || String(p.name_vi || '').toLowerCase().indexOf(s) !== -1 || String(p.slug || '').toLowerCase().indexOf(s) !== -1;
        }).slice(0, PRODUCT_RESULTS);
    }
    var vnFormat = null;
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
    function formatDate(ymd) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
        return m ? m[3] + '/' + m[2] + '/' + m[1] : DASH;
    }
    // Người thao tác: đã xoá tài khoản -> "Tài khoản đã xóa"; email chỉ có khi server trả (người xem có quyền).
    function actorText(a) {
        if (!a) return DASH;
        if (a.deleted) return tr('admRcp.deletedAccount') + ' (#' + a.id + ')';
        var name = a.display_name || ('#' + a.id);
        return a.email ? name + ' · ' + a.email : name;
    }
    function warnings(flags) {
        var out = [];
        if (flags.invalid) out.push('admRcp.warn.invalid');
        if (flags.productOff) out.push('admRcp.warn.product');
        if (flags.variantOff) out.push('admRcp.warn.variant');
        if (flags.colorOff) out.push('admRcp.warn.color');
        return out;
    }

    // ================= Trạng thái =================
    var state = freshState();
    var accessEpoch = 0, listEpoch = 0, openModals = 0, previousOverflow = '';
    function freshState() {
        return { perms: [], can: { read: false, create: false, approve: false, receive: false },
            list: null, page: 1, total: 0, totalPages: 0, status: 'all', supplierId: '', q: '', loading: false, error: false,
            suppliers: null, products: null, productsError: false,
            editor: null, detail: null, action: null };
    }
    function allowed() { return document.body.classList.contains('adm-authed'); }
    function request(url, options) {
        if (!window.AuthHelper || !window.AuthHelper.apiFetch) return Promise.reject(new Error('auth-not-ready'));
        return window.AuthHelper.apiFetch(url, options).then(function (res) {
            return Promise.resolve().then(function () { return res.json(); }).catch(function () { return null; })
                .then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
        });
    }
    function send(url, method, body) {
        return request(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    }
    function toast(key, params) { if (typeof window.ProfileToast === 'function') window.ProfileToast(tr(key, params)); }
    function lockScroll() { if (openModals++ === 0) { previousOverflow = document.body.style.overflow || ''; document.body.style.overflow = 'hidden'; } }
    function unlockScroll() { if (openModals > 0 && --openModals === 0) document.body.style.overflow = previousOverflow; }
    function focusSafe(node) { if (node && node.focus && node.isConnected !== false) { try { node.focus(); } catch (e) { /* bỏ qua */ } return true; } return false; }
    function statusPill(status) {
        var known = STATUSES.indexOf(status) !== -1;
        return el('span', 'pill rcp-st' + (known ? ' rcp-st-' + status : ''), known ? tr('admRcp.st.' + status) : show(status));
    }
    function supplierById(id) {
        return (state.suppliers || []).filter(function (s) { return s.id === id; })[0] || null;
    }
    function supplierText(s) {
        if (!s) return DASH;
        return s.code + ' — ' + s.name + (s.is_active === false ? ' ' + tr('admRcp.inactiveSuffix') : '');
    }

    // ================= NCC (ô lọc + ô chọn trong form) =================
    function loadSuppliers() {
        if (state.perms.indexOf('supplier:read') === -1) { state.suppliers = []; renderSupplierFilter(); return Promise.resolve(); }
        var access = accessEpoch, all = [];
        function page(n) {
            return request('/api/admin/suppliers?page=' + n + '&limit=50&status=all').then(function (x) {
                if (access !== accessEpoch) return;
                if (!x.ok || !x.body || !Array.isArray(x.body.suppliers)) throw new Error('supplier-list-failed');
                all = all.concat(x.body.suppliers);
                if (n < x.body.totalPages && n < SUPPLIER_PAGES) return page(n + 1);
            });
        }
        return page(1).then(function () {
            if (access !== accessEpoch) return;
            state.suppliers = all.sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
            renderSupplierFilter();
        }, function () {
            if (access !== accessEpoch) return;
            state.suppliers = []; renderSupplierFilter();
        });
    }
    function renderSupplierFilter() {
        var select = $('rcp-supplier'), current = state.supplierId;
        var nodes = [el('option', '', tr('admRcp.all'))];
        nodes[0].value = '';
        (state.suppliers || []).forEach(function (s) { var o = el('option', '', supplierText(s)); o.value = String(s.id); nodes.push(o); });
        select.replaceChildren.apply(select, nodes);
        select.value = current;
    }

    // ================= Danh sách =================
    function loadList(nextPage) {
        if (!allowed() || !state.can.read) return Promise.resolve();
        var epoch = ++listEpoch, access = accessEpoch;
        state.page = Number.isInteger(nextPage) && nextPage > 0 ? nextPage : state.page;
        state.loading = true; state.error = false; state.list = null;
        renderTable();
        return request(listUrl(state.page, state.q, state.status, state.supplierId)).then(function (x) {
            if (epoch !== listEpoch || access !== accessEpoch || !allowed()) return;
            if (!x.ok || !x.body || !Array.isArray(x.body.receipts)) throw new Error('receipt-list-failed');
            state.list = x.body.receipts; state.page = x.body.page; state.total = x.body.total; state.totalPages = x.body.totalPages;
            state.loading = false; renderTable();
        }).catch(function () {
            if (epoch !== listEpoch || access !== accessEpoch || !allowed()) return;
            state.loading = false; state.error = true; renderTable();
        });
    }
    function receiptRow(r) {
        var row = el('tr');
        row.setAttribute('data-receipt-id', String(r.id));
        row.appendChild(el('td', 'rcp-code', show(r.code)));
        row.appendChild(el('td', '', r.supplier ? supplierText(r.supplier) : DASH));
        row.appendChild(el('td', 'num', fmtNum(r.item_count)));
        row.appendChild(el('td', 'num', fmtNum(r.total_quantity)));
        row.appendChild(el('td', 'num', fmtMoney(r.total_cost)));
        var st = el('td'); st.appendChild(statusPill(r.status)); row.appendChild(st);
        row.appendChild(el('td', 'rcp-time', formatVnTime(r.created_at)));
        var td = el('td');
        var b = button('adm-btn ghost small', tr('admRcp.view'), function () { openDetail(r.id, b); });
        b.setAttribute('aria-label', tr('admRcp.viewAria', { code: r.code }));
        b.setAttribute('aria-haspopup', 'dialog');
        b.disabled = state.loading;
        td.appendChild(b); row.appendChild(td);
        return row;
    }
    function messageRow(key, retry) {
        var row = el('tr'), td = el('td', state.loading ? 'adm-loading' : 'adm-empty', tr(key));
        td.setAttribute('colspan', '8');
        if (retry) td.appendChild(button('adm-btn ghost small rcp-retry', tr('admRcp.retry'), function () { loadList(state.page); }));
        row.appendChild(td);
        return row;
    }
    function renderTable() {
        var body = $('rcp-body');
        body.replaceChildren();
        body.setAttribute('aria-busy', String(state.loading));
        $('rcp-add').hidden = !state.can.create;
        $('rcp-pager').hidden = !state.total;
        setText($('rcp-page'), tr('adm.pgPage') + ' ' + state.page + ' / ' + Math.max(state.totalPages, 1));
        $('rcp-prev').disabled = state.loading || state.error || state.page <= 1;
        $('rcp-next').disabled = state.loading || state.error || state.page >= state.totalPages;
        if (state.loading) { body.appendChild(messageRow('com.loading')); return; }
        if (state.error) { body.appendChild(messageRow('admRcp.loadError', true)); return; }
        if (!state.list || !state.list.length) {
            body.appendChild(messageRow(state.q || state.status !== 'all' || state.supplierId ? 'admRcp.noMatch' : 'admRcp.empty'));
            return;
        }
        state.list.forEach(function (r) { body.appendChild(receiptRow(r)); });
    }

    // ================= Form lập / sửa phiếu nháp =================
    // editor = { mode, receiptId, code, originalSupplierId, items: [dòng], productResults, selected: { product, variants } | null,
    //   variantsState: 'idle' | 'loading' | 'error', errors, general, saving, trigger }
    // dòng = { product_id, variant_id, name, sku, size, color, stock, flags: { productOff, variantOff, colorOff, invalid }, qty, cost }
    function variantFlags(product, v) {
        return { productOff: product && product.is_active === false, variantOff: v.is_active === false,
            colorOff: v.color_active === false, invalid: false };
    }
    function loadProducts() {
        if (state.products) return Promise.resolve();
        var access = accessEpoch;
        return request('/api/admin/products').then(function (x) {
            if (access !== accessEpoch) return;
            if (!x.ok || !x.body || !Array.isArray(x.body.products)) throw new Error('product-list-failed');
            state.products = x.body.products; state.productsError = false;
        }).catch(function () { if (access === accessEpoch) state.productsError = true; });
    }
    function receivable(productId) {
        return request('/api/admin/receipts/receivable-variants?product_id=' + encodeURIComponent(productId)).then(function (x) {
            if (!x.ok || !x.body || !x.body.product || !Array.isArray(x.body.variants)) throw new Error('variants-failed');
            return x.body;
        });
    }
    function openEditor(receipt, trigger) {
        if (!allowed() || !state.can.create || state.editor || state.action) return Promise.resolve();
        var ed = { mode: receipt ? 'edit' : 'create', receiptId: receipt ? receipt.id : null, code: receipt ? receipt.code : null,
            originalSupplierId: receipt && receipt.supplier ? receipt.supplier.id : null, items: [], productResults: [],
            selected: null, variantsState: 'idle', errors: { rows: {} }, general: null, saving: false, trigger: trigger || null, loading: !!receipt };
        state.editor = ed;
        $('rcp-f-supplier').value = '';
        $('rcp-f-expected').value = receipt && receipt.expected_date ? receipt.expected_date : '';
        $('rcp-f-note').value = receipt && receipt.note ? receipt.note : '';
        $('rcp-product-q').value = '';
        renderEditor();
        $('rcp-f-supplier').value = ed.originalSupplierId ? String(ed.originalSupplierId) : '';
        lockScroll();
        $('rcp-editor').classList.add('open');
        focusSafe($('rcp-f-supplier'));
        var access = accessEpoch;
        var loads = [loadProducts(), state.suppliers ? Promise.resolve() : loadSuppliers()];
        if (receipt) {
            // Dòng có sẵn: lấy tồn hiện tại + cờ từ receivable-variants của từng sản phẩm; không còn là lá -> đánh dấu đỏ.
            var pids = receipt.items.map(function (i) { return i.product_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
            loads.push(Promise.all(pids.map(function (pid) { return receivable(pid).catch(function () { return null; }); })).then(function (res) {
                if (state.editor !== ed || access !== accessEpoch) return;
                var byProduct = {};
                res.forEach(function (r, i) { byProduct[pids[i]] = r; });
                ed.items = receipt.items.map(function (it) {
                    var info = byProduct[it.product_id], v = info && info.variants.filter(function (x) { return x.id === it.variant_id; })[0];
                    var flags = v ? variantFlags(info.product, v) : { productOff: false, variantOff: false, colorOff: false, invalid: !!info };
                    return { product_id: it.product_id, variant_id: it.variant_id, name: it.name, sku: it.sku, size: it.size, color: it.color,
                        stock: v ? v.stock : null, flags: flags, qty: String(it.quantity), cost: String(it.unit_cost) };
                });
                ed.loading = false;
            }));
        }
        return Promise.all(loads).then(function () {
            if (state.editor !== ed || access !== accessEpoch) return;
            var keep = $('rcp-f-supplier').value;
            renderEditor();
            $('rcp-f-supplier').value = keep || (ed.originalSupplierId ? String(ed.originalSupplierId) : '');
        });
    }
    function closeEditor(force) {
        var ed = state.editor;
        if (!ed || (ed.saving && !force)) return;
        state.editor = null;
        $('rcp-editor').classList.remove('open');
        $('rcp-items-body').replaceChildren(); $('rcp-variants-body').replaceChildren(); $('rcp-product-results').replaceChildren();
        unlockScroll();
        if (!focusSafe(ed.trigger)) focusSafe($('rcp-add'));
    }
    function renderSupplierOptions() {
        var ed = state.editor, select = $('rcp-f-supplier'), current = select.value;
        var nodes = [el('option', '', tr('admRcp.chooseSupplier'))];
        nodes[0].value = '';
        (state.suppliers || []).forEach(function (s) {
            // Đang hợp tác: chọn được. Đã ngừng: chỉ hiện khi là NCC hiện tại của phiếu đang sửa (giữ nguyên được: NCC ngừng hợp tác chỉ chặn lập phiếu mới).
            if (s.is_active || (ed && ed.mode === 'edit' && s.id === ed.originalSupplierId)) {
                var o = el('option', '', supplierText(s)); o.value = String(s.id); nodes.push(o);
            }
        });
        select.replaceChildren.apply(select, nodes);
        select.value = current;
        var original = ed && ed.originalSupplierId ? supplierById(ed.originalSupplierId) : null;
        $('rcp-h-supplier').hidden = !(original && original.is_active === false);
    }
    function fieldError(name, key) {
        var box = $('rcp-e-' + name), input = { supplier: 'rcp-f-supplier', expected_date: 'rcp-f-expected', note: 'rcp-f-note' }[name];
        if (input) $(input).setAttribute('aria-invalid', key ? 'true' : 'false');
        box.hidden = !key; setText(box, key ? tr(key) : '');
    }
    function renderEditor() {
        var ed = state.editor;
        if (!ed) return;
        setText($('rcp-editor-title'), ed.mode === 'create' ? tr('admRcp.editorAdd') : tr('admRcp.editorEdit', { code: ed.code }));
        renderSupplierOptions();
        ['supplier', 'expected_date', 'note', 'items'].forEach(function (f) { fieldError(f, ed.errors[f]); });
        var general = $('rcp-editor-err');
        setText(general, ed.general ? tr(ed.general.key, ed.general.params) : '');
        general.style.display = ed.general ? 'block' : 'none';
        renderProductResults(); renderVariants(); renderItems();
        $('rcp-editor-save').disabled = ed.saving || ed.loading;
        setText($('rcp-editor-save'), tr(ed.saving ? 'admRcp.saving' : 'admRcp.saveDraft'));
        $('rcp-editor-cancel').disabled = ed.saving;
    }
    function renderProductResults() {
        var ed = state.editor, box = $('rcp-product-results'), q = $('rcp-product-q').value || '';
        box.replaceChildren();
        if (!ed) return;
        if (state.productsError) { box.appendChild(el('p', 'rcp-muted', tr('admRcp.productLoadError'))); return; }
        if (!q.trim()) { box.appendChild(el('p', 'rcp-muted', tr('admRcp.productHint'))); return; }
        if (!ed.productResults.length) { box.appendChild(el('p', 'rcp-muted', tr('admRcp.productNone'))); return; }
        ed.productResults.forEach(function (p) {
            var b = button('rcp-product-btn' + (ed.selected && ed.selected.product.id === p.id ? ' is-selected' : ''),
                p.name_vi + ' (' + p.slug + ')', function () { selectProduct(p.id); });
            box.appendChild(b);
        });
    }
    function selectProduct(productId) {
        var ed = state.editor;
        if (!ed) return Promise.resolve();
        ed.selected = null; ed.variantsState = 'loading'; renderProductResults(); renderVariants();
        return receivable(productId).then(function (data) {
            if (state.editor !== ed) return;
            ed.selected = data; ed.variantsState = 'idle'; renderProductResults(); renderVariants();
        }, function () {
            if (state.editor !== ed) return;
            ed.variantsState = 'error'; renderVariants();
        });
    }
    function inReceipt(variantId) {
        return !!state.editor && state.editor.items.some(function (it) { return it.variant_id === variantId; });
    }
    function warnCell(flags) {
        var td = el('td', 'rcp-warns');
        var list = warnings(flags);
        if (!list.length) setText(td, DASH);
        list.forEach(function (key) { td.appendChild(el('span', 'pill ' + (key === 'admRcp.warn.invalid' ? 'rcp-bad' : 'rcp-warn'), tr(key))); });
        return td;
    }
    function renderVariants() {
        var ed = state.editor, body = $('rcp-variants-body'), msg = $('rcp-variants-msg'), wrap = $('rcp-variants-wrap');
        body.replaceChildren();
        if (!ed) return;
        wrap.hidden = !ed.selected && ed.variantsState === 'idle';
        var title = ed.selected ? tr('admRcp.variantsOf', { name: ed.selected.product.name_vi }) + ' · ' + tr('admRcp.mode.' + ed.selected.product.mode) : '';
        setText($('rcp-variants-title'), title);
        var text = ed.variantsState === 'loading' ? tr('admRcp.variantsLoading') : ed.variantsState === 'error' ? tr('admRcp.variantsError')
            : ed.selected && !ed.selected.variants.length ? tr('admRcp.variantsNone') : '';
        setText(msg, text); msg.hidden = !text;
        if (!ed.selected) return;
        var product = ed.selected.product;
        ed.selected.variants.forEach(function (v) {
            var row = el('tr'), flags = variantFlags(product, v), added = inReceipt(v.id);
            row.appendChild(el('td', 'rcp-code', show(v.sku)));
            row.appendChild(el('td', '', show(v.size)));
            row.appendChild(el('td', '', show(v.color_label)));
            row.appendChild(el('td', 'num', fmtNum(v.stock)));
            row.appendChild(warnCell(flags));
            var td = el('td');
            var b = button('adm-btn ghost small', tr(added ? 'admRcp.added' : 'admRcp.addLine'), function () { addItem(product, v); });
            b.setAttribute('aria-label', tr('admRcp.addAria', { sku: v.sku }));
            b.disabled = added || ed.saving || ed.items.length >= MAX_ITEMS;
            td.appendChild(b); row.appendChild(td);
            body.appendChild(row);
        });
    }
    function addItem(product, v) {
        var ed = state.editor;
        if (!ed || ed.saving || inReceipt(v.id) || ed.items.length >= MAX_ITEMS) return;
        ed.items.push({ product_id: product.id, variant_id: v.id, name: product.name_vi, sku: v.sku, size: v.size, color: v.color_label,
            stock: v.stock, flags: variantFlags(product, v), qty: '1', cost: '' });
        ed.errors.items = null; ed.errors.rows = {};
        renderItems(); renderVariants(); fieldError('items', null);
        var inputs = $('rcp-items-body').children;
        var last = inputs[inputs.length - 1];
        if (last && last._qty) focusSafe(last._qty);
    }
    function removeItem(index) {
        var ed = state.editor;
        if (!ed || ed.saving) return;
        ed.items.splice(index, 1);
        ed.errors.rows = {};
        renderItems(); renderVariants();
        focusSafe($('rcp-product-q'));
    }
    function amountInput(item, key, ariaKey, rowErr) {
        var input = el('input', 'rcp-amount');
        input.type = 'text';
        input.setAttribute('inputmode', 'numeric');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('aria-label', tr(ariaKey, { sku: item.sku }));
        input.setAttribute('aria-invalid', rowErr ? 'true' : 'false');
        input.value = item[key];
        input.disabled = state.editor.saving;
        input.addEventListener('input', function () { item[key] = input.value; updateTotals(); });
        return input;
    }
    function lineTotal(item) {
        var q = parseAmount(item.qty), c = parseAmount(item.cost);
        return q !== null && c !== null ? q * c : null;
    }
    function updateTotals() {
        var ed = state.editor;
        if (!ed) return;
        var qty = 0, total = 0;
        ed.items.forEach(function (it, i) {
            var q = parseAmount(it.qty), lt = lineTotal(it);
            if (q !== null) qty += q;
            if (lt !== null) total += lt;
            var row = $('rcp-items-body').children[i];
            if (row && row._total) setText(row._total, lt === null ? DASH : fmtMoney(lt));
        });
        setText($('rcp-totals'), tr('admRcp.totals', { lines: ed.items.length, qty: fmtNum(qty), total: fmtMoney(total) }));
    }
    function renderItems() {
        var ed = state.editor, body = $('rcp-items-body');
        body.replaceChildren();
        if (!ed) return;
        if (ed.loading) { var lr = el('tr'), lt = el('td', 'adm-loading', tr('com.loading')); lt.setAttribute('colspan', '9'); lr.appendChild(lt); body.appendChild(lr); }
        else if (!ed.items.length) { var er = el('tr'), et = el('td', 'adm-empty', tr('admRcp.itemsEmpty')); et.setAttribute('colspan', '9'); er.appendChild(et); body.appendChild(er); }
        ed.items.forEach(function (it, i) {
            var rowErr = ed.errors.rows[i] || {}, row = el('tr', rowErr.server || it.flags.invalid ? 'rcp-row-bad' : '');
            row.setAttribute('data-variant-id', String(it.variant_id));
            row.appendChild(el('td', '', show(it.name)));
            row.appendChild(el('td', 'rcp-code', show(it.sku)));
            row.appendChild(el('td', '', show(it.size)));
            row.appendChild(el('td', '', show(it.color)));
            row.appendChild(warnCell(it.flags));
            var qtyTd = el('td'), costTd = el('td');
            row._qty = amountInput(it, 'qty', 'admRcp.qtyAria', rowErr.qty);
            row._cost = amountInput(it, 'cost', 'admRcp.costAria', rowErr.cost);
            qtyTd.appendChild(row._qty); costTd.appendChild(row._cost);
            [[qtyTd, rowErr.qty], [costTd, rowErr.cost]].forEach(function (pair) {
                if (pair[1]) pair[0].appendChild(el('p', 'rcp-row-err', tr(pair[1])));
            });
            row.appendChild(qtyTd); row.appendChild(costTd);
            row._total = el('td', 'num rcp-line-total', DASH);
            row.appendChild(row._total);
            var td = el('td');
            var rm = button('rcp-remove', undefined, function () { removeItem(i); });
            rm.setAttribute('aria-label', tr('admRcp.removeAria', { sku: it.sku }));
            var icon = el('i', 'fa fa-trash-o'); icon.setAttribute('aria-hidden', 'true'); rm.appendChild(icon);
            rm.disabled = ed.saving;
            td.appendChild(rm);
            if (rowErr.server) td.appendChild(el('p', 'rcp-row-err', tr(rowErr.server)));
            row.appendChild(td);
            body.appendChild(row);
        });
        updateTotals();
    }
    function readDraft() {
        var ed = state.editor, sid = Number($('rcp-f-supplier').value);
        return { supplierId: Number.isInteger(sid) && sid > 0 ? sid : null, expectedDate: $('rcp-f-expected').value || '',
            note: $('rcp-f-note').value || '', items: ed.items };
    }
    function focusFirstError() {
        var ed = state.editor, e = ed.errors;
        if (e.supplier) return focusSafe($('rcp-f-supplier'));
        if (e.expected_date) return focusSafe($('rcp-f-expected'));
        if (e.note) return focusSafe($('rcp-f-note'));
        var rows = Object.keys(e.rows).map(Number).sort(function (a, b) { return a - b; });
        if (rows.length) {
            var row = $('rcp-items-body').children[rows[0]], r = e.rows[rows[0]];
            return focusSafe(row && (r.cost && !r.qty ? row._cost : row._qty));
        }
        if (e.items) return focusSafe($('rcp-product-q'));
        focusSafe($('rcp-editor-err'));
    }
    function submitEditor(e) {
        if (e && e.preventDefault) e.preventDefault();
        var ed = state.editor;
        if (!ed || ed.saving || ed.loading || !state.can.create) return Promise.resolve();
        var d = readDraft();
        ed.errors = validateDraft(d); ed.general = null;
        if (hasErrors(ed.errors)) { renderEditor(); focusFirstError(); return Promise.resolve(); }
        var edit = ed.mode === 'edit', access = accessEpoch;
        ed.saving = true; renderEditor();
        return send(edit ? '/api/admin/receipts/' + encodeURIComponent(ed.receiptId) : '/api/admin/receipts', edit ? 'PUT' : 'POST', buildBody(d))
            .then(function (x) {
                if (access !== accessEpoch || state.editor !== ed) return;
                ed.saving = false;
                if (x.ok && x.body && x.body.receipt) {
                    var saved = x.body.receipt;
                    closeEditor(true);
                    toast(edit ? 'admRcp.toast.updated' : 'admRcp.toast.created', { code: saved.code });
                    loadList(edit ? state.page : 1);
                    return openDetail(saved.id, ed.trigger, saved);
                }
                var err = serverError(x.status, x.body);
                ed.errors = { rows: {} };
                if (err.supplier) ed.errors.supplier = err.supplier;
                if (err.field) ed.errors[err.field.name] = err.field.key;
                if (err.rows) Object.keys(err.rows).forEach(function (i) { ed.errors.rows[i] = { server: err.rows[i] }; });
                if (err.general) ed.general = { key: err.general, params: { status: err.state ? tr('admRcp.st.' + err.state) : '' } };
                renderEditor(); focusFirstError();
            }, function () {
                if (access !== accessEpoch || state.editor !== ed) return;
                ed.saving = false; ed.general = { key: 'admRcp.err.generic' }; renderEditor();
            });
    }

    // ================= Chi tiết phiếu =================
    // opts.readOnly: mở từ popup Lịch sử tồn kho — chỉ xem, không nút thao tác (thao tác làm ở trang Nhập kho).
    function openDetail(id, trigger, data, opts) {
        if (!allowed() || !state.can.read) return Promise.resolve();
        if (state.detail) closeDetail(true);
        state.detail = { id: id, data: data || null, loading: !data, error: false, general: null, trigger: trigger || null,
            readOnly: !!(opts && opts.readOnly) };
        renderDetail();
        lockScroll();
        $('rcp-detail').classList.add('open');
        focusSafe($('rcp-detail-close'));
        return data ? Promise.resolve() : loadDetail();
    }
    function loadDetail() {
        var d = state.detail, access = accessEpoch;
        if (!d) return Promise.resolve();
        d.loading = true; d.error = false; renderDetail();
        return request('/api/admin/receipts/' + encodeURIComponent(d.id)).then(function (x) {
            if (state.detail !== d || access !== accessEpoch) return;
            if (!x.ok || !x.body || !x.body.receipt) throw new Error('receipt-detail-failed');
            d.data = x.body.receipt; d.loading = false; renderDetail();
        }).catch(function () {
            if (state.detail !== d || access !== accessEpoch) return;
            d.loading = false; d.error = true; renderDetail();
        });
    }
    function closeDetail(force) {
        var d = state.detail;
        if (!d || (state.action && !force)) return;
        state.detail = null;
        $('rcp-detail').classList.remove('open');
        ['rcp-detail-info', 'rcp-detail-items', 'rcp-detail-actors', 'rcp-detail-actions'].forEach(function (id) { $(id).replaceChildren(); });
        unlockScroll();
        if (!force && !focusSafe(d.trigger)) focusSafe(document.querySelector('.adm-nav-item[data-nav="receipts"]'));
    }
    function dlRow(dl, key, value) {
        var group = el('div', 'rcp-dl-row'), dd = el('dd');
        group.appendChild(el('dt', '', tr(key)));
        if (typeof value === 'string') setText(dd, value); else dd.appendChild(value);
        group.appendChild(dd); dl.appendChild(group);
    }
    function renderDetail() {
        var d = state.detail;
        if (!d) return;
        var r = d.data, info = $('rcp-detail-info'), items = $('rcp-detail-items'), actors = $('rcp-detail-actors'), actions = $('rcp-detail-actions');
        [info, items, actors, actions].forEach(function (n) { n.replaceChildren(); });
        setText($('rcp-detail-title'), r ? tr('admRcp.detailTitle', { code: r.code }) : tr('admRcp.title'));
        var general = $('rcp-detail-err');
        var msg = d.error ? tr('admRcp.detailError') : d.general ? tr(d.general.key, d.general.params) : '';
        setText(general, msg); general.style.display = msg ? 'block' : 'none';
        $('rcp-detail-loading').hidden = !d.loading;
        $('rcp-detail-body').hidden = !r;
        $('rcp-detail-retry').hidden = !d.error;
        var box = $('rcp-reject-box');
        box.hidden = true;
        if (!r) return;
        // Phiếu nháp từng bị từ chối: lý do lần gần nhất nổi bật ở đầu.
        if (r.status === 'draft' && r.reject_reason && String(r.reject_reason).trim()) {
            box.hidden = false;
            setText($('rcp-reject-reason'), r.reject_reason);
            setText($('rcp-reject-by'), r.actors && r.actors.rejected ? actorText(r.actors.rejected) + ' · ' + formatVnTime(r.actors.rejected.at) : '');
        }
        dlRow(info, 'admRcp.thCode', show(r.code));
        dlRow(info, 'admRcp.thStatus', statusPill(r.status));
        dlRow(info, 'admRcp.f.supplier', r.supplier ? supplierText(r.supplier) : DASH);
        dlRow(info, 'admRcp.f.expected', formatDate(r.expected_date));
        dlRow(info, 'admRcp.f.note', show(r.note));
        if (r.status === 'cancelled') dlRow(info, 'admRcp.cancelReason', show(r.cancel_reason));
        (r.items || []).forEach(function (it) {
            var row = el('tr');
            [show(it.name), show(it.sku), show(it.size), show(it.color)].forEach(function (v, i) { row.appendChild(el('td', i === 1 ? 'rcp-code' : '', v)); });
            row.appendChild(el('td', 'num', fmtNum(it.quantity)));
            row.appendChild(el('td', 'num', fmtMoney(it.unit_cost)));
            row.appendChild(el('td', 'num', fmtMoney(it.line_total)));
            items.appendChild(row);
        });
        // Khối không có nội dung thì ẩn cả tiêu đề lẫn khung, không để lại viền trống.
        var hasItems = items.children.length > 0;
        $('rcp-detail-items-h').hidden = !hasItems; $('rcp-detail-items-wrap').hidden = !hasItems;
        setText($('rcp-detail-totals'), tr('admRcp.totals', { lines: fmtNum(r.item_count), qty: fmtNum(r.total_quantity), total: fmtMoney(r.total_cost) }));
        ACTORS.forEach(function (k) {
            var a = r.actors && r.actors[k];
            if (!a) return;
            var text = actorText(a) + ' · ' + formatVnTime(a.at);
            var dd = el('span', a.deleted ? 'rcp-deleted' : '', text);
            dlRow(actors, 'admRcp.actor.' + k, dd);
        });
        $('rcp-detail-actors-h').hidden = actors.hidden = !actors.children.length;
        if (d.readOnly) return;
        availableActions(r.status, state.can).forEach(function (kind) {
            var b = button('adm-btn small' + (kind === 'edit' || kind === 'reject' || kind === 'cancel' ? ' ghost' : '') + (kind === 'cancel' ? ' rcp-danger' : ''),
                tr('admRcp.act.' + kind), function () { onDetailAction(kind, b); });
            b.setAttribute('data-rcp-action', kind);
            b.setAttribute('aria-haspopup', 'dialog');
            b.disabled = !!state.action;
            actions.appendChild(b);
        });
    }
    function onDetailAction(kind, trigger) {
        var d = state.detail;
        if (!d || !d.data || state.action || d.readOnly) return;
        if (kind === 'edit') {
            var receipt = d.data, back = d.trigger;
            closeDetail(true);
            return openEditor(receipt, back);
        }
        return openAction(kind, d.data, trigger);
    }

    // ================= Modal thao tác: gửi duyệt / duyệt / từ chối / huỷ / nhận hàng =================
    // action = { kind, receipt, busy, error: { key, params, lines } | null, reasonError, result: stock_changes | null, trigger }
    function needsReason(kind) { return kind === 'reject' || kind === 'cancel'; }
    function openAction(kind, receipt, trigger) {
        if (!allowed() || state.action || (state.detail && state.detail.readOnly)
            || availableActions(receipt.status, state.can).indexOf(kind) === -1) return;
        state.action = { kind: kind, receipt: receipt, busy: false, error: null, reasonError: false, result: null, trigger: trigger || null };
        $('rcp-action-reason').value = '';
        renderAction();
        renderDetail();
        lockScroll();
        $('rcp-action').classList.add('open');
        focusSafe(needsReason(kind) ? $('rcp-action-reason') : $('rcp-action-cancel'));
    }
    function closeAction(force) {
        var a = state.action;
        if (!a || (a.busy && !force)) return;
        state.action = null;
        $('rcp-action').classList.remove('open');
        $('rcp-action-body').replaceChildren();
        unlockScroll();
        renderDetail();
        var again = a.trigger && state.detail ? document.querySelector('[data-rcp-action="' + a.kind + '"]') : null;
        if (!focusSafe(again) && !focusSafe(a.trigger)) focusSafe($('rcp-detail-close'));
    }
    function actionHead(cols) {
        var head = $('rcp-action-head');
        var tr0 = el('tr');
        cols.forEach(function (c) { var th = el('th', c[1] || '', tr(c[0])); th.setAttribute('scope', 'col'); tr0.appendChild(th); });
        head.replaceChildren(tr0);
    }
    function renderAction() {
        var a = state.action;
        if (!a) return;
        var code = a.receipt.code, done = !!a.result;
        setText($('rcp-action-title'), tr(done ? 'admRcp.receiveDoneTitle' : 'admRcp.' + a.kind + 'Title', { code: code }));
        setText($('rcp-action-msg'), tr(done ? 'admRcp.receiveDoneMsg' : 'admRcp.' + a.kind + 'Msg'));
        $('rcp-action-reason-wrap').hidden = !needsReason(a.kind);
        var reason = $('rcp-action-reason');
        reason.disabled = a.busy;
        reason.setAttribute('aria-invalid', a.reasonError ? 'true' : 'false');
        setText($('rcp-action-count'), tr('admRcp.reasonCount', { n: (reason.value || '').length }));
        var rerr = $('rcp-action-reason-err');
        rerr.hidden = !a.reasonError; setText(rerr, a.reasonError ? tr('admRcp.err.reason') : '');
        var body = $('rcp-action-body');
        body.replaceChildren();
        var showTable = a.kind === 'receive';
        $('rcp-action-table').hidden = !showTable;
        if (showTable) {
            var byVariant = {};
            (a.receipt.items || []).forEach(function (it) { byVariant[it.variant_id] = it; });
            if (done) {
                actionHead([['admRcp.thSku'], ['admRcp.thProduct'], ['admRcp.thSize'], ['admRcp.thColor'], ['admRcp.thBefore', 'num'],
                    ['admRcp.thAdded', 'num'], ['admRcp.thAfter', 'num']]);
                a.result.forEach(function (c) {
                    var it = byVariant[c.variant_id] || {}, row = el('tr');
                    [show(it.sku), show(it.name), show(it.size), show(it.color)].forEach(function (v) { row.appendChild(el('td', '', v)); });
                    row.appendChild(el('td', 'num', fmtNum(c.stock_before)));
                    row.appendChild(el('td', 'num', '+' + fmtNum(c.quantity)));
                    row.appendChild(el('td', 'num rcp-after', fmtNum(c.stock_after)));
                    body.appendChild(row);
                });
            } else {
                actionHead([['admRcp.thSku'], ['admRcp.thProduct'], ['admRcp.thSize'], ['admRcp.thColor'], ['admRcp.thAdded', 'num']]);
                (a.receipt.items || []).forEach(function (it) {
                    var row = el('tr');
                    [show(it.sku), show(it.name), show(it.size), show(it.color)].forEach(function (v) { row.appendChild(el('td', '', v)); });
                    row.appendChild(el('td', 'num', '+' + fmtNum(it.quantity)));
                    body.appendChild(row);
                });
            }
        }
        var err = $('rcp-action-err');
        err.replaceChildren();
        if (a.error) {
            err.appendChild(el('span', '', tr(a.error.key, a.error.params)));
            (a.error.lines || []).forEach(function (line) { err.appendChild(el('span', 'rcp-err-line', line)); });
        }
        err.style.display = a.error ? 'block' : 'none';
        var ok = $('rcp-action-ok');
        ok.hidden = done;
        ok.disabled = a.busy;
        setText(ok, tr(a.busy ? 'admRcp.saving' : 'admRcp.act.' + a.kind));
        ok.classList.toggle('danger', a.kind === 'cancel' || a.kind === 'reject');
        var cancel = $('rcp-action-cancel');
        cancel.disabled = a.busy;
        label(cancel, done ? 'com.close' : 'com.cancel');
    }
    function submitAction() {
        var a = state.action;
        if (!a || a.busy || a.result) return Promise.resolve();
        var payload = {};
        if (needsReason(a.kind)) {
            var reason = ($('rcp-action-reason').value || '').trim();
            a.reasonError = !reason || reason.length > MAX_REASON;
            if (a.reasonError) { renderAction(); focusSafe($('rcp-action-reason')); return Promise.resolve(); }
            payload.reason = reason;
        }
        var access = accessEpoch, id = a.receipt.id;
        a.busy = true; a.error = null; renderAction();
        return send('/api/admin/receipts/' + encodeURIComponent(id) + '/' + a.kind, 'POST', payload).then(function (x) {
            if (access !== accessEpoch || state.action !== a) return;
            a.busy = false;
            if (x.ok && x.body && x.body.receipt) {
                toast('admRcp.toast.' + a.kind, { code: x.body.receipt.code });
                if (state.detail && state.detail.id === id) { state.detail.data = x.body.receipt; state.detail.general = null; }
                loadList(state.page);
                if (a.kind === 'receive') {
                    a.result = Array.isArray(x.body.stock_changes) ? x.body.stock_changes : [];
                    a.receipt = x.body.receipt;
                    renderAction(); renderDetail(); focusSafe($('rcp-action-cancel'));
                    return;
                }
                closeAction(true);
                return;
            }
            var err = serverError(x.status, x.body);
            if (err.field && err.field.name === 'reason') { a.reasonError = true; renderAction(); return; }
            var byIndex = a.receipt.items || [];
            a.error = { key: err.general || err.supplier || 'admRcp.err.generic',
                params: { status: err.state ? tr('admRcp.st.' + err.state) : '' },
                lines: err.rows ? Object.keys(err.rows).map(function (i) {
                    var it = byIndex[i] || {};
                    return tr('admRcp.rowLine', { n: Number(i) + 1, sku: show(it.sku) }) + ': ' + tr(err.rows[i]);
                }) : [] };
            renderAction();
            if (err.state) { loadList(state.page); loadDetail(); }
        }, function () {
            if (access !== accessEpoch || state.action !== a) return;
            a.busy = false; a.error = { key: 'admRcp.err.generic' }; renderAction();
        });
    }

    // ================= Bàn phím: Esc đóng, Tab / Shift+Tab xoay vòng trong modal =================
    function trap(modal, e, close) {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key !== 'Tab' || !modal.querySelectorAll) return;
        var list = Array.prototype.slice.call(modal.querySelectorAll(FOCUSABLE)).filter(function (n) {
            return !n.disabled && (n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement);
        });
        if (!list.length) { e.preventDefault(); return; }
        var first = list[0], last = list[list.length - 1], active = document.activeElement;
        if (list.indexOf(active) === -1 || (!e.shiftKey && active === last)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    }

    window.BreezeAdminReceipts = Object.freeze({
        // perms: BẢN SAO permissions từ /api/me.
        load: function (page, perms) {
            state.perms = Array.isArray(perms) ? perms.slice() : [];
            var has = function (p) { return state.perms.indexOf(p) !== -1; };
            state.can = { read: has('receipt:read'), create: has('receipt:create'), approve: has('receipt:approve'), receive: has('receipt:receive') };
            if (!state.can.read) { renderTable(); return Promise.resolve(); }
            var list = loadList(Number.isInteger(page) && page > 0 ? page : 1);
            return Promise.all([list, state.suppliers ? Promise.resolve() : loadSuppliers()]);
        },
        // Popup Lịch sử tồn kho (admin.js) bấm mã phiếu: mở chi tiết CHỈ XEM, chồng lên popup. perms = BẢN SAO quyền từ
        // /api/me (người dùng có thể chưa mở tab Nhập kho lần nào). Không có receipt:read -> không làm gì. Không tải
        // danh sách phiếu / NCC.
        openFromHistory: function (id, trigger, perms) {
            if (Array.isArray(perms)) {
                state.perms = perms.slice();
                var has = function (p) { return state.perms.indexOf(p) !== -1; };
                state.can = { read: has('receipt:read'), create: has('receipt:create'), approve: has('receipt:approve'), receive: has('receipt:receive') };
            }
            if (!Number.isInteger(id) || id < 1 || !state.can.read || state.editor || state.action) return Promise.resolve();
            return openDetail(id, trigger, null, { readOnly: true });
        },
        // Rời phiên: bỏ phản hồi đang chờ, đóng mọi modal, xoá dữ liệu, bộ lọc và quyền.
        reset: function () {
            accessEpoch++; listEpoch++;
            closeAction(true); closeEditor(true); closeDetail(true);
            openModals = 0; document.body.style.overflow = previousOverflow;
            state = freshState();
            $('rcp-q').value = ''; $('rcp-status').value = 'all';
            renderSupplierFilter(); renderTable();
        },
        util: Object.freeze({ parseAmount: parseAmount, validateDraft: validateDraft, buildBody: buildBody, serverError: serverError,
            availableActions: availableActions, listUrl: listUrl, filterProducts: filterProducts, formatVnTime: formatVnTime,
            formatDate: formatDate, actorText: actorText, warnings: warnings })
    });

    document.addEventListener('DOMContentLoaded', function () {
        renderSupplierFilter(); renderTable();
        $('rcp-filter-form').addEventListener('submit', function (e) {
            if (e && e.preventDefault) e.preventDefault();
            state.q = ($('rcp-q').value || '').trim();
            loadList(1);
        });
        $('rcp-status').addEventListener('change', function () { state.status = $('rcp-status').value || 'all'; loadList(1); });
        $('rcp-supplier').addEventListener('change', function () { state.supplierId = $('rcp-supplier').value || ''; loadList(1); });
        $('rcp-prev').addEventListener('click', function () { if (!$('rcp-prev').disabled) loadList(state.page - 1); });
        $('rcp-next').addEventListener('click', function () { if (!$('rcp-next').disabled) loadList(state.page + 1); });
        $('rcp-add').addEventListener('click', function () { openEditor(null, $('rcp-add')); });
        // Form
        $('rcp-form').addEventListener('submit', submitEditor);
        $('rcp-editor-cancel').addEventListener('click', function () { closeEditor(); });
        $('rcp-product-q').addEventListener('input', function () {
            if (!state.editor) return;
            state.editor.productResults = filterProducts(state.products, $('rcp-product-q').value);
            renderProductResults();
        });
        $('rcp-f-supplier').addEventListener('change', function () {
            if (state.editor && state.editor.errors.supplier) { state.editor.errors.supplier = null; fieldError('supplier', null); }
        });
        // Chi tiết
        $('rcp-detail-close').addEventListener('click', function () { closeDetail(); });
        $('rcp-detail-retry').addEventListener('click', function () { loadDetail(); });
        // Thao tác
        $('rcp-action-ok').addEventListener('click', submitAction);
        $('rcp-action-cancel').addEventListener('click', function () { closeAction(); });
        $('rcp-action-reason').addEventListener('input', function () {
            if (state.action) setText($('rcp-action-count'), tr('admRcp.reasonCount', { n: ($('rcp-action-reason').value || '').length }));
        });
        [['rcp-editor', function () { closeEditor(); }], ['rcp-detail', function () { closeDetail(); }], ['rcp-action', function () { closeAction(); }]]
            .forEach(function (pair) {
                var modal = $(pair[0]);
                modal.addEventListener('click', function (e) { if (e.target === modal) pair[1](); });
                modal.addEventListener('keydown', function (e) { trap(modal, e, pair[1]); });
            });
        // Đổi VI/EN: vẽ lại từ dữ liệu đã tải, KHÔNG gọi lại API.
        document.addEventListener('langchange', function () {
            renderSupplierFilter(); renderTable(); renderEditor(); renderDetail(); renderAction();
        });
    });
})();
