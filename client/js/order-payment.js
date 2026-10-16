/* Shared payment detail and explicit simulation action; server owns every result. */
(function () {
    'use strict';
    function canSimulate(order) {
        var p = order && order.payment_transaction;
        return !!(p && p.status === 'pending' && ['visa', 'mastercard', 'momo'].includes(p.payment_method) &&
            ['pending', 'confirmed', 'processing', 'shipping', 'shipped', 'paid'].includes(order.status));
    }
    function date(value) {
        if (!value) return '—';
        var d = new Date(value);
        var lang = window.__i18n && window.__i18n.current || document.documentElement.lang;
        return isNaN(d.getTime()) ? '—' : d.toLocaleString(lang === 'en' ? 'en-GB' : 'vi-VN');
    }
    function details(order, allowSimulation, busy) {
        var p = order && order.payment_transaction;
        var html = '<section class="order-payment"><h3>' + esc(t('paymenttx.heading')) + '</h3>';
        if (!p) return html + '<p>' + esc(t('paymenttx.legacy')) + '</p></section>';
        var rows = [
            ['paymenttx.method', t('pay.' + p.payment_method)],
            ['paymenttx.code', p.transaction_code], ['paymenttx.amount', money(p.amount)],
            ['paymenttx.status', t('paymenttx.' + p.status)],
            ['paymenttx.created', date(p.created_at)], ['paymenttx.paidAt', date(p.paid_at)]
        ];
        html += '<dl>' + rows.map(function (r) { return '<div><dt>' + esc(t(r[0])) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>';
        if (allowSimulation && canSimulate(order)) {
            html += '<p>' + esc(t('paymenttx.simulation')) + '</p><div class="payment-simulation-actions">' +
                ['success', 'failure'].map(function (outcome) {
                    return '<button type="button" data-action="order-payment-simulate" data-order-id="' + esc(order.id) +
                        '" data-outcome="' + outcome + '"' + (busy ? ' disabled' : '') + '>' + esc(t('paymenttx.' + outcome)) + '</button>';
                }).join('') + '</div>';
        }
        return html + '</section>';
    }
    async function simulate(id, outcome) {
        if (!Number.isInteger(id) || id < 1 || !['success', 'failure'].includes(outcome)) throw new Error('paymenttx.error');
        var response = await window.AuthHelper.apiFetch('/api/orders/' + id + '/payment-simulation', {
            method: 'POST', body: JSON.stringify({ outcome: outcome })
        });
        var data = await response.json();
        if (!response.ok || !data.payment_transaction) throw new Error('paymenttx.error');
        return data.payment_transaction;
    }
    window.BreezeOrderPayment = { details: details, canSimulate: canSimulate, simulate: simulate };
})();
