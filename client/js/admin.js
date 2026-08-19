    (function () {
        'use strict';
        var $ = function (id) { return document.getElementById(id); };

        // i18n — js/i18n.js nạp trước file này; nhãn tĩnh do data-i18n lo, ở đây
        // chỉ dùng cho chuỗi do JS sinh ra (bảng, toast, confirm...).
        function lang() { return (window.__i18n && window.__i18n.current) || 'vi'; }
        function tr(key, params, fallback) {
            if (!(window.__i18n && window.__i18n.t)) return fallback == null ? key : fallback;
            var v = window.__i18n.t(key, params);
            return (v === key && fallback != null) ? fallback : v;
        }

        var ORDER_STATUSES = ['pending', 'paid', 'shipped', 'completed', 'cancelled'];
        function statusLabel(s) { return tr('st.' + s, null, s); }
        // Đồng bộ đúng tên hiển thị với 4 lựa chọn ở UI checkout (client/checkout.html).
        function paymentLabel(m) { return m ? tr('pay.' + m, null, '—') : '—'; }

        var categories = [];   // [{id, slug, name_vi}]
        var catById = {};

        // Ngày/giờ theo ngôn ngữ đang chọn (VN dd/mm/yyyy, EN dd/mm/yyyy kiểu en-GB).
        function fmtDate(iso) {
            try { return new Date(iso).toLocaleString(lang() === 'en' ? 'en-GB' : 'vi-VN'); }
            catch (e) { return iso; }
        }

        function api(path, opts) {
            if (!(window.AuthHelper && window.AuthHelper.apiFetch)) return Promise.reject(new Error(tr('adm.authNotReady')));
            return window.AuthHelper.apiFetch(path, opts);
        }

        var _toastTimer = null;
        function toast(msg, isErr) {
            var t = $('toast');
            t.textContent = msg;
            t.className = 'show' + (isErr ? ' err' : '');
            if (_toastTimer) clearTimeout(_toastTimer);
            _toastTimer = setTimeout(function () { t.className = ''; }, 2800);
        }

        // --- Access states ---------------------------------------------------
        function showState(which) {
            ['state-loading', 'state-login', 'state-forbidden'].forEach(function (id) {
                $(id).style.display = 'none';
            });
            $('panel').style.display = 'none';
            $('bar-right').style.visibility = 'hidden';
            document.body.classList.toggle('adm-authed', which === 'panel');
            if (which !== 'panel') closeDrawer();
            if (which === 'panel') {
                $('panel').style.display = 'block';
                $('bar-right').style.visibility = 'visible';
            } else {
                $(which).style.display = 'block';
            }
        }

        function onAuth(user) {
            if (!user) { showState('state-login'); return; }
            showState('state-loading');
            api('/api/me')
                .then(function (r) { if (!r.ok) throw new Error('me ' + r.status); return r.json(); })
                .then(function (me) {
                    if (me.role !== 'admin') { showState('state-forbidden'); return; }
                    $('who').textContent = me.email || me.display_name || me.firebase_uid;
                    showState('panel');
                    return loadCategories().then(loadProducts).then(function () { return loadOrders(1); })
                        .then(loadDashboard).then(function () { return loadUsers(1); })
                        .then(function () { return loadBlacklist(1); });
                })
                .catch(function (e) { console.error('[admin] auth/me lỗi:', e); showState('state-forbidden'); });
        }

        // Đổi VI/EN: nhãn tĩnh đã do i18n.js áp lại; bảng/biểu đồ do JS sinh thì
        // nạp lại đúng view đang mở (bỏ qua khi chưa qua cổng quyền admin).
        function reloadCurrentView() {
            if (!document.body.classList.contains('adm-authed')) return;
            var active = document.querySelector('.adm-nav-item.active');
            switch (active ? active.getAttribute('data-nav') : 'dashboard') {
                case 'products': loadProducts(); break;
                case 'orders': loadOrders(_orderPage); break;
                case 'statistics': loadStatistics(); break;
                case 'users': loadUsers(_userPage); break;
                case 'blacklist': loadBlacklist(_blacklistPage); break;
                default: loadDashboard();
            }
        }

        // --- Sidebar navigation ----------------------------------------------
        // Map mục sidebar -> id view. Products/Orders trỏ đúng 2 panel cũ.
        var NAV_VIEWS = {
            dashboard: 'view-dashboard',
            products: 'tab-products',
            orders: 'tab-orders',
            statistics: 'view-statistics',
            users: 'view-users',
            blacklist: 'view-blacklist'
        };
        function bindNav() {
            var items = document.querySelectorAll('.adm-nav-item');
            items.forEach(function (btn) {
                btn.addEventListener('click', function () {
                    items.forEach(function (b) { b.classList.remove('active'); b.removeAttribute('aria-current'); });
                    btn.classList.add('active');
                    btn.setAttribute('aria-current', 'page');
                    var t = btn.getAttribute('data-nav');
                    Object.keys(NAV_VIEWS).forEach(function (k) {
                        var el = $(NAV_VIEWS[k]);
                        if (el) el.style.display = (k === t) ? 'block' : 'none';
                    });
                    closeDrawer();
                });
            });
        }

        // --- Drawer (sidebar overlay ở tablet/mobile) ------------------------
        function openDrawer() {
            document.body.classList.add('adm-drawer-open');
            var mb = $('adm-menu-btn'); if (mb) mb.setAttribute('aria-expanded', 'true');
        }
        function closeDrawer() {
            document.body.classList.remove('adm-drawer-open');
            var mb = $('adm-menu-btn'); if (mb) mb.setAttribute('aria-expanded', 'false');
        }
        function toggleDrawer() {
            if (document.body.classList.contains('adm-drawer-open')) closeDrawer(); else openDrawer();
        }

        // --- Dropdown tài khoản (email + Đăng xuất) --------------------------
        function openAccountMenu() {
            var m = $('adm-account-menu'), b = $('adm-account-btn');
            if (m) m.hidden = false;
            if (b) b.setAttribute('aria-expanded', 'true');
        }
        function closeAccountMenu() {
            var m = $('adm-account-menu'), b = $('adm-account-btn');
            if (m) m.hidden = true;
            if (b) b.setAttribute('aria-expanded', 'false');
        }
        function toggleAccountMenu() {
            var m = $('adm-account-menu');
            if (m && m.hidden) openAccountMenu(); else closeAccountMenu();
        }


        // --- Categories ------------------------------------------------------
        function loadCategories() {
            return fetch((window.API_BASE || '') + '/api/categories')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    categories = Array.isArray(data) ? data : [];
                    catById = {};
                    categories.forEach(function (c) { catById[c.id] = c; });
                    var sel = $('f-category');
                    sel.innerHTML = categories.map(function (c) {
                        return '<option value="' + c.id + '">' + esc(c.name_vi) + ' (' + esc(c.slug) + ')</option>';
                    }).join('');
                });
        }

        // --- Products --------------------------------------------------------
        var LOW_STOCK_THRESHOLD = 30;          // <= ngưỡng "sắp hết" (duy nhất, không lặp lại số)
        var _prodAll = [];                     // toàn bộ SP đã tải (products không phân trang)
        var _prodStockFilter = 'all';          // 'all' | 'low' | 'out'

        // Phân loại tồn kho theo stock -> badge.
        function stockInfo(stock) {
            var n = Number(stock); if (!Number.isFinite(n)) n = 0;
            if (n === 0) return { cls: 'stock-out', label: tr('adm.fOut') };
            if (n <= LOW_STOCK_THRESHOLD) return { cls: 'stock-low', label: tr('adm.fLow') };
            return { cls: 'stock-ok', label: tr('adm.fOk') };
        }
        function stockBadge(stock) {
            var s = stockInfo(stock);
            return '<span class="pill ' + s.cls + '">' + s.label + '</span>';
        }
        function prodMatchesStock(p) {
            var n = Number(p.stock); if (!Number.isFinite(n)) n = 0;
            if (_prodStockFilter === 'low') return n > 0 && n <= LOW_STOCK_THRESHOLD;
            if (_prodStockFilter === 'out') return n === 0;
            return true;
        }

        function loadProducts() {
            return api('/api/admin/products')
                .then(function (r) { if (!r.ok) throw new Error('products ' + r.status); return r.json(); })
                .then(function (data) { renderProducts(data.products || []); })
                .catch(function (e) {
                    console.error('[admin] load products lỗi:', e);
                    $('prod-body').innerHTML = '<tr><td colspan="10" class="adm-empty">' + tr('adm.errLoadProd') + '</td></tr>';
                });
        }

        function prodRowHTML(p) {
            var cat = catById[p.category_id];
            var catName = cat ? cat.name_vi : (p.category_slug || p.category_id);
            var img = (p.images && p.images.length) ? p.images[0] : '';
            var thumb = img ? '<img class="adm-thumb" src="' + esc(img) + '" alt="" onerror="this.style.visibility=\'hidden\'">' : '<span class="adm-thumb"></span>';
            return '<tr>' +
                '<td class="num">' + p.id + '</td>' +
                '<td>' + thumb + '</td>' +
                '<td>' + esc(p.name_vi) + '<div class="adm-slug">' + esc(p.slug) + '</div></td>' +
                '<td>' + esc(catName) + '</td>' +
                '<td class="num">' + money(p.price) + '</td>' +
                '<td class="num">' + (p.sale_price != null ? money(p.sale_price) : '—') + '</td>' +
                '<td class="num">' + p.stock + '</td>' +
                '<td>' + stockBadge(p.stock) + '</td>' +
                '<td>' + (p.is_active ? '<span class="pill on">' + tr('adm.pillOn') + '</span>' : '<span class="pill off">' + tr('adm.pillOff') + '</span>') + '</td>' +
                '<td><div class="adm-actions">' +
                    '<button type="button" class="adm-btn ghost small" data-edit="' + p.id + '">' + tr('com.edit') + '</button>' +
                    '<button type="button" class="adm-btn danger small" data-del="' + p.id + '">' + tr('com.delete') + '</button>' +
                '</div></td>' +
            '</tr>';
        }

        function attachProdRowHandlers() {
            $('prod-body').querySelectorAll('[data-edit]').forEach(function (b) {
                b.addEventListener('click', function () { openModal(_prodCache[b.getAttribute('data-edit')]); });
            });
            $('prod-body').querySelectorAll('[data-del]').forEach(function (b) {
                b.addEventListener('click', function () { deleteProduct(_prodCache[b.getAttribute('data-del')]); });
            });
        }

        function renderProducts(list) {
            _prodAll = list || [];
            // Cache theo id để mở form sửa (toàn bộ SP, không phụ thuộc filter).
            _prodCache = {};
            _prodAll.forEach(function (p) { _prodCache[p.id] = p; });
            applyProductFilter();
        }

        function applyProductFilter() {
            var list = _prodAll.filter(prodMatchesStock);
            $('prod-count').textContent = '(' + list.length + ')';   // đếm theo tập đang hiển thị
            if (!list.length) {
                var msg = _prodStockFilter === 'low' ? tr('adm.emptyLow')
                        : _prodStockFilter === 'out' ? tr('adm.emptyOut')
                        : tr('adm.emptyProd');
                $('prod-body').innerHTML = '<tr><td colspan="10" class="adm-empty">' + msg + '</td></tr>';
                return;
            }
            $('prod-body').innerHTML = list.map(prodRowHTML).join('');
            attachProdRowHandlers();
        }

        function bindProductFilters() {
            var btns = document.querySelectorAll('.prod-filter-btn');
            btns.forEach(function (b) {
                b.addEventListener('click', function () {
                    btns.forEach(function (x) { x.classList.remove('active'); x.removeAttribute('aria-current'); });
                    b.classList.add('active'); b.setAttribute('aria-current', 'true');
                    _prodStockFilter = b.getAttribute('data-stock-filter') || 'all';
                    applyProductFilter();
                });
            });
        }
        var _prodCache = {};

        // --- Product modal ---------------------------------------------------
        function openModal(p) {
            $('modal-err').style.display = 'none';
            if (p) {
                $('modal-title').textContent = tr('adm.modalEdit', { id: p.id });
                $('f-id').value = p.id;
                $('f-slug').value = p.slug || '';
                $('f-name-vi').value = p.name_vi || '';
                $('f-name-en').value = p.name_en || '';
                $('f-price').value = p.price;
                $('f-sale').value = (p.sale_price != null ? p.sale_price : '');
                $('f-stock').value = p.stock;
                $('f-images').value = (p.images || []).join('\n');
                $('f-desc-vi').value = p.description_vi || '';
                $('f-desc-en').value = p.description_en || '';
                $('f-active').checked = !!p.is_active;
                if (p.category_id != null) $('f-category').value = String(p.category_id);
            } else {
                $('modal-title').textContent = tr('adm.modalAdd');
                $('prod-form').reset();
                $('f-id').value = '';
                $('f-stock').value = '0';
                $('f-active').checked = true;
            }
            $('prod-modal').classList.add('open');
        }
        function closeModal() { $('prod-modal').classList.remove('open'); }

        function parseImages(str) {
            return String(str || '').split(/[\n,]/).map(function (s) { return s.trim(); }).filter(Boolean);
        }

        function submitProduct(ev) {
            ev.preventDefault();
            var id = $('f-id').value;
            var saleRaw = $('f-sale').value.trim();
            var body = {
                slug: $('f-slug').value.trim(),
                name_vi: $('f-name-vi').value.trim(),
                name_en: $('f-name-en').value.trim() || null,
                category_id: Number($('f-category').value),
                price: Number($('f-price').value),
                sale_price: saleRaw === '' ? null : Number(saleRaw),
                stock: Number($('f-stock').value || 0),
                images: parseImages($('f-images').value),
                description_vi: $('f-desc-vi').value.trim() || null,
                description_en: $('f-desc-en').value.trim() || null,
                is_active: $('f-active').checked
            };
            var isEdit = !!id;
            var path = isEdit ? ('/api/admin/products/' + id) : '/api/admin/products';
            var method = isEdit ? 'PUT' : 'POST';

            $('btn-save').disabled = true;
            api(path, { method: method, body: JSON.stringify(body) })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
                .then(function (res) {
                    if (!res.ok) {
                        var err = $('modal-err');
                        err.textContent = (res.j && res.j.message) ? res.j.message : tr('adm.errCode', { code: res.status });
                        err.style.display = 'block';
                        return;
                    }
                    closeModal();
                    toast(isEdit ? tr('adm.toastProdUpdated') : tr('adm.toastProdAdded'));
                    loadProducts();
                })
                .catch(function (e) {
                    console.error(e);
                    var err = $('modal-err'); err.textContent = tr('com.netErr'); err.style.display = 'block';
                })
                .then(function () { $('btn-save').disabled = false; });
        }

        function deleteProduct(p) {
            if (!p) return;
            if (!window.confirm(tr('adm.confirmDelProd', { name: p.name_vi }))) return;
            api('/api/admin/products/' + p.id, { method: 'DELETE' })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
                .then(function (res) {
                    if (!res.ok) { toast((res.j && res.j.message) || tr('adm.delFail'), true); return; }
                    toast(res.j.mode === 'soft' ? tr('adm.softDeleted') : tr('adm.prodDeleted'));
                    loadProducts();
                })
                .catch(function (e) { console.error(e); toast(tr('com.netErr'), true); });
        }

        // --- Orders ----------------------------------------------------------
        var _orderPage = 1;
        var _orderFilters = { status: '', q: '' };  // gửi xuống server; lọc TOÀN BỘ đơn, không chỉ 1 trang
        var _orderSearchTimer = null;

        // Đọc trạng thái filter/search từ UI vào _orderFilters.
        function readOrderFilters() {
            var stSel = $('order-status-filter');
            var qEl = $('order-search');
            _orderFilters.status = stSel ? stSel.value : '';
            _orderFilters.q = qEl ? qEl.value.trim() : '';
        }

        function orderQuery() {
            var params = ['page=' + _orderPage, 'limit=10'];
            if (_orderFilters.status) params.push('status=' + encodeURIComponent(_orderFilters.status));
            if (_orderFilters.q) params.push('q=' + encodeURIComponent(_orderFilters.q));
            return '/api/admin/orders?' + params.join('&');
        }

        function loadOrders(page) {
            _orderPage = page || 1;
            $('order-body').innerHTML = skeletonRows(7, 8);
            $('order-pager').innerHTML = '';
            return api(orderQuery())
                .then(function (r) { if (!r.ok) throw new Error('orders ' + r.status); return r.json(); })
                .then(renderOrders)
                .catch(function (e) {
                    console.error('[admin] load orders lỗi:', e);
                    $('order-body').innerHTML = '<tr><td colspan="7" class="adm-empty">' + tr('adm.errLoadOrders') + '</td></tr>';
                });
        }

        // Đổi filter -> nạp lại từ server (về trang 1). Search có debounce để đỡ gọi API mỗi phím.
        function onOrderFilterChange() { readOrderFilters(); loadOrders(1); }
        function onOrderSearchInput() {
            if (_orderSearchTimer) clearTimeout(_orderSearchTimer);
            _orderSearchTimer = setTimeout(function () { readOrderFilters(); loadOrders(1); }, 300);
        }

        // Dựng HTML cho 1 đơn (hàng chính + hàng chi tiết ẩn). Giữ nguyên markup cũ.
        function orderRowHTML(o) {
            var opts = ORDER_STATUSES.map(function (s) {
                return '<option value="' + s + '"' + (s === o.status ? ' selected' : '') + '>' + statusLabel(s) + '</option>';
            }).join('');
            var itemRows = (o.items || []).map(function (it) {
                return '<tr><td class="inner">' + esc(it.product_name) + '</td>' +
                    '<td class="inner">' + money(it.unit_price) + '</td>' +
                    '<td class="inner">' + it.quantity + '</td>' +
                    '<td class="inner">' + money(it.line_total) + '</td></tr>';
            }).join('');
            var cust = o.user_email || o.user_name || ('user #' + o.user_id);
            // Dòng voucher chỉ hiện khi đơn có áp mã (mã hoặc số tiền giảm > 0).
            var voucherLine = (o.voucher_code || Number(o.discount_amount) > 0)
                ? '<p class="oi-voucher">' + tr('adm.voucherLine') + ' <strong>' + esc(o.voucher_code || '—') +
                  '</strong> · ' + tr('adm.discountWord') + ' ' + money(o.discount_amount || 0) + '</p>'
                : '';
            // Đơn không có/không nhận diện được hình thức thanh toán -> "—" (không để trống vỡ bảng).
            // Tên biến KHÁC tên hàm paymentLabel() — trùng tên thì `var` hoisted sẽ che
            // mất hàm ngay trong scope này và ném TypeError, làm rỗng cả bảng đơn hàng.
            var payLabel = esc(paymentLabel(o.payment_method));
            var invoiceBtn = '<button type="button" class="adm-btn ghost small" data-invoice="' + o.id + '">' + tr('adm.btnInvoice') + '</button> ';
            return '<tr>' +
                    '<td class="num">' + o.id + '</td>' +
                    '<td>' + esc(cust) + '</td>' +
                    '<td>' + fmtDate(o.created_at) + '</td>' +
                    '<td>' + payLabel + '</td>' +
                    '<td class="num">' + money(o.total_amount) + '</td>' +
                    '<td><select class="status-sel" data-order="' + o.id + '">' + opts + '</select></td>' +
                    '<td style="white-space:nowrap;">' +
                        '<button type="button" class="adm-btn ghost small" data-toggle="' + o.id + '">' + tr('adm.btnDetail') + '</button> ' +
                        invoiceBtn +
                        '<button type="button" class="adm-btn danger small" data-del-order="' + o.id + '">' + tr('com.delete') + '</button>' +
                    '</td>' +
                '</tr>' +
                '<tr class="oi-detail" id="oi-' + o.id + '" style="display:none;"><td colspan="7">' +
                    '<table><thead><tr><th>' + tr('adm.thProdName') + '</th><th>' + tr('adm.thUnitPrice') + '</th><th>' + tr('adm.thQtyShort') + '</th><th>' + tr('adm.thLineTotal') + '</th></tr></thead>' +
                    '<tbody>' + (itemRows || '<tr><td class="inner" colspan="4">' + tr('adm.noLines') + '</td></tr>') + '</tbody></table>' +
                    voucherLine +
                '</td></tr>';
        }

        function attachOrderRowHandlers() {
            $('order-body').querySelectorAll('.status-sel').forEach(function (sel) {
                sel.addEventListener('change', function () { changeStatus(sel.getAttribute('data-order'), sel.value, sel); });
            });
            $('order-body').querySelectorAll('[data-toggle]').forEach(function (b) {
                b.addEventListener('click', function () {
                    var row = $('oi-' + b.getAttribute('data-toggle'));
                    if (row) row.style.display = (row.style.display === 'none') ? 'table-row' : 'none';
                });
            });
            $('order-body').querySelectorAll('[data-del-order]').forEach(function (b) {
                b.addEventListener('click', function () { deleteOrder(b.getAttribute('data-del-order'), b); });
            });
            // Mở trang in hoá đơn ở TAB MỚI (trang tự xác thực admin rồi gọi API lấy dữ liệu đơn).
            $('order-body').querySelectorAll('[data-invoice]').forEach(function (b) {
                b.addEventListener('click', function () {
                    window.open('invoice.html?orderId=' + encodeURIComponent(b.getAttribute('data-invoice')), '_blank');
                });
            });
        }

        function renderOrders(data) {
            var orders = (data && data.orders) || [];
            $('order-count').textContent = '(' + ((data && data.total) || 0) + ')';
            var tb = $('order-body');
            if (!orders.length) {
                // Phân biệt: đang lọc mà rỗng vs thật sự chưa có đơn nào.
                var filtering = _orderFilters.status || _orderFilters.q;
                tb.innerHTML = '<tr><td colspan="7" class="adm-empty">' +
                    (filtering ? tr('adm.emptyOrderSearch') : tr('adm.emptyOrders')) + '</td></tr>';
                $('order-pager').innerHTML = '';
                return;
            }
            tb.innerHTML = orders.map(orderRowHTML).join('');
            attachOrderRowHandlers();
            renderOrderPager(data);
        }

        function renderOrderPager(data) {
            var totalPages = (data && data.total_pages) || 1;
            $('order-pager').innerHTML =
                '<button type="button" id="pg-prev"' + (_orderPage <= 1 ? ' disabled' : '') + '>' + tr('adm.pgPrev') + '</button>' +
                '<span>' + tr('adm.pgPage') + ' ' + _orderPage + ' / ' + totalPages + '</span>' +
                '<button type="button" id="pg-next"' + (_orderPage >= totalPages ? ' disabled' : '') + '>' + tr('adm.pgNext') + '</button>';
            var prev = $('pg-prev'), next = $('pg-next');
            if (prev) prev.addEventListener('click', function () { loadOrders(_orderPage - 1); });
            if (next) next.addEventListener('click', function () { loadOrders(_orderPage + 1); });
        }

        function deleteOrder(orderId, btn) {
            if (!window.confirm(tr('adm.confirmDelOrder'))) return;
            btn.disabled = true;
            api('/api/admin/orders/' + orderId, { method: 'DELETE' })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
                .then(function (res) {
                    if (!res.ok) { toast((res.j && res.j.message) || tr('adm.delOrderFail'), true); btn.disabled = false; return; }
                    toast(tr('adm.orderDeleted', { id: orderId }));
                    loadOrders(_orderPage); // tải lại trang hiện tại
                })
                .catch(function (e) { console.error(e); toast(tr('com.netErr'), true); btn.disabled = false; });
        }

        function changeStatus(orderId, status, sel) {
            var prev = sel.getAttribute('data-current') || '';
            sel.disabled = true;
            api('/api/admin/orders/' + orderId + '/status', { method: 'PUT', body: JSON.stringify({ status: status }) })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
                .then(function (res) {
                    if (!res.ok) { toast((res.j && res.j.message) || tr('adm.updFail'), true); if (prev) sel.value = prev; return; }
                    sel.setAttribute('data-current', status);
                    toast(tr('adm.statusUpdated', { id: orderId }));
                })
                .catch(function (e) { console.error(e); toast(tr('com.netErr'), true); if (prev) sel.value = prev; })
                .then(function () { sel.disabled = false; });
        }

        // --- Dashboard -------------------------------------------------------
        // ===== Dashboard — KPI cards + chart, filter theo khoảng ngày =====
        var _dashRange = null;   // {from, to} đang xem
        var _lastDaily = [];     // dailyRevenue gần nhất (dùng cho Xuất CSV)
        var KPI_VAL_IDS = ['kpi-revenue-val', 'kpi-orders-val', 'kpi-customers-val', 'kpi-aov-val'];
        var VN_MONTHS = ['thg 1', 'thg 2', 'thg 3', 'thg 4', 'thg 5', 'thg 6', 'thg 7', 'thg 8', 'thg 9', 'thg 10', 'thg 11', 'thg 12'];
        var EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        function months() { return lang() === 'en' ? EN_MONTHS : VN_MONTHS; }

        function pad2(n) { return String(n).padStart(2, '0'); }
        function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
        function ymdToDate(s) { var p = String(s).split('-'); return new Date(+p[0], (+p[1]) - 1, +p[2]); }
        function num(n) { return Number(n || 0).toLocaleString('vi-VN'); }

        // Mốc "hôm nay" cho các preset: neo vào đơn MỚI NHẤT trong DB thay vì đồng hồ máy
        // (GET /api/admin/stats/anchor — xem chú thích getAnchorInstant ở server/routes/admin.js).
        // Dữ liệu hiện dừng ở 2026-07-30 nên nếu lấy new Date() thì '7 ngày qua' rơi trọn vào
        // vùng trống và dashboard hiện rỗng như thể mất dữ liệu. Chưa tải được mốc -> dùng
        // ngày máy như cũ. Ngày hiển thị trên bảng/chart vẫn là ngày THẬT của đơn.
        var _anchorYMD = null;

        function loadAnchor() {
            return api('/api/admin/stats/anchor')
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (j) { if (j && j.anchor) _anchorYMD = j.anchor; })
                .catch(function (e) { console.error('[admin] load anchor lỗi:', e); });
        }

        // Preset -> {from, to} (ngày local, tính cả ngày mốc).
        function presetRange(preset) {
            var today = _anchorYMD ? ymdToDate(_anchorYMD) : new Date();
            var to = ymd(today), from;
            if (preset === '7') { var a = new Date(today); a.setDate(a.getDate() - 6); from = ymd(a); }
            else if (preset === 'month') { from = ymd(new Date(today.getFullYear(), today.getMonth(), 1)); }
            else if (preset === 'year') { from = ymd(new Date(today.getFullYear(), 0, 1)); }
            else { var b = new Date(today); b.setDate(b.getDate() - 29); from = ymd(b); } // '30'
            return { from: from, to: to };
        }

        function fmtRangeLabel(from, to) {
            var f = ymdToDate(from), t = ymdToDate(to);
            var M = months();
            return f.getDate() + ' ' + M[f.getMonth()] + ' – ' +
                t.getDate() + ' ' + M[t.getMonth()] + ', ' + t.getFullYear();
        }

        function calcDelta(cur, prev) {
            if (!prev) return { dir: 'nodata' };
            var pct = Math.round(((cur - prev) / prev) * 1000) / 10; // 1 chữ số thập phân
            return { dir: pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat'), pct: pct };
        }

        // Vẽ badge trend; trả về mô tả CHỮ (cho aria-label — không truyền ý nghĩa chỉ bằng màu).
        function renderTrend(trendEl, d) {
            if (!trendEl) return '';
            if (d.dir === 'nodata') {
                trendEl.className = 'kpi-trend is-flat';
                trendEl.innerHTML = '<span aria-hidden="true">—</span> ' + tr('adm.trendNoData');
                return tr('adm.trendNoData');
            }
            var abs = Math.abs(d.pct).toLocaleString('vi-VN');
            var word, arrow, cls;
            if (d.dir === 'up') { word = tr('adm.trendUp'); arrow = '▲'; cls = 'is-up'; }
            else if (d.dir === 'down') { word = tr('adm.trendDown'); arrow = '▼'; cls = 'is-down'; }
            else { word = tr('adm.trendFlat'); arrow = '→'; cls = 'is-flat'; }
            trendEl.className = 'kpi-trend ' + cls;
            trendEl.innerHTML = '<span aria-hidden="true">' + arrow + '</span> ' + abs + tr('adm.trendVs');
            return word + ' ' + abs + tr('adm.trendVs');
        }

        function setKpi(key, valueText, ariaValue, cur, prev) {
            var valEl = $('kpi-' + key + '-val');
            if (valEl) { valEl.classList.remove('skel'); valEl.textContent = valueText; }
            var word = renderTrend($('kpi-' + key + '-trend'), calcDelta(cur, prev));
            var art = $('kpi-' + key);
            if (art) art.setAttribute('aria-label', ariaValue + ', ' + word);
        }

        function kpiSkeleton(on) {
            KPI_VAL_IDS.forEach(function (id) {
                var el = $(id);
                if (!el) return;
                el.classList.toggle('skel', on);
                if (on) el.textContent = '';
            });
        }

        // Nạp lại mốc neo mỗi lần vào dashboard: có đơn mới thì mốc tự trôi theo, không
        // phải reload trang. Một request phụ rất nhẹ (SELECT MAX(created_at)).
        function loadDashboard() {
            return loadAnchor().then(function () {
                var sel = $('dash-preset');
                _dashRange = presetRange(sel ? sel.value : '30');
                loadStats(_dashRange);          // KPI + chart doanh thu (theo khoảng)
                loadOrderStatus(_dashRange);    // donut trạng thái (theo khoảng)
                loadTopProducts(_dashRange);    // bán chạy (theo khoảng)
                loadRecentOrders();             // 5 đơn mới nhất (không theo khoảng)
            });
        }

        function loadStats(range) {
            kpiSkeleton(true);
            chartLoading();
            var q = '?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to);
            return api('/api/admin/stats' + q)
                .then(function (r) { if (!r.ok) throw new Error('stats ' + r.status); return r.json(); })
                .then(renderStats)
                .catch(function (e) {
                    console.error('[admin] load stats lỗi:', e);
                    kpiSkeleton(false);
                    KPI_VAL_IDS.forEach(function (id) { if ($(id)) $(id).textContent = '—'; });
                    renderRevenueChart([]);
                });
        }

        function renderStats(s) {
            kpiSkeleton(false);
            var c = s.current || {}, p = s.previous || {};
            setKpi('revenue', money(c.revenue || 0), tr('adm.kpiRevenue') + ' ' + money(c.revenue || 0), c.revenue || 0, p.revenue || 0);
            setKpi('orders', num(c.orders), tr('adm.kpiOrders') + ' ' + num(c.orders), c.orders || 0, p.orders || 0);
            setKpi('customers', num(c.customers), tr('adm.kpiCustomers') + ' ' + num(c.customers), c.customers || 0, p.customers || 0);
            setKpi('aov', money(c.aov || 0), tr('adm.kpiAovFull') + ' ' + money(c.aov || 0), c.aov || 0, p.aov || 0);

            var sub = $('dash-range');
            if (sub && s.range) sub.textContent = fmtRangeLabel(s.range.from, s.range.to);

            _lastDaily = s.dailyRevenue || [];
            renderRevenueChart(_lastDaily);
        }

        // Xuất dailyRevenue đang xem ra CSV (client-side, Blob) — không cần route backend.
        function exportCsv() {
            if (!_lastDaily.length) return;
            var rows = [[tr('adm.csvDate'), tr('adm.csvRevenue')]].concat(_lastDaily.map(function (d) { return [d.date, d.revenue]; }));
            var csv = rows.map(function (r) { return r.join(','); }).join('\n');
            var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = tr('adm.csvFile') + '_' + (_dashRange ? _dashRange.from + '_' + _dashRange.to : 'export') + '.csv';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        }

        // --- Revenue chart (Chart.js) — dữ liệu dailyRevenue [{date, revenue}] ---
        var _revChart = null;
        var _dailyDates = [];   // song song với cột chart, cho tooltip title (ngày đầy đủ)
        function cssVar(name) {
            return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        }
        // Rút gọn tiền cho trục Y: 8.000.000 -> "8tr", 500.000 -> "500k".
        function compactVnd(v) {
            v = Number(v) || 0;
            if (v >= 1000000) return (v / 1000000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + 'tr';
            if (v >= 1000) return (v / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'k';
            return v.toLocaleString('vi-VN');
        }
        function fmtDayFull(ymdStr) {
            if (!ymdStr) return '';
            var d = ymdToDate(ymdStr);
            return d.getDate() + ' ' + months()[d.getMonth()] + ', ' + d.getFullYear();
        }
        function chartLoading() {
            var l = $('chart-loading'), e = $('chart-empty'), c = $('revenue-chart');
            if (l) l.style.display = '';
            if (e) e.style.display = 'none';
            if (c) c.style.display = 'none';
        }
        function renderRevenueChart(daily) {
            var loading = $('chart-loading'), empty = $('chart-empty'), canvas = $('revenue-chart');
            if (!canvas) return;
            if (loading) loading.style.display = 'none';

            var data = daily || [];
            var allZero = !data.length || data.every(function (m) { return !m.revenue; });
            if (allZero || typeof Chart === 'undefined') {
                if (empty) empty.style.display = '';
                canvas.style.display = 'none';
                if (_revChart) { _revChart.destroy(); _revChart = null; }
                return;
            }

            if (empty) empty.style.display = 'none';
            canvas.style.display = '';
            _dailyDates = data.map(function (m) { return m.date; });
            var labels = data.map(function (m) { return String(m.date || '').slice(8); }); // 'DD'
            var values = data.map(function (m) { return m.revenue; });

            if (_revChart) {
                _revChart.data.labels = labels;
                _revChart.data.datasets[0].data = values;
                _revChart.update();
                return;
            }

            var ink = cssVar('--admin-ink') || cssVar('--c-ink') || '#1C1B19';
            var line = cssVar('--admin-border') || '#E5E3DE';
            var muted = cssVar('--admin-ink-3') || '#78716C';
            var uiFont = cssVar('--font-ui') || 'Jost, sans-serif';

            _revChart = new Chart(canvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Doanh thu', data: values, backgroundColor: ink, borderWidth: 0,
                        borderRadius: { topLeft: 3, topRight: 3, bottomLeft: 0, bottomRight: 0 },
                        maxBarThickness: 34
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: ink,
                            titleFont: { family: uiFont },
                            bodyFont: { family: uiFont },
                            callbacks: {
                                title: function (items) { return fmtDayFull(_dailyDates[items[0].dataIndex]); },
                                label: function (ctx) { return money(ctx.parsed.y); }
                            }
                        }
                    },
                    scales: {
                        x: { border: { display: false }, grid: { display: false }, ticks: { color: muted, font: { family: uiFont, size: 11 } } },
                        y: {
                            beginAtZero: true,
                            border: { display: false },
                            grid: { color: line },
                            ticks: { color: muted, font: { family: uiFont, size: 11 }, callback: function (v) { return compactVnd(v); } }
                        }
                    }
                }
            });
        }

        function statusPill(s) {
            return '<span class="pill status">' + esc(statusLabel(s)) + '</span>';
        }

        function skeletonRows(cols, n) {
            var cell = '<td><span class="skel skel-cell"></span></td>';
            var row = '<tr>' + new Array(cols + 1).join(cell) + '</tr>';
            return new Array(n + 1).join(row);
        }
        function recentSkeletonRows(n) { return skeletonRows(5, n); }

        // TÁI DÙNG endpoint đơn hàng chung, chỉ lấy 5 đơn mới nhất (trang 1).
        function loadRecentOrders() {
            var tb = $('dash-orders-body');
            if (tb) tb.innerHTML = recentSkeletonRows(5);
            return api('/api/admin/orders?page=1&limit=5')
                .then(function (r) { if (!r.ok) throw new Error('recent orders ' + r.status); return r.json(); })
                .then(renderRecentOrders)
                .catch(function (e) {
                    console.error('[admin] load recent orders lỗi:', e);
                    if (tb) tb.innerHTML = '<tr><td colspan="5" class="adm-empty">' + tr('adm.errLoadOrders') + '</td></tr>';
                });
        }

        function renderRecentOrders(data) {
            var tb = $('dash-orders-body');
            if (!tb) return;
            var orders = (data && data.orders) || [];
            if (!orders.length) {
                tb.innerHTML = '<tr><td colspan="5" class="adm-empty">' + tr('adm.emptyOrders') + '</td></tr>';
                return;
            }
            tb.innerHTML = orders.map(function (o) {
                var cust = o.user_email || o.user_name || ('user #' + o.user_id);
                return '<tr>' +
                    '<td class="num">' + o.id + '</td>' +
                    '<td>' + esc(cust) + '</td>' +
                    '<td>' + fmtDate(o.created_at) + '</td>' +
                    '<td>' + statusPill(o.status) + '</td>' +
                    '<td class="num">' + money(o.total_amount) + '</td>' +
                '</tr>';
            }).join('');
        }

        // ===== Widget: Trạng thái đơn (donut) =====
        var _statusChart = null;
        var STATUS_ORDER = ['completed', 'paid', 'shipped', 'pending', 'cancelled'];
        // Sắc độ trung tính (giữ tông luxury Breeze) — không dùng màu rực rỡ.
        var STATUS_COLORS = { completed: '#1C1B19', paid: '#57534E', shipped: '#78716C', pending: '#A8A29E', cancelled: '#D6D3D1' };

        function loadOrderStatus(range) {
            var l = $('status-loading'), e = $('status-empty'), c = $('status-chart'), center = $('status-total'), leg = $('status-legend');
            if (l) l.style.display = '';
            if (e) e.style.display = 'none';
            if (c) c.style.display = 'none';
            if (center) center.style.display = 'none';
            if (leg) leg.innerHTML = '';
            var q = '?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to);
            return api('/api/admin/stats/order-status' + q)
                .then(function (r) { if (!r.ok) throw new Error('order-status ' + r.status); return r.json(); })
                .then(renderOrderStatus)
                .catch(function (err) { console.error('[admin] order-status lỗi:', err); renderOrderStatus([]); });
        }

        function renderOrderStatus(data) {
            var l = $('status-loading'), e = $('status-empty'), c = $('status-chart'), center = $('status-total'), leg = $('status-legend');
            if (l) l.style.display = 'none';
            var arr = data || [];
            var map = {};
            arr.forEach(function (x) { map[x.status] = Number(x.count) || 0; });
            var total = arr.reduce(function (s, x) { return s + (Number(x.count) || 0); }, 0);

            if (total === 0 || typeof Chart === 'undefined') {
                if (e) e.style.display = '';
                if (c) c.style.display = 'none';
                if (center) center.style.display = 'none';
                if (leg) leg.innerHTML = '';
                if (_statusChart) { _statusChart.destroy(); _statusChart = null; }
                return;
            }

            if (e) e.style.display = 'none';
            if (c) c.style.display = '';
            var present = STATUS_ORDER.filter(function (s) { return map[s] > 0; });
            var labels = present.map(function (s) { return statusLabel(s); });
            var counts = present.map(function (s) { return map[s]; });
            var colors = present.map(function (s) { return STATUS_COLORS[s] || '#A8A29E'; });

            if (center) {
                center.style.display = 'flex';
                center.innerHTML = '<span class="donut-total-num">' + total.toLocaleString('vi-VN') + '</span>' +
                    '<span class="donut-total-lbl">' + tr('adm.donutOrders') + '</span>';
            }
            if (leg) {
                leg.innerHTML = present.map(function (s, i) {
                    var pct = Math.round((map[s] / total) * 100);
                    return '<li><span class="dot" style="background:' + colors[i] + '"></span>' +
                        '<span class="lg-name">' + esc(statusLabel(s)) + '</span>' +
                        '<span class="lg-pct">' + pct + '%</span></li>';
                }).join('');
            }

            var uiFont = cssVar('--font-ui') || 'Jost, sans-serif';
            var ink = cssVar('--admin-ink') || '#1C1B19';
            if (_statusChart) {
                _statusChart.data.labels = labels;
                _statusChart.data.datasets[0].data = counts;
                _statusChart.data.datasets[0].backgroundColor = colors;
                _statusChart.update();
                return;
            }
            _statusChart = new Chart($('status-chart').getContext('2d'), {
                type: 'doughnut',
                data: { labels: labels, datasets: [{ data: counts, backgroundColor: colors, borderColor: cssVar('--admin-surface') || '#FCFCFB', borderWidth: 2 }] },
                options: {
                    responsive: true, maintainAspectRatio: false, cutout: '68%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: ink, titleFont: { family: uiFont }, bodyFont: { family: uiFont },
                            callbacks: { label: function (ctx) { return ctx.label + ': ' + ctx.parsed.toLocaleString('vi-VN') + ' ' + tr('adm.donutOrders'); } }
                        }
                    }
                }
            });
        }

        // ===== Widget: Sản phẩm bán chạy =====
        function loadTopProducts(range) {
            var el = $('top-products');
            if (el) el.innerHTML = '<li class="top-state">' + tr('com.loading') + '</li>';
            var q = '?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to) + '&limit=5';
            return api('/api/admin/stats/top-products' + q)
                .then(function (r) { if (!r.ok) throw new Error('top-products ' + r.status); return r.json(); })
                .then(renderTopProducts)
                .catch(function (err) {
                    console.error('[admin] top-products lỗi:', err);
                    if (el) el.innerHTML = '<li class="top-state">' + tr('adm.topErr') + '</li>';
                });
        }

        function renderTopProducts(items) {
            var el = $('top-products');
            if (!el) return;
            var arr = items || [];
            if (!arr.length) {
                el.innerHTML = '<li class="top-state">' + tr('adm.topEmpty') + '</li>';
                return;
            }
            el.innerHTML = arr.map(function (p) {
                var name = esc(p.name || '');
                return '<li>' +
                    '<img src="' + esc(p.imageUrl || 'img/breeze.png') + '" alt="' + name + '" onerror="this.src=\'img/breeze.png\'">' +
                    '<div class="top-main"><div class="top-name">' + name + '</div></div>' +
                    '<div class="top-side">' +
                        '<div class="top-units">' + Number(p.unitsSold || 0).toLocaleString('vi-VN') + ' ' + tr('adm.topSold') + '</div>' +
                        '<div class="top-rev">' + money(p.revenue || 0) + '</div>' +
                    '</div>' +
                '</li>';
            }).join('');
        }

        // --- Users (chỉ xem, phân trang giống orders) ------------------------
        var _userPage = 1;
        function loadUsers(page) {
            _userPage = page || 1;
            $('user-body').innerHTML = skeletonRows(6, 8);
            $('user-pager').innerHTML = '';
            return api('/api/admin/users?page=' + _userPage + '&limit=20')
                .then(function (r) { if (!r.ok) throw new Error('users ' + r.status); return r.json(); })
                .then(renderUsers)
                .catch(function (e) {
                    console.error('[admin] load users lỗi:', e);
                    $('user-body').innerHTML = '<tr><td colspan="6" class="adm-empty">' + tr('adm.errLoadUsers') + '</td></tr>';
                });
        }

        function rolePill(role) {
            var isAdmin = String(role || '').toLowerCase() === 'admin';
            var label = isAdmin ? tr('adm.roleAdmin') : tr('adm.roleCustomer');
            return '<span class="pill role-' + (isAdmin ? 'admin' : 'customer') + '">' + esc(label) + '</span>';
        }

        function renderUsers(data) {
            var users = (data && data.users) || [];
            $('user-count').textContent = '(' + ((data && data.total) || 0) + ')';
            if (!users.length) {
                $('user-body').innerHTML = '<tr><td colspan="6" class="adm-empty">' + tr('adm.emptyUsers') + '</td></tr>';
                $('user-pager').innerHTML = '';
                return;
            }
            $('user-body').innerHTML = users.map(function (u) {
                var isAdmin = String(u.role || '').toLowerCase() === 'admin';
                var blCell;
                if (isAdmin) {
                    blCell = '—'; // không cho blacklist tài khoản admin
                } else if (u.is_blacklisted) {
                    blCell = '<span class="pill off">' + tr('adm.inBlacklist') + '</span>';
                } else {
                    blCell = '<button type="button" class="adm-btn danger small" data-blacklist="' + u.id + '">' + tr('adm.addBlacklist') + '</button>';
                }
                return '<tr>' +
                    '<td>' + esc(u.email || '—') + '</td>' +
                    '<td>' + esc(u.display_name || '—') + '</td>' +
                    '<td>' + rolePill(u.role) + '</td>' +
                    '<td>' + (u.created_at ? fmtDate(u.created_at) : '—') + '</td>' +
                    '<td>' + (u.last_login ? fmtDate(u.last_login) : '—') + '</td>' +
                    '<td>' + blCell + '</td>' +
                '</tr>';
            }).join('');

            $('user-body').querySelectorAll('[data-blacklist]').forEach(function (b) {
                b.addEventListener('click', function () { addToBlacklist(b.getAttribute('data-blacklist'), b); });
            });

            var totalPages = (data && data.total_pages) || 1;
            $('user-pager').innerHTML =
                '<button type="button" id="user-pg-prev"' + (_userPage <= 1 ? ' disabled' : '') + '>' + tr('adm.pgPrev') + '</button>' +
                '<span>' + tr('adm.pgPage') + ' ' + _userPage + ' / ' + totalPages + '</span>' +
                '<button type="button" id="user-pg-next"' + (_userPage >= totalPages ? ' disabled' : '') + '>' + tr('adm.pgNext') + '</button>';
            var prev = $('user-pg-prev'), next = $('user-pg-next');
            if (prev) prev.addEventListener('click', function () { loadUsers(_userPage - 1); });
            if (next) next.addEventListener('click', function () { loadUsers(_userPage + 1); });
        }

        // Thêm THỦ CÔNG 1 user vào danh sách đen (độc lập với huỷ đơn) — ảnh hưởng
        // quyền mua hàng của user nên xác nhận trước.
        function addToBlacklist(userId, btn) {
            if (!window.confirm(tr('adm.confirmBl'))) return;
            btn.disabled = true;
            api('/api/admin/users/' + userId + '/blacklist', { method: 'POST' })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
                .then(function (res) {
                    if (!res.ok) { toast((res.j && res.j.message) || tr('adm.blFail'), true); btn.disabled = false; return; }
                    toast(tr('adm.blOk'));
                    loadUsers(_userPage); // tải lại — dòng này đổi từ nút sang badge
                })
                .catch(function (e) { console.error(e); toast(tr('com.netErr'), true); btn.disabled = false; });
        }

        // --- Danh sách Đen (đơn ĐÃ HUỶ của user đang bị blacklist, theo ĐƠN) --
        var _blacklistPage = 1;
        var _blacklistQuery = '';           // gửi xuống server; lọc TOÀN BỘ, không chỉ 1 trang
        var _blacklistSearchTimer = null;

        function blacklistQuery() {
            var params = ['page=' + _blacklistPage, 'limit=20'];
            if (_blacklistQuery) params.push('q=' + encodeURIComponent(_blacklistQuery));
            return '/api/admin/blacklist?' + params.join('&');
        }

        function loadBlacklist(page) {
            _blacklistPage = page || 1;
            $('blacklist-body').innerHTML = skeletonRows(7, 6);
            $('blacklist-pager').innerHTML = '';
            return api(blacklistQuery())
                .then(function (r) { if (!r.ok) throw new Error('blacklist ' + r.status); return r.json(); })
                .then(renderBlacklist)
                .catch(function (e) {
                    console.error('[admin] load blacklist lỗi:', e);
                    $('blacklist-body').innerHTML = '<tr><td colspan="7" class="adm-empty">' + tr('adm.errLoadBl') + '</td></tr>';
                });
        }

        // Đổi ô search -> nạp lại từ server (về trang 1), debounce để đỡ gọi API mỗi phím.
        function onBlacklistSearchInput() {
            if (_blacklistSearchTimer) clearTimeout(_blacklistSearchTimer);
            _blacklistSearchTimer = setTimeout(function () {
                var el = $('blacklist-search');
                _blacklistQuery = el ? el.value.trim() : '';
                loadBlacklist(1);
            }, 300);
        }

        function renderBlacklist(data) {
            var orders = (data && data.orders) || [];
            $('blacklist-count').textContent = '(' + ((data && data.total) || 0) + ')';
            if (!orders.length) {
                var msg = _blacklistQuery ? tr('adm.emptyOrderSearch') : tr('adm.emptyBl');
                $('blacklist-body').innerHTML = '<tr><td colspan="7" class="adm-empty">' + msg + '</td></tr>';
                $('blacklist-pager').innerHTML = '';
                return;
            }
            $('blacklist-body').innerHTML = orders.map(function (o) {
                var cust = o.user_email || o.user_name || ('user #' + o.user_id);
                // order_id null -> user bị blacklist THỦ CÔNG, chưa từng có đơn huỷ nào.
                var noOrder = o.order_id == null;
                var statusCell = noOrder
                    ? '<span class="pill off">' + tr('adm.noCancelled') + '</span>'
                    : statusPill(o.status);
                return '<tr>' +
                    '<td class="num">' + (noOrder ? '—' : o.order_id) + '</td>' +
                    '<td>' + esc(cust) + '</td>' +
                    '<td>' + (noOrder ? '—' : fmtDate(o.created_at)) + '</td>' +
                    '<td>' + (noOrder ? '—' : esc(paymentLabel(o.payment_method))) + '</td>' +
                    '<td class="num">' + (noOrder ? '—' : money(o.total_amount)) + '</td>' +
                    '<td>' + statusCell + '</td>' +
                    '<td style="white-space:nowrap;">' +
                        '<button type="button" class="adm-btn accent small" data-release="' + o.user_id + '">' + tr('adm.btnRelease') + '</button>' +
                    '</td>' +
                '</tr>';
            }).join('');

            $('blacklist-body').querySelectorAll('[data-release]').forEach(function (b) {
                b.addEventListener('click', function () { releaseUser(b.getAttribute('data-release'), b); });
            });

            var totalPages = (data && data.total_pages) || 1;
            $('blacklist-pager').innerHTML =
                '<button type="button" id="bl-pg-prev"' + (_blacklistPage <= 1 ? ' disabled' : '') + '>' + tr('adm.pgPrev') + '</button>' +
                '<span>' + tr('adm.pgPage') + ' ' + _blacklistPage + ' / ' + totalPages + '</span>' +
                '<button type="button" id="bl-pg-next"' + (_blacklistPage >= totalPages ? ' disabled' : '') + '>' + tr('adm.pgNext') + '</button>';
            var prevBl = $('bl-pg-prev'), nextBl = $('bl-pg-next');
            if (prevBl) prevBl.addEventListener('click', function () { loadBlacklist(_blacklistPage - 1); });
            if (nextBl) nextBl.addEventListener('click', function () { loadBlacklist(_blacklistPage + 1); });
        }

        // Gỡ 1 user khỏi danh sách đen — ảnh hưởng quyền user nên xác nhận trước.
        function releaseUser(userId, btn) {
            if (!window.confirm(tr('adm.confirmRelease'))) return;
            btn.disabled = true;
            api('/api/admin/blacklist/' + userId + '/release', { method: 'POST' })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
                .then(function (res) {
                    if (!res.ok) { toast((res.j && res.j.message) || tr('adm.relFail'), true); btn.disabled = false; return; }
                    toast(tr('adm.relOk'));
                    loadBlacklist(_blacklistPage); // tải lại — mọi dòng của user này biến mất khỏi bảng
                })
                .catch(function (e) { console.error(e); toast(tr('com.netErr'), true); btn.disabled = false; });
        }

        // --- Thống kê sản phẩm bán được --------------------------------------
        // Chỉ gửi KEY preset ('7d'|'30d'|'month'|'year') — server tự tính khoảng ngày
        // theo giờ VN, không nhận from/to từ client. Value của <select> CHÍNH LÀ key nên
        // không cần map thêm. totalRevenue lấy thẳng từ server, KHÔNG tự cộng ở client.
        var _statLoaded = false;   // nạp lần đầu khi mở section; sau đó chỉ nạp lại khi đổi preset

        function statPreset() {
            var sel = $('stat-preset');
            return sel ? sel.value : '7d';
        }

        function loadStatistics() {
            var body = $('stat-body'), foot = $('stat-foot');
            if (!body) return Promise.resolve();
            body.innerHTML = skeletonRows(3, 6);
            if (foot) foot.hidden = true;
            return api('/api/admin/statistics?range=' + encodeURIComponent(statPreset()))
                .then(function (r) { if (!r.ok) throw new Error('statistics ' + r.status); return r.json(); })
                .then(renderStatistics)
                .catch(function (e) {
                    console.error('[admin] load statistics lỗi:', e);
                    body.innerHTML = '<tr><td colspan="3" class="adm-empty">' + tr('adm.errLoadStats') + '</td></tr>';
                    if (foot) foot.hidden = true;
                });
        }

        function renderStatistics(data) {
            var items = (data && data.items) || [];
            var body = $('stat-body'), foot = $('stat-foot'), total = $('stat-total');
            if (!items.length) {
                body.innerHTML = '<tr><td colspan="3" class="adm-empty">' + tr('adm.emptyStats') + '</td></tr>';
                if (foot) foot.hidden = true;
                return;
            }
            body.innerHTML = items.map(function (it) {
                return '<tr>' +
                    '<td>' + esc(it.productName || '—') + '</td>' +
                    '<td class="num">' + Number(it.quantity || 0).toLocaleString('vi-VN') + '</td>' +
                    '<td class="num">' + money(it.revenue) + '</td>' +
                '</tr>';
            }).join('');
            if (total) total.textContent = money((data && data.totalRevenue) || 0);
            if (foot) foot.hidden = false;
        }

        // --- Wire up ---------------------------------------------------------
        document.addEventListener('DOMContentLoaded', function () {
            bindNav();
            var menuBtn = $('adm-menu-btn'); if (menuBtn) menuBtn.addEventListener('click', toggleDrawer);
            var backdrop = $('adm-backdrop'); if (backdrop) backdrop.addEventListener('click', closeDrawer);

            // Dropdown tài khoản: toggle khi bấm icon, đóng khi click ra ngoài / Escape.
            var accBtn = $('adm-account-btn');
            if (accBtn) accBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleAccountMenu(); });
            document.addEventListener('click', function (e) {
                var acc = $('adm-account');
                if (acc && !acc.contains(e.target)) closeAccountMenu();
            });
            document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAccountMenu(); });
            // Nhãn tĩnh do js/i18n.js lo (data-i18n). Ở đây chỉ vẽ lại phần do JS sinh.
            document.addEventListener('langchange', reloadCurrentView);
            $('btn-add-prod').addEventListener('click', function () { openModal(null); });
            bindProductFilters();
            // Dashboard: đổi preset -> nạp lại theo khoảng mới; nút Xuất CSV.
            var dashPreset = $('dash-preset'); if (dashPreset) dashPreset.addEventListener('change', loadDashboard);
            var dashExport = $('dash-export'); if (dashExport) dashExport.addEventListener('click', exportCsv);
            // Link "Xem báo cáo/Xem tất cả" -> chuyển sang view tương ứng (dùng nav sidebar).
            document.querySelectorAll('[data-goto]').forEach(function (el) {
                el.addEventListener('click', function (e) {
                    e.preventDefault();
                    var nav = document.querySelector('.adm-nav-item[data-nav="' + el.getAttribute('data-goto') + '"]');
                    if (nav) nav.click();
                });
            });
            var ordStatus = $('order-status-filter'); if (ordStatus) ordStatus.addEventListener('change', onOrderFilterChange);
            var ordSearch = $('order-search'); if (ordSearch) ordSearch.addEventListener('input', onOrderSearchInput);
            var blSearch = $('blacklist-search'); if (blSearch) blSearch.addEventListener('input', onBlacklistSearchInput);

            // Thống kê: nạp LƯỜI (lần đầu mở section) + nạp lại mỗi khi đổi preset.
            var statNav = document.querySelector('.adm-nav-item[data-nav="statistics"]');
            if (statNav) statNav.addEventListener('click', function () {
                if (_statLoaded) return;
                _statLoaded = true;
                loadStatistics();
            });
            var statPresetSel = $('stat-preset');
            if (statPresetSel) statPresetSel.addEventListener('change', function () {
                _statLoaded = true;
                loadStatistics();
            });

            // Search topbar (toàn layout): Enter -> nhảy sang Đơn hàng và tìm (mã đơn = khớp chính xác).
            var topSearch = $('top-search');
            if (topSearch) topSearch.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                var v = topSearch.value.trim();
                if (!v) return;
                var ordersNav = document.querySelector('.adm-nav-item[data-nav="orders"]');
                if (ordersNav) ordersNav.click();            // chuyển view + đóng drawer
                var stSel = $('order-status-filter'); if (stSel) stSel.value = '';  // bỏ lọc status để đơn tìm thấy luôn hiện
                var os = $('order-search'); if (os) os.value = v;
                readOrderFilters();
                loadOrders(1);
                if (os) os.focus();
            });
            $('btn-cancel').addEventListener('click', closeModal);
            $('prod-form').addEventListener('submit', submitProduct);
            $('prod-modal').addEventListener('click', function (e) { if (e.target === $('prod-modal')) closeModal(); });
            $('btn-logout').addEventListener('click', function () {
                if (window.firebase && firebase.auth) firebase.auth().signOut();
                setTimeout(function () { window.location.href = 'login.html'; }, 200);
            });

            if (window.AuthHelper) window.AuthHelper.onChange(onAuth);
            else showState('state-login');
        });
    })();
