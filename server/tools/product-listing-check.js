'use strict';

// Read the catalog independently of Product API filters and variant joins.
async function readCatalog() {
  require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
  const { sql, config } = require('../db');
  const pool = await new sql.ConnectionPool(config).connect();
  try {
    return (await pool.request().query(`
      SELECT p.id, p.is_active, p.sale_price, p.name_vi, p.name_en, c.slug AS category_slug
      FROM dbo.products p LEFT JOIN dbo.categories c ON c.id = p.category_id;`)).recordset;
  } finally {
    await pool.close();
  }
}

const norm = value => String(value == null ? '' : value).toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd').replace(/\s+/g, ' ').trim();
const matchesSearch = p => norm((p.name_vi || '') + ' ' + (p.name_en || '')).includes('quan');

function checkListings(catalog, responses) {
  const expected = catalog.filter(p => (p.is_active === true || p.is_active === 1) && p.category_slug != null);
  const issues = [];
  function products(label, response) {
    let data;
    try { data = JSON.parse(response.body); } catch (_) { /* reported below */ }
    const list = Array.isArray(data) ? data : data && Array.isArray(data.data) ? data.data : null;
    if (response.status !== 200 || !list || list.some(p => !p || !Number.isInteger(p.id) || p.id < 0)) {
      issues.push(label + ': HTTP ' + response.status + ' / danh sach khong hop le');
      return null;
    }
    return list;
  }
  function compare(label, actual, wanted) {
    if (actual) {
      const ids = actual.map(p => p.id), want = new Set(wanted.map(p => p.id));
      const missing = [...want].filter(id => !ids.includes(id));
      const extra = ids.filter(id => !want.has(id));
      if (new Set(ids).size !== ids.length || missing.length || extra.length) {
        issues.push(label + ': thieu [' + missing + '], thua [' + extra + '], trung ' + (ids.length - new Set(ids).size));
      }
    }
    return label + ' ' + (actual ? actual.length : '?') + '/' + wanted.length;
  }
  const all = products('all', responses.all);
  const category = products('ao', responses.category);
  const sale = products('sale', responses.sale);
  // The former 6 / 14 / 10 counts were a catalog snapshot, not listing limits.
  const counts = [
    compare('all', all, expected),
    compare('ao', category, expected.filter(p => p.category_slug === 'sanpham-ao' && p.sale_price == null)),
    compare('sale', sale, expected.filter(p => p.sale_price != null)),
    compare('tim kiem', all && all.filter(matchesSearch), expected.filter(matchesSearch)),
  ];
  return { ok: issues.length === 0, detail: counts.join(' | ') + (issues.length ? '; ' + issues.join('; ') : '') };
}

module.exports = { readCatalog, checkListings };
