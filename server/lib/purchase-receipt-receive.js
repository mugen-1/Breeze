'use strict';
// Nhận hàng theo phiếu nhập (nhận đủ 1 lần) — chạy trên transaction `tx` của CALLER. Caller (routes/admin-receipts.js) đã
// khoá dòng phiếu WITH (UPDLOCK, HOLDLOCK) và kiểm status = 'approved'; sau hàm này caller chuyển phiếu sang received
// và ghi audit RECEIPT_RECEIVE trong cùng tx. Lỗi bất kỳ -> ném, caller rollback: không đổi tồn, không ghi sổ kho.
//
// Thứ tự khoá (chống deadlock với checkout / huỷ đơn / đổi size, đều khoá sản phẩm trước rồi mới tới biến thể của nó,
// sản phẩm theo product_id tăng dần): khoá TỪNG sản phẩm theo product_id tăng dần, rồi TỪNG biến thể theo variant_id
// tăng dần — mỗi dòng một câu (một câu IN (...) không bảo đảm thứ tự khoá).
// Kiểm lại từng dòng là biến thể lá (chỉ xét cấu trúc, như lúc duyệt) -> 409 RECEIPT_ITEMS_INVALID.
// Cộng tồn vượt INT -> 409 RECEIPT_STOCK_OVERFLOW (kèm các dòng gây tràn). Biến thể / sản phẩm đang tắt vẫn nhận được,
// KHÔNG tự bật lại (không đụng is_active).
// Mỗi dòng phiếu ghi 1 dòng sổ kho PURCHASE_RECEIPT có receipt_id; UX_inventory_movements_receipt_variant chặn cộng
// trùng ở tầng DB (caller đổi lỗi 2627/2601 thành 409).
//   receiveReceipt(tx, { receiptId, actorUserId }) -> [{ product_id, variant_id, quantity, stock_before, stock_after }]
//                                                      theo variant_id tăng dần.
const { sql } = require('../db');
const { recordInventoryMovement } = require('./inventory-movement');
const { SIZE_CONFIGURED_SQL, COLOR_CONFIGURED_SQL } = require('./size-variants');
const { ReceiptError, checkItems } = require('./purchase-receipt');

const MAX_INT = 2147483647;

async function receiveReceipt(tx, { receiptId, actorUserId }) {
  const items = (await new sql.Request(tx).input('id', sql.Int, receiptId).query(`SELECT i.id, i.product_id, i.variant_id,
    i.quantity FROM dbo.purchase_receipt_items i WHERE i.receipt_id = @id ORDER BY i.id;`)).recordset;
  if (!items.length) throw new Error('Purchase receipt has no items');

  const products = new Map();
  for (const pid of [...new Set(items.map(i => i.product_id))].sort((a, b) => a - b)) {
    const r = await new sql.Request(tx).input('pid', sql.Int, pid).query(`SELECT p.id, p.slug, p.stock,
      (SELECT slug FROM dbo.categories WHERE id = p.category_id) AS category_slug,
      ${SIZE_CONFIGURED_SQL} AS size_configured, ${COLOR_CONFIGURED_SQL} AS color_configured
      FROM dbo.products p WITH (UPDLOCK, HOLDLOCK) WHERE p.id = @pid;`);
    const p = r.recordset[0];
    if (p) products.set(pid, { ...p, size_configured: !!p.size_configured, color_configured: !!p.color_configured });
  }
  const variants = new Map();
  for (const vid of [...new Set(items.map(i => i.variant_id))].sort((a, b) => a - b)) {
    const r = await new sql.Request(tx).input('vid', sql.Int, vid).query(`SELECT v.id, v.product_id, v.size, v.color, v.stock,
      v.is_base, pc.id AS color_id
      FROM dbo.product_variants v WITH (UPDLOCK, HOLDLOCK)
      LEFT JOIN dbo.product_colors pc ON pc.product_id = v.product_id AND pc.color_key = v.color
      WHERE v.id = @vid;`);
    const v = r.recordset[0];
    if (v) variants.set(vid, { ...v, is_base: !!v.is_base, color_exists: v.color_id != null });
  }

  const bad = checkItems(items, products, variants);
  if (bad.length) {
    throw new ReceiptError(409, 'RECEIPT_ITEMS_INVALID', 'Có dòng hàng không còn là biến thể nhập kho hợp lệ', { items: bad });
  }

  // Chặn tràn trên số đã khoá: từng biến thể, và tổng của từng sản phẩm.
  const perProduct = new Map();
  for (const it of items) perProduct.set(it.product_id, (perProduct.get(it.product_id) || 0) + it.quantity);
  const overflow = [];
  items.forEach((it, index) => {
    const v = variants.get(it.variant_id), p = products.get(it.product_id);
    if (v.stock + it.quantity > MAX_INT || p.stock + perProduct.get(it.product_id) > MAX_INT) {
      overflow.push({ index, product_id: it.product_id, variant_id: it.variant_id });
    }
  });
  if (overflow.length) {
    throw new ReceiptError(409, 'RECEIPT_STOCK_OVERFLOW', 'Tồn kho sau khi nhập vượt giới hạn cho phép', { items: overflow });
  }

  for (const [pid, qty] of [...perProduct].sort((a, b) => a[0] - b[0])) {
    const r = await new sql.Request(tx).input('pid', sql.Int, pid).input('qty', sql.Int, qty)
      .query(`UPDATE dbo.products SET stock = stock + @qty, updated_at = SYSUTCDATETIME()
        WHERE id = @pid AND stock <= 2147483647 - @qty;`);
    if (r.rowsAffected[0] !== 1) throw new Error('Product stock changed during receive');
  }
  const changes = [];
  for (const it of items.slice().sort((a, b) => a.variant_id - b.variant_id)) {
    const r = await new sql.Request(tx).input('vid', sql.Int, it.variant_id).input('pid', sql.Int, it.product_id)
      .input('qty', sql.Int, it.quantity)
      .query(`UPDATE dbo.product_variants SET stock = stock + @qty, updated_at = SYSUTCDATETIME()
        OUTPUT DELETED.stock AS stock_before, INSERTED.stock AS stock_after
        WHERE id = @vid AND product_id = @pid AND stock <= 2147483647 - @qty;`);
    if (r.rowsAffected[0] !== 1) throw new Error('Variant stock changed during receive');
    const { stock_before, stock_after } = r.recordset[0];
    await recordInventoryMovement(tx, { productId: it.product_id, variantId: it.variant_id, receiptId, type: 'PURCHASE_RECEIPT',
      delta: it.quantity, before: stock_before, after: stock_after, reason: null, actorUserId });
    changes.push({ product_id: it.product_id, variant_id: it.variant_id, quantity: it.quantity, stock_before, stock_after });
  }
  return changes;
}

module.exports = { receiveReceipt };
