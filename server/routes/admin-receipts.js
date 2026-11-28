'use strict';
// /api/admin/receipts — phiếu nhập kho. Gắn trong routes/admin.js SAU verifyFirebaseToken +
// requireBackOffice; từng route gắn requirePermission riêng.
//   GET   /                        receipt:read    — danh sách: status, supplier_id, q (mã phiếu), page, limit (≤ 50).
//   GET   /receivable-variants     receipt:create  — ?product_id= : biến thể lá theo chế độ sản phẩm (kèm tồn, cờ bật/tắt).
//   GET   /:id                     receipt:read    — chi tiết + dòng hàng + người lập / gửi / duyệt / từ chối / nhận / huỷ.
//   POST  /                        receipt:create  — tạo phiếu nháp; NCC phải đang hợp tác.
//   PUT   /:id                     receipt:create  — sửa phiếu nháp (thay toàn bộ dòng hàng); ai có quyền đều sửa được,
//                                                    kể cả phiếu người khác lập. Chỉ kiểm NCC khi ĐỔI sang NCC khác.
//   POST  /:id/submit              receipt:create  — draft -> pending.
//   POST  /:id/approve             receipt:approve — pending -> approved; kiểm lại từng dòng còn là biến thể lá.
//   POST  /:id/reject              receipt:approve — pending -> draft, bắt buộc lý do.
//   POST  /:id/cancel              receipt:create  — draft | pending -> cancelled; huỷ phiếu approved cần thêm receipt:approve.
//   POST  /:id/receive             receipt:receive — approved -> received: nhận đủ 1 lần, cộng tồn biến thể + sản phẩm,
//                                                    ghi sổ kho PURCHASE_RECEIPT (lib/purchase-receipt-receive.js).
// NCC ngừng hợp tác chỉ chặn phiếu MỚI (và đổi sang NCC đó); phiếu dở vẫn gửi duyệt / duyệt / huỷ được.
// Mọi chuyển trạng thái: khoá dòng phiếu UPDLOCK, kiểm trạng thái trong tx (sai -> 409), audit RECEIPT_* cùng tx
// (audit() lỗi -> rollback, 500). Email người thao tác chỉ trả cho ai có user:view_admin_detail.
const router = require('express').Router();
const { requirePermission } = require('../middleware/requirePermission');
const { can } = require('../lib/permissions');
const { getPool, sql } = require('../db');
const { audit } = require('../lib/audit');
const { SIZE_CONFIGURED_SQL, COLOR_CONFIGURED_SQL } = require('../lib/size-variants');
const R = require('../lib/purchase-receipt');
const { createSnapshot, updateSnapshot, statusChange } = require('../lib/receipt-audit');
const { receiveReceipt } = require('../lib/purchase-receipt-receive');
const isUniqueViolation = err => err && (err.number === 2627 || err.number === 2601);

const { ReceiptError } = R;
const notFound = () => new ReceiptError(404, 'RECEIPT_NOT_FOUND', 'Không tìm thấy phiếu nhập');
const badState = (status, message = 'Phiếu nhập không ở trạng thái cho phép thao tác này') =>
  new ReceiptError(409, 'RECEIPT_INVALID_STATE', message, { current_status: status });
const itemsInvalid = items => new ReceiptError(409, 'RECEIPT_ITEMS_INVALID',
  'Có dòng hàng không còn là biến thể nhập kho hợp lệ', { items });
const forbidden = () => Object.assign(new ReceiptError(403, 'FORBIDDEN', 'Tài khoản không có quyền thực hiện thao tác này'),
  { deny: true });
const EXTRA_KEYS = ['field', 'index', 'current_status', 'items'];

function errorBody(err) {
  const body = { status: 'error', code: err.code, message: err.message };
  for (const k of EXTRA_KEYS) if (err.extra && Object.hasOwn(err.extra, k)) body[k] = err.extra[k];
  return body;
}
// ctx.tx: transaction đang mở (null sau commit) — lỗi bất kỳ -> rollback trong catch.
function handle(label, action) {
  return async (req, res) => {
    const ctx = { tx: null };
    try {
      const out = await action(req, ctx);
      res.status(out.status || 200).json(out.body);
    } catch (err) {
      if (ctx.tx) { try { await ctx.tx.rollback(); } catch (_) { /* SQL đã tự rollback */ } }
      if (err instanceof ReceiptError) {
        // Chặn vì thiếu quyền trong handler: cùng body + cùng loại SecurityEvents như requirePermission.
        if (err.deny) res.locals.securityEventType = 'PERMISSION_DENIED';
        return res.status(err.status).json(errorBody(err));
      }
      console.error(`[admin-receipts] ${label} error:`, err.message);
      res.status(500).json({ status: 'error', code: 'RECEIPT_ADMIN_ERROR', message: 'Không xử lý được phiếu nhập. Vui lòng thử lại' });
    }
  };
}
async function begin(ctx) {
  ctx.tx = new sql.Transaction(await getPool());
  await ctx.tx.begin();
  return ctx.tx;
}
async function commit(ctx) {
  await ctx.tx.commit();
  ctx.tx = null;
}
const canSeeEmail = req => can(req.user.role, 'user:view_admin_detail');

// ---- SQL dùng chung -------------------------------------------------------------------
const PRODUCT_COLS = `p.id, p.slug, p.name_vi, p.is_active, c.slug AS category_slug,
  ${SIZE_CONFIGURED_SQL} AS size_configured, ${COLOR_CONFIGURED_SQL} AS color_configured`;
const VARIANT_COLS = `v.id, v.product_id, v.sku, v.size, v.color, v.stock, v.is_active, v.is_base,
  pc.id AS color_id, pc.label AS color_label, pc.is_active AS color_active`;
const VARIANT_FROM = `FROM dbo.product_variants v
  LEFT JOIN dbo.product_colors pc ON pc.product_id = v.product_id AND pc.color_key = v.color`;
const asVariant = v => ({ ...v, is_active: !!v.is_active, is_base: !!v.is_base, color_exists: v.color_id != null,
  color_active: v.color_id == null ? null : !!v.color_active });
const asProduct = p => ({ ...p, is_active: !!p.is_active, size_configured: !!p.size_configured, color_configured: !!p.color_configured });

// IN (@x0, @x1, ...) tham số hoá; ids đã là số nguyên dương.
function inList(request, prefix, ids) {
  ids.forEach((id, i) => request.input(prefix + i, sql.Int, id));
  return ids.map((_, i) => '@' + prefix + i).join(', ');
}
// Đọc sản phẩm + biến thể của các dòng (trong tx), kiểm biến thể lá -> 409 RECEIPT_ITEMS_INVALID nếu có dòng sai.
async function checkLeafItems(tx, items) {
  const productIds = [...new Set(items.map(i => i.product_id))], variantIds = items.map(i => i.variant_id);
  const pr = new sql.Request(tx);
  const products = (await pr.query(`SELECT ${PRODUCT_COLS} FROM dbo.products p JOIN dbo.categories c ON c.id = p.category_id
    WHERE p.id IN (${inList(pr, 'p', productIds)});`)).recordset.map(asProduct);
  const vr = new sql.Request(tx);
  const variants = (await vr.query(`SELECT ${VARIANT_COLS} ${VARIANT_FROM}
    WHERE v.id IN (${inList(vr, 'v', variantIds)});`)).recordset.map(asVariant);
  const pmap = new Map(products.map(p => [p.id, p])), vmap = new Map(variants.map(v => [v.id, v]));
  const bad = R.checkItems(items, pmap, vmap);
  if (bad.length) throw itemsInvalid(bad);
  return { products: pmap, variants: vmap };
}
// Khoá NCC (UPDLOCK, HOLDLOCK) để không bị ngừng hợp tác giữa chừng; không có -> 404, đã ngừng -> 409.
async function lockActiveSupplier(tx, supplierId) {
  const r = await new sql.Request(tx).input('sid', sql.Int, supplierId)
    .query('SELECT s.id, s.is_active FROM dbo.suppliers s WITH (UPDLOCK, HOLDLOCK) WHERE s.id = @sid;');
  if (!r.recordset.length) throw new ReceiptError(404, 'RECEIPT_SUPPLIER_NOT_FOUND', 'Không tìm thấy nhà cung cấp', { field: 'supplier_id' });
  if (!r.recordset[0].is_active) {
    throw new ReceiptError(409, 'RECEIPT_SUPPLIER_INACTIVE', 'Nhà cung cấp đã ngừng hợp tác, không lập phiếu mới được', { field: 'supplier_id' });
  }
}
async function lockReceipt(tx, id) {
  const r = await new sql.Request(tx).input('id', sql.Int, id).query(`SELECT r.id, r.code, r.status, r.supplier_id, r.note,
    r.expected_date FROM dbo.purchase_receipts r WITH (UPDLOCK, HOLDLOCK) WHERE r.id = @id;`);
  if (!r.recordset.length) throw notFound();
  return r.recordset[0];
}
async function readItems(tx, id) {
  return (await new sql.Request(tx).input('id', sql.Int, id).query(`SELECT i.product_id, i.variant_id, i.sku_snapshot, i.quantity,
    i.unit_cost FROM dbo.purchase_receipt_items i WHERE i.receipt_id = @id ORDER BY i.id;`)).recordset;
}
// Ghi dòng hàng: snapshot tên / SKU / size / màu lấy từ DB (đã đọc ở checkLeafItems), không tin client.
async function insertItems(tx, receiptId, items, { products, variants }) {
  const request = new sql.Request(tx).input('rid', sql.Int, receiptId);
  const values = items.map((it, i) => {
    const v = variants.get(it.variant_id), p = products.get(it.product_id);
    request.input('pid' + i, sql.Int, it.product_id).input('vid' + i, sql.Int, it.variant_id)
      .input('qty' + i, sql.Int, it.quantity).input('cost' + i, sql.Int, it.unit_cost)
      .input('name' + i, sql.NVarChar(200), p.name_vi).input('sku' + i, sql.VarChar(80), v.sku)
      .input('size' + i, sql.NVarChar(40), v.size == null ? null : v.size)
      .input('color' + i, sql.NVarChar(80), v.color_label == null ? null : v.color_label);
    return `(@rid, @pid${i}, @vid${i}, @qty${i}, @cost${i}, @name${i}, @sku${i}, @size${i}, @color${i})`;
  });
  await request.query(`INSERT INTO dbo.purchase_receipt_items
    (receipt_id, product_id, variant_id, quantity, unit_cost, name_snapshot, sku_snapshot, size_snapshot, color_snapshot)
    VALUES ${values.join(', ')};`);
  return items.map(it => ({ ...it, sku: variants.get(it.variant_id).sku }));
}

const ACTOR_SQL = R.ACTORS.map(k => `r.${k}_by, r.${k}_at, u_${k}.id AS ${k}_user, u_${k}.display_name AS ${k}_name,
  u_${k}.email AS ${k}_email`).join(', ');
const ACTOR_JOIN = R.ACTORS.map(k => `LEFT JOIN dbo.users u_${k} ON u_${k}.id = r.${k}_by`).join(' ');
const TOTALS_SQL = `(SELECT COUNT(*) FROM dbo.purchase_receipt_items i WHERE i.receipt_id = r.id) AS item_count,
  (SELECT ISNULL(SUM(CAST(i.quantity AS BIGINT)), 0) FROM dbo.purchase_receipt_items i WHERE i.receipt_id = r.id) AS total_quantity,
  (SELECT ISNULL(SUM(CAST(i.quantity AS BIGINT) * i.unit_cost), 0) FROM dbo.purchase_receipt_items i WHERE i.receipt_id = r.id) AS total_cost`;
// Tiền tính BIGINT: INT * INT tràn khi vượt ~2,1 tỷ (vd 100 cái × 25.000.000). Chi tiết phiếu cộng trong JS (number, chính xác
// tới ~9·10^15).

async function loadDetail(request, id, opts) {
  const { recordsets } = await request.input('id', sql.Int, id).query(`
    SELECT r.id, r.code, r.status, r.supplier_id, s.code AS supplier_code, s.name AS supplier_name, s.is_active AS supplier_active,
      r.note, r.expected_date, r.updated_at, r.reject_reason, r.cancel_reason, ${ACTOR_SQL}
    FROM dbo.purchase_receipts r JOIN dbo.suppliers s ON s.id = r.supplier_id ${ACTOR_JOIN}
    WHERE r.id = @id;
    SELECT i.id, i.product_id, i.variant_id, i.quantity, i.unit_cost, i.name_snapshot, i.sku_snapshot, i.size_snapshot,
      i.color_snapshot FROM dbo.purchase_receipt_items i WHERE i.receipt_id = @id ORDER BY i.id;`);
  if (!recordsets[0].length) throw notFound();
  return R.toReceiptDetail(recordsets[0][0], recordsets[1], opts);
}
const detailAfterCommit = async (req, id) => loadDetail((await getPool()).request(), id, { canSeeEmail: canSeeEmail(req) });

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ---- GET /api/admin/receipts ---------------------------------------------------------
router.get('/', requirePermission('receipt:read'), handle('list', async req => {
  const { page, limit, status, supplierId, q } = R.parseListQuery(req.query);
  const request = (await getPool()).request().input('page', sql.Int, page).input('limit', sql.Int, limit);
  const where = [];
  if (status !== 'all') { where.push('r.status = @status'); request.input('status', sql.VarChar(12), status); }
  if (supplierId !== null) { where.push('r.supplier_id = @supplier_id'); request.input('supplier_id', sql.Int, supplierId); }
  if (q !== null) { where.push('r.code LIKE @q'); request.input('q', sql.VarChar(400), q); }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const { recordsets } = await request.query(`
    DECLARE @total INT = (SELECT COUNT(*) FROM dbo.purchase_receipts r${whereSql});
    DECLARE @pages INT = CEILING(@total / CAST(@limit AS FLOAT));
    DECLARE @actualPage INT = CASE WHEN @total = 0 THEN 1 WHEN @page > @pages THEN @pages ELSE @page END;
    SELECT @total AS total, @actualPage AS page;
    SELECT r.id, r.code, r.status, r.supplier_id, s.code AS supplier_code, s.name AS supplier_name, s.is_active AS supplier_active,
      r.expected_date, r.created_at, r.updated_at, r.created_by, u_created.id AS created_user,
      u_created.display_name AS created_name, u_created.email AS created_email, ${TOTALS_SQL}
    FROM dbo.purchase_receipts r JOIN dbo.suppliers s ON s.id = r.supplier_id
    LEFT JOIN dbo.users u_created ON u_created.id = r.created_by${whereSql}
    ORDER BY r.created_at DESC, r.id DESC OFFSET ((@actualPage - 1) * @limit) ROWS FETCH NEXT @limit ROWS ONLY;`);
  const meta = recordsets[0][0], opts = { canSeeEmail: canSeeEmail(req) };
  return { body: { status: 'ok', page: meta.page, limit, total: meta.total, totalPages: Math.ceil(meta.total / limit),
    receipts: recordsets[1].map(row => R.toReceiptListRow(row, opts)) } };
}));

// ---- GET /api/admin/receipts/receivable-variants?product_id= ---------------------------
// Khai TRƯỚC /:id.
router.get('/receivable-variants', requirePermission('receipt:create'), handle('receivable-variants', async req => {
  const productId = R.parseProductId(req.query.product_id);
  const pool = await getPool();
  const product = (await pool.request().input('pid', sql.Int, productId).query(`SELECT ${PRODUCT_COLS}
    FROM dbo.products p JOIN dbo.categories c ON c.id = p.category_id WHERE p.id = @pid;`)).recordset.map(asProduct)[0];
  if (!product) throw new ReceiptError(404, 'RECEIPT_PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm');
  const variants = (await pool.request().input('pid', sql.Int, productId).query(`SELECT ${VARIANT_COLS} ${VARIANT_FROM}
    WHERE v.product_id = @pid;`)).recordset.map(asVariant).filter(v => R.isLeafVariant(product, v));
  return { body: { status: 'ok',
    product: { id: product.id, name_vi: product.name_vi, slug: product.slug, is_active: product.is_active, mode: R.productMode(product) },
    variants: R.sortLeafVariants(product, variants).map(v => ({ id: v.id, sku: v.sku, size: v.size == null ? null : v.size,
      color_key: v.color == null ? null : v.color, color_label: v.color_label == null ? null : v.color_label, stock: v.stock,
      is_active: v.is_active, color_active: v.color_active })) } };
}));

// ---- GET /api/admin/receipts/:id -------------------------------------------------------
router.get('/:id', requirePermission('receipt:read'), handle('detail', async req => {
  const id = R.parseId(req.params.id);
  return { body: { status: 'ok', receipt: await detailAfterCommit(req, id) } };
}));

// ---- POST /api/admin/receipts ----------------------------------------------------------
router.post('/', requirePermission('receipt:create'), handle('create', async (req, ctx) => {
  const input = R.parseReceiptInput(req.body);
  const tx = await begin(ctx);
  await lockActiveSupplier(tx, input.supplierId);
  const leaf = await checkLeafItems(tx, input.items);
  const ins = await new sql.Request(tx).input('sid', sql.Int, input.supplierId).input('note', sql.NVarChar(500), input.note)
    .input('expected_date', sql.Date, R.dateParam(input.expectedDate)).input('uid', sql.Int, req.user.id)
    .query(`INSERT INTO dbo.purchase_receipts (supplier_id, note, expected_date, created_by)
      OUTPUT INSERTED.id, INSERTED.code, INSERTED.status
      VALUES (@sid, @note, @expected_date, @uid);`);
  const head = ins.recordset[0];
  const saved = await insertItems(tx, head.id, input.items, leaf);
  await audit(tx, req, { action: 'RECEIPT_CREATE', entityType: 'receipt', entityId: head.id, before: null,
    after: createSnapshot({ ...head, supplier_id: input.supplierId, note: input.note, expected_date: input.expectedDate }, saved) });
  await commit(ctx);
  return { status: 201, body: { status: 'ok', receipt: await detailAfterCommit(req, head.id) } };
}));

// ---- PUT /api/admin/receipts/:id -------------------------------------------------------
router.put('/:id', requirePermission('receipt:create'), handle('update', async (req, ctx) => {
  const id = R.parseId(req.params.id);
  const input = R.parseReceiptInput(req.body);
  const tx = await begin(ctx);
  const current = await lockReceipt(tx, id);
  if (!R.canTransition(current.status, 'update')) throw badState(current.status, 'Chỉ sửa được phiếu nhập ở trạng thái nháp');
  // NCC ngừng hợp tác chỉ chặn phiếu mới: giữ NCC cũ (kể cả đã ngừng) thì cho qua; đổi sang NCC khác thì kiểm.
  if (input.supplierId !== current.supplier_id) await lockActiveSupplier(tx, input.supplierId);
  const beforeItems = await readItems(tx, id);
  const leaf = await checkLeafItems(tx, input.items);
  const upd = await new sql.Request(tx).input('id', sql.Int, id).input('sid', sql.Int, input.supplierId)
    .input('note', sql.NVarChar(500), input.note).input('expected_date', sql.Date, R.dateParam(input.expectedDate))
    .query(`UPDATE dbo.purchase_receipts SET supplier_id = @sid, note = @note, expected_date = @expected_date,
      updated_at = SYSUTCDATETIME() WHERE id = @id AND status = 'draft';`);
  if (upd.rowsAffected[0] !== 1) throw new Error('Receipt changed during update');
  await new sql.Request(tx).input('id', sql.Int, id).query('DELETE FROM dbo.purchase_receipt_items WHERE receipt_id = @id;');
  const saved = await insertItems(tx, id, input.items, leaf);
  // Không đổi gì vẫn ghi {} / {} (như PRODUCT_UPDATE).
  await audit(tx, req, { action: 'RECEIPT_UPDATE', entityType: 'receipt', entityId: id,
    before: updateSnapshot(current, beforeItems),
    after: updateSnapshot({ supplier_id: input.supplierId, note: input.note, expected_date: input.expectedDate }, saved) });
  await commit(ctx);
  return { body: { status: 'ok', receipt: await detailAfterCommit(req, id) } };
}));

// ---- chuyển trạng thái -------------------------------------------------------------------
// stamp: cột người + thời điểm của mốc; reason: cột lý do (reject / cancel).
// receive: cộng tồn + ghi sổ kho (lib/purchase-receipt-receive.js) trong cùng tx, trước khi chuyển received.
const STEPS = {
  submit: { auditAction: 'RECEIPT_SUBMIT', stamp: 'submitted', checkItems: true },
  approve: { auditAction: 'RECEIPT_APPROVE', stamp: 'approved', checkItems: true },
  reject: { auditAction: 'RECEIPT_REJECT', stamp: 'rejected', reason: 'reject_reason' },
  cancel: { auditAction: 'RECEIPT_CANCEL', stamp: 'cancelled', reason: 'cancel_reason' },
  receive: { auditAction: 'RECEIPT_RECEIVE', stamp: 'received', receive: true },
};
function transition(action) {
  const step = STEPS[action];
  return handle(action, async (req, ctx) => {
    const id = R.parseId(req.params.id);
    const reason = step.reason ? R.parseReason(req.body) : null;
    const tx = await begin(ctx);
    const current = await lockReceipt(tx, id);
    const to = R.nextStatus(current.status, action);
    if (!to) throw badState(current.status);
    // Huỷ phiếu đã duyệt cần receipt:approve — kiểm SAU khi khoá phiếu (trạng thái đọc trong tx).
    if (action === 'cancel' && R.cancelNeedsApprove(current.status) && !can(req.user.role, 'receipt:approve')) throw forbidden();
    // Gửi duyệt / duyệt: kiểm lại từng dòng còn là biến thể lá. KHÔNG kiểm NCC (NCC đã ngừng hợp tác chỉ chặn lập phiếu mới; phiếu dở vẫn xử lý tiếp).
    if (step.checkItems) await checkLeafItems(tx, await readItems(tx, id));
    let stockChanges = null;
    if (step.receive) {
      try { stockChanges = await receiveReceipt(tx, { receiptId: id, actorUserId: req.user.id }); }
      catch (err) {
        // Lớp chặn cuối UX_inventory_movements_receipt_variant (phiếu đã cộng kho) -> 409 như sai trạng thái.
        if (isUniqueViolation(err)) throw badState(current.status, 'Phiếu nhập đã được nhận hàng');
        throw err;
      }
    }
    const request = new sql.Request(tx).input('id', sql.Int, id).input('from', sql.VarChar(12), current.status)
      .input('to', sql.VarChar(12), to).input('uid', sql.Int, req.user.id);
    const sets = ['status = @to', `${step.stamp}_by = @uid`, `${step.stamp}_at = SYSUTCDATETIME()`];
    if (step.reason) { request.input('reason', sql.NVarChar(250), reason); sets.push(`${step.reason} = @reason`); }
    const upd = await request.query(`UPDATE dbo.purchase_receipts SET ${sets.join(', ')}, updated_at = SYSUTCDATETIME()
      WHERE id = @id AND status = @from;`);
    if (upd.rowsAffected[0] !== 1) throw new Error('Receipt changed during ' + action);
    await audit(tx, req, { action: step.auditAction, entityType: 'receipt', entityId: id,
      ...statusChange(current.status, to, step.reason ? { [step.reason]: reason } : step.receive ? { stock: stockChanges } : {}) });
    await commit(ctx);
    const body = { status: 'ok', receipt: await detailAfterCommit(req, id) };
    if (step.receive) body.stock_changes = stockChanges;
    return { body };
  });
}
router.post('/:id/submit', requirePermission('receipt:create'), transition('submit'));
router.post('/:id/approve', requirePermission('receipt:approve'), transition('approve'));
router.post('/:id/reject', requirePermission('receipt:approve'), transition('reject'));
router.post('/:id/cancel', requirePermission('receipt:create'), transition('cancel'));
router.post('/:id/receive', requirePermission('receipt:receive'), transition('receive'));

module.exports = router;
