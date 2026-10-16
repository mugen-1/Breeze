// Script riêng của orders.html — tách ra từ thẻ <script> inline cuối trang.
// Phải load SAU i18n.js (đọc window.__i18n) và SAU auth-helper.js
// (dùng window.AuthHelper.isLoggedIn / apiFetch).
//
// LƯU Ý cho đợt gom hàm dùng chung: esc / money / fmtDate / render ở đây là
// bản riêng của trang, trùng TÊN với bản ở trang khác. Giữ nguyên, chưa gom.

function _op() {
    var lang = (window.__i18n && window.__i18n.current) || 'vi';
    return (window.__i18n && window.__i18n.T[lang] && window.__i18n.T[lang].orders) || {};
}
// Ten co tien to 'orders' de KHONG dam vao global _lang cua cart.js — hai file
// cung nap tren orders.html, ban nao nap sau se de ban kia. Ban cua cart.js day
// du hon (co nhanh doc localStorage 'ql_lang').
function _ordersLang() { return (window.__i18n && window.__i18n.current) || 'vi'; }

function fmtDate(iso) {
    try { return new Date(iso).toLocaleString(_ordersLang() === 'en' ? 'en-GB' : 'vi-VN'); }
    catch (e) { return iso; }
}

var _ordersCache = null;   // dữ liệu đơn đã tải (để render lại khi đổi ngôn ngữ)
var _cancelOrderId = null;
var _cancelBusy = false;
var _cancelTrigger = null;

function _orderText(template, id) { return String(template || '').replace('{id}', id); }
function _cancelError(message) {
    var el = document.getElementById('orders-cancel-error');
    el.textContent = message;
    el.hidden = !message;
}
function _ordersFlash(message, isError) {
    var el = document.getElementById('orders-flash');
    el.textContent = message;
    el.classList.toggle('is-error', !!isError);
    el.hidden = !message;
}
function _closeCancel() {
    if (_cancelBusy) return;
    document.getElementById('orders-cancel-overlay').hidden = true;
    _cancelOrderId = null;
    if (_cancelTrigger && _cancelTrigger.focus) _cancelTrigger.focus();
    _cancelTrigger = null;
}
function _openCancel(id, trigger) {
    var order = (_ordersCache || []).find(function (o) { return o.id === id && o.can_cancel; });
    if (!order) return;
    _cancelOrderId = id;
    _cancelTrigger = trigger;
    var reason = document.getElementById('orders-cancel-reason');
    reason.value = '';
    document.getElementById('orders-cancel-details').value = '';
    document.getElementById('orders-cancel-details').hidden = true;
    document.getElementById('orders-cancel-details-label').hidden = true;
    _cancelError('');
    document.getElementById('orders-cancel-overlay').hidden = false;
    renderCancelDialog();
    reason.focus();
}
function renderCancelDialog() {
    var op = _op();
    document.getElementById('orders-cancel-title').textContent = op.cancelTitle || 'Hủy đơn hàng?';
    document.getElementById('orders-cancel-confirm').textContent = _orderText(op.cancelConfirm || 'Bạn có chắc muốn hủy đơn #{id}?', window.BreezeOrderShipping.code((_ordersCache || []).find(function (o) { return o.id === _cancelOrderId; }) || {}) || '');
    document.getElementById('orders-cancel-reason-label').textContent = op.cancelReason || 'Lý do hủy';
    document.getElementById('orders-cancel-details-label').textContent = op.cancelOther || 'Chi tiết lý do';
    var reason = document.getElementById('orders-cancel-reason');
    var selected = reason.value;
    var opts = op.reasonOptions || {};
    reason.innerHTML = '<option value="">' + esc(op.cancelChoose || 'Chọn lý do') + '</option>' +
        ['wrong_item', 'change_item', 'change_address', 'no_longer_needed', 'other'].map(function (key) {
            return '<option value="' + key + '">' + esc(opts[key] || key) + '</option>';
        }).join('');
    reason.value = selected;
    document.getElementById('orders-cancel-back').textContent = op.cancelBack || 'Quay lại';
    document.getElementById('orders-cancel-submit').textContent = _cancelBusy ? (op.cancelSaving || 'Đang hủy...') : (op.cancelSubmit || 'Xác nhận hủy');
}
function _submitCancel() {
    if (_cancelBusy || _cancelOrderId === null) return;
    var reason = document.getElementById('orders-cancel-reason').value;
    var details = document.getElementById('orders-cancel-details').value.trim();
    if (!reason || (reason === 'other' && !details) || details.length > 180) {
        _cancelError(_op().cancelReason || 'Vui lòng chọn lý do hủy');
        return;
    }
    _cancelError('');
    _cancelBusy = true;
    var id = _cancelOrderId;
    var displayCode = window.BreezeOrderShipping.code((_ordersCache || []).find(function (o) { return o.id === id; }) || { id: id });
    var button = document.getElementById('orders-cancel-submit');
    button.disabled = true;
    renderCancelDialog();
    window.AuthHelper.apiFetch('/api/orders/' + id + '/cancel', {
        method: 'POST', body: JSON.stringify({ reason: reason, details: reason === 'other' ? details : '' })
    }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
            return { status: response.status, body: body };
        });
    }).then(function (reply) {
        if (reply.status === 200) {
            _cancelBusy = false;
            _closeCancel();
            _ordersFlash(_orderText(_op().cancelSuccess || 'Đã hủy đơn #{id}.', displayCode), false);
            loadOrders();
        } else if (reply.status === 409) {
            _cancelBusy = false;
            _closeCancel();
            _ordersFlash(_op().cancelConflict || 'Đơn hàng không còn có thể hủy.', true);
            loadOrders();
        } else {
            _cancelError(reply.body.message || _op().cancelError || 'Không thể hủy đơn.');
        }
    }).catch(function () {
        _cancelError(_op().cancelError || 'Không thể hủy đơn.');
    }).finally(function () {
        _cancelBusy = false;
        button.disabled = false;
        renderCancelDialog();
    });
}

function _show(id, on) {
    var el = document.getElementById(id);
    if (el) el.style.display = on ? 'block' : 'none';
}

var _paymentBusy = {}, _paymentErrors = {};
async function simulatePayment(action) {
    var id = Number(action.getAttribute('data-order-id'));
    var order = (_ordersCache || []).find(function (o) { return o.id === id; });
    if (_paymentBusy[id] || !window.BreezeOrderPayment.canSimulate(order)) return;
    var cache = _ordersCache;
    _paymentBusy[id] = true; delete _paymentErrors[id]; render();
    try {
        var payment = await window.BreezeOrderPayment.simulate(id, action.getAttribute('data-outcome'));
        if (cache === _ordersCache) order.payment_transaction = payment;
    } catch (_) {
        if (cache === _ordersCache) _paymentErrors[id] = true;
    } finally {
        delete _paymentBusy[id]; render();
    }
}

function render() {
    var op = _op();
    document.getElementById('orders-heading').textContent = op.heading || 'Đơn Hàng Của Tôi';
    document.getElementById('orders-login-text').textContent = op.loginRequired || 'Vui lòng đăng nhập để xem đơn hàng của bạn.';
    document.getElementById('orders-login-link').textContent = op.signIn || 'Đăng nhập';
    document.getElementById('orders-empty-text').textContent = op.empty || 'Bạn chưa có đơn hàng nào.';
    renderCancelDialog();

    // Chưa đăng nhập
    if (!(window.AuthHelper && window.AuthHelper.isLoggedIn())) {
        _show('orders-login', true); _show('orders-empty', false); _show('orders-status', false);
        document.getElementById('orders-list').innerHTML = '';
        document.getElementById('orders-continue').style.display = 'none';
        return;
    }
    _show('orders-login', false);

    if (_ordersCache === null) {
        var st = document.getElementById('orders-status');
        st.style.display = 'block'; st.textContent = '...';
        return;
    }
    if (_ordersCache.length === 0) {
        _show('orders-empty', true); _show('orders-status', false);
        document.getElementById('orders-list').innerHTML = '';
        document.getElementById('orders-continue').style.display = 'none';
        return;
    }

    _show('orders-empty', false); _show('orders-status', false);
    document.getElementById('orders-continue').style.display = 'inline-block';
    document.getElementById('orders-continue').textContent = op.continueShopping || '← Tiếp tục mua sắm';

    var statusMap = op.statusMap || {};
    var html = _ordersCache.map(function (o) {
        var rows = (o.items || []).map(function (it) {
            return '<tr>' +
                '<td>' + esc(it.product_name) + (it.size_snapshot ? '<br><small>' + esc(window.__i18n.t('pd.thSize')) + ': ' + esc(it.size_snapshot) + '</small>' : '') +
                (it.color_snapshot ? '<br><small>' + esc(window.__i18n.t('co.metaColor')) + ': ' + esc(it.color_snapshot) + '</small>' : '') + '</td>' +
                '<td class="num">' + money(it.unit_price) + '</td>' +
                '<td class="num">' + it.quantity + '</td>' +
                '<td class="num">' + money(it.line_total) + '</td>' +
            '</tr>';
        }).join('');

        var stLabel = statusMap[o.status] || o.status;
        return '' +
            '<div class="order-card">' +
                '<div class="order-head">' +
                    '<span class="oh-id">' + (op.orderNo || 'Đơn hàng #') + esc(window.BreezeOrderShipping.code(o)) + '</span>' +
                    '<span class="oh-meta">' + (op.date || 'Ngày đặt') + ': ' + fmtDate(o.created_at) + '</span>' +
                    '<span class="order-status ' + esc(o.status) + '">' + esc(stLabel) + '</span>' +
                '</div>' +
                '<table class="order-items">' +
                    '<thead><tr>' +
                        '<th>' + (op.items || 'Sản phẩm') + '</th>' +
                        '<th class="num">' + (op.unitPrice || 'Đơn giá') + '</th>' +
                        '<th class="num">' + (op.qty || 'SL') + '</th>' +
                        '<th class="num">' + (op.lineTotal || 'Thành tiền') + '</th>' +
                    '</tr></thead>' +
                    '<tbody>' + rows + '</tbody>' +
                '</table>' +
                window.BreezeOrderShipping.details(o, false) +
                window.BreezeOrderPayment.details(o, true, !!_paymentBusy[o.id]) +
                (_paymentErrors[o.id] ? '<p class="payment-simulation-message" role="status">' + esc(t('paymenttx.error')) + '</p>' : '') +
                '<div class="order-foot"><span>' + (op.total || 'Tổng tiền') + ':</span><span>' + money(o.total_amount) + '</span></div>' +
                (o.can_cancel ? '<div class="order-actions"><button type="button" class="order-cancel-btn" data-action="order-cancel-open" data-order-id="' + o.id + '">' + esc(op.cancelButton || 'Hủy đơn hàng') + '</button></div>' : '') +
            '</div>';
    }).join('');
    document.getElementById('orders-list').innerHTML = html;
}

function loadOrders() {
    if (!(window.AuthHelper && window.AuthHelper.isLoggedIn())) { _ordersCache = null; render(); return; }
    window.AuthHelper.apiFetch('/api/orders')
        .then(function (r) { if (!r.ok) throw new Error('GET /api/orders ' + r.status); return r.json(); })
        .then(function (data) { _ordersCache = Array.isArray(data) ? data : []; render(); })
        .catch(function (e) {
            console.error('[orders] load lỗi:', e);
            var st = document.getElementById('orders-status');
            st.style.display = 'block';
            st.textContent = (_op().loadError || 'Không tải được đơn hàng.');
        });
}

// Trạng thái đăng nhập đổi -> tải lại (đăng nhập) hoặc hiện thông báo (đăng xuất).
document.addEventListener('authchange', function () {
    _ordersCache = null;
    render();
    loadOrders();
});
document.addEventListener('langchange', render);
document.addEventListener('DOMContentLoaded', render);
document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'orders-cancel-reason') {
        var other = event.target.value === 'other';
        document.getElementById('orders-cancel-details').hidden = !other;
        document.getElementById('orders-cancel-details-label').hidden = !other;
        _cancelError('');
    }
});
document.addEventListener('click', function (event) {
    if (event.target === document.getElementById('orders-cancel-overlay')) { _closeCancel(); return; }
    var action = event.target && event.target.closest && event.target.closest('[data-action]');
    if (!action) return;
    var key = action.getAttribute('data-action');
    if (key === 'order-payment-simulate') simulatePayment(action);
    if (key === 'order-cancel-open') _openCancel(Number(action.getAttribute('data-order-id')), action);
    if (key === 'order-cancel-close') _closeCancel();
    if (key === 'order-cancel-submit') _submitCancel();
});
document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !document.getElementById('orders-cancel-overlay').hidden) _closeCancel();
});
