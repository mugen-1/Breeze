'use strict';

// Migration 025 (bảng audit_logs append-only): kiểm tĩnh nội dung file + đăng ký trong setup-db.
// verify-migration-chain.js dựng --fresh toàn bộ chuỗi gồm 025.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = '025_audit_logs.sql';
const raw = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', FILE), 'utf8');
// Bỏ chú thích /* */ và -- (chú thích giải thích vì sao KHÔNG có FOREIGN KEY) trước khi soi code SQL.
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const setup = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');

test('025 tồn tại và đăng ký trong setup-db.js, ngay sau 024', () => {
  const at24 = setup.indexOf("file: 'db/migrations/024_inventory_order_delete.sql'");
  const at25 = setup.indexOf(`file: 'db/migrations/${FILE}'`);
  assert.ok(at24 >= 0 && at25 > at24, 'setup-db.js phải đăng ký 025 sau 024');
});

test('025 idempotent: SET XACT_ABORT + TRY/CATCH, chỉ tạo khi chưa có, không sửa/xoá dữ liệu', () => {
  assert.match(code, /^SET XACT_ABORT ON;$/m);
  assert.match(code, /BEGIN TRY\s+BEGIN TRANSACTION;/);
  assert.match(code, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\s+THROW;\s+END CATCH;/);
  assert.match(code, /IF OBJECT_ID\('dbo\.audit_logs', 'U'\) IS NULL\s+CREATE TABLE dbo\.audit_logs/);
  for (const name of ['CK_audit_logs_actor_role', 'CK_audit_logs_before_json', 'CK_audit_logs_after_json']) {
    assert.match(code, new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM sys\\.check_constraints\\s+WHERE name = '${name}'`), name);
  }
  for (const name of ['IX_audit_logs_time', 'IX_audit_logs_entity', 'IX_audit_logs_actor', 'IX_audit_logs_role']) {
    assert.match(code, new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM sys\\.indexes WHERE name = '${name}'[^\\n]*\\n\\s+CREATE INDEX ${name} `), name);
  }
  assert.match(code, /IF OBJECT_ID\('dbo\.TR_audit_logs_no_update_delete', 'TR'\) IS NULL/);
  assert.doesNotMatch(code, /\bUPDATE\s+dbo\.|\bDELETE\s+FROM\b|\bDROP\b|\bTRUNCATE\b/i, 'không sửa/xoá dữ liệu');
});

test('025 có trigger INSTEAD OF UPDATE, DELETE chỉ THROW 51000', () => {
  assert.match(code, /CREATE TRIGGER dbo\.TR_audit_logs_no_update_delete ON dbo\.audit_logs\s+INSTEAD OF UPDATE, DELETE\s+AS/);
  assert.match(code, /THROW 51000, N''audit_logs chỉ cho phép thêm, không được sửa hoặc xoá'', 1;/);
});

test('025 CHECK actor_role phân biệt hoa/thường (COLLATE CS) + chặn dấu cách cuối, như CK_users_role', () => {
  assert.match(code, /CHECK \(actor_role COLLATE Latin1_General_CS_AS IN \('admin', 'staff', 'customer', 'cli'\)\s+AND DATALENGTH\(actor_role\) = LEN\(actor_role\)\);/);
});

test('025 CHECK ISJSON cho before_json / after_json; action, entity_type KHÔNG có CHECK', () => {
  assert.match(code, /CHECK \(before_json IS NULL OR ISJSON\(before_json\) = 1\)/);
  assert.match(code, /CHECK \(after_json IS NULL OR ISJSON\(after_json\) = 1\)/);
  assert.doesNotMatch(code, /CHECK \([^)]*\b(action|entity_type)\b/);
});

test('025 KHÔNG có FOREIGN KEY / REFERENCES trong định nghĩa bảng', () => {
  assert.doesNotMatch(code, /FOREIGN\s+KEY|\bREFERENCES\b/i);
});
