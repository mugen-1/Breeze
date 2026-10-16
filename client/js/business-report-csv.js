/* CSV formatting only. Values come from the authorized Admin report API. */
(function () {
    'use strict';
    function cell(value) {
        var text = String(value == null ? '' : value);
        // Product snapshots are user-editable text; prevent spreadsheet formulas.
        if (typeof value === 'string' && /^\s*[=+\-@]/.test(text)) text = "'" + text;
        return /[,"\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }
    function validNumber(value) { return typeof value === 'number' && isFinite(value) && value >= 0; }
    function validDate(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        var date = new Date(value + 'T00:00:00Z');
        return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }
    function create(report, tr) {
        var r = report && report.range, s = report && report.summary;
        var metrics = ['revenue','orders','completedOrders','cancelledOrders','customers','aov','productsSold'];
        if (!r || !validDate(r.from) || !validDate(r.to) || r.from > r.to || !s ||
            metrics.some(function (k) { return !validNumber(s[k]); }) ||
            !Array.isArray(report.dailyRevenue) || !Array.isArray(report.topProducts) ||
            report.dailyRevenue.some(function (d) { return !d || !validDate(d.date) || d.date < r.from || d.date > r.to ||
                ['revenue','orders','completedOrders','cancelledOrders'].some(function (k) { return !validNumber(d[k]); }); }) ||
            report.topProducts.some(function (p) { return !p || typeof p.name !== 'string' || !validNumber(p.unitsSold) || !validNumber(p.revenue); })) {
            throw new Error('Invalid business report');
        }
        var rows = [[tr('report.title')], [], [tr('report.from'), r.from], [tr('report.to'), r.to],
            [tr('report.definition'), tr('report.rules')], [], [tr('report.metric'), tr('report.total')]];
        metrics.forEach(function (k) { rows.push([tr('report.' + k), s[k]]); });
        rows.push([], [tr('report.daily')], [tr('adm.csvDate'), tr('report.revenue'), tr('report.orders'), tr('report.completedOrders'), tr('report.cancelledOrders')]);
        report.dailyRevenue.forEach(function (d) { rows.push([d.date, d.revenue, d.orders, d.completedOrders, d.cancelledOrders]); });
        rows.push([], [tr('report.top')], [tr('adm.thProdName'), tr('report.quantity'), tr('report.productRevenue')]);
        report.topProducts.forEach(function (p) { rows.push([p.name, p.unitsSold, p.revenue]); });
        return { content: '\uFEFF' + rows.map(function (row) { return row.map(cell).join(','); }).join('\r\n') + '\r\n',
            filename: 'breeze-business-report-' + r.from + '-to-' + r.to + '.csv' };
    }
    window.BreezeBusinessCsv = { create: create };
})();
