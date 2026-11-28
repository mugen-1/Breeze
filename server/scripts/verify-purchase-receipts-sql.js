'use strict';
// Kiểm migration 029 (nhà cung cấp + phiếu nhập kho) trên SQL Server thật, bằng DB TẠM tự tạo và tự xoá.
// Không bao giờ chạm DB thật trong .env (BreezeShopDB).
// Chạy (trong server/, cần sqlcmd + Windows auth như các script verify-*-sql khác):
//   node scripts/verify-purchase-receipts-sql.js
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const realDb = process.env.DB_NAME;
const dbName = 'BreezeReceiptTest_' + process.pid + '_' + Date.now();
if (!/^BreezeReceiptTest_[0-9]+_[0-9]+$/.test(dbName) || dbName === realDb) throw Error('Unsafe test database');
process.env.DB_NAME = dbName;
const { sql, config } = require('../db');
if (config.database !== dbName) throw Error('db.js không nhận DB tạm');
const quoted = '[' + dbName + ']', serverDir = path.join(__dirname, '..');
const MIGRATION = 'db/migrations/029_suppliers_purchase_receipts.sql';

let pool, created = false, checks = 0;
function check(name, value) { assert.ok(value, name); checks++; console.log('PASS: ' + name); }
function same(name, actual, expected) { assert.deepEqual(actual, expected, name); checks++; console.log('PASS: ' + name); }
function adminSql(query) {
  execFileSync('sqlcmd', ['-E', '-S', config.server, '-d', 'master', '-No', '-b', '-Q', query], { stdio: 'pipe' });
}
function node(args) {
  return execFileSync(process.execPath, args, { cwd: serverDir, env: { ...process.env, DB_NAME: dbName },
    stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 });
}
async function rows(text) { return (await pool.request().query(text)).recordset; }
// 547 = vi phạm CHECK/FK, 2627 = UNIQUE constraint, 2601 = unique index.
async function rejects(name, text, numbers = [547]) {
  let error = null;
  try { await pool.request().query(text); } catch (e) { error = e; }
  check(name, error && numbers.includes(error.number));
}
async function accepts(name, text) { await pool.request().query(text); check(name, true); }

// Phiếu hợp lệ theo từng trạng thái — các ca lỗi bên dưới sửa đúng một chỗ trên nền này.
const BY = 'created_by';
function receiptSql(cols) {
  const all = { supplier_id: '@sup', status: "'draft'", [BY]: '1', ...cols };
  return `INSERT INTO dbo.purchase_receipts (${Object.keys(all).join(',')}) VALUES (${Object.values(all).join(',')});`;
}
const NOW = 'SYSUTCDATETIME()';
const SUBMITTED = { submitted_by: '1', submitted_at: NOW };
const APPROVED = { ...SUBMITTED, status: "'approved'", approved_by: '2', approved_at: NOW };

async function main() {
  try {
    adminSql('CREATE DATABASE ' + quoted + ';'); created = true;
    adminSql('ALTER AUTHORIZATION ON DATABASE::' + quoted + ' TO [' + String(config.user).replace(/]/g, ']]') + '];');
    console.log('Created disposable database:', dbName);
    node(['scripts/setup-db.js', '--fresh']);
    pool = await new sql.ConnectionPool({ ...config, database: dbName }).connect();
    same('pool trỏ vào DB tạm', (await rows('SELECT DB_NAME() AS n;'))[0].n, dbName);

    // --- Dựng bảng + chạy lại lần 2 ---------------------------------------------------
    for (const t of ['suppliers', 'purchase_receipts', 'purchase_receipt_items']) {
      check('setup-db --fresh tạo dbo.' + t, (await rows(`SELECT OBJECT_ID('dbo.${t}','U') AS id;`))[0].id);
    }
    const before = (await rows('SELECT COUNT(*) AS n FROM dbo.inventory_movements;'))[0].n;
    node(['db/run-sql.js', MIGRATION]);
    same('chạy lại 029 lần 2 không lỗi, không đổi sổ kho',
      (await rows('SELECT COUNT(*) AS n FROM dbo.inventory_movements;'))[0].n, before);
    const constraints = await rows(`SELECT name, is_disabled, is_not_trusted FROM sys.check_constraints
      WHERE name IN ('CK_inventory_movements_type','CK_inventory_movements_receipt','CK_purchase_receipts_state',
                     'CK_purchase_receipts_status','CK_suppliers_code') ORDER BY name;`);
    same('5 CHECK chính tồn tại, bật và trusted', constraints.map(c => [c.name, c.is_disabled, c.is_not_trusted]), [
      ['CK_inventory_movements_receipt', false, false], ['CK_inventory_movements_type', false, false],
      ['CK_purchase_receipts_state', false, false], ['CK_purchase_receipts_status', false, false],
      ['CK_suppliers_code', false, false]]);

    // --- suppliers --------------------------------------------------------------------
    await accepts('thêm NCC hợp lệ', `INSERT INTO dbo.suppliers (code,name,phone,email,tax_code)
      VALUES ('NCC-001',N'Công ty May Sài Gòn','0901234567','lienhe@maysg.vn','0312345678');`);
    await rejects('mã NCC trùng bị chặn', "INSERT INTO dbo.suppliers (code,name) VALUES ('NCC-001',N'Khác');", [2627]);
    await rejects('mã NCC chữ thường bị chặn', "INSERT INTO dbo.suppliers (code,name) VALUES ('ncc-002',N'X');");
    await rejects('mã NCC có dấu cách bị chặn', "INSERT INTO dbo.suppliers (code,name) VALUES ('NCC 002',N'X');");
    await rejects('tên NCC rỗng bị chặn', "INSERT INTO dbo.suppliers (code,name) VALUES ('NCC-003',N'');");
    await rejects('SĐT có chữ bị chặn', "INSERT INTO dbo.suppliers (code,name,phone) VALUES ('NCC-004',N'X','09abc12345');");
    await rejects('mã số thuế sai độ dài bị chặn', "INSERT INTO dbo.suppliers (code,name,tax_code) VALUES ('NCC-005',N'X','123');");
    await rejects('email sai dạng bị chặn', "INSERT INTO dbo.suppliers (code,name,email) VALUES ('NCC-006',N'X','khong-phai-email');");
    const sup = (await rows("SELECT id FROM dbo.suppliers WHERE code = 'NCC-001';"))[0].id;
    const withSup = text => `DECLARE @sup INT = ${sup}; ${text}`;

    // --- purchase_receipts: mã + trạng thái -------------------------------------------
    await accepts('thêm phiếu nháp hợp lệ', withSup(receiptSql({})));
    const first = (await rows('SELECT TOP (1) id, code, status FROM dbo.purchase_receipts ORDER BY id;'))[0];
    same('mã phiếu sinh từ id, mặc định draft', [first.code, first.status], ['PN-' + String(first.id).padStart(6, '0'), 'draft']);
    await rejects('trạng thái lạ bị chặn', withSup(receiptSql({ status: "'paused'" })));
    await rejects('trạng thái rejected không còn hợp lệ', withSup(receiptSql({ status: "'rejected'" })));
    await rejects('trạng thái viết hoa bị chặn', withSup(receiptSql({ status: "'Draft'" })));
    await rejects('NCC không tồn tại bị chặn (FK)', receiptSql({ supplier_id: '999999' }));
    await rejects('pending thiếu người/thời điểm gửi bị chặn', withSup(receiptSql({ status: "'pending'" })));
    await accepts('pending đủ mốc gửi duyệt', withSup(receiptSql({ ...SUBMITTED, status: "'pending'" })));
    await rejects('approved thiếu người duyệt bị chặn',
      withSup(receiptSql({ ...SUBMITTED, status: "'approved'", approved_at: NOW })));
    await accepts('approved đủ mốc', withSup(receiptSql(APPROVED)));
    await rejects('received khi chưa duyệt bị chặn',
      withSup(receiptSql({ ...SUBMITTED, status: "'received'", received_by: '1', received_at: NOW })));
    await accepts('received đủ mốc', withSup(receiptSql({ ...APPROVED, status: "'received'", received_by: '1', received_at: NOW })));
    await rejects('draft mà đã có mốc nhận hàng bị chặn',
      withSup(receiptSql({ received_by: '1', received_at: NOW })));
    await rejects('cancelled thiếu lý do bị chặn',
      withSup(receiptSql({ status: "'cancelled'", cancelled_by: '1', cancelled_at: NOW })));
    await rejects('cancelled lý do rỗng bị chặn',
      withSup(receiptSql({ status: "'cancelled'", cancelled_by: '1', cancelled_at: NOW, cancel_reason: "N''" })));
    await accepts('cancelled đủ lý do',
      withSup(receiptSql({ status: "'cancelled'", cancelled_by: '1', cancelled_at: NOW, cancel_reason: "N'NCC hết hàng'" })));
    await rejects('đã nhận rồi thì không thể huỷ',
      withSup(receiptSql({ ...APPROVED, status: "'cancelled'", received_by: '1', received_at: NOW,
        cancelled_by: '1', cancelled_at: NOW, cancel_reason: "N'x'" })));
    await accepts('draft sau khi bị từ chối giữ lý do từ chối',
      withSup(receiptSql({ ...SUBMITTED, rejected_by: '2', rejected_at: NOW, reject_reason: "N'Sai số lượng'" })));
    await rejects('lý do từ chối mà thiếu người từ chối bị chặn',
      withSup(receiptSql({ reject_reason: "N'Sai số lượng'" })));
    await rejects('từ chối với lý do NULL bị chặn (không lọt qua UNKNOWN)',
      withSup(receiptSql({ rejected_by: '2', rejected_at: NOW })));
    await accepts('created_by không có FK: id user không tồn tại vẫn lưu được',
      withSup(receiptSql({ created_by: '987654' })));

    // --- purchase_receipt_items -------------------------------------------------------
    const [v1, v2] = await rows(`SELECT TOP (2) v.id, v.product_id, v.stock, v.sku FROM dbo.product_variants v
      WHERE v.is_base = 1 ORDER BY v.id;`);
    const rid = first.id;
    const itemSql = (v, extra = {}) => {
      const all = { receipt_id: rid, product_id: v.product_id, variant_id: v.id, quantity: 10, unit_cost: 150000,
        name_snapshot: "N'Áo thun'", sku_snapshot: `'${v.sku}'`, ...extra };
      return `INSERT INTO dbo.purchase_receipt_items (${Object.keys(all).join(',')}) VALUES (${Object.values(all).join(',')});`;
    };
    await accepts('thêm dòng phiếu hợp lệ', itemSql(v1));
    await rejects('cùng biến thể 2 dòng trong 1 phiếu bị chặn', itemSql(v1), [2627]);
    await rejects('số lượng 0 bị chặn', itemSql(v2, { quantity: 0 }));
    await rejects('số lượng vượt 100000 bị chặn', itemSql(v2, { quantity: 100001 }));
    await rejects('giá nhập âm bị chặn', itemSql(v2, { unit_cost: -1 }));
    await rejects('biến thể không thuộc sản phẩm bị chặn (FK cặp)', itemSql(v2, { product_id: v1.product_id }));
    await rejects('phiếu không tồn tại bị chặn (FK)', itemSql(v2, { receipt_id: 999999 }));

    // --- inventory_movements ----------------------------------------------------------
    const mv = (v, extra = {}) => {
      const all = { product_id: v.product_id, variant_id: v.id, movement_type: "'PURCHASE_RECEIPT'",
        quantity_delta: 10, stock_before: v.stock, stock_after: v.stock + 10, receipt_id: rid, ...extra };
      return `INSERT INTO dbo.inventory_movements (${Object.keys(all).join(',')}) VALUES (${Object.values(all).join(',')});`;
    };
    await accepts('movement PURCHASE_RECEIPT hợp lệ', mv(v1));
    await rejects('cộng kho lần 2 cho cùng (phiếu, biến thể) bị chặn', mv(v1), [2601]);
    await rejects('PURCHASE_RECEIPT thiếu receipt_id bị chặn', mv(v2, { receipt_id: 'NULL' }));
    await rejects('PURCHASE_RECEIPT số âm bị chặn',
      mv(v2, { quantity_delta: -1, stock_after: v2.stock - 1 }));
    await rejects('loại khác mà có receipt_id bị chặn',
      mv(v2, { movement_type: "'ADMIN_ADJUSTMENT'" }));
    await rejects('loại movement lạ vẫn bị chặn', mv(v2, { movement_type: "'FOO'", receipt_id: 'NULL' }));
    await accepts('9 loại cũ vẫn ghi được (ADMIN_ADJUSTMENT không receipt_id)',
      mv(v2, { movement_type: "'ADMIN_ADJUSTMENT'", receipt_id: 'NULL' }));

    console.log(`\nOK: ${checks} kiểm tra đều đạt trên SQL Server thật (${dbName}).`);
  } finally {
    if (pool) await pool.close();
    if (created) {
      try {
        adminSql(`ALTER DATABASE ${quoted} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${quoted};`);
        console.log('Dropped disposable database:', dbName);
      } catch (e) { console.error('Không xoá được DB tạm, xoá tay:', dbName, e.message); }
    }
  }
}

main().catch(error => { console.error('FAIL:', error.message); process.exitCode = 1; });
