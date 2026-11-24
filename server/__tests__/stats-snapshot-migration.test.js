'use strict';

// Migration 028 (thống kê tính sẵn): kiểm tĩnh nội dung file + đăng ký trong setup-db.
// Chạy thật + so khớp với truy vấn trực tiếp: scripts/verify-stats-snapshot-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = '028_stats_snapshots.sql';
const raw = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', FILE), 'utf8');
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const setup = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');

test('028 đăng ký trong setup-db.js ngay sau 027, không destructive', () => {
  const at27 = setup.indexOf("file: 'db/migrations/027_review_image_status.sql'");
  const at28 = setup.indexOf(`file: 'db/migrations/${FILE}'`);
  assert.ok(at27 >= 0 && at28 > at27);
  assert.doesNotMatch(setup.slice(at28, setup.indexOf('}', at28)), /destructive/);
});

test('028 idempotent: SET XACT_ABORT + TRY/CATCH, chỉ tạo khi chưa có, không sửa/xoá dữ liệu, không trigger/FK', () => {
  assert.match(code, /^SET XACT_ABORT ON;$/m);
  assert.match(code, /BEGIN TRY\s+BEGIN TRANSACTION;/);
  assert.match(code, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\s+THROW;\s+END CATCH;/);
  for (const table of ['stats_snapshots', 'stats_snapshot_products']) {
    assert.match(code, new RegExp(`IF OBJECT_ID\\('dbo\\.${table}', 'U'\\) IS NULL\\s+CREATE TABLE dbo\\.${table}`));
  }
  for (const name of ['CK_stats_snapshots_counts', 'CK_stats_snapshot_products_units']) {
    assert.match(code, new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM sys\\.check_constraints\\s+WHERE name = '${name}'`));
  }
  assert.doesNotMatch(code, /\bUPDATE\s+dbo\.|\bDELETE\s+FROM\b|\bDROP\b|\bTRUNCATE\b|\bINSERT\b/i);
  assert.doesNotMatch(code, /FOREIGN\s+KEY|\bREFERENCES\b|CREATE TRIGGER/i);
});

test('028 stats_snapshots: ngày làm khoá, doanh thu DECIMAL(19,2), không có cột số khách', () => {
  assert.match(code, /day\s+DATE\s+NOT NULL CONSTRAINT PK_stats_snapshots PRIMARY KEY/);
  assert.match(code, /revenue\s+DECIMAL\(19,2\) NOT NULL/);
  for (const column of ['orders', 'completed', 'cancelled']) assert.match(code, new RegExp(`\\n\\s+${column}\\s+INT\\s+NOT NULL`));
  assert.match(code, /products_sold BIGINT\s+NOT NULL/);
  assert.match(code, /computed_at\s+DATETIME2\(3\)\s+NOT NULL CONSTRAINT DF_stats_snapshots_computed_at DEFAULT SYSUTCDATETIME\(\)/);
  assert.doesNotMatch(code, /customers/i);
});

test('028 stats_snapshot_products: doanh thu CHƯA làm tròn DECIMAL(38,7), tên + last_order_at, khoá (day, product_id)', () => {
  assert.match(code, /product_name\s+NVARCHAR\(200\) NOT NULL/);
  assert.match(code, /last_order_at DATETIME2\s+NOT NULL/);
  assert.match(code, /units_sold\s+BIGINT\s+NOT NULL/);
  assert.match(code, /revenue\s+DECIMAL\(38,7\) NOT NULL/);
  assert.match(code, /CONSTRAINT PK_stats_snapshot_products PRIMARY KEY \(day, product_id\)/);
});

test('028 đúng 2 chỉ mục đã chốt; không thêm (status, created_at)', () => {
  assert.match(code, /CREATE INDEX IX_orders_created ON dbo\.orders\(created_at\) INCLUDE\(status, total_amount, user_id\);/);
  assert.match(code, /CREATE INDEX IX_order_items_order ON dbo\.order_items\(order_id\) INCLUDE\(product_id, product_name, quantity, line_total\);/);
  assert.equal((code.match(/CREATE INDEX/g) || []).length, 2);
  assert.doesNotMatch(code, /\(status, created_at/);
});
