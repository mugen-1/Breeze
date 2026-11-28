'use strict';

// Migration 029 (nhà cung cấp + phiếu nhập kho): kiểm tĩnh nội dung file + đăng ký trong setup-db.
// Ràng buộc chạy thật trên SQL Server: scripts/verify-purchase-receipts-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = '029_suppliers_purchase_receipts.sql';
const raw = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', FILE), 'utf8');
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const setup = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');

test('029 đăng ký trong setup-db.js ngay sau 028, không destructive', () => {
  const at28 = setup.indexOf("file: 'db/migrations/028_stats_snapshots.sql'");
  const at29 = setup.indexOf(`file: 'db/migrations/${FILE}'`);
  assert.ok(at28 >= 0 && at29 > at28, 'setup-db.js phải đăng ký 029 sau 028');
  const entry = setup.slice(at29, setup.indexOf('}', at29));
  assert.doesNotMatch(entry, /destructive/);
});

test('--fresh gỡ bảng phiếu nhập sau inventory_movements và trước product_variants', () => {
  const pos = name => setup.indexOf(`IF OBJECT_ID('dbo.${name}','U') IS NOT NULL DROP TABLE dbo.${name};`);
  const im = pos('inventory_movements'), items = pos('purchase_receipt_items');
  const receipts = pos('purchase_receipts'), suppliers = pos('suppliers'), variants = pos('product_variants');
  assert.ok(im >= 0 && items > im && receipts > items && suppliers > receipts && variants > suppliers);
});

test('029 idempotent: XACT_ABORT + TRY/CATCH, không sửa/xoá dữ liệu', () => {
  assert.match(code, /^SET XACT_ABORT ON;$/m);
  assert.match(code, /BEGIN TRY\s+BEGIN TRANSACTION;/);
  assert.match(code, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\s+THROW;\s+END CATCH;/);
  for (const t of ['suppliers', 'purchase_receipts', 'purchase_receipt_items']) {
    assert.match(code, new RegExp(`IF OBJECT_ID\\('dbo\\.${t}', 'U'\\) IS NULL\\s+CREATE TABLE dbo\\.${t} \\(`), t);
  }
  assert.doesNotMatch(code, /\bUPDATE\s+dbo\.|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bINSERT\b|DROP\s+TABLE/i);
  // DROP duy nhất được phép: dựng lại CHECK loại movement khi thiếu loại.
  const drops = code.match(/\bDROP\b[^;]*/gi) || [];
  assert.deepEqual(drops.map(d => d.replace(/\s+/g, ' ').trim()), ['DROP CONSTRAINT CK_inventory_movements_type']);
});

test('trạng thái phiếu: 5 trạng thái, không có rejected (từ chối quay về draft)', () => {
  const m = code.match(/CK_purchase_receipts_status\s+CHECK \(status COLLATE Latin1_General_CS_AS IN \(([^)]*)\)/);
  assert.ok(m);
  assert.deepEqual(m[1].split(',').map(s => s.trim().replace(/'/g, '')),
    ['draft', 'pending', 'approved', 'received', 'cancelled']);
  assert.match(code, /DF_purchase_receipts_status DEFAULT 'draft'/);
});

test('người thao tác trên phiếu không có FK tới users (xoá tài khoản nhân viên không bị chặn)', () => {
  const table = code.slice(code.indexOf('CREATE TABLE dbo.purchase_receipts'), code.indexOf('UX_purchase_receipts_code'));
  assert.doesNotMatch(table, /REFERENCES dbo\.users/);
  assert.match(table, /FOREIGN KEY \(supplier_id\)\s+REFERENCES dbo\.suppliers\(id\)/);
  for (const c of ['created_by', 'submitted_by', 'approved_by', 'rejected_by', 'received_by', 'cancelled_by']) {
    assert.match(table, new RegExp(`\\b${c}\\s+INT\\b`), c);
  }
});

test('mã phiếu là cột tính PERSISTED + UNIQUE', () => {
  assert.match(code, /code\s+AS CONVERT\(VARCHAR\(16\), 'PN-'[\s\S]*?\) PERSISTED,/);
  assert.match(code, /CREATE UNIQUE INDEX UX_purchase_receipts_code ON dbo\.purchase_receipts\(code\);/);
});

test('CHECK lý do từ chối/huỷ ghi rõ IS NOT NULL (CHECK cho qua khi UNKNOWN)', () => {
  for (const col of ['reject_reason', 'cancel_reason']) {
    const all = code.split(`LEN(${col})`).length - 1;
    const guarded = code.split(`${col} IS NOT NULL AND LEN(${col})`).length - 1;
    assert.ok(all >= 1 && all === guarded, col);
  }
});

test('dòng phiếu: FK (product_id, variant_id) như order_items, mỗi biến thể 1 dòng, số lượng/giá có giới hạn', () => {
  assert.match(code, /FK_purchase_receipt_items_variant_product FOREIGN KEY \(product_id, variant_id\)\s+REFERENCES dbo\.product_variants\(product_id, id\)/);
  assert.match(code, /UQ_purchase_receipt_items_variant UNIQUE \(receipt_id, variant_id\)/);
  assert.match(code, /CHECK \(quantity BETWEEN 1 AND 100000\)/);
  assert.match(code, /CHECK \(unit_cost BETWEEN 0 AND 1000000000\)/);
});

test('inventory_movements: đủ 10 loại, giữ 9 loại cũ + PURCHASE_RECEIPT; chặn cộng kho 2 lần', () => {
  const types = ['OPENING_BALANCE', 'VARIANT_OPENING', 'ORDER_CHECKOUT', 'ORDER_CANCEL', 'ADMIN_ADJUSTMENT',
    'PRODUCT_CREATE', 'VARIANT_TRANSFER_OUT', 'VARIANT_TRANSFER_IN', 'ORDER_DELETE', 'PURCHASE_RECEIPT'];
  const m = code.match(/ADD CONSTRAINT CK_inventory_movements_type CHECK\s+\(movement_type IN \(([^)]*)\)\)/);
  assert.ok(m);
  assert.deepEqual(m[1].split(',').map(s => s.trim().replace(/'/g, '')), types);
  for (const t of types) assert.match(code, new RegExp(`definition NOT LIKE '%${t}%'`), t);
  assert.match(code, /receipt_id IS NOT NULL AND variant_id IS NOT NULL AND quantity_delta > 0/);
  assert.match(code, /CREATE UNIQUE INDEX UX_inventory_movements_receipt_variant\s+ON dbo\.inventory_movements\(receipt_id, variant_id\) WHERE receipt_id IS NOT NULL;/);
});
