'use strict';
// /api/admin/suppliers — nhà cung cấp. Gắn trong routes/admin.js SAU verifyFirebaseToken + requireBackOffice;
// từng route gắn requirePermission riêng.
//   GET   /            supplier:read  — danh sách: q (mã / tên / SĐT), status=active|inactive|all (mặc định all),
//                                      page, limit (mặc định 20, tối đa 50); created_at DESC, id DESC.
//   GET   /:id         supplier:read  — chi tiết; không có -> 404 SUPPLIER_NOT_FOUND.
//   POST  /            supplier:write — tạo; trùng mã -> 409 SUPPLIER_CODE_EXISTS; audit SUPPLIER_CREATE cùng tx.
//   PUT   /:id         supplier:write — sửa từng phần, khoá dòng UPDLOCK. Mã không sửa được (khác mã hiện tại ->
//                                      400 SUPPLIER_CODE_IMMUTABLE). Audit SUPPLIER_UPDATE: before = dòng đã khoá,
//                                      after = OUTPUT của UPDATE; không cột nào đổi vẫn ghi {} / {} như PRODUCT_UPDATE.
//   PATCH /:id/status  supplier:write — { is_active }; audit SUPPLIER_STATUS; trạng thái không đổi -> 200, không ghi log.
//                                      Ngừng hợp tác luôn được phép kể cả khi NCC còn phiếu nhập dở; quy tắc
//                                      "không lập phiếu mới với NCC đã ngừng" kiểm ở API phiếu nhập.
// Lỗi: { status: 'error', code, message, field? }. audit() lỗi -> rollback cả thao tác, 500.
const router = require('express').Router();
const { requirePermission } = require('../middleware/requirePermission');
const { getPool, sql } = require('../db');
const { audit } = require('../lib/audit');
const {
  SupplierError, FIELDS, COLUMNS, parseSupplierCreate, parseSupplierUpdate, parseStatusInput, parseId, parseListQuery,
  searchPatterns, toSupplierDto,
} = require('../lib/suppliers');
const { supplierColumns, createSnapshot, statusChange } = require('../lib/supplier-audit');

// Kiểu SQL đúng từng cột của dbo.suppliers (029).
const SQL_TYPE = {
  code: sql.VarChar(20), name: sql.NVarChar(200), contact_name: sql.NVarChar(120), phone: sql.VarChar(20),
  email: sql.VarChar(255), address: sql.NVarChar(300), tax_code: sql.VarChar(20), note: sql.NVarChar(500),
};
const SELECT_COLS = COLUMNS.map(c => 's.' + c).join(', ');
const OUTPUT_COLS = COLUMNS.map(c => 'INSERTED.' + c).join(', ');
const LOCK_SQL = `SELECT ${SELECT_COLS} FROM dbo.suppliers s WITH (UPDLOCK, HOLDLOCK) WHERE s.id = @id;`;

const notFound = () => new SupplierError(404, 'SUPPLIER_NOT_FOUND', 'Không tìm thấy nhà cung cấp');
const noFields = () => new SupplierError(400, 'SUPPLIER_INVALID_INPUT', 'Không có trường hợp lệ nào để cập nhật');
const isUniqueViolation = err => err && (err.number === 2627 || err.number === 2601);

function errorBody(err) {
  const body = { status: 'error', code: err.code, message: err.message };
  if (err.field) body.field = err.field;
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
      if (err instanceof SupplierError) return res.status(err.status).json(errorBody(err));
      if (isUniqueViolation(err)) {
        return res.status(409).json({ status: 'error', code: 'SUPPLIER_CODE_EXISTS', message: 'Mã nhà cung cấp đã tồn tại' });
      }
      console.error(`[admin-suppliers] ${label} error:`, err.message);
      res.status(500).json({ status: 'error', code: 'SUPPLIER_ADMIN_ERROR', message: 'Không xử lý được nhà cung cấp. Vui lòng thử lại' });
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
async function lockSupplier(tx, id) {
  const r = await new sql.Request(tx).input('id', sql.Int, id).query(LOCK_SQL);
  if (!r.recordset.length) throw notFound();
  return r.recordset[0];
}

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ---- GET /api/admin/suppliers ------------------------------------------------
router.get('/', requirePermission('supplier:read'), handle('list', async req => {
  const { page, limit, status, q } = parseListQuery(req.query);
  const request = (await getPool()).request().input('page', sql.Int, page).input('limit', sql.Int, limit);
  const where = [];
  if (status === 'active') where.push('s.is_active = 1');
  if (status === 'inactive') where.push('s.is_active = 0');
  const pattern = searchPatterns(q);
  if (pattern) {
    where.push('(s.code LIKE @q OR s.name LIKE @q OR s.phone LIKE @q_phone)');
    request.input('q', sql.NVarChar(400), pattern.text).input('q_phone', sql.NVarChar(400), pattern.phone);
  }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const { recordsets } = await request.query(`
    DECLARE @total INT = (SELECT COUNT(*) FROM dbo.suppliers s${whereSql});
    DECLARE @pages INT = CEILING(@total / CAST(@limit AS FLOAT));
    DECLARE @actualPage INT = CASE WHEN @total = 0 THEN 1 WHEN @page > @pages THEN @pages ELSE @page END;
    SELECT @total AS total, @actualPage AS page;
    SELECT ${SELECT_COLS} FROM dbo.suppliers s${whereSql}
    ORDER BY s.created_at DESC, s.id DESC OFFSET ((@actualPage - 1) * @limit) ROWS FETCH NEXT @limit ROWS ONLY;`);
  const meta = recordsets[0][0];
  return { body: { status: 'ok', page: meta.page, limit, total: meta.total, totalPages: Math.ceil(meta.total / limit),
    suppliers: recordsets[1].map(toSupplierDto) } };
}));

// ---- GET /api/admin/suppliers/:id --------------------------------------------
router.get('/:id', requirePermission('supplier:read'), handle('detail', async req => {
  const id = parseId(req.params.id);
  const r = await (await getPool()).request().input('id', sql.Int, id)
    .query(`SELECT ${SELECT_COLS} FROM dbo.suppliers s WHERE s.id = @id;`);
  if (!r.recordset.length) throw notFound();
  return { body: { status: 'ok', supplier: toSupplierDto(r.recordset[0]) } };
}));

// ---- POST /api/admin/suppliers -----------------------------------------------
router.post('/', requirePermission('supplier:write'), handle('create', async (req, ctx) => {
  const { values } = parseSupplierCreate(req.body);
  const tx = await begin(ctx);
  const request = new sql.Request(tx);
  for (const f of FIELDS) request.input(f, SQL_TYPE[f], values[f]);
  // Trùng mã: UQ_suppliers_code chặn (2627) -> 409; không kiểm trước bằng SELECT.
  const ins = await request.query(`INSERT INTO dbo.suppliers (${FIELDS.join(', ')})
    OUTPUT ${OUTPUT_COLS}
    VALUES (${FIELDS.map(f => '@' + f).join(', ')});`);
  const row = ins.recordset[0];
  await audit(tx, req, { action: 'SUPPLIER_CREATE', entityType: 'supplier', entityId: row.id,
    before: null, after: createSnapshot(row) });
  await commit(ctx);
  return { status: 201, body: { status: 'ok', supplier: toSupplierDto(row) } };
}));

// ---- PUT /api/admin/suppliers/:id --------------------------------------------
router.put('/:id', requirePermission('supplier:write'), handle('update', async (req, ctx) => {
  const id = parseId(req.params.id);
  const { code, updates } = parseSupplierUpdate(req.body);
  const fields = Object.keys(updates);
  if (!fields.length && code === undefined) throw noFields();
  const tx = await begin(ctx);
  const current = await lockSupplier(tx, id);
  if (code !== undefined && code !== current.code) {
    throw new SupplierError(400, 'SUPPLIER_CODE_IMMUTABLE', 'Mã nhà cung cấp không sửa được sau khi tạo', 'code');
  }
  if (!fields.length) throw noFields(); // chỉ gửi code trùng mã hiện tại: không có gì để sửa
  const request = new sql.Request(tx).input('id', sql.Int, id);
  for (const f of fields) request.input(f, SQL_TYPE[f], updates[f]);
  const upd = await request.query(`UPDATE dbo.suppliers
    SET ${fields.map(f => `${f} = @${f}`).join(', ')}, updated_at = SYSUTCDATETIME()
    OUTPUT ${OUTPUT_COLS}
    WHERE id = @id;`);
  if (upd.rowsAffected[0] !== 1) throw new Error('Supplier disappeared during update');
  const row = upd.recordset[0];
  await audit(tx, req, { action: 'SUPPLIER_UPDATE', entityType: 'supplier', entityId: id,
    before: supplierColumns(current), after: supplierColumns(row) });
  await commit(ctx);
  return { body: { status: 'ok', supplier: toSupplierDto(row) } };
}));

// ---- PATCH /api/admin/suppliers/:id/status -----------------------------------
router.patch('/:id/status', requirePermission('supplier:write'), handle('status', async (req, ctx) => {
  const id = parseId(req.params.id);
  const isActive = parseStatusInput(req.body);
  const tx = await begin(ctx);
  const current = await lockSupplier(tx, id);
  if (!!current.is_active === isActive) { // đã đúng trạng thái đích: không ghi gì, không ghi log
    await commit(ctx);
    return { body: { status: 'ok', supplier: toSupplierDto(current) } };
  }
  const upd = await new sql.Request(tx).input('id', sql.Int, id).input('active', sql.Bit, isActive)
    .query(`UPDATE dbo.suppliers SET is_active = @active, updated_at = SYSUTCDATETIME()
      OUTPUT ${OUTPUT_COLS}
      WHERE id = @id;`);
  if (upd.rowsAffected[0] !== 1) throw new Error('Supplier disappeared during status change');
  const row = upd.recordset[0];
  await audit(tx, req, { action: 'SUPPLIER_STATUS', entityType: 'supplier', entityId: id,
    ...statusChange(current.is_active, row.is_active) });
  await commit(ctx);
  return { body: { status: 'ok', supplier: toSupplierDto(row) } };
}));

module.exports = router;
