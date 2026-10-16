'use strict';

// Read-only TASK 05/06 reconciliation. No customer data or credentials printed.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { getPool } = require('../db');
const { createHash } = require('node:crypto');
const { sizeProfile, sellableVariant } = require('../lib/size-variants');
const { colorName } = require('../lib/color-variants');

async function main() {
  const pool = await getPool();
  const products = (await pool.request().query(`SELECT p.id, p.stock, p.is_active, p.slug, c.slug AS category_slug
    FROM dbo.products p JOIN dbo.categories c ON c.id = p.category_id ORDER BY p.id;`)).recordset;
  const variants = (await pool.request().query(`SELECT id, product_id, sku, size, color, stock, is_active, is_base
    FROM dbo.product_variants ORDER BY product_id, id;`)).recordset;
  const colors = (await pool.request().query(`SELECT id, product_id, color_key, label, swatch_hex, is_active
    FROM dbo.product_colors ORDER BY product_id, id;`)).recordset;
  const images = (await pool.request().query(`SELECT id, color_id, image_path, sort_order, is_primary
    FROM dbo.product_color_images ORDER BY color_id, id;`)).recordset;
  const movements = (await pool.request().query(`SELECT id, product_id, variant_id, order_id,
    order_reference_id, movement_type, quantity_delta, stock_before, stock_after, created_at
    FROM dbo.inventory_movements ORDER BY created_at, id;`)).recordset;
  const orderIds = new Set((await pool.request().query('SELECT id FROM dbo.orders;')).recordset.map(x => x.id));
  const productById = new Map(products.map(p => [p.id, p]));
  const variantById = new Map(variants.map(v => [v.id, v]));
  const oldLast = new Map(), variantLast = new Map();
  const oldOpenings = new Map(), variantOpenings = new Map();
  const issues = {
    missing_base: [], orphan_variant: [], duplicate_sku: [], duplicate_base: [], base_options: [],
    negative_variant_stock: [], cart_variant: [], order_variant: [],
    aggregate_mismatch: [], movement_variant: [], inactive: [],
    latest_variant_stock: [], missing_start: [], broken_chain: [], equation: [],
    duplicate_opening: [], transition: [], order_reference: [], untrusted_fk: [],
    missing_fk: [], post_cutover_product_movement: [],
    duplicate_size: [], invalid_size: [], base_sellability: [], inactive_sellability: [], size_snapshot: [],
    duplicate_color: [], orphan_color: [], orphan_image: [], duplicate_primary_image: [],
    invalid_image_sort: [], invalid_hex: [], variant_mode: [], sellable_source: [],
    inactive_color_sellability: [], color_snapshot: [], duplicate_color_variant: [],
  };
  const colorByKey = new Map(), colorById = new Map(), colorLabels = new Set(), primary = new Set();
  for (const c of colors) {
    if (!productById.has(c.product_id)) issues.orphan_color.push(c.id);
    const key = `${c.product_id}:${c.color_key}`;
    if (colorByKey.has(key)) issues.duplicate_color.push(c.id);
    colorByKey.set(key, c);
    colorById.set(c.id, c);
    try {
      const normalized = `${c.product_id}:${colorName(c.label).key}`;
      if (colorLabels.has(normalized)) issues.duplicate_color.push(c.id);
      colorLabels.add(normalized);
    } catch (_) { issues.duplicate_color.push(c.id); }
    if (c.swatch_hex != null && !/^#[0-9A-F]{6}$/.test(c.swatch_hex)) issues.invalid_hex.push(c.id);
  }
  for (const i of images) {
    if (!colorById.has(i.color_id)) issues.orphan_image.push(i.id);
    if (!Number.isInteger(i.sort_order) || i.sort_order < 0) issues.invalid_image_sort.push(i.id);
    if (i.is_primary) {
      if (primary.has(i.color_id)) issues.duplicate_primary_image.push(i.id);
      primary.add(i.color_id);
    }
  }
  const skus = new Set();
  const logicalVariants = new Set();
  for (const v of variants) {
    if (!productById.has(v.product_id)) issues.orphan_variant.push(v.id);
    if (skus.has(v.sku)) issues.duplicate_sku.push(v.id);
    skus.add(v.sku);
    if (v.stock < 0) issues.negative_variant_stock.push(v.id);
    if (v.is_base && (v.size != null || v.color != null)) issues.base_options.push(v.id);
    if (!v.is_base && v.size != null && !sizeProfile(productById.get(v.product_id) || {}).sizes.includes(v.size))
      issues.invalid_size.push(v.id);
    if (!v.is_base && v.color == null && v.size == null ||
        v.color != null && !colorByKey.has(`${v.product_id}:${v.color}`)) issues.variant_mode.push(v.id);
    if (!v.is_base) {
      const identity = `${v.product_id}:${v.size ?? '<null>'}:${v.color ?? '<null>'}`;
      if (logicalVariants.has(identity)) issues.duplicate_color_variant.push(v.id);
      logicalVariants.add(identity);
    }
  }
  for (const p of products) {
    const all = variants.filter(v => v.product_id === p.id);
    const bases = all.filter(v => v.is_base);
    if (!bases.length) issues.missing_base.push(p.id);
    if (bases.length > 1) issues.duplicate_base.push(p.id);
    if (all.reduce((n, v) => n + v.stock, 0) !== p.stock) issues.aggregate_mismatch.push(p.id);
    if (!p.is_active && all.some(v => v.is_active)) issues.inactive.push(p.id);
    p.size_configured = all.some(v => !v.is_base && v.size != null);
    p.color_configured = colors.some(c => c.product_id === p.id);
    const seenSizes = new Set();
    for (const v of all) {
      if (!v.is_base && v.color == null && seenSizes.has(v.size)) issues.duplicate_size.push(v.id);
      if (!v.is_base && v.color == null) seenSizes.add(v.size);
      const color = colorByKey.get(`${p.id}:${v.color}`);
      const enriched = { ...v, color_active: color ? color.is_active : false };
      if (p.color_configured && v.color == null && sellableVariant(p, enriched)) issues.sellable_source.push(v.id);
      if (color && !color.is_active && sellableVariant(p, enriched)) issues.inactive_color_sellability.push(v.id);
      if (p.size_configured && v.is_base && sellableVariant(p, enriched)) issues.base_sellability.push(v.id);
      if ((!p.is_active || !v.is_active) && sellableVariant(p, enriched)) issues.inactive_sellability.push(v.id);
    }
  }

  for (const m of movements) {
    if (m.stock_before < 0 || m.stock_after < 0 ||
        m.stock_before + m.quantity_delta !== m.stock_after) issues.equation.push(m.id);
    if (m.movement_type.startsWith('ORDER_') &&
        (m.order_reference_id == null || (m.order_id != null && !orderIds.has(m.order_id))))
      issues.order_reference.push(m.id);
    if (m.variant_id == null) {
      if (variantLast.size && variants.some(v => v.product_id === m.product_id && variantLast.has(v.id)))
        issues.post_cutover_product_movement.push(m.id);
      const prev = oldLast.get(m.product_id);
      if (prev && prev.stock_after !== m.stock_before) issues.broken_chain.push(m.id);
      if (!prev && !['OPENING_BALANCE', 'PRODUCT_CREATE'].includes(m.movement_type))
        issues.missing_start.push(m.product_id);
      if (m.movement_type === 'OPENING_BALANCE')
        oldOpenings.set(m.product_id, (oldOpenings.get(m.product_id) || 0) + 1);
      oldLast.set(m.product_id, m);
    } else {
      const v = variantById.get(m.variant_id);
      if (!v || v.product_id !== m.product_id) issues.movement_variant.push(m.id);
      const prev = variantLast.get(m.variant_id);
      if (prev && prev.stock_after !== m.stock_before) issues.broken_chain.push(m.id);
      if (!prev && !['VARIANT_OPENING', 'PRODUCT_CREATE'].includes(m.movement_type))
        issues.missing_start.push(m.variant_id);
      if (m.movement_type === 'VARIANT_OPENING') {
        variantOpenings.set(m.variant_id, (variantOpenings.get(m.variant_id) || 0) + 1);
        const old = oldLast.get(m.product_id);
        if (v && v.is_base ? (!old || old.stock_after !== m.stock_before) : m.stock_before !== 0)
          issues.transition.push(m.variant_id);
      }
      variantLast.set(m.variant_id, m);
    }
  }
  for (const [id, n] of oldOpenings) if (n > 1) issues.duplicate_opening.push(id);
  for (const [id, n] of variantOpenings) if (n > 1) issues.duplicate_opening.push(id);
  for (const v of variants) {
    const last = variantLast.get(v.id);
    if (!last) issues.missing_start.push(v.id);
    else if (last.stock_after !== v.stock) issues.latest_variant_stock.push(v.id);
  }

  const dbChecks = (await pool.request().query(`
    SELECT 'cart_variant' AS issue, ci.id FROM dbo.cart_items ci
      LEFT JOIN dbo.product_variants v ON v.id = ci.variant_id AND v.product_id = ci.product_id
      WHERE v.id IS NULL
    UNION ALL
    SELECT 'order_variant', oi.id FROM dbo.order_items oi
      LEFT JOIN dbo.product_variants v ON v.id = oi.variant_id AND v.product_id = oi.product_id
      WHERE v.id IS NULL;`)).recordset;
  for (const row of dbChecks) issues[row.issue].push(row.id);
  const hasSnapshot = (await pool.request().query("SELECT COL_LENGTH('dbo.order_items','size_snapshot') AS n;")).recordset[0].n;
  if (hasSnapshot) issues.size_snapshot = (await pool.request().query(`SELECT oi.id FROM dbo.order_items oi
    JOIN dbo.product_variants v ON v.id = oi.variant_id
    WHERE (v.size IS NOT NULL AND (oi.size_snapshot IS NULL OR oi.size_snapshot <> v.size))
      OR (v.size IS NULL AND oi.size_snapshot IS NOT NULL);`)).recordset.map(x => x.id);
  issues.color_snapshot = (await pool.request().query(`SELECT oi.id FROM dbo.order_items oi
    JOIN dbo.product_variants v ON v.id = oi.variant_id
    WHERE (v.color IS NOT NULL AND (oi.color_snapshot IS NULL OR LTRIM(RTRIM(oi.color_snapshot)) = ''))
       OR (v.color IS NULL AND oi.color_snapshot IS NOT NULL);`)).recordset.map(x => x.id);
  const fkNames = ['FK_product_variants_product', 'FK_cart_items_variant_product',
    'FK_order_items_variant_product', 'FK_inventory_movements_variant_product',
    'FK_product_colors_product', 'FK_product_color_images_color', 'FK_product_variants_color'];
  const fk = (await pool.request().query(`SELECT name, is_disabled, is_not_trusted FROM sys.foreign_keys
    WHERE name IN ('FK_product_variants_product','FK_cart_items_variant_product',
      'FK_order_items_variant_product','FK_inventory_movements_variant_product',
      'FK_product_colors_product','FK_product_color_images_color','FK_product_variants_color');`)).recordset;
  issues.untrusted_fk = fk.filter(x => x.is_disabled || x.is_not_trusted).map(x => x.name);
  issues.missing_fk = fkNames.filter(name => !fk.some(x => x.name === name));
  const stockRows = products.map(p => ({ id: p.id, stock: p.stock }));
  const summary = {
    products: products.length, variants: variants.length,
    base_variants: variants.filter(v => v.is_base).length,
    size_variants: variants.filter(v => v.size != null).length,
    colors: colors.length, color_images: images.length,
    stock_total: products.reduce((n, p) => n + p.stock, 0),
    stock_sha256: createHash('sha256').update(JSON.stringify(stockRows)).digest('hex'),
    movements: movements.length,
    product_level_movements: movements.filter(m => m.variant_id == null).length,
    variant_level_movements: movements.filter(m => m.variant_id != null).length,
    issues,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (Object.values(issues).some(items => items.length)) process.exitCode = 1;
  await pool.close();
}

main().catch(err => { console.error('[audit-inventory-movements]', err.message); process.exitCode = 1; });
