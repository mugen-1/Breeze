'use strict';
// Xuất số liệu kiểm thử chức năng "Nhà cung cấp + phiếu nhập kho" cho báo cáo, trên SQL Server thật bằng DB TẠM tự tạo
// và tự xoá (setup-db --fresh). KHÔNG ghi gì vào DB của .env (BreezeShopDB) hay BreezeShopDB_Receipt: chỉ SELECT vài con
// số trước / sau để chứng minh không đổi. Gọi router thật (/api/admin, /api/orders) qua HTTP; đăng nhập giả bằng header
// x-test-user (đọc id / email / role từ DB tạm, như verify-audit-sql.js); có securityLogger; KHÔNG có rate limit.
// Kết quả: in console + ghi outputs/bao-cao-nhap-kho-YYYY-MM-DD-HHmm.md và .json cùng tên (đã exclude khỏi git).
// File kết quả KHÔNG chứa tên máy, tên người dùng Windows hay đường dẫn thư mục.
// Chạy (trong server/, cần sqlcmd + Windows auth như các script verify-*-sql khác):
//   node scripts/report-purchase-receipts.js
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const mainDb = process.env.DB_NAME;
const COPY_DB = 'BreezeShopDB_Receipt';
const dbName = 'BreezeReportTest_' + process.pid + '_' + Date.now();
if (!/^BreezeReportTest_[0-9]+_[0-9]+$/.test(dbName) || [String(mainDb), COPY_DB].some(n => n.toLowerCase() === dbName.toLowerCase())) {
  throw new Error('Unsafe test database');
}
process.env.DB_NAME = dbName; // trước require('../db'): getPool() trỏ vào DB tạm
const { getPool, sql, config } = require('../db');
if (config.database !== dbName) throw new Error('Unsafe test database');
const quoted = '[' + dbName + ']', serverDir = path.join(__dirname, '..');
const OUT_DIR = path.join(serverDir, '..', 'outputs');
const CONCURRENT_DUP = 10, CONCURRENT_CHECKOUT = 20, PERF_SIZES = [1, 10, 50, 200], PERF_RUNS = 5, PERF_PRODUCTS = 200;

let pool, server, created = false;
const R = { meta: {}, prep: [], scenario: [], stock: { variants: [], products: [], ledger: null }, permissions: { rows: [], summary: null },
  validation: [], concurrency: [], performance: [], safety: [], failures: [] };

function adminSql(statement) {
  return execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-h', '-1', '-Q',
    'SET NOCOUNT ON; ' + statement], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
async function otherDbSnapshot(name) { // chỉ đọc DB khác (chứng minh không đổi); DB chưa có bảng phiếu -> null
  const p = await new sql.ConnectionPool({ ...config, database: name }).connect();
  try {
    const base = (await p.request().query(`SELECT (SELECT COUNT(*) FROM dbo.inventory_movements) AS movements,
      (SELECT COUNT(*) FROM dbo.products) AS products, CASE WHEN OBJECT_ID('dbo.purchase_receipts') IS NULL THEN 0 ELSE 1 END AS has_receipts;`)).recordset[0];
    // Câu riêng: DB chưa chạy 029 thì không được nhắc tên bảng (lỗi biên dịch "Invalid object name").
    const receipts = base.has_receipts ? (await p.request().query('SELECT COUNT(*) AS n FROM dbo.purchase_receipts;')).recordset[0].n : null;
    return { movements: base.movements, products: base.products, receipts };
  } finally { await p.close(); }
}
const dbExists = name => adminSql(`SELECT COUNT(*) FROM sys.databases WHERE name = N'${name.replace(/'/g, "''")}';`).trim() === '1';
const wait = ms => new Promise(r => setTimeout(r, ms));
const ms = t0 => Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10; // 1 chữ số thập phân
const maxId = async table => Number((await pool.request().query(`SELECT ISNULL(MAX(id), 0) AS m FROM dbo.${table};`)).recordset[0].m);
async function countSince(table, from, where = '1=1') {
  return (await pool.request().input('from', sql.BigInt, from).query(`SELECT COUNT(*) AS n FROM dbo.${table} WHERE id > @from AND ${where};`)).recordset[0].n;
}
function fail(section, name, detail) { R.failures.push(`${section}: ${name}${detail ? ' — ' + detail : ''}`); }

async function main() {
  const t0 = process.hrtime.bigint();
  const mainBefore = await otherDbSnapshot(mainDb);
  const copyBefore = dbExists(COPY_DB) ? await otherDbSnapshot(COPY_DB) : null;
  try {
    adminSql(`CREATE DATABASE ${quoted};`); created = true;
    adminSql(`ALTER AUTHORIZATION ON DATABASE::${quoted} TO [${String(config.user).replace(/]/g, ']]')}];`);
    console.log('Created disposable database:', dbName);
    execFileSync(process.execPath, ['scripts/setup-db.js', '--fresh'], { cwd: serverDir, env: { ...process.env, DB_NAME: dbName },
      stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 });
    pool = await getPool();
    if ((await pool.request().query('SELECT DB_NAME() AS d;')).recordset[0].d !== dbName) throw new Error('pool không trỏ DB tạm');

    // ---- thông tin môi trường (không tên máy / user / đường dẫn) ----
    const v = (await pool.request().query(`SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(64)) AS ver,
      CAST(SERVERPROPERTY('ProductLevel') AS NVARCHAR(64)) AS lvl, CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128)) AS ed,
      @@VERSION AS full_version;`)).recordset[0];
    const cpus = os.cpus();
    R.meta = {
      generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }),
      os: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
      cpu: `${cpus.length ? cpus[0].model.trim() : '?'} × ${cpus.length} luồng`,
      ram: `${Math.round(os.totalmem() / 1024 ** 3)} GB`,
      node: process.version,
      sql_server: `${String(v.full_version).split('\n')[0].replace(/\s+/g, ' ').trim()} — ${v.ed} ${v.lvl} ${v.ver}`,
      temp_db: dbName,
      notes: ['Đăng nhập giả: header x-test-user, role đọc từ dbo.users của DB tạm (không gọi Firebase).',
        'Router thật /api/admin và /api/orders qua HTTP; có securityLogger; KHÔNG có rate limit.',
        'Thời gian là thời gian HTTP khứ hồi trên máy chạy (localhost), làm tròn 0,1 ms.',
        'DB tạm tự tạo bằng setup-db --fresh và tự xoá khi chạy xong.'],
    };

    // ---- router thật, đăng nhập giả ----
    require.cache[require.resolve('../middleware/auth')] = { exports: {
      async verifyFirebaseToken(req, res, next) {
        const id = Number(req.headers['x-test-user']); if (!id) return res.status(401).json({ status: 'error' });
        req.user = (await pool.request().input('id', sql.Int, id).query('SELECT id, email, role, phone FROM dbo.users WHERE id=@id;')).recordset[0];
        if (!req.user) return res.status(401).json({ status: 'error' });
        next();
      },
    } };
    const express = require('express');
    const app = express();
    app.use(require('../middleware/securityLogger').securityLogger);
    app.use(express.json());
    app.use('/api/admin', require('../routes/admin'));
    app.use('/api/orders', require('../routes/orders'));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = async (who, method, url, body) => {
      const start = process.hrtime.bigint();
      const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(who) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      let json = null; try { json = await r.json(); } catch (_) { /* không phải JSON */ }
      return { status: r.status, body: json, ms: ms(start) };
    };
    const mkUser = async role => (await pool.request().input('tag', sql.VarChar(128), `report-${role}-${process.pid}`)
      .input('email', sql.VarChar(255), `${role}.report@example.test`).input('role', sql.VarChar(20), role)
      .query('INSERT INTO dbo.users(firebase_uid,email,role) OUTPUT INSERTED.id VALUES(@tag,@email,@role);')).recordset[0].id;
    const ADMIN = await mkUser('admin'), STAFF = await mkUser('staff'), CUSTOMER = await mkUser('customer');
    const ROLE_ID = { admin: ADMIN, staff: STAFF, customer: CUSTOMER };
    // Đo 1 request: status, ms, số dòng audit + sổ kho sinh ra.
    async function measured(who, method, url, body) {
      const a0 = await maxId('audit_logs'), m0 = await maxId('inventory_movements');
      const out = await call(who, method, url, body);
      out.audit = await countSince('audit_logs', a0);
      out.ledger = await countSince('inventory_movements', m0);
      return out;
    }

    // ================= Chuẩn bị =================
    const pick = async where => (await pool.request().query(`SELECT TOP (1) p.id, p.name_vi, v.id AS base FROM dbo.products p
      JOIN dbo.categories c ON c.id = p.category_id JOIN dbo.product_variants v ON v.product_id = p.id AND v.is_base = 1
      WHERE p.is_active = 1 AND ${where}
        AND NOT EXISTS (SELECT 1 FROM dbo.product_colors pc WHERE pc.product_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM dbo.product_variants nv WHERE nv.product_id = p.id AND nv.is_base = 0)
      ORDER BY p.id;`)).recordset[0];
    const spS = await pick("c.slug = 'sanpham-ao'");
    const spSM = await pick(`c.slug = 'sanpham-ao' AND p.id <> ${spS.id}`);
    if (!spS || !spSM) throw new Error('seed thiếu sản phẩm áo chỉ BASE');
    const catPlain = (await pool.request().query(`SELECT TOP (1) c.id FROM dbo.categories c
      WHERE c.slug NOT IN ('sanpham-ao','sanpham-quan','sanpham-giay') ORDER BY c.id;`)).recordset[0].id;
    async function prepStep(name, expect, fn) {
      const a0 = await maxId('audit_logs'), start = process.hrtime.bigint();
      let status = null, ok = false, detail = '';
      try { const r = await fn(); status = r.status; ok = r.ok; detail = r.detail || ''; } catch (e) { detail = e.message; }
      const row = { name, expect, status, ms: ms(start), audit: await countSince('audit_logs', a0), ok, detail };
      R.prep.push(row); if (!ok) fail('Chuẩn bị', name, detail);
      return row;
    }
    await prepStep(`SP-S (#${spS.id}): cấu hình size S / M / L`, 200, async () => {
      const r = await call(ADMIN, 'POST', `/admin/products/${spS.id}/sizes`, { sizes: ['S', 'M', 'L'] }); return { status: r.status, ok: r.status === 200 };
    });
    await prepStep(`SP-SM (#${spSM.id}): cấu hình size S / M`, 200, async () => {
      const r = await call(ADMIN, 'POST', `/admin/products/${spSM.id}/sizes`, { sizes: ['S', 'M'] }); return { status: r.status, ok: r.status === 200 };
    });
    await prepStep(`SP-SM (#${spSM.id}): thêm màu "Đen" (tự sinh Đen/S, Đen/M)`, 200, async () => {
      const r = await call(ADMIN, 'POST', `/admin/products/${spSM.id}/colors`, { label: 'Đen', swatch_hex: '#111111' }); return { status: r.status, ok: r.status === 200 };
    });
    const leafS = (await call(STAFF, 'GET', `/admin/receipts/receivable-variants?product_id=${spS.id}`)).body;
    const leafSM = (await call(STAFF, 'GET', `/admin/receipts/receivable-variants?product_id=${spSM.id}`)).body;
    await prepStep('Kiểm chế độ: SP-S = theo size (3 biến thể), SP-SM = theo size + màu (2 biến thể)', 'size / size_color', async () => {
      const ok = leafS.product.mode === 'size' && leafS.variants.length === 3 && leafSM.product.mode === 'size_color' && leafSM.variants.length === 2;
      return { status: 200, ok, detail: `${leafS.product.mode} ${leafS.variants.length}, ${leafSM.product.mode} ${leafSM.variants.length}` };
    });
    const vS = Object.fromEntries(leafS.variants.map(x => [x.size, x]));
    const vSM = Object.fromEntries(leafSM.variants.map(x => [x.size, x]));
    const perf = [];
    await prepStep(`Tạo ${PERF_PRODUCTS} sản phẩm thử (chỉ BASE) qua POST /api/admin/products`, `${PERF_PRODUCTS} × 201`, async () => {
      const tag = Date.now().toString(36);
      for (let i = 0; i < PERF_PRODUCTS; i++) {
        const r = await call(ADMIN, 'POST', '/admin/products', { slug: `rpt-${tag}-${i}`, name_vi: `SP thử ${i + 1}`, price: 100000, category_id: catPlain, stock: 0 });
        if (r.status !== 201) return { status: r.status, ok: false, detail: `lần ${i + 1}: ${r.status}` };
        perf.push({ product_id: r.body.product.id });
      }
      const ids = perf.map(p => p.product_id);
      const bases = (await pool.request().query(`SELECT product_id, id FROM dbo.product_variants WHERE is_base = 1
        AND product_id IN (${ids.join(',')});`)).recordset; // ids là số nguyên do server trả
      const map = new Map(bases.map(b => [b.product_id, b.id]));
      perf.forEach(p => { p.variant_id = map.get(p.product_id); });
      return { status: 201, ok: perf.every(p => Number.isInteger(p.variant_id)), detail: `${perf.length} sản phẩm` };
    });
    const sellable = (await pool.request().query(`SELECT TOP (2) p.id, v.id AS base FROM dbo.products p
      JOIN dbo.categories c ON c.id = p.category_id JOIN dbo.product_variants v ON v.product_id = p.id AND v.is_base = 1
      WHERE p.is_active = 1 AND v.is_active = 1 AND v.stock >= 5 AND c.slug NOT IN ('sanpham-ao','sanpham-quan','sanpham-giay')
        AND NOT EXISTS (SELECT 1 FROM dbo.product_colors pc WHERE pc.product_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM dbo.product_variants nv WHERE nv.product_id = p.id AND nv.is_base = 0)
        AND p.id NOT IN (${[spS.id, spSM.id].concat(perf.map(p => p.product_id)).join(',')})
      ORDER BY p.id;`)).recordset;

    // ================= Kịch bản chính =================
    async function scenario(name, actor, method, url, body, expect, expectAudit, expectLedger) {
      const r = await measured(ROLE_ID[actor], method, url, body);
      const ok = r.status === expect && r.audit === expectAudit && r.ledger === expectLedger;
      R.scenario.push({ name, actor, api: `${method} ${url.replace(/\/\d+/g, '/:id')}`, expect, status: r.status, ms: r.ms,
        audit: r.audit, ledger: r.ledger, ok });
      if (!ok) fail('Kịch bản', name, `status ${r.status}, audit ${r.audit}, sổ kho ${r.ledger}`);
      return r;
    }
    const supA = (await scenario('Tạo NCC A', 'admin', 'POST', '/admin/suppliers', { code: 'NCC-A', name: 'Công ty Vải A', phone: '0901234567' }, 201, 1, 0)).body.supplier;
    const supB = (await scenario('Tạo NCC B', 'admin', 'POST', '/admin/suppliers', { code: 'NCC-B', name: 'Xưởng Dệt B' }, 201, 1, 0)).body.supplier;
    const lines = (qS, qM, qDS, qDM, cost = 150000) => [
      { product_id: spS.id, variant_id: vS.S.id, quantity: qS, unit_cost: cost },
      { product_id: spS.id, variant_id: vS.M.id, quantity: qM, unit_cost: cost },
      { product_id: spSM.id, variant_id: vSM.S.id, quantity: qDS, unit_cost: cost + 30000 },
      { product_id: spSM.id, variant_id: vSM.M.id, quantity: qDM, unit_cost: cost + 30000 }];
    const main = (await scenario('Lập phiếu (size + size/màu, 4 dòng)', 'staff', 'POST', '/admin/receipts',
      { supplier_id: supA.id, note: 'Phiếu báo cáo', items: lines(10, 5, 7, 3) }, 201, 1, 0)).body.receipt;
    const rid = main.id;
    await scenario('Gửi duyệt', 'staff', 'POST', `/admin/receipts/${rid}/submit`, undefined, 200, 1, 0);
    await scenario('Từ chối (có lý do)', 'admin', 'POST', `/admin/receipts/${rid}/reject`, { reason: 'Giá nhập size + màu cao hơn báo giá' }, 200, 1, 0);
    await scenario('Sửa phiếu sau khi bị từ chối', 'staff', 'PUT', `/admin/receipts/${rid}`,
      { supplier_id: supA.id, note: 'Phiếu báo cáo (đã sửa giá)', items: lines(12, 5, 7, 3, 140000) }, 200, 1, 0);
    await scenario('Gửi duyệt lại', 'staff', 'POST', `/admin/receipts/${rid}/submit`, undefined, 200, 1, 0);
    await scenario('Duyệt', 'admin', 'POST', `/admin/receipts/${rid}/approve`, undefined, 200, 1, 0);
    // Tồn trước nhận hàng
    const stockQuery = async () => (await pool.request().input('a', sql.Int, spS.id).input('b', sql.Int, spSM.id).query(`
      SELECT v.id, v.product_id, v.sku, v.size, pc.label AS color, v.stock FROM dbo.product_variants v
      LEFT JOIN dbo.product_colors pc ON pc.product_id = v.product_id AND pc.color_key = v.color
      WHERE v.product_id IN (@a, @b) ORDER BY v.product_id, v.id;
      SELECT p.id, p.name_vi, p.stock, (SELECT SUM(CAST(x.stock AS BIGINT)) FROM dbo.product_variants x WHERE x.product_id = p.id) AS variant_sum
      FROM dbo.products p WHERE p.id IN (@a, @b) ORDER BY p.id;`)).recordsets;
    const [vBefore, pBefore] = await stockQuery();
    const recv = await scenario('Nhận hàng', 'staff', 'POST', `/admin/receipts/${rid}/receive`, undefined, 200, 1, 4);
    const [vAfter, pAfter] = await stockQuery();

    // ================= Tồn kho =================
    const qtyByVariant = new Map((recv.body && recv.body.stock_changes || []).map(c => [c.variant_id, c.quantity]));
    for (const a of vAfter) {
      const b = vBefore.find(x => x.id === a.id), q = qtyByVariant.get(a.id) || 0;
      const ok = a.stock === b.stock + q;
      R.stock.variants.push({ sku: a.sku, product_id: a.product_id, size: a.size, color: a.color, before: b.stock, received: q, after: a.stock, ok });
      if (!ok) fail('Tồn kho', a.sku, `${b.stock} + ${q} ≠ ${a.stock}`);
    }
    for (const a of pAfter) {
      const b = pBefore.find(x => x.id === a.id), q = [...qtyByVariant.entries()].filter(([vid]) => vAfter.find(x => x.id === vid && x.product_id === a.id))
        .reduce((s, [, n]) => s + n, 0);
      const ok = a.stock === b.stock + q && Number(a.variant_sum) === a.stock;
      R.stock.products.push({ product_id: a.id, name: a.name_vi, before: b.stock, received: q, after: a.stock, variant_sum: Number(a.variant_sum), ok });
      if (!ok) fail('Tồn kho', `sản phẩm #${a.id}`, `trước ${b.stock}, nhập ${q}, sau ${a.stock}, Σ biến thể ${a.variant_sum}`);
    }
    const ledgerRows = (await pool.request().input('id', sql.Int, rid).query(`SELECT COUNT(*) AS n FROM dbo.inventory_movements
      WHERE receipt_id = @id AND movement_type = 'PURCHASE_RECEIPT';`)).recordset[0].n;
    R.stock.ledger = { receipt: main.code, rows: ledgerRows, expect: 4, ok: ledgerRows === 4 };
    if (ledgerRows !== 4) fail('Tồn kho', 'số dòng sổ kho PURCHASE_RECEIPT', String(ledgerRows));

    // ================= Kiểm dữ liệu =================
    const smallItems = () => [{ product_id: perf[0].product_id, variant_id: perf[0].variant_id, quantity: 1, unit_cost: 1000 }];
    async function receiptIn(status, who = ADMIN) { // phiếu mới ở đúng trạng thái (chuẩn bị, không tính vào ca)
      const r = await call(who, 'POST', '/admin/receipts', { supplier_id: supA.id, items: smallItems() });
      const id = r.body.receipt.id;
      if (['pending', 'approved'].includes(status)) await call(who, 'POST', `/admin/receipts/${id}/submit`);
      if (status === 'approved') await call(ADMIN, 'POST', `/admin/receipts/${id}/approve`);
      return id;
    }
    const stockFingerprint = async () => (await pool.request().query(`SELECT SUM(CAST(stock AS BIGINT)) AS s, COUNT(*) AS n FROM dbo.product_variants;
      `)).recordset[0];
    async function validation(name, who, method, url, body, expect) {
      const f0 = await stockFingerprint();
      const r = await measured(who, method, url, body);
      const f1 = await stockFingerprint();
      const b = r.body || {};
      const got = { status: r.status, code: b.code || null, field: b.field || null,
        reason: Array.isArray(b.items) && b.items[0] ? b.items[0].reason : null, current_status: b.current_status || null };
      const ok = Object.keys(expect).every(k => got[k] === expect[k]) && r.audit === 0 && r.ledger === 0 && JSON.stringify(f0) === JSON.stringify(f1);
      const fmt = o => [o.status, o.code, o.field && `field=${o.field}`, o.reason && `reason=${o.reason}`,
        o.current_status && `trạng thái=${o.current_status}`].filter(Boolean).join(' ');
      R.validation.push({ name, expected: fmt(expect), actual: fmt(got), audit: r.audit, stock_unchanged: JSON.stringify(f0) === JSON.stringify(f1), ok });
      if (!ok) fail('Kiểm dữ liệu', name, `${fmt(got)}, audit ${r.audit}`);
    }
    await validation('Trùng mã NCC', ADMIN, 'POST', '/admin/suppliers', { code: 'ncc-a', name: 'Trùng' }, { status: 409, code: 'SUPPLIER_CODE_EXISTS' });
    await validation('SĐT NCC sai định dạng', ADMIN, 'POST', '/admin/suppliers', { code: 'NCC-SDT', name: 'X', phone: '090-123-4567' },
      { status: 400, code: 'SUPPLIER_INVALID_INPUT', field: 'phone' });
    await validation('Đổi mã NCC', ADMIN, 'PUT', `/admin/suppliers/${supA.id}`, { code: 'NCC-Z', name: 'Đổi' }, { status: 400, code: 'SUPPLIER_CODE_IMMUTABLE', field: 'code' });
    await validation('Số lượng 0', STAFF, 'POST', '/admin/receipts', { supplier_id: supA.id, items: [{ ...smallItems()[0], quantity: 0 }] },
      { status: 400, code: 'RECEIPT_INVALID_INPUT', field: 'quantity' });
    await validation('Biến thể không thuộc sản phẩm', STAFF, 'POST', '/admin/receipts',
      { supplier_id: supA.id, items: [{ product_id: spS.id, variant_id: vSM.S.id, quantity: 1, unit_cost: 1 }] },
      { status: 409, code: 'RECEIPT_ITEMS_INVALID', reason: 'PRODUCT_MISMATCH' });
    await validation('Biến thể không phải lá (BASE của SP theo size)', STAFF, 'POST', '/admin/receipts',
      { supplier_id: supA.id, items: [{ product_id: spS.id, variant_id: spS.base, quantity: 1, unit_cost: 1 }] },
      { status: 409, code: 'RECEIPT_ITEMS_INVALID', reason: 'NOT_LEAF' });
    await call(ADMIN, 'PATCH', `/admin/suppliers/${supB.id}/status`, { is_active: false }); // chuẩn bị
    await validation('Lập phiếu với NCC đã ngừng', STAFF, 'POST', '/admin/receipts', { supplier_id: supB.id, items: smallItems() },
      { status: 409, code: 'RECEIPT_SUPPLIER_INACTIVE', field: 'supplier_id' });
    const vDraft = await receiptIn('draft'), vPending = await receiptIn('pending'), vApproved = await receiptIn('approved');
    await validation('Sai trạng thái: duyệt phiếu nháp', ADMIN, 'POST', `/admin/receipts/${vDraft}/approve`, undefined,
      { status: 409, code: 'RECEIPT_INVALID_STATE', current_status: 'draft' });
    await validation('Sai trạng thái: nhận phiếu chờ duyệt', STAFF, 'POST', `/admin/receipts/${vPending}/receive`, undefined,
      { status: 409, code: 'RECEIPT_INVALID_STATE', current_status: 'pending' });
    await validation('Sai trạng thái: sửa phiếu đã duyệt', STAFF, 'PUT', `/admin/receipts/${vApproved}`, { supplier_id: supA.id, items: smallItems() },
      { status: 409, code: 'RECEIPT_INVALID_STATE', current_status: 'approved' });
    await validation('Từ chối thiếu lý do', ADMIN, 'POST', `/admin/receipts/${vPending}/reject`, { reason: '   ' },
      { status: 400, code: 'RECEIPT_INVALID_INPUT', field: 'reason' });
    await validation('Nhận lại phiếu đã nhận', STAFF, 'POST', `/admin/receipts/${rid}/receive`, undefined,
      { status: 409, code: 'RECEIPT_INVALID_STATE', current_status: 'received' });

    // ================= Phân quyền: 16 API × 3 role =================
    const freshSupplier = async () => (await call(ADMIN, 'POST', '/admin/suppliers', { code: 'P-' + Math.random().toString(36).slice(2, 10).toUpperCase(), name: 'NCC phân quyền' })).body.supplier.id;
    const API = [
      { api: 'GET /suppliers', staff: 200, run: who => call(who, 'GET', '/admin/suppliers') },
      { api: 'GET /suppliers/:id', staff: 200, run: who => call(who, 'GET', `/admin/suppliers/${supA.id}`) },
      { api: 'POST /suppliers', staff: 403, ok: 201, run: who => call(who, 'POST', '/admin/suppliers', { code: 'Q-' + who + '-' + Date.now().toString(36).toUpperCase().slice(-6), name: 'Tạo thử' }) },
      { api: 'PUT /suppliers/:id', staff: 403, prep: freshSupplier, run: (who, id) => call(who, 'PUT', `/admin/suppliers/${id}`, { name: 'Sửa thử' }) },
      { api: 'PATCH /suppliers/:id/status', staff: 403, prep: freshSupplier, run: (who, id) => call(who, 'PATCH', `/admin/suppliers/${id}/status`, { is_active: false }) },
      { api: 'GET /receipts', staff: 200, run: who => call(who, 'GET', '/admin/receipts') },
      { api: 'GET /receipts/receivable-variants', staff: 200, run: who => call(who, 'GET', `/admin/receipts/receivable-variants?product_id=${spS.id}`) },
      { api: 'GET /receipts/:id', staff: 200, run: who => call(who, 'GET', `/admin/receipts/${rid}`) },
      { api: 'POST /receipts', staff: 201, ok: 201, run: who => call(who, 'POST', '/admin/receipts', { supplier_id: supA.id, items: smallItems() }) },
      { api: 'PUT /receipts/:id', staff: 200, prep: () => receiptIn('draft'), run: (who, id) => call(who, 'PUT', `/admin/receipts/${id}`, { supplier_id: supA.id, items: smallItems(), note: 'sửa' }) },
      { api: 'POST /receipts/:id/submit', staff: 200, prep: () => receiptIn('draft'), run: (who, id) => call(who, 'POST', `/admin/receipts/${id}/submit`) },
      { api: 'POST /receipts/:id/approve', staff: 403, prep: () => receiptIn('pending'), run: (who, id) => call(who, 'POST', `/admin/receipts/${id}/approve`) },
      { api: 'POST /receipts/:id/reject', staff: 403, prep: () => receiptIn('pending'), run: (who, id) => call(who, 'POST', `/admin/receipts/${id}/reject`, { reason: 'thử' }) },
      { api: 'POST /receipts/:id/cancel (phiếu nháp)', staff: 200, prep: () => receiptIn('draft'), run: (who, id) => call(who, 'POST', `/admin/receipts/${id}/cancel`, { reason: 'thử' }) },
      { api: 'POST /receipts/:id/cancel (phiếu đã duyệt)', staff: 403, prep: () => receiptIn('approved'), run: (who, id) => call(who, 'POST', `/admin/receipts/${id}/cancel`, { reason: 'thử' }) },
      { api: 'POST /receipts/:id/receive', staff: 200, prep: () => receiptIn('approved'), run: (who, id) => call(who, 'POST', `/admin/receipts/${id}/receive`) },
    ];
    const sec0 = await maxId('SecurityEvents');
    for (const a of API) {
      for (const role of ['admin', 'staff', 'customer']) {
        const id = a.prep ? await a.prep() : null;
        const expect = role === 'customer' ? 403 : role === 'staff' && a.staff === 403 ? 403 : (a.ok || 200);
        const r = await a.run(ROLE_ID[role], id);
        const ok = r.status === expect;
        R.permissions.rows.push({ api: a.api, role, expect, status: r.status, ok });
        if (!ok) fail('Phân quyền', `${a.api} × ${role}`, `mong đợi ${expect}, thực tế ${r.status}`);
      }
    }
    await wait(400); // securityLogger ghi fire-and-forget sau 'finish'
    const sec = (await pool.request().input('from', sql.BigInt, sec0).query(`SELECT event_type, COUNT(*) AS n FROM dbo.SecurityEvents
      WHERE id > @from GROUP BY event_type;`)).recordset;
    const secN = t => (sec.find(x => x.event_type === t) || { n: 0 }).n;
    const total403 = R.permissions.rows.filter(x => x.status === 403).length;
    const staff403 = R.permissions.rows.filter(x => x.status === 403 && x.role === 'staff').length;
    const cust403 = R.permissions.rows.filter(x => x.status === 403 && x.role === 'customer').length;
    R.permissions.summary = { cells: R.permissions.rows.length, total403, staff403, customer403: cust403,
      permission_denied: secN('PERMISSION_DENIED'), forbidden: secN('FORBIDDEN'),
      ok: secN('PERMISSION_DENIED') === staff403 && secN('FORBIDDEN') === cust403 };
    if (!R.permissions.summary.ok) fail('Phân quyền', 'SecurityEvents', `PERMISSION_DENIED ${secN('PERMISSION_DENIED')} / staff 403 ${staff403}; FORBIDDEN ${secN('FORBIDDEN')} / customer 403 ${cust403}`);

    // ================= Đồng thời =================
    let deadlocks = 0;
    const realError = console.error;
    console.error = (...args) => { if (args.join(' ').match(/deadlock|1205/i)) deadlocks++; };
    try {
      { // nhận trùng song song
        const a0 = await maxId('audit_logs'), m0 = await maxId('inventory_movements');
        let ok200 = 0, blocked = 0, onceOk = 0;
        const start = process.hrtime.bigint();
        for (let i = 0; i < CONCURRENT_DUP; i++) {
          const id = await receiptIn('approved');
          const before = (await pool.request().input('v', sql.Int, perf[0].variant_id).query('SELECT stock FROM dbo.product_variants WHERE id=@v;')).recordset[0].stock;
          const outs = await Promise.all([call(STAFF, 'POST', `/admin/receipts/${id}/receive`), call(ADMIN, 'POST', `/admin/receipts/${id}/receive`)]);
          ok200 += outs.filter(o => o.status === 200).length; blocked += outs.filter(o => o.status === 409).length;
          const after = (await pool.request().input('v', sql.Int, perf[0].variant_id).query('SELECT stock FROM dbo.product_variants WHERE id=@v;')).recordset[0].stock;
          if (after === before + 1) onceOk++;
        }
        const ledger = await countSince('inventory_movements', m0, "movement_type = 'PURCHASE_RECEIPT'");
        const receives = await countSince('audit_logs', a0, "action = 'RECEIPT_RECEIVE'");
        const ok = ok200 === CONCURRENT_DUP && blocked === CONCURRENT_DUP && onceOk === CONCURRENT_DUP && ledger === CONCURRENT_DUP && receives === CONCURRENT_DUP && deadlocks === 0;
        R.concurrency.push({ name: '2 request nhận cùng 1 phiếu, song song', rounds: CONCURRENT_DUP, success: ok200, blocked, stock_once: `${onceOk}/${CONCURRENT_DUP}`,
          ledger, receipt_receive: receives, deadlocks, other: '—', ms: ms(start), ok });
        if (!ok) fail('Đồng thời', 'nhận trùng', JSON.stringify({ ok200, blocked, onceOk, ledger, receives, deadlocks }));
      }
      { // nhận hàng ‖ checkout
        const shippingInput = require('../__tests__/helpers/shipping');
        const [g1, g2] = sellable;
        const stockOf = async () => Object.fromEntries((await pool.request().input('a', sql.Int, g1.base).input('b', sql.Int, g2.base)
          .query('SELECT id, stock FROM dbo.product_variants WHERE id IN (@a, @b);')).recordset.map(x => [x.id, x.stock]));
        const a0 = await maxId('audit_logs'), m0 = await maxId('inventory_movements'), d0 = deadlocks;
        const s0 = await stockOf(); let inSum = 0, outSum = 0, okRounds = 0, recvOk = 0, orderOk = 0;
        const start = process.hrtime.bigint();
        for (let i = 0; i < CONCURRENT_CHECKOUT; i++) {
          const q = 3 + (i % 3), c = 1 + (i % 2);
          const r0 = await call(STAFF, 'POST', '/admin/receipts', { supplier_id: supA.id, items: [
            { product_id: g1.id, variant_id: g1.base, quantity: q, unit_cost: 1000 }, { product_id: g2.id, variant_id: g2.base, quantity: q, unit_cost: 1000 }] });
          const id = r0.body.receipt.id;
          await call(STAFF, 'POST', `/admin/receipts/${id}/submit`); await call(ADMIN, 'POST', `/admin/receipts/${id}/approve`);
          await pool.request().input('u', sql.Int, CUSTOMER).query('DELETE FROM dbo.cart_items WHERE user_id=@u;');
          await pool.request().input('u', sql.Int, CUSTOMER).input('p1', sql.Int, g1.id).input('v1', sql.Int, g1.base).input('p2', sql.Int, g2.id)
            .input('v2', sql.Int, g2.base).input('c', sql.Int, c)
            .query('INSERT INTO dbo.cart_items(user_id,product_id,variant_id,quantity) VALUES(@u,@p1,@v1,@c),(@u,@p2,@v2,@c);');
          const [r, o] = await Promise.all([call(STAFF, 'POST', `/admin/receipts/${id}/receive`), call(CUSTOMER, 'POST', '/orders', { ...shippingInput, paymentMethod: 'cod' })]);
          if (r.status === 200) { recvOk++; inSum += q; }
          if (o.status === 201) { orderOk++; outSum += c; }
          if (r.status === 200 && o.status === 201) okRounds++;
        }
        const s1 = await stockOf();
        const balanced = [g1, g2].every(g => s1[g.base] === s0[g.base] + inSum - outSum);
        const ledger = await countSince('inventory_movements', m0, "movement_type = 'PURCHASE_RECEIPT'");
        const receives = await countSince('audit_logs', a0, "action = 'RECEIPT_RECEIVE'");
        const dl = deadlocks - d0;
        const ok = okRounds === CONCURRENT_CHECKOUT && balanced && dl === 0 && ledger === 2 * CONCURRENT_CHECKOUT && receives === CONCURRENT_CHECKOUT;
        R.concurrency.push({ name: 'Nhận hàng ‖ checkout cùng sản phẩm', rounds: CONCURRENT_CHECKOUT, success: `${recvOk} nhận + ${orderOk} đơn`, blocked: 0,
          stock_once: balanced ? 'đầu + nhập − bán: khớp' : 'KHÔNG khớp', ledger, receipt_receive: receives, deadlocks: dl,
          other: [g1, g2].map(g => `SP #${g.id}: ${s0[g.base]} + ${inSum} − ${outSum} = ${s1[g.base]}`).join('; '), ms: ms(start), ok });
        if (!ok) fail('Đồng thời', 'nhận ‖ checkout', JSON.stringify({ okRounds, balanced, dl, ledger, receives }));
      }
    } finally { console.error = realError; }

    // ================= Hiệu năng nhận hàng =================
    for (const size of PERF_SIZES) {
      const times = []; let allOk = true;
      for (let run = 0; run < PERF_RUNS; run++) {
        const items = perf.slice(0, size).map(p => ({ product_id: p.product_id, variant_id: p.variant_id, quantity: 1, unit_cost: 1000 }));
        const c = await call(ADMIN, 'POST', '/admin/receipts', { supplier_id: supA.id, items });
        const id = c.body && c.body.receipt && c.body.receipt.id;
        if (!id) { allOk = false; break; }
        await call(ADMIN, 'POST', `/admin/receipts/${id}/submit`); await call(ADMIN, 'POST', `/admin/receipts/${id}/approve`);
        const m0 = await maxId('inventory_movements');
        const r = await call(STAFF, 'POST', `/admin/receipts/${id}/receive`);
        const ledger = await countSince('inventory_movements', m0, "movement_type = 'PURCHASE_RECEIPT'");
        if (r.status !== 200 || ledger !== size) allOk = false;
        times.push(r.ms);
      }
      const avg = times.length ? Math.round(times.reduce((s, x) => s + x, 0) / times.length * 10) / 10 : null;
      R.performance.push({ lines: size, runs: times.length, avg, min: times.length ? Math.min(...times) : null, max: times.length ? Math.max(...times) : null,
        ms_list: times, ok: allOk && times.length === PERF_RUNS });
      if (!allOk) fail('Hiệu năng', `${size} dòng`, 'có lần không 200 hoặc sai số dòng sổ kho');
    }
    R.meta.duration_s = Math.round(Number(process.hrtime.bigint() - t0) / 1e8) / 10;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    try { if (pool && pool.connected) await pool.close(); }
    finally {
      if (created) {
        adminSql(`ALTER DATABASE ${quoted} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${quoted};`);
        const gone = !dbExists(dbName);
        R.safety.push({ name: 'DB tạm đã xoá', detail: gone ? 'đã xoá' : 'CÒN', ok: gone });
        if (!gone) fail('An toàn', 'DB tạm đã xoá');
        console.log(`Removed disposable database: ${dbName} (${gone ? 'đã xoá' : 'CÒN'})`);
      }
    }
  }
  const mainAfter = await otherDbSnapshot(mainDb);
  const mainSame = JSON.stringify(mainAfter) === JSON.stringify(mainBefore);
  R.safety.push({ name: `${mainDb} không đổi`, detail: `sổ kho ${mainBefore.movements} → ${mainAfter.movements}, sản phẩm ${mainBefore.products} → ${mainAfter.products}`, ok: mainSame });
  if (!mainSame) fail('An toàn', `${mainDb} không đổi`);
  if (copyBefore) {
    const copyAfter = await otherDbSnapshot(COPY_DB), same = JSON.stringify(copyAfter) === JSON.stringify(copyBefore);
    R.safety.push({ name: `${COPY_DB} không đổi`, detail: `sổ kho ${copyBefore.movements} → ${copyAfter.movements}, phiếu ${copyBefore.receipts} → ${copyAfter.receipts}`, ok: same });
    if (!same) fail('An toàn', `${COPY_DB} không đổi`);
  }
}

// ================= Ghi kết quả =================
const yes = ok => (ok ? 'Đạt' : '**KHÔNG ĐẠT**');
const cell = v => (v == null || v === '' ? '—' : String(v).replace(/\|/g, '\\|').replace(/\n/g, ' '));
function table(headers, rows) {
  return ['| ' + headers.join(' | ') + ' |', '|' + headers.map(() => '---').join('|') + '|', ...rows.map(r => '| ' + r.map(cell).join(' | ') + ' |')].join('\n');
}
function countCases() {
  const all = [...R.prep, ...R.scenario, ...R.stock.variants, ...R.stock.products, R.stock.ledger, ...R.permissions.rows, R.permissions.summary,
    ...R.validation, ...R.concurrency, ...R.performance, ...R.safety].filter(Boolean);
  const crashed = R.failures.some(f => f.startsWith('Lỗi chạy script'));
  return { total: all.length + (crashed ? 1 : 0), passed: all.filter(x => x.ok).length }; // script dừng giữa chừng = 1 ca không đạt
}
function markdown(summary) {
  const m = R.meta, out = [];
  out.push('# Báo cáo kiểm thử — Nhà cung cấp và phiếu nhập kho', '');
  out.push(`- Thời điểm chạy: ${cell(m.generated_at)} (giờ Việt Nam)`, `- Hệ điều hành: ${cell(m.os)}`, `- CPU: ${cell(m.cpu)}`, `- RAM: ${cell(m.ram)}`,
    `- Node.js: ${cell(m.node)}`, `- SQL Server: ${cell(m.sql_server)}`, `- Cơ sở dữ liệu: DB tạm \`${cell(m.temp_db)}\` (đã xoá sau khi chạy)`,
    `- Tổng thời gian chạy: ${cell(m.duration_s)} giây`, '');
  (m.notes || []).forEach(n => out.push(`> ${n}`));
  out.push('', `**Kết quả chung: ${summary.passed} / ${summary.total} ca đạt.**`, '');
  out.push('## 1. Chuẩn bị dữ liệu (không tính vào kịch bản)', '');
  out.push(table(['Bước', 'Mong đợi', 'HTTP', 'Thời gian (ms)', 'Dòng audit', 'Kết quả'],
    R.prep.map(r => [r.name + (r.detail && !r.ok ? ` (${r.detail})` : ''), r.expect, r.status, r.ms, r.audit, yes(r.ok)])), '');
  out.push('## 2. Kịch bản chính: lập → gửi → từ chối → sửa → gửi lại → duyệt → nhận', '');
  out.push(table(['#', 'Bước', 'Người làm', 'API', 'HTTP mong đợi', 'HTTP thực tế', 'Thời gian (ms)', 'Dòng audit', 'Dòng sổ kho', 'Kết quả'],
    R.scenario.map((r, i) => [i + 1, r.name, r.actor, '`' + r.api + '`', r.expect, r.status, r.ms, r.audit, r.ledger, yes(r.ok)])), '');
  out.push('## 3. Tồn kho trước → sau khi nhận hàng', '', '### 3.1 Từng biến thể', '');
  out.push(table(['SKU', 'Sản phẩm', 'Size', 'Màu', 'Tồn trước', 'Nhập', 'Tồn sau', 'Kết quả'],
    R.stock.variants.map(r => [r.sku, '#' + r.product_id, r.size, r.color, r.before, r.received ? '+' + r.received : 0, r.after, yes(r.ok)])), '');
  out.push('### 3.2 Tổng theo sản phẩm (products.stock)', '');
  out.push(table(['Sản phẩm', 'Tên', 'products.stock trước', 'Nhập', 'products.stock sau', 'SUM(biến thể)', 'SUM = stock', 'Kết quả'],
    R.stock.products.map(r => ['#' + r.product_id, r.name, r.before, '+' + r.received, r.after, r.variant_sum, r.variant_sum === r.after ? 'Khớp' : 'Lệch', yes(r.ok)])), '');
  if (R.stock.ledger) out.push(`Sổ kho: phiếu ${R.stock.ledger.receipt} sinh **${R.stock.ledger.rows}** dòng \`PURCHASE_RECEIPT\` (mong đợi ${R.stock.ledger.expect}) — ${yes(R.stock.ledger.ok)}.`, '');
  out.push('## 4. Phân quyền: API × role', '');
  out.push(table(['API', 'Role', 'HTTP mong đợi', 'HTTP thực tế', 'Kết quả'], R.permissions.rows.map(r => ['`' + r.api + '`', r.role, r.expect, r.status, yes(r.ok)])), '');
  const s = R.permissions.summary;
  if (s) {
    out.push(table(['Chỉ số', 'Giá trị'], [['Số ô kiểm', s.cells], ['Tổng số 403', s.total403], ['403 của staff', s.staff403], ['403 của customer', s.customer403],
      ['Dòng PERMISSION_DENIED mới (SecurityEvents)', s.permission_denied], ['Dòng FORBIDDEN mới (SecurityEvents)', s.forbidden], ['Khớp', yes(s.ok)]]), '');
    out.push('> Vì sao số dòng `PERMISSION_DENIED` thấp hơn tổng số 403: customer bị chặn ngay ở cổng chung `requireBackOffice` (chưa tới',
      '> bước xét quyền từng API) nên securityLogger ghi loại `FORBIDDEN`; chỉ staff bị chặn ở `requirePermission` (hoặc kiểm quyền trong',
      '> handler khi huỷ phiếu đã duyệt) mới ghi `PERMISSION_DENIED`. Vì vậy: `PERMISSION_DENIED` = số 403 của staff, `FORBIDDEN` = số 403 của customer.', '');
  }
  out.push('## 5. Kiểm dữ liệu sai', '');
  out.push(table(['Ca', 'Mong đợi', 'Thực tế', 'Dòng audit', 'Tồn không đổi', 'Kết quả'],
    R.validation.map(r => [r.name, '`' + r.expected + '`', '`' + r.actual + '`', r.audit, r.stock_unchanged ? 'Có' : 'Không', yes(r.ok)])), '');
  out.push('## 6. Đồng thời', '');
  out.push(table(['Ca', 'Số vòng', 'Thành công', 'Bị chặn (409)', 'Tồn cộng đúng', 'Dòng sổ kho PURCHASE_RECEIPT', 'Dòng audit RECEIPT_RECEIVE', 'Deadlock', 'Ghi chú', 'Thời gian (ms)', 'Kết quả'],
    R.concurrency.map(r => [r.name, r.rounds, r.success, r.blocked, r.stock_once, r.ledger, r.receipt_receive, r.deadlocks, r.other, r.ms, yes(r.ok)])), '');
  out.push(`## 7. Hiệu năng nhận hàng (mỗi cỡ ${PERF_RUNS} lần, chỉ đo POST /receipts/:id/receive)`, '');
  out.push(table(['Số dòng phiếu', 'Số lần', 'Trung bình (ms)', 'Nhỏ nhất (ms)', 'Lớn nhất (ms)', 'Các lần (ms)', 'Kết quả'],
    R.performance.map(r => [r.lines, r.runs, r.avg, r.min, r.max, (r.ms_list || []).join(' / '), yes(r.ok)])), '');
  out.push('## 8. An toàn dữ liệu', '');
  out.push(table(['Kiểm tra', 'Chi tiết', 'Kết quả'], R.safety.map(r => [r.name, r.detail, yes(r.ok)])), '');
  out.push('## 9. Tổng kết', '', `**${summary.passed} / ${summary.total} ca đạt.**`, '');
  if (R.failures.length) { out.push('Ca không đạt:', ''); R.failures.forEach(f => out.push(`- ${cell(f)}`)); out.push(''); }
  return out.join('\n');
}
function writeReport() {
  const summary = countCases();
  const d = new Date(Date.now() + 7 * 3600 * 1000).toISOString(); // giờ Việt Nam
  const stamp = d.slice(0, 10) + '-' + d.slice(11, 13) + d.slice(14, 16);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const md = markdown(summary);
  fs.writeFileSync(path.join(OUT_DIR, `bao-cao-nhap-kho-${stamp}.md`), md, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, `bao-cao-nhap-kho-${stamp}.json`), JSON.stringify({ ...R, summary }, null, 2), 'utf8');
  console.log('\n' + md);
  console.log(`\nĐã ghi outputs/bao-cao-nhap-kho-${stamp}.md và .json — ${summary.passed} / ${summary.total} ca đạt.`);
  return summary;
}

main().catch(err => { R.failures.push('Lỗi chạy script: ' + err.message); console.error('report-purchase-receipts FAILED:', err.message); })
  .finally(() => {
    const s = writeReport();
    if (R.failures.length || s.passed !== s.total) process.exitCode = 1;
  });
