'use strict';

// Only creates zero-stock size rows. BASE, physical stock and history stay intact.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { getPool } = require('../db');
const { sizeProfile, readSizes, changeSizes } = require('../lib/size-variants');
async function main() {
  const pool = await getPool();
  try {
    const products = (await pool.request().query(`SELECT p.id, p.slug, p.is_active, c.slug AS category_slug
      FROM dbo.products p JOIN dbo.categories c ON c.id = p.category_id ORDER BY p.id;`)).recordset;
    const report = { apparel: [], mens_shoes: [], base_only: [], created: 0 };
    for (const p of products) {
      const profile = sizeProfile(p);
      if (!p.is_active || !profile.sizes.length) { report.base_only.push(p.id); continue; }
      report[profile.kind === 'apparel' ? 'apparel' : 'mens_shoes'].push(p.id);
      const current = await readSizes(pool, p.id);
      const missing = profile.sizes.filter(s => !current.variants.some(v => v.size === s));
      if (missing.length) {
        await changeSizes(pool, p.id, null, 'configure', { sizes: missing });
        report.created += missing.length;
      }
    }
    console.log(JSON.stringify(report, null, 2));
  } finally { await pool.close(); }
}
main().catch(err => { console.error('[configure-size-products]', err.message); process.exitCode = 1; });
