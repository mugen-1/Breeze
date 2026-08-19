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
function _lang() { return (window.__i18n && window.__i18n.current) || 'vi'; }

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function money(n) { return Number(n).toLocaleString('vi-VN') + 'đ'; }
function fmtDate(iso) {
    try { return new Date(iso).toLocaleString(_lang() === 'en' ? 'en-GB' : 'vi-VN'); }
    catch (e) { return iso; }
}

var _ordersCache = null;   // dữ liệu đơn đã tải (để render lại khi đổi ngôn ngữ)

function _show(id, on) {
    var el = document.getElementById(id);
    if (el) el.style.display = on ? 'block' : 'none';
}

function render() {
    var op = _op();
    document.getElementById('orders-heading').textContent = op.heading || 'Đơn Hàng Của Tôi';
    document.getElementById('orders-login-text').textContent = op.loginRequired || 'Vui lòng đăng nhập để xem đơn hàng của bạn.';
    document.getElementById('orders-login-link').textContent = op.signIn || 'Đăng nhập';
    document.getElementById('orders-empty-text').textContent = op.empty || 'Bạn chưa có đơn hàng nào.';

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
                '<td>' + esc(it.product_name) + '</td>' +
                '<td class="num">' + money(it.unit_price) + '</td>' +
                '<td class="num">' + it.quantity + '</td>' +
                '<td class="num">' + money(it.line_total) + '</td>' +
            '</tr>';
        }).join('');

        var stLabel = statusMap[o.status] || o.status;
        return '' +
            '<div class="order-card">' +
                '<div class="order-head">' +
                    '<span class="oh-id">' + (op.orderNo || 'Đơn hàng #') + o.id + '</span>' +
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
                '<div class="order-foot"><span>' + (op.total || 'Tổng tiền') + ':</span><span>' + money(o.total_amount) + '</span></div>' +
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
