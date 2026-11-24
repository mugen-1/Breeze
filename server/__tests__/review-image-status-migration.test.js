'use strict';

// Migration 027 (review_images.status): kiểm tĩnh nội dung file + đăng ký trong setup-db.
// Chạy thật trên SQL Server (dòng cũ thành 'ready', chạy lại không đổi dữ liệu): scripts/verify-review-image-job-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = '027_review_image_status.sql';
const raw = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', FILE), 'utf8');
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const setup = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');

test('027 đăng ký trong setup-db.js ngay sau 026, không destructive', () => {
  const at26 = setup.indexOf("file: 'db/migrations/026_jobs.sql'");
  const at27 = setup.indexOf(`file: 'db/migrations/${FILE}'`);
  assert.ok(at26 >= 0 && at27 > at26, 'setup-db.js phải đăng ký 027 sau 026');
  assert.doesNotMatch(setup.slice(at27, setup.indexOf('}', at27)), /destructive/);
});

test('027 idempotent: SET XACT_ABORT + TRY/CATCH, chỉ thêm khi chưa có, không sửa/xoá dữ liệu', () => {
  assert.match(code, /^SET XACT_ABORT ON;$/m);
  assert.match(code, /BEGIN TRY\s+BEGIN TRANSACTION;/);
  assert.match(code, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\s+THROW;\s+END CATCH;/);
  assert.match(code, /IF COL_LENGTH\('dbo\.review_images', 'status'\) IS NULL\s+ALTER TABLE dbo\.review_images\s+ADD status/);
  assert.match(code, /IF NOT EXISTS \(SELECT 1 FROM sys\.check_constraints\s+WHERE name = 'CK_review_images_status'/);
  assert.doesNotMatch(code, /\bUPDATE\s+dbo\.|\bDELETE\s+FROM\b|\bDROP\b|\bTRUNCATE\b|\bINSERT\b/i);
});

test("027 cột NOT NULL DEFAULT 'ready': dòng đang có tự thành 'ready', ảnh cũ không bị ẩn", () => {
  assert.match(code, /ADD status VARCHAR\(10\) NOT NULL CONSTRAINT DF_review_images_status DEFAULT 'ready';/);
});

test('027 CHECK pending|ready|failed phân biệt hoa/thường, chặn dấu cách cuối, tạo qua EXEC', () => {
  assert.match(code, /EXEC\(N'ALTER TABLE dbo\.review_images WITH CHECK\s+ADD CONSTRAINT CK_review_images_status\s+CHECK \(status COLLATE Latin1_General_CS_AS IN \(''pending'', ''ready'', ''failed''\)\s+AND DATALENGTH\(status\) = LEN\(status\)\);'\);/);
});
