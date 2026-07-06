// Verify seed: đếm số sản phẩm theo từng category và tổng số sản phẩm.
// Dùng: node db/verify.js
require('dotenv').config();
const { getPool } = require('../db');

async function main() {
  const pool = await getPool();

  const perCat = await pool.request().query(`
    SELECT c.slug, c.name_vi, COUNT(p.id) AS product_count
    FROM dbo.categories c
    LEFT JOIN dbo.products p ON p.category_id = c.id
    GROUP BY c.id, c.slug, c.name_vi
    ORDER BY c.id;
  `);

  const totals = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.categories) AS categories,
      (SELECT COUNT(*) FROM dbo.products)   AS products,
      (SELECT COUNT(*) FROM dbo.products WHERE sale_price IS NOT NULL) AS on_sale;
  `);

  console.log('\n=== SẢN PHẨM THEO CATEGORY ===');
  console.table(
    perCat.recordset.map((r) => ({
      slug: r.slug,
      name_vi: r.name_vi,
      products: r.product_count,
    }))
  );

  const t = totals.recordset[0];
  console.log(`Tổng categories : ${t.categories}`);
  console.log(`Tổng sản phẩm   : ${t.products}`);
  console.log(`Đang sale       : ${t.on_sale}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[verify] LỖI:', err.message);
    process.exit(1);
  });
