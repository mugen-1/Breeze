// Script riêng của invoice.html — tách ra từ thẻ <script> inline cuối trang.
//
// IN HOÁ ĐƠN: trang này KHÔNG dùng html2pdf.js hay thư viện PDF nào. Nút "In hoá
// đơn" gọi thẳng window.print() của trình duyệt (người dùng tự chọn Save as PDF),
// và chỉ chạy khi người dùng bấm — không có auto-print. Bố cục bản in do khối
// @media print trong <style> của invoice.html lo, không liên quan tới file này.
// => Tách file không ảnh hưởng gì tới việc in.
//
// Phụ thuộc: window.__i18n (i18n.js), window.AuthHelper (auth-helper.js).
// Cả hai chỉ dùng bên trong DOMContentLoaded/handler nên thứ tự load khá tự do.

(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    // Đồng bộ đúng nhãn với admin.js / UI checkout.

    function pad2(n) { return String(n).padStart(2, '0'); }
    function fmtDateVN(iso) {                    // dd-mm-yyyy
        try {
            var d = new Date(iso);
            return pad2(d.getDate()) + '-' + pad2(d.getMonth() + 1) + '-' + d.getFullYear();
        } catch (e) { return iso || ''; }
    }
    function showState(msg) {
        var st = $('inv-state');
        st.hidden = false;
        st.innerHTML = msg;
        $('inv-content').hidden = true;
        $('inv-actions').hidden = true;
    }

    function getOrderId() {
        var raw = new URLSearchParams(window.location.search).get('orderId');
        if (raw === null || raw === '' || !/^\d+$/.test(raw)) return null;
        return raw;
    }

    var _order = null;                  // đơn đang hiển thị -> dựng lại khi đổi VI/EN
    function render(o) {
        _order = o;
        document.title = t('inv.docTitleN', { id: o.id });
        $('inv-customer').textContent = o.shipping_name || o.user_name || o.user_email
            || t('inv.guest', { id: o.user_id });
        $('inv-phone').textContent = o.shipping_phone || '—';
        $('inv-address').textContent = o.shipping_address || '—';
        $('inv-date').textContent = fmtDateVN(o.created_at);
        $('inv-id').textContent = '#' + o.id;

        var items = o.items || [];
        $('inv-items').innerHTML = items.length
            ? items.map(function (it) {
                return '<tr>' +
                    '<td>' + esc(it.product_name) + '</td>' +
                    '<td class="col-qty num">x' + it.quantity + '</td>' +
                    '<td class="col-price num">' + money(it.unit_price) + '</td>' +
                    '<td class="col-total num">' + money(it.line_total) + '</td>' +
                '</tr>';
            }).join('')
            : '<tr><td colspan="4" style="text-align:center;color:#6b6b6b;">' + t('inv.noLines') + '</td></tr>';

        // Tạm tính = tổng line_total của items; Tổng tiền lấy total_amount THẬT từ DB (đã trừ giảm).
        var subtotal = items.reduce(function (s, it) { return s + Number(it.line_total || 0); }, 0);
        var discount = Number(o.discount_amount || 0);
        $('inv-subtotal').textContent = money(subtotal);
        if (discount > 0 || o.voucher_code) {
            $('inv-discount-row').hidden = false;
            $('inv-discount-label').textContent = o.voucher_code
                ? t('inv.discountCode', { code: o.voucher_code })
                : t('inv.discount');
            $('inv-discount').textContent = '−' + money(discount);
        }
        $('inv-total').textContent = money(o.total_amount);
        $('inv-payment').textContent = o.payment_method ? t('pay.' + o.payment_method) : '—';

        $('inv-state').hidden = true;
        $('inv-content').hidden = false;
        $('inv-actions').hidden = false;   // chỉ hiện khi đã có dữ liệu (không tự bật print dialog)
    }


    function load(user) {
        if (!user) {
            showState(t('inv.needLogin') + '<br><a href="' + window.BreezeRoutes.to('login') + '">' + t('com.signin') + '</a>');
            return;
        }
        var id = getOrderId();
        if (!id) { showState(t('inv.badId')); return; }

        window.AuthHelper.apiFetch('/api/admin/orders?q=' + encodeURIComponent(id) + '&limit=1')
            .then(function (r) {
                if (r.status === 401 || r.status === 403) throw new Error('FORBIDDEN');
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var o = (data.orders || [])[0];
                if (!o) { showState(t('inv.notFound', { id: id })); return; }
                render(o);
            })
            .catch(function (e) {
                console.error('[invoice] lỗi:', e);
                showState(e.message === 'FORBIDDEN'
                    ? t('inv.forbidden')
                    : t('inv.loadErr'));
            });
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (window.AuthHelper && typeof window.AuthHelper.onChange === 'function') {
            window.AuthHelper.onChange(load);
        } else {
            showState(t('inv.authErr'));
        }
    });

    // Đổi VI/EN: các nhãn tĩnh do i18n.js lo, phần do JS sinh dựng lại ở đây.
    document.addEventListener('langchange', function () { if (_order) render(_order); });
})();
