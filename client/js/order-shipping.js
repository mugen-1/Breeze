/* Read order snapshots only; never consult the current profile or shipping config. */
(function () {
    'use strict';
    function tr(key) { return window.__i18n ? window.__i18n.t(key) : key; }
    function address(o) {
        return [o.shipping_address, o.shipping_ward, o.shipping_district, o.shipping_city].filter(Boolean).join(', ');
    }
    function code(o) { return o.order_code == null ? o.id : o.order_code; }
    function method(o) { return o.shipping_service || (o.shipping_method === 'STANDARD' ? tr('ship.standard') : (o.shipping_method || '—')); }
    function tracking(o) {
        if (o.shipping_version !== 2) return '';
        return '<p>' + esc(tr('ship.simulation')) + '</p>' + [
            ['ship.provider', o.shipping_provider], ['ship.tracking', o.shipping_tracking_code],
            ['ship.status', tr('ship.status.' + o.shipping_status)], ['ship.eta', o.shipping_eta]
        ].map(function (f) { return '<p>' + esc(tr(f[0])) + ': <strong>' + esc(f[1] || '—') + '</strong></p>'; }).join('');
    }
    function subtotal(o) {
        return (o.items || []).reduce(function (sum, item) { return sum + Number(item.line_total || 0); }, 0);
    }
    function details(o, includeTotal) {
        var fields = [
            ['ship.recipient', o.shipping_name], ['co.phone', o.shipping_phone],
            ['co.shipAddress', address(o)], ['ship.methods', o.shipping_method && method(o)],
            ['ship.note', o.delivery_note]
        ];
        var html = fields.filter(function (f) { return f[1]; }).map(function (f) {
            return '<p style="overflow-wrap:anywhere;white-space:pre-wrap">' + esc(tr(f[0])) + ': <strong>' + esc(f[1]) + '</strong></p>';
        }).join('');
        return '<div class="order-shipping" style="padding:16px">' +
            (html || '<p>' + esc(tr('ship.legacy')) + '</p>') + tracking(o) +
            '<p>' + esc(tr('co.subtotal')) + ': ' + money(subtotal(o)) + '</p>' +
            '<p>' + esc(tr('co.discount')) + ': ' + money(o.discount_amount || 0) + '</p>' +
            '<p>' + esc(tr('ship.fee')) + ': ' + (o.shipping_fee == null ? '—' : money(o.shipping_fee)) + '</p>' +
            (includeTotal === false ? '' : '<p><strong>' + esc(tr('co.total')) + ': ' + money(o.total_amount) + '</strong></p>') + '</div>';
    }
    window.BreezeOrderShipping = { code: code, address: address, method: method, subtotal: subtotal, details: details };
})();
