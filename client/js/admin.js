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

        // Ảnh lỗi — thay cho onerror="..." inline trong chuỗi HTML (CSP chặn handler inline).
        // 'error' của <img> không nổi bọt nên bắt ở pha capture.
        //   .adm-thumb (bảng sản phẩm) : ẩn ảnh, giữ chỗ trống như cũ.
        //   #top-products img          : đổi sang ảnh dự phòng, đúng MỘT lần — ảnh dự phòng
        //                                đang thiếu (P-1), không chặn thì lỗi -> đổi -> lỗi lặp.
        var TOP_IMG_FALLBACK = 'img/breeze.png';
        document.addEventListener('error', function (e) {
            var img = e.target;
            if (!img || img.tagName !== 'IMG' || !img.closest) return;
            if (img.classList.contains('adm-thumb')) {
                img.style.visibility = 'hidden';
            } else if (img.closest('#top-products') && img.getAttribute('src') !== TOP_IMG_FALLBACK) {
                img.src = TOP_IMG_FALLBACK;
            }
        }, true);

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
            if (which !== 'panel') { _exportEpoch++; closeDrawer(); closeCustomerDetail(); }
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
            if ($('inventory-modal').classList.contains('open') && _inventoryData) renderInventory(_inventoryData);
            if (_sizesData) renderSizesAdmin(_sizesData);
            if (_customerId) {
                if (_customerData) renderCustomerDetail(_customerData);
                else $('customer-message').textContent = tr(_customerMessageKey);
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
            var thumb = img ? '<img class="adm-thumb" src="' + esc(img) + '" alt="">' : '<span class="adm-thumb"></span>';
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
                    '<button type="button" class="adm-btn ghost small" data-inventory="' + p.id + '">' + tr('adm.inventoryHistory') + '</button>' +
                    (p.size_kind !== 'base-only' || p.size_configured ? '<button type="button" class="adm-btn ghost small" data-sizes="' + p.id + '">' + tr('adm.manageSizes') + '</button>' : '') +
                    '<button type="button" class="adm-btn ghost small" data-colors="' + p.id + '">' + tr('adm.manageColors') + '</button>' +
                    '<button type="button" class="adm-btn danger small" data-del="' + p.id + '">' + tr('com.delete') + '</button>' +
                '</div></td>' +
            '</tr>';
        }

        function attachProdRowHandlers() {
            $('prod-body').querySelectorAll('[data-sizes]').forEach(function (b) {
                b.addEventListener('click', function () { openSizes(_prodCache[b.getAttribute('data-sizes')], b); });
            });
            $('prod-body').querySelectorAll('[data-colors]').forEach(function (b) {
                b.addEventListener('click', function () { openColors(_prodCache[b.getAttribute('data-colors')], b); });
            });
            $('prod-body').querySelectorAll('[data-edit]').forEach(function (b) {
                b.addEventListener('click', function () { openModal(_prodCache[b.getAttribute('data-edit')]); });
            });
            $('prod-body').querySelectorAll('[data-del]').forEach(function (b) {
                b.addEventListener('click', function () { deleteProduct(_prodCache[b.getAttribute('data-del')]); });
            });
            $('prod-body').querySelectorAll('[data-inventory]').forEach(function (b) {
                b.addEventListener('click', function () { openInventory(_prodCache[b.getAttribute('data-inventory')], b); });
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

        // --- Inventory history (admin only) ---------------------------------
        var _inventoryProduct = null, _inventoryData = null, _inventoryPage = 1, _inventoryTrigger = null;
        function openInventory(p, trigger) {
            if (!p) return;
            _inventoryProduct = p;
            _inventoryTrigger = trigger;
            _inventoryData = null;
            $('inventory-modal').classList.add('open');
            loadInventory(1);
            $('inventory-close').focus();
        }
        function closeInventory() {
            $('inventory-modal').classList.remove('open');
            if (_inventoryTrigger && _inventoryTrigger.focus) _inventoryTrigger.focus();
            _inventoryTrigger = null;
            _inventoryProduct = null;
            _inventoryData = null;
        }
        function loadInventory(page) {
            _inventoryPage = page;
            var requestedId = _inventoryProduct.id;
            $('inventory-title').textContent = tr('adm.inventoryTitle', { name: _inventoryProduct.name_vi });
            $('inventory-body').innerHTML = '<tr><td colspan="6" class="adm-loading">' + tr('com.loading') + '</td></tr>';
            $('inventory-pager').innerHTML = '';
            return api('/api/admin/products/' + _inventoryProduct.id + '/inventory-movements?page=' + page + '&limit=20')
                .then(function (r) { if (!r.ok) throw new Error('inventory ' + r.status); return r.json(); })
                .then(function (data) {
                    if (!_inventoryProduct || _inventoryProduct.id !== requestedId || _inventoryPage !== page) return;
                    _inventoryData = data; renderInventory(data);
                })
                .catch(function (e) {
                    if (!_inventoryProduct || _inventoryProduct.id !== requestedId || _inventoryPage !== page) return;
                    console.error('[admin] inventory history lỗi:', e);
                    $('inventory-body').innerHTML = '<tr><td colspan="6" class="adm-empty">' + tr('adm.inventoryError') + '</td></tr>';
                });
        }
        function renderInventory(data) {
            var list = data.movements || [];
            $('inventory-title').textContent = tr('adm.inventoryTitle', { name: _inventoryProduct.name_vi });
            $('inventory-body').innerHTML = list.length ? list.map(function (m) {
                var ref = m.order_reference_id != null ? '#' + (m.order_code == null ? m.order_reference_id : m.order_code) : (m.reason || '—');
                return '<tr><td>' + fmtDate(m.created_at) + '</td>' +
                    '<td>' + esc(tr('adm.inv.' + m.movement_type, null, m.movement_type)) +
                    (m.size ? '<br><small>' + tr('pd.thSize') + ': ' + esc(m.size) + '</small>' : '') +
                    (m.color ? '<br><small>' + tr('co.metaColor') + ': ' + esc(m.color) + '</small>' : '') + '</td>' +
                    '<td class="num">' + (m.quantity_delta > 0 ? '+' : '') + m.quantity_delta + '</td>' +
                    '<td class="num">' + m.stock_before + '</td><td class="num">' + m.stock_after + '</td>' +
                    '<td>' + esc(ref) + '</td></tr>';
            }).join('') : '<tr><td colspan="6" class="adm-empty">' + tr('adm.inventoryEmpty') + '</td></tr>';
            var pages = data.total_pages || 1;
            $('inventory-pager').innerHTML =
                '<button type="button" id="inv-prev"' + (_inventoryPage <= 1 ? ' disabled' : '') + '>' + tr('adm.pgPrev') + '</button>' +
                '<span>' + tr('adm.pgPage') + ' ' + _inventoryPage + ' / ' + pages + '</span>' +
                '<button type="button" id="inv-next"' + (_inventoryPage >= pages ? ' disabled' : '') + '>' + tr('adm.pgNext') + '</button>';
            $('inv-prev').addEventListener('click', function () { loadInventory(_inventoryPage - 1); });
            $('inv-next').addEventListener('click', function () { loadInventory(_inventoryPage + 1); });
        }

        // --- Size management: same modal/table/button styles as product admin.
        var _sizesProduct = null, _sizesData = null, _sizesTrigger = null, _sizesBusy = false;
        function openSizes(p, trigger) {
            if (!p || _sizesBusy) return;
            _sizesProduct = p; _sizesTrigger = trigger; _sizesData = null;
            $('sizes-error').textContent = '';
            $('sizes-body').innerHTML = '';
            $('sizes-summary').textContent = tr('com.loading');
            $('sizes-reason').value = '';
            $('sizes-modal').classList.add('open');
            $('sizes-close').focus();
            loadSizes();
        }
        function closeSizes() {
            if (_sizesBusy) return;
            $('sizes-modal').classList.remove('open');
            if (_sizesTrigger) _sizesTrigger.focus();
            _sizesProduct = null; _sizesData = null;
        }
        function loadSizes() {
            var id = _sizesProduct.id;
            return api('/api/admin/products/' + id + '/sizes')
                .then(function (r) { if (!r.ok) throw new Error(tr('adm.inventoryError')); return r.json(); })
                .then(function (data) { if (_sizesProduct && _sizesProduct.id === id) renderSizesAdmin(data); })
                .catch(function (e) { if (_sizesProduct && _sizesProduct.id === id) $('sizes-error').textContent = e.message; });
        }
        function renderSizesAdmin(data) {
            _sizesData = data;
            var base = data.variants.find(function (v) { return v.is_base; });
            var rows = data.variants.filter(function (v) { return !v.is_base; });
            var missing = data.allowed_sizes.filter(function (s) { return !rows.some(function (v) { return v.size === s; }); });
            $('sizes-title').textContent = tr('adm.manageSizes') + ' — ' + data.product.name_vi;
            $('sizes-summary').textContent = tr('adm.sizeSummary', { total: data.product.stock, base: base ? base.stock : 0 });
            $('sizes-add').innerHTML = missing.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
            $('sizes-create').disabled = $('sizes-create-all').disabled = !missing.length || !data.product.is_active;
            $('sizes-allocate').disabled = !rows.length || !base || base.stock === 0;
            $('sizes-body').innerHTML = rows.map(function (v) {
                return '<tr data-size-row="' + v.id + '"><td>' + esc(v.size) + '</td>' +
                    '<td><input type="number" min="0" max="2147483647" step="1" data-size-stock="' + v.id + '" value="' + v.stock + '" aria-label="' + esc(tr('adm.sizeStock') + ' ' + v.size) + '"></td>' +
                    '<td><input type="checkbox" data-size-active="' + v.id + '"' + (v.is_active ? ' checked' : '') + ' aria-label="' + esc(tr('adm.sizeActive') + ' ' + v.size) + '"></td>' +
                    '<td><input type="number" min="0" step="1" data-size-allocation="' + v.id + '" value="0" aria-label="' + esc(tr('adm.sizeAllocate') + ' ' + v.size) + '"></td>' +
                    '<td><button type="button" class="adm-btn ghost small" data-size-save="' + v.id + '">' + tr('com.save') + '</button></td></tr>';
            }).join('');
        }
        function mutateSizes(suffix, method, body) {
            if (_sizesBusy || !_sizesProduct) return;
            _sizesBusy = true;
            $('sizes-error').textContent = '';
            return api('/api/admin/products/' + _sizesProduct.id + '/' + suffix, { method: method, body: JSON.stringify(body) })
                .then(function (r) { return r.json().then(function (data) { if (!r.ok) throw new Error(data.message || tr('com.netErr')); return data; }); })
                .then(function (data) { renderSizesAdmin(data); loadProducts(); })
                .catch(function (e) { $('sizes-error').textContent = e.message; return loadSizes(); })
                .finally(function () { _sizesBusy = false; });
        }
        function createSizes(all) {
            if (!_sizesData) return;
            var sizes = all ? _sizesData.allowed_sizes.filter(function (s) {
                return !_sizesData.variants.some(function (v) { return v.size === s; });
            }) : [$('sizes-add').value];
            return mutateSizes('sizes', 'POST', { sizes: sizes });
        }
        function allocateSizes() {
            if (!_sizesData || _sizesBusy) return;
            var list = [];
            $('sizes-body').querySelectorAll('[data-size-allocation]').forEach(function (input) {
                var qty = Number(input.value);
                if (qty !== 0) list.push({ variant_id: Number(input.getAttribute('data-size-allocation')), quantity: qty });
            });
            var total = list.reduce(function (sum, x) { return sum + x.quantity; }, 0);
            return confirmDialog(tr('adm.sizeConfirm', { total: total })).then(function (ok) {
                if (ok) return mutateSizes('size-allocation', 'POST', { allocations: list });
            });
        }
        function saveSize(e) {
            var btn = e.target.closest('[data-size-save]');
            if (!btn || !_sizesData) return;
            var id = Number(btn.getAttribute('data-size-save'));
            var v = _sizesData.variants.find(function (x) { return x.id === id; });
            return mutateSizes('sizes/' + id, 'PUT', {
                stock: Number($('sizes-body').querySelector('[data-size-stock="' + id + '"]').value),
                expected_stock: v.stock,
                is_active: $('sizes-body').querySelector('[data-size-active="' + id + '"]').checked,
                reason: $('sizes-reason').value.trim()
            });
        }

        // --- Color management: one modal, same table/buttons/confirmation pattern. ---
        var _colorsProduct = null, _colorsData = null, _colorsTrigger = null, _colorsBusy = false;
        function openColors(p, trigger) {
            if (!p || _colorsBusy) return;
            _colorsProduct = p; _colorsTrigger = trigger; _colorsData = null;
            $('colors-error').textContent = '';
            $('colors-body').innerHTML = '';
            $('colors-summary').textContent = tr('com.loading');
            $('colors-name').value = $('colors-hex').value = $('colors-reason').value = '';
            $('colors-modal').classList.add('open');
            $('colors-close').focus();
            loadColors();
        }
        function closeColors() {
            if (_colorsBusy) return;
            $('colors-modal').classList.remove('open');
            if (_colorsTrigger) _colorsTrigger.focus();
            _colorsProduct = _colorsData = null;
        }
        function loadColors() {
            var id = _colorsProduct.id;
            return api('/api/admin/products/' + id + '/colors')
                .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.message); return d; }); })
                .then(function (d) { if (_colorsProduct && _colorsProduct.id === id) renderColorsAdmin(d); })
                .catch(function (e) { $('colors-error').textContent = e.message || tr('com.netErr'); });
        }
        function renderColorsAdmin(data) {
            _colorsData = data;
            $('colors-title').textContent = tr('adm.manageColors') + ' — ' + data.product.name_vi;
            $('colors-summary').textContent = tr('adm.colorSummary', { total: data.product.stock,
                source: data.variants.filter(function (v) { return v.color == null; }).reduce(function (s, v) { return s + v.stock; }, 0) });
            var missing = data.allowed_sizes.filter(function (s) { return !data.variants.some(function (v) { return v.size === s; }); });
            $('colors-size-row').hidden = !data.colors.length || !missing.length;
            $('colors-size').innerHTML = missing.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
            $('colors-allocate').disabled = !data.colors.length;
            $('colors-body').innerHTML = data.colors.length ? data.colors.map(function (c) {
                var rows = c.variants.map(function (v) {
                    var source = data.variants.find(function (x) { return x.color == null &&
                        (v.size == null ? x.is_base : x.size === v.size); });
                    return '<tr><td>' + esc(v.size || '—') + '</td><td>' + esc(v.sku) + '</td>' +
                        '<td><input type="number" min="0" step="1" data-color-stock="' + v.id + '" value="' + v.stock + '"></td>' +
                        '<td><input type="checkbox" data-color-variant-active="' + v.id + '"' + (v.is_active ? ' checked' : '') + '></td>' +
                        '<td>' + (source ? source.stock : '—') + '</td>' +
                        '<td><input type="number" min="0" step="1" data-color-allocation="' + v.id + '" value="0"' + (source && source.stock ? '' : ' disabled') + '></td>' +
                        '<td><button type="button" class="adm-btn ghost small" data-color-variant-save="' + v.id + '">' + tr('com.save') + '</button></td></tr>';
                }).join('');
                var images = c.images.map(function (im) {
                    return '<div class="adm-color-head" data-color-image="' + im.id + '">' +
                        '<img src="' + esc(im.image_path) + '" alt="">' +
                        '<span>' + esc(im.image_path) + '</span>' +
                        '<input type="number" min="0" step="1" data-image-order="' + im.id + '" value="' + im.sort_order + '" aria-label="' + tr('adm.imageOrder') + '">' +
                        '<label><input type="radio" name="primary-' + c.id + '" data-image-primary="' + im.id + '"' + (im.is_primary ? ' checked' : '') + '> ' + tr('adm.primaryImage') + '</label>' +
                        '<button type="button" class="adm-btn ghost small" data-image-save="' + im.id + '" data-color-id="' + c.id + '">' + tr('com.save') + '</button>' +
                        '<button type="button" class="adm-btn ghost small" data-image-delete="' + im.id + '" data-color-id="' + c.id + '">' + tr('com.delete') + '</button></div>';
                }).join('');
                return '<section class="adm-color-card" data-color-card="' + c.id + '">' +
                    '<div class="adm-color-head"><input type="text" maxlength="80" data-color-label="' + c.id + '" value="' + esc(c.label) + '">' +
                    '<input type="text" maxlength="7" class="adm-color-hex" data-color-hex="' + c.id + '" value="' + esc(c.swatch_hex || '') + '" placeholder="#000000">' +
                    '<label><input type="checkbox" data-color-active="' + c.id + '"' + (c.is_active ? ' checked' : '') + '> ' + tr('adm.sizeActive') + '</label>' +
                    '<button type="button" class="adm-btn ghost small" data-color-save="' + c.id + '">' + tr('com.save') + '</button></div>' +
                    '<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>' + tr('pd.thSize') + '</th><th>SKU</th><th>' + tr('adm.sizeStock') +
                    '</th><th>' + tr('adm.sizeActive') + '</th><th>' + tr('adm.colorSource') + '</th><th>' + tr('adm.sizeAllocate') + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
                    '<div class="adm-color-images"><strong>' + tr('adm.colorImages') + '</strong>' +
                    (images || '<p class="hint">' + tr('adm.noColorImages') + '</p>') +
                    '<div class="adm-color-head"><input type="text" data-image-path="' + c.id + '" placeholder="img/products/' + esc(data.product.slug) + '/' + esc(c.color_key) + '-01.webp">' +
                    '<button type="button" class="adm-btn ghost small" data-image-add="' + c.id + '">' + tr('adm.addImage') + '</button></div></div></section>';
            }).join('') : '<p class="hint">' + tr('adm.noColors') + '</p>';
        }
        function mutateColors(suffix, method, body) {
            if (!_colorsProduct || _colorsBusy) return;
            _colorsBusy = true; $('colors-error').textContent = '';
            return api('/api/admin/products/' + _colorsProduct.id + '/' + suffix,
                { method: method, body: JSON.stringify(body || {}) })
                .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.message); return d; }); })
                .then(function (d) { renderColorsAdmin(d); loadProducts(); })
                .catch(function (e) { $('colors-error').textContent = e.message || tr('com.netErr'); return loadColors(); })
                .finally(function () { _colorsBusy = false; });
        }
        function colorBodyClick(e) {
            if (!_colorsData || _colorsBusy) return;
            var b = e.target.closest('button'); if (!b) return;
            var id = Number(b.getAttribute('data-color-save'));
            if (id) return mutateColors('colors/' + id, 'PUT', {
                label: $('colors-body').querySelector('[data-color-label="' + id + '"]').value,
                swatch_hex: $('colors-body').querySelector('[data-color-hex="' + id + '"]').value,
                is_active: $('colors-body').querySelector('[data-color-active="' + id + '"]').checked });
            id = Number(b.getAttribute('data-color-variant-save'));
            if (id) {
                var v = _colorsData.variants.find(function (x) { return x.id === id; });
                return mutateColors('color-variants/' + id, 'PUT', {
                    stock: Number($('colors-body').querySelector('[data-color-stock="' + id + '"]').value),
                    expected_stock: v.stock,
                    is_active: $('colors-body').querySelector('[data-color-variant-active="' + id + '"]').checked,
                    reason: $('colors-reason').value.trim() });
            }
            id = Number(b.getAttribute('data-image-add'));
            if (id) return mutateColors('colors/' + id + '/images', 'POST', {
                image_path: $('colors-body').querySelector('[data-image-path="' + id + '"]').value.trim() });
            id = Number(b.getAttribute('data-image-save'));
            if (id) return mutateColors('colors/' + b.getAttribute('data-color-id') + '/images/' + id, 'PUT', {
                sort_order: Number($('colors-body').querySelector('[data-image-order="' + id + '"]').value),
                is_primary: $('colors-body').querySelector('[data-image-primary="' + id + '"]').checked });
            id = Number(b.getAttribute('data-image-delete'));
            if (id) return confirmDialog(tr('adm.removeImageConfirm')).then(function (ok) {
                if (ok) return mutateColors('colors/' + b.getAttribute('data-color-id') + '/images/' + id, 'DELETE');
            });
        }
        function allocateColors() {
            if (!_colorsData || _colorsBusy) return;
            var list = [];
            $('colors-body').querySelectorAll('[data-color-allocation]').forEach(function (input) {
                var quantity = Number(input.value), id = Number(input.getAttribute('data-color-allocation'));
                if (!quantity) return;
                var target = _colorsData.variants.find(function (v) { return v.id === id; });
                var source = _colorsData.variants.find(function (v) { return v.color == null &&
                    (target.size == null ? v.is_base : v.size === target.size); });
                if (source) list.push({ source_variant_id: source.id, target_variant_id: id, quantity: quantity,
                    expected_source_stock: source.stock, expected_target_stock: target.stock });
            });
            var total = list.reduce(function (n, x) { return n + x.quantity; }, 0);
            if (!total) return;
            return confirmDialog(tr('adm.colorConfirm', { total: total })).then(function (ok) {
                if (ok) return mutateColors('color-allocation', 'POST', { allocations: list });
            });
        }

        // --- Product modal ---------------------------------------------------
        function openModal(p) {
            $('modal-err').style.display = 'none';
            $('f-stock').readOnly = !!(p && (p.size_configured || p.color_configured));
            $('size-stock-hint').hidden = !(p && (p.size_configured || p.color_configured));
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
                $('stock-reason-field').hidden = !!(p.size_configured || p.color_configured);
            } else {
                $('modal-title').textContent = tr('adm.modalAdd');
                $('prod-form').reset();
                $('f-id').value = '';
                $('f-stock').value = '0';
                $('f-active').checked = true;
                $('stock-reason-field').hidden = true;
            }
            $('f-stock-reason').value = '';
            $('f-stock-reason').required = false;
            $('prod-modal').classList.add('open');
        }
        function closeModal() { $('prod-modal').classList.remove('open'); }

        // --- Confirm modal dùng chung (thay window.confirm) -------------------
        var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
        var _confirmTrigger = null;   // phần tử đã mở modal, để trả focus về khi đóng
        var _confirmResolve = null;   // resolve() của Promise confirmDialog() đang chờ

        // resolve(true) khi bấm Xác nhận; resolve(false) khi Huỷ / Esc / click ra backdrop.
        // opts.danger: true -> nút Xác nhận đổi sang biến thể đỏ (adm-btn danger).
        function confirmDialog(message, opts) {
            return new Promise(function (resolve) {
                _confirmResolve = resolve;
                _confirmTrigger = document.activeElement;
                // textContent, không innerHTML: message có nội suy tên sản phẩm từ dữ liệu (adm.confirmDelProd).
                $('confirm-message').textContent = message;
                $('confirm-ok').classList.toggle('danger', !!(opts && opts.danger));
                $('confirm-modal').classList.add('open');
                setTimeout(function () { var b = $('confirm-cancel'); if (b) b.focus(); }, 0);
            });
        }

        function closeConfirm(result) {
            $('confirm-modal').classList.remove('open');
            if (_confirmTrigger && _confirmTrigger.focus) { try { _confirmTrigger.focus(); } catch (e) { /* bỏ qua */ } }
            _confirmTrigger = null;
            var resolve = _confirmResolve;
            _confirmResolve = null;
            if (resolve) resolve(result);
        }

        // Focus trap + ESC — cùng pattern onModalKeydown đã dùng ở modal địa chỉ
        // (change-password.js / payment-methods.js). Gắn trên chính #confirm-modal
        // (không phải document) nên chỉ nổ khi phần tử đang focus nằm trong modal.
        function onConfirmKeydown(e) {
            if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); closeConfirm(false); return; }
            if (e.key !== 'Tab' && e.keyCode !== 9) return;
            var modal = $('confirm-modal');
            var nodes = modal.querySelectorAll(FOCUSABLE);
            var list = [];
            for (var i = 0; i < nodes.length; i++) {
                if (nodes[i].offsetWidth > 0 || nodes[i].offsetHeight > 0 || nodes[i] === document.activeElement) list.push(nodes[i]);
            }
            if (!list.length) return;
            var first = list[0], last = list[list.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }

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
            if (isEdit && _prodCache[id] && (_prodCache[id].size_configured || _prodCache[id].color_configured)) delete body.stock;
            if (isEdit) body.stock_reason = $('f-stock-reason').value.trim();
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
            confirmDialog(tr('adm.confirmDelProd', { name: p.name_vi }), { danger: true }).then(function (ok) {
                if (!ok) return;
                api('/api/admin/products/' + p.id, { method: 'DELETE' })
                    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
                    .then(function (res) {
                        if (!res.ok) { toast((res.j && res.j.message) || tr('adm.delFail'), true); return; }
                        toast(res.j.mode === 'soft' ? tr('adm.softDeleted') : tr('adm.prodDeleted'));
                        loadProducts();
                    })
                    .catch(function (e) { console.error(e); toast(tr('com.netErr'), true); });
            });
        }

        // --- Orders ----------------------------------------------------------
        var _orderPage = 1;
        var _orderFilters = { status: '', q: '' };  // gửi xuống server; lọc TOÀN BỘ đơn, không chỉ 1 trang
        var _orderSearchTimer = null;
        var _orderRequest = 0;

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

        function loadOrders(page, revealId, exactId) {
            var request = ++_orderRequest;
            _orderPage = page || 1;
            $('order-body').innerHTML = skeletonRows(7, 8);
            $('order-pager').innerHTML = '';
            return api(exactId ? '/api/admin/orders?order_id=' + encodeURIComponent(revealId) + '&limit=1' : orderQuery())
                .then(function (r) { if (!r.ok) throw new Error('orders ' + r.status); return r.json(); })
                .then(function (data) {
                    if (request !== _orderRequest) return;
                    renderOrders(data);
                    if (revealId) {
                        var row = $('oi-' + revealId);
                        var toggle = $('order-body').querySelector('[data-toggle="' + revealId + '"]');
                        if (row) row.style.display = 'table-row';
                        if (toggle) toggle.focus();
                    }
                })
                .catch(function (e) {
                    if (request !== _orderRequest) return;
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
        function statusOptions(current, next) {
            return [current].concat(Array.isArray(next) ? next : []).map(function (s) {
                return '<option value="' + esc(s) + '"' + (s === current ? ' selected' : '') + '>' + esc(statusLabel(s)) + '</option>';
            }).join('');
        }
        function orderRowHTML(o) {
            var next = Array.isArray(o.allowed_next_statuses) ? o.allowed_next_statuses : [];
            var opts = statusOptions(o.status, next);
            var itemRows = (o.items || []).map(function (it) {
                return '<tr><td class="inner">' + esc(it.product_name) +
                    (it.size_snapshot ? '<br><small>' + tr('pd.thSize') + ': ' + esc(it.size_snapshot) + '</small>' : '') +
                    (it.color_snapshot ? '<br><small>' + tr('co.metaColor') + ': ' + esc(it.color_snapshot) + '</small>' : '') + '</td>' +
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
            var cancelLine = o.cancel_reason
                ? '<p class="oi-voucher">' + tr('adm.cancelReason') + ': ' + esc(o.cancel_reason) + '</p>'
                : '';
            // Đơn không có/không nhận diện được hình thức thanh toán -> "—" (không để trống vỡ bảng).
            // Tên biến KHÁC tên hàm paymentLabel() — trùng tên thì `var` hoisted sẽ che
            // mất hàm ngay trong scope này và ném TypeError, làm rỗng cả bảng đơn hàng.
            var payLabel = esc(paymentLabel(o.payment_method));
            var invoiceBtn = '<button type="button" class="adm-btn ghost small" data-invoice="' + o.id + '">' + tr('adm.btnInvoice') + '</button> ';
            return '<tr>' +
                    '<td class="num">' + esc(window.BreezeOrderShipping.code(o)) + '</td>' +
                    '<td>' + esc(cust) + '</td>' +
                    '<td>' + fmtDate(o.created_at) + '</td>' +
                    '<td>' + payLabel + '</td>' +
                    '<td class="num">' + money(o.total_amount) + '</td>' +
                    '<td><select class="status-sel" data-order="' + o.id + '" data-order-code="' + esc(window.BreezeOrderShipping.code(o)) + '" data-current="' + esc(o.status) + '"' +
                        (next.length ? '' : ' disabled') + '>' + opts + '</select></td>' +
                    '<td style="white-space:nowrap;">' +
                        '<button type="button" class="adm-btn ghost small" data-toggle="' + o.id + '">' + tr('adm.btnDetail') + '</button> ' +
                        invoiceBtn +
                        '<button type="button" class="adm-btn danger small" data-del-order="' + o.id + '" data-order-code="' + esc(window.BreezeOrderShipping.code(o)) + '">' + tr('com.delete') + '</button>' +
                    '</td>' +
                '</tr>' +
                '<tr class="oi-detail" id="oi-' + o.id + '" style="display:none;"><td colspan="7">' +
                    '<table><thead><tr><th>' + tr('adm.thProdName') + '</th><th>' + tr('adm.thUnitPrice') + '</th><th>' + tr('adm.thQtyShort') + '</th><th>' + tr('adm.thLineTotal') + '</th></tr></thead>' +
                    '<tbody>' + (itemRows || '<tr><td class="inner" colspan="4">' + tr('adm.noLines') + '</td></tr>') + '</tbody></table>' +
                    window.BreezeOrderShipping.details(o) + shippingControls(o) +
                    window.BreezeOrderPayment.details(o, false) +
                    voucherLine +
                    cancelLine +
                '</td></tr>';
        }

        function shippingControls(o) {
            if (o.shipping_version !== 2) return '';
            var next = o.allowed_shipping_statuses || [];
            return '<label class="adm-shipping-control">' + esc(tr('ship.update')) +
                ' <select data-shipping-order="' + o.id + '"' + (next.length ? '' : ' disabled') + '>' +
                [o.shipping_status].concat(next).map(function (s) {
                    return '<option value="' + esc(s) + '">' + esc(tr('ship.status.' + s)) + '</option>';
                }).join('') + '</select></label>';
        }

        function attachOrderRowHandlers() {
            $('order-body').querySelectorAll('[data-shipping-order]').forEach(function (sel) {
                sel.addEventListener('change', function () {
                    var id = sel.getAttribute('data-shipping-order');
                    sel.disabled = true;
                    api('/api/admin/orders/' + id + '/shipping-status', { method: 'PATCH', body: JSON.stringify({ shipping_status: sel.value }) })
                        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || tr('adm.updFail')); }); })
                        .catch(function (e) { toast(e.message || tr('com.netErr'), true); })
                        .then(function () { loadOrders(_orderPage, id); });
                });
            });
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
                    window.open(window.BreezeRoutes.to('invoice', { orderId: b.getAttribute('data-invoice') }), '_blank');
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
            confirmDialog(tr('adm.confirmDelOrder'), { danger: true }).then(function (ok) {
                if (!ok) return;
                btn.disabled = true;
                api('/api/admin/orders/' + orderId, { method: 'DELETE' })
                    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
                    .then(function (res) {
                        if (!res.ok) { toast((res.j && res.j.message) || tr('adm.delOrderFail'), true); btn.disabled = false; return; }
                        toast(tr('adm.orderDeleted', { id: btn.getAttribute('data-order-code') || orderId }));
                        loadOrders(_orderPage); // tải lại trang hiện tại
                    })
                    .catch(function (e) { console.error(e); toast(tr('com.netErr'), true); btn.disabled = false; });
            });
        }

        function changeStatus(orderId, status, sel) {
            var prev = sel.getAttribute('data-current') || '';
            var canChange = true;
            sel.disabled = true;
            api('/api/admin/orders/' + orderId + '/status', { method: 'PUT', body: JSON.stringify({ status: status }) })
                .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
                .then(function (res) {
                    if (!res.ok) {
                        toast((res.j && res.j.message) || tr('adm.updFail'), true);
                        if (prev) sel.value = prev;
                        if (res.status === 409) loadOrders(_orderPage);
                        return;
                    }
                    var order = res.j && res.j.order;
                    var next = order && order.allowed_next_statuses;
                    sel.innerHTML = statusOptions(status, next);
                    sel.setAttribute('data-current', status);
                    canChange = Array.isArray(next) && next.length > 0;
                    toast(tr('adm.statusUpdated', { id: sel.getAttribute('data-order-code') || orderId }));
                    loadOrders(_orderPage, orderId);
                })
                .catch(function (e) { console.error(e); toast(tr('com.netErr'), true); if (prev) sel.value = prev; })
                .then(function () { sel.disabled = !canChange; });
        }

        // --- Dashboard -------------------------------------------------------
        // ===== Dashboard — KPI cards + chart, filter theo khoảng ngày =====
        var _dashRange = null;   // {from, to} đang xem
        var _exporting = false, _exportEpoch = 0;
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
                .then(function (data) { if (range === _dashRange) renderStats(data); })
                .catch(function (e) {
                    console.error('[admin] load stats lỗi:', e);
                    if (range !== _dashRange) return;
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

            renderRevenueChart(s.dailyRevenue || []);
        }

        // Fetch an authorized report for the selected Dashboard range. No stale cached CSV.
        async function exportCsv() {
            if (_exporting || !_dashRange || !document.body.classList.contains('adm-authed')) return;
            var range = { from: _dashRange.from, to: _dashRange.to }, epoch = _exportEpoch;
            var button = $('dash-export'), label = button && button.querySelector('[data-i18n]');
            _exporting = true;
            if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
            if (label) label.textContent = tr('report.exporting');
            var url = null;
            try {
                var response = await api('/api/admin/stats/business-report?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to));
                if (!response.ok) throw new Error('report');
                var data = await response.json();
                if (epoch !== _exportEpoch || !document.body.classList.contains('adm-authed')) return;
                if (!_dashRange || range.from !== _dashRange.from || range.to !== _dashRange.to) {
                    toast(tr('report.rangeChanged'), true); return;
                }
                if (!data.range || data.range.from !== range.from || data.range.to !== range.to) throw new Error('report range');
                var csv = window.BreezeBusinessCsv.create(data, tr);
                url = URL.createObjectURL(new Blob([csv.content], { type: 'text/csv;charset=utf-8;' }));
                var link = document.createElement('a');
                link.href = url; link.download = csv.filename;
                document.body.appendChild(link);
                try { link.click(); } finally { document.body.removeChild(link); }
            } catch (_) {
                if (epoch === _exportEpoch && document.body.classList.contains('adm-authed')) toast(tr('report.error'), true);
            } finally {
                if (url) setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
                _exporting = false;
                if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
                if (label) label.textContent = tr('adm.exportCsv');
            }
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
                    '<td class="num">' + esc(window.BreezeOrderShipping.code(o)) + '</td>' +
                    '<td>' + esc(cust) + '</td>' +
                    '<td>' + fmtDate(o.created_at) + '</td>' +
                    '<td>' + statusPill(o.status) + '</td>' +
                    '<td class="num">' + money(o.total_amount) + '</td>' +
                '</tr>';
            }).join('');
        }

        // ===== Widget: Trạng thái đơn (donut) =====
        var _statusChart = null;
        var STATUS_ORDER = ['completed', 'shipping', 'processing', 'confirmed', 'pending', 'cancelled', 'paid', 'shipped'];
        // Sắc độ trung tính (giữ tông luxury Breeze) — không dùng màu rực rỡ.
        var STATUS_COLORS = { completed: '#1C1B19', shipping: '#78716C', processing: '#57534E', confirmed: '#8A8178', pending: '#A8A29E', cancelled: '#D6D3D1', paid: '#57534E', shipped: '#78716C' };

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
                    '<img src="' + esc(p.imageUrl || TOP_IMG_FALLBACK) + '" alt="' + name + '">' +
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
            $('user-body').innerHTML = skeletonRows(7, 8);
            $('user-pager').innerHTML = '';
            return api('/api/admin/users?page=' + _userPage + '&limit=20')
                .then(function (r) { if (!r.ok) throw new Error('users ' + r.status); return r.json(); })
                .then(renderUsers)
                .catch(function (e) {
                    console.error('[admin] load users lỗi:', e);
                    $('user-body').innerHTML = '<tr><td colspan="7" class="adm-empty">' + tr('adm.errLoadUsers') + '</td></tr>';
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
                $('user-body').innerHTML = '<tr><td colspan="7" class="adm-empty">' + tr('adm.emptyUsers') + '</td></tr>';
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
                    '<td><button type="button" class="adm-btn ghost small" data-customer-detail="' + u.id + '">' + tr('adm.btnDetail') + '</button></td>' +
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

        // --- Customer Detail: read-only, independent from user-list pagination. ---
        var _customerId = null, _customerPage = 1, _customerData = null;
        var _customerRequest = 0, _customerTrigger = null, _customerMessageKey = 'com.loading';

        function openCustomerDetail(userId, trigger) {
            _customerTrigger = trigger;
            _customerId = userId;
            $('customer-modal').classList.add('open');
            document.body.classList.add('customer-detail-open');
            $('customer-close').focus();
            return loadCustomerDetail(1);
        }

        function closeCustomerDetail() {
            if (!_customerId) return;
            // Switching language reloads the user table and can replace the opener.
            var trigger = _customerTrigger;
            if (trigger && trigger.isConnected === false) {
                trigger = $('user-body').querySelector('[data-customer-detail="' + _customerId + '"]') ||
                    document.querySelector('.adm-nav-item[data-nav="users"]');
            }
            ++_customerRequest; // A response arriving after close must not restore private data.
            _customerId = null;
            _customerData = null;
            $('customer-modal').classList.remove('open');
            document.body.classList.remove('customer-detail-open');
            $('customer-content').hidden = true;
            $('customer-info').innerHTML = '';
            $('customer-orders').innerHTML = '';
            if (trigger) trigger.focus();
            _customerTrigger = null;
        }

        function loadCustomerDetail(page) {
            if (!_customerId) return;
            var request = ++_customerRequest;
            _customerPage = page;
            _customerData = null;
            _customerMessageKey = 'com.loading';
            $('customer-close').focus();
            $('customer-content').hidden = true;
            $('customer-retry').hidden = true;
            $('customer-message').hidden = false;
            $('customer-message').classList.remove('customer-error');
            $('customer-message').textContent = tr(_customerMessageKey);
            $('customer-modal').setAttribute('aria-busy', 'true');
            return api('/api/admin/users/' + encodeURIComponent(_customerId) + '/detail?page=' + page + '&limit=10')
                .then(function (r) {
                    if (!r.ok) { var error = new Error('customer detail'); error.status = r.status; throw error; }
                    return r.json();
                })
                .then(function (data) {
                    if (request !== _customerRequest) return;
                    _customerData = data;
                    _customerPage = data.page;
                    renderCustomerDetail(data);
                    $('customer-modal').setAttribute('aria-busy', 'false');
                })
                .catch(function (error) {
                    if (request !== _customerRequest) return;
                    _customerMessageKey = error.status === 404 ? 'adm.customerNotFound' : 'adm.customerLoadError';
                    $('customer-message').textContent = tr(_customerMessageKey);
                    $('customer-message').classList.add('customer-error');
                    $('customer-retry').hidden = error.status === 404;
                    $('customer-modal').setAttribute('aria-busy', 'false');
                });
        }

        function renderCustomerDetail(data) {
            var u = data.user, stats = data.statistics;
            var dob = u.dob ? new Date(u.dob).toLocaleDateString(lang() === 'en' ? 'en-GB' : 'vi-VN', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
            var fields = [
                ['adm.customerId', u.id], ['pf.fullname', u.display_name], ['adm.thEmail', u.email],
                ['pf.phone', u.phone], ['pf.dob', dob],
                ['pf.gender', u.gender === 'male' ? tr('pf.genderMale') : u.gender === 'female' ? tr('pf.genderFemale') : '—'],
                ['pf.country', u.country ? tr('pf.c' + u.country, null, u.country) : '—'],
                ['adm.thRole', u.role === 'admin' ? tr('adm.roleAdmin') : tr('adm.roleCustomer')],
                ['pf.createdAt', u.created_at ? fmtDate(u.created_at) : '—'],
                ['pf.lastLogin', u.last_login ? fmtDate(u.last_login) : '—'],
                ['adm.customerStatus', tr(u.is_blacklisted ? 'adm.inBlacklist' : 'adm.customerActive')]
            ];
            $('customer-info').innerHTML = fields.map(function (field) {
                return '<div><dt>' + esc(tr(field[0])) + '</dt><dd>' + esc(field[1] == null || field[1] === '' ? '—' : field[1]) + '</dd></div>';
            }).join('');
            $('customer-total-orders').textContent = stats.total_orders;
            $('customer-completed').textContent = stats.completed_orders;
            $('customer-cancelled').textContent = stats.cancelled_orders;
            $('customer-spent').textContent = money(stats.total_spent);
            $('customer-orders').innerHTML = data.orders.length ? data.orders.map(function (o) {
                return '<tr><td class="num">#' + esc(window.BreezeOrderShipping.code(o)) + '</td><td>' + esc(fmtDate(o.created_at)) + '</td>' +
                    '<td class="num">' + money(o.total_amount) + '</td><td>' + esc(paymentLabel(o.payment_method)) + '</td>' +
                    '<td>' + esc(statusLabel(o.status)) + '</td><td><button type="button" class="adm-btn ghost small" data-customer-order="' + o.id + '">' +
                    tr('adm.customerViewOrder') + '</button></td></tr>';
            }).join('') : '<tr><td colspan="6" class="adm-empty">' + tr('adm.customerEmptyOrders') + '</td></tr>';
            $('customer-page').textContent = tr('adm.pgPage') + ' ' + data.page + ' / ' + (data.total_pages || 1);
            $('customer-prev').disabled = data.page <= 1;
            $('customer-next').disabled = data.page >= data.total_pages;
            $('customer-pager').hidden = data.total === 0;
            $('customer-message').hidden = true;
            $('customer-content').hidden = false;
        }

        function viewCustomerOrder(orderId) {
            if (!_customerData || !_customerData.orders.some(function (o) { return String(o.id) === orderId; })) return;
            var displayCode = window.BreezeOrderShipping.code(_customerData.orders.find(function (o) { return String(o.id) === orderId; }));
            closeCustomerDetail();
            var nav = document.querySelector('.adm-nav-item[data-nav="orders"]');
            if (nav) nav.click();
            if (_orderSearchTimer) clearTimeout(_orderSearchTimer);
            $('order-status-filter').value = '';
            $('order-search').value = String(displayCode);
            readOrderFilters();
            return loadOrders(1, orderId, true);
        }

        function onCustomerKeydown(e) {
            if (e.key === 'Escape') { e.preventDefault(); closeCustomerDetail(); return; }
            if (e.key !== 'Tab') return;
            var nodes = Array.prototype.filter.call($('customer-modal').querySelectorAll(FOCUSABLE), function (el) {
                return !el.hidden && !el.closest('[hidden]');
            });
            var first = nodes[0], last = nodes[nodes.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }

        // Thêm THỦ CÔNG 1 user vào danh sách đen (độc lập với huỷ đơn) — ảnh hưởng
        // quyền mua hàng của user nên xác nhận trước.
        function addToBlacklist(userId, btn) {
            confirmDialog(tr('adm.confirmBl')).then(function (ok) {
                if (!ok) return;
                btn.disabled = true;
                api('/api/admin/users/' + userId + '/blacklist', { method: 'POST' })
                    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
                    .then(function (res) {
                        if (!res.ok) { toast((res.j && res.j.message) || tr('adm.blFail'), true); btn.disabled = false; return; }
                        toast(tr('adm.blOk'));
                        loadUsers(_userPage); // tải lại — dòng này đổi từ nút sang badge
                    })
                    .catch(function (e) { console.error(e); toast(tr('com.netErr'), true); btn.disabled = false; });
            });
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
                    '<td class="num">' + (noOrder ? '—' : esc(o.order_code == null ? o.order_id : o.order_code)) + '</td>' +
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
            confirmDialog(tr('adm.confirmRelease')).then(function (ok) {
                if (!ok) return;
                btn.disabled = true;
                api('/api/admin/blacklist/' + userId + '/release', { method: 'POST' })
                    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
                    .then(function (res) {
                        if (!res.ok) { toast((res.j && res.j.message) || tr('adm.relFail'), true); btn.disabled = false; return; }
                        toast(tr('adm.relOk'));
                        loadBlacklist(_blacklistPage); // tải lại — mọi dòng của user này biến mất khỏi bảng
                    })
                    .catch(function (e) { console.error(e); toast(tr('com.netErr'), true); btn.disabled = false; });
            });
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

            // --- Phím tắt Ctrl/⌘ + K: nhảy vào ô search; Esc: thoát focus ---------
            // navigator.platform đã deprecated -> đọc userAgent. iPadOS 13+ cũng khai
            // 'Macintosh', nhưng bàn phím rời của iPad cũng dùng ⌘ nên hiện ⌘ vẫn đúng.
            var kbdHint = $('search-kbd');
            if (kbdHint) kbdHint.style.display = 'none';

            // Chỉ cướp phím khi đã qua gate admin (#bar-right hiện). Ở state-login /
            // state-forbidden thì KHÔNG preventDefault, để Ctrl+K vẫn là phím tắt mặc
            // định của trình duyệt.
            function searchShortcutReady() {
                var bar = $('bar-right');
                return !!bar && window.getComputedStyle(bar).visibility === 'visible';
            }

            document.addEventListener('keydown', function (e) {
                // Chỉ khớp 'k' thường: Ctrl+Shift+K là devtools của Chrome/Firefox, không đụng.
                if (e.key !== 'k' || !(e.metaKey || e.ctrlKey)) return;
                if (!searchShortcutReady()) return;
                var el = $('top-search');
                if (!el) return;
                e.preventDefault();
                el.focus();
                el.select();
            });

            if (topSearch) topSearch.addEventListener('keydown', function (e) {
                if (e.key !== 'Escape') return;
                // <input type="search"> mặc định XOÁ sạch nội dung khi bấm Esc. Chặn lại:
                // Esc ở đây chỉ để thoát focus, chữ đã gõ giữ nguyên (Ctrl+K rồi Enter
                // vẫn tìm được như cũ).
                e.preventDefault();
                topSearch.blur();
            });
            $('btn-cancel').addEventListener('click', closeModal);
            $('user-body').addEventListener('click', function (e) {
                var button = e.target.closest('[data-customer-detail]');
                if (button) openCustomerDetail(button.getAttribute('data-customer-detail'), button);
            });
            $('customer-close').addEventListener('click', closeCustomerDetail);
            $('customer-retry').addEventListener('click', function () { loadCustomerDetail(_customerPage); });
            $('customer-prev').addEventListener('click', function () { if (_customerData && _customerPage > 1) loadCustomerDetail(_customerPage - 1); });
            $('customer-next').addEventListener('click', function () { if (_customerData && _customerPage < _customerData.total_pages) loadCustomerDetail(_customerPage + 1); });
            $('customer-orders').addEventListener('click', function (e) {
                var button = e.target.closest('[data-customer-order]');
                if (button) viewCustomerOrder(button.getAttribute('data-customer-order'));
            });
            $('customer-modal').addEventListener('click', function (e) { if (e.target === $('customer-modal')) closeCustomerDetail(); });
            $('customer-modal').addEventListener('keydown', onCustomerKeydown);
            $('prod-form').addEventListener('submit', submitProduct);
            $('f-stock').addEventListener('input', function () {
                var p = _prodCache[$('f-id').value];
                $('f-stock-reason').required = !!p && Number($('f-stock').value) !== Number(p.stock);
            });
            $('prod-modal').addEventListener('click', function (e) { if (e.target === $('prod-modal')) closeModal(); });
            $('inventory-close').addEventListener('click', closeInventory);
            $('sizes-close').addEventListener('click', closeSizes);
            $('sizes-create').addEventListener('click', function () { createSizes(false); });
            $('sizes-create-all').addEventListener('click', function () { createSizes(true); });
            $('sizes-allocate').addEventListener('click', allocateSizes);
            $('sizes-body').addEventListener('click', saveSize);
            $('sizes-modal').addEventListener('click', function (e) { if (e.target === $('sizes-modal')) closeSizes(); });
            $('sizes-modal').addEventListener('keydown', function (e) {
                if (e.key === 'Escape') { e.preventDefault(); closeSizes(); return; }
                if (e.key !== 'Tab') return;
                var nodes = $('sizes-modal').querySelectorAll(FOCUSABLE);
                if (!nodes.length) return;
                var first = nodes[0], last = nodes[nodes.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            });
            $('colors-close').addEventListener('click', closeColors);
            $('colors-create').addEventListener('click', function () {
                mutateColors('colors', 'POST', { label: $('colors-name').value, swatch_hex: $('colors-hex').value });
            });
            $('colors-add-size').addEventListener('click', function () {
                mutateColors('color-sizes', 'POST', { size: $('colors-size').value });
            });
            $('colors-allocate').addEventListener('click', allocateColors);
            $('colors-body').addEventListener('click', colorBodyClick);
            $('colors-modal').addEventListener('click', function (e) { if (e.target === $('colors-modal')) closeColors(); });
            $('colors-modal').addEventListener('keydown', function (e) {
                if (e.key === 'Escape') { e.preventDefault(); closeColors(); return; }
                if (e.key !== 'Tab') return;
                var nodes = $('colors-modal').querySelectorAll(FOCUSABLE);
                if (!nodes.length) return;
                if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes[nodes.length - 1].focus(); }
                else if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) { e.preventDefault(); nodes[0].focus(); }
            });
            $('inventory-modal').addEventListener('click', function (e) { if (e.target === $('inventory-modal')) closeInventory(); });
            $('inventory-modal').addEventListener('keydown', function (e) {
                if (e.key === 'Escape') { e.preventDefault(); closeInventory(); }
                if (e.key !== 'Tab') return;
                var nodes = $('inventory-modal').querySelectorAll(FOCUSABLE);
                var visible = [];
                for (var i = 0; i < nodes.length; i++) {
                    if (nodes[i].offsetWidth > 0 || nodes[i].offsetHeight > 0 || nodes[i] === document.activeElement) visible.push(nodes[i]);
                }
                if (!visible.length) return;
                if (e.shiftKey && document.activeElement === visible[0]) {
                    e.preventDefault(); visible[visible.length - 1].focus();
                } else if (!e.shiftKey && document.activeElement === visible[visible.length - 1]) {
                    e.preventDefault(); visible[0].focus();
                }
            });
            $('confirm-cancel').addEventListener('click', function () { closeConfirm(false); });
            $('confirm-ok').addEventListener('click', function () { closeConfirm(true); });
            $('confirm-modal').addEventListener('click', function (e) { if (e.target === $('confirm-modal')) closeConfirm(false); });
            $('confirm-modal').addEventListener('keydown', onConfirmKeydown);
            $('btn-logout').addEventListener('click', function () {
                if (window.firebase && firebase.auth) firebase.auth().signOut();
                setTimeout(function () { window.location.href = window.BreezeRoutes.to('login'); }, 200);
            });

            if (window.AuthHelper) window.AuthHelper.onChange(onAuth);
            else showState('state-login');
        });
    })();
