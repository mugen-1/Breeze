'use strict';

// Migration 026 (bảng jobs): kiểm tĩnh nội dung file + đăng ký trong setup-db.
// Ràng buộc chạy thật trên SQL Server: scripts/verify-jobs-sql.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = '026_jobs.sql';
const raw = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', FILE), 'utf8');
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const setup = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');
const { JOB_TYPES, MAX_ATTEMPTS_LIMIT, DEFAULT_MAX_ATTEMPTS } = require('../lib/jobs/queue');

test('026 tồn tại và đăng ký trong setup-db.js, ngay sau 025, không destructive', () => {
  const at25 = setup.indexOf("file: 'db/migrations/025_audit_logs.sql'");
  const at26 = setup.indexOf(`file: 'db/migrations/${FILE}'`);
  assert.ok(at25 >= 0 && at26 > at25, 'setup-db.js phải đăng ký 026 sau 025');
  const entry = setup.slice(at26, setup.indexOf('}', at26));
  assert.doesNotMatch(entry, /destructive/);
});

test('026 idempotent: SET XACT_ABORT + TRY/CATCH, chỉ tạo khi chưa có, không sửa/xoá dữ liệu', () => {
  assert.match(code, /^SET XACT_ABORT ON;$/m);
  assert.match(code, /BEGIN TRY\s+BEGIN TRANSACTION;/);
  assert.match(code, /BEGIN CATCH\s+IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\s+THROW;\s+END CATCH;/);
  assert.match(code, /IF OBJECT_ID\('dbo\.jobs', 'U'\) IS NULL\s+CREATE TABLE dbo\.jobs/);
  for (const name of ['CK_jobs_type', 'CK_jobs_status', 'CK_jobs_payload', 'CK_jobs_attempts', 'CK_jobs_lock',
    'CK_jobs_finished', 'CK_jobs_dedupe_key']) {
    assert.match(code, new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM sys\\.check_constraints\\s+WHERE name = '${name}'`), name);
  }
  for (const name of ['IX_jobs_ready', 'UX_jobs_dedupe']) {
    assert.match(code, new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM sys\\.indexes WHERE name = '${name}'[^\\n]*\\n\\s+CREATE (UNIQUE )?INDEX ${name} `), name);
  }
  assert.doesNotMatch(code, /\bUPDATE\s+dbo\.|\bDELETE\s+FROM\b|\bDROP\b|\bTRUNCATE\b|\bINSERT\b/i, 'không sửa/xoá dữ liệu');
  assert.doesNotMatch(code, /FOREIGN\s+KEY|\bREFERENCES\b|CREATE TRIGGER/i);
});

test('026 đủ cột theo thiết kế, kiểu và mặc định đúng', () => {
  for (const [column, def] of [
    ['id', /BIGINT IDENTITY\(1,1\) NOT NULL CONSTRAINT PK_jobs PRIMARY KEY/],
    ['type', /VARCHAR\(40\)\s+NOT NULL/],
    ['payload', /NVARCHAR\(2000\) NOT NULL/],
    ['status', /VARCHAR\(12\)\s+NOT NULL CONSTRAINT DF_jobs_status DEFAULT 'queued'/],
    ['attempts', /TINYINT\s+NOT NULL CONSTRAINT DF_jobs_attempts DEFAULT 0/],
    ['max_attempts', new RegExp(`TINYINT\\s+NOT NULL CONSTRAINT DF_jobs_max_attempts DEFAULT ${DEFAULT_MAX_ATTEMPTS}`)],
    ['run_after', /DATETIME2\(3\)\s+NOT NULL CONSTRAINT DF_jobs_run_after DEFAULT SYSUTCDATETIME\(\)/],
    ['locked_by', /VARCHAR\(64\)\s+NULL/],
    ['locked_until', /DATETIME2\(3\)\s+NULL/],
    ['last_error', /NVARCHAR\(400\)\s+NULL/],
    ['dedupe_key', /VARCHAR\(100\)\s+NULL/],
    ['created_at', /DATETIME2\(3\)\s+NOT NULL CONSTRAINT DF_jobs_created_at DEFAULT SYSUTCDATETIME\(\)/],
    ['updated_at', /DATETIME2\(3\)\s+NOT NULL CONSTRAINT DF_jobs_updated_at DEFAULT SYSUTCDATETIME\(\)/],
    ['finished_at', /DATETIME2\(3\)\s+NULL/],
  ]) {
    assert.match(code, new RegExp(`\\n\\s+${column}\\s+${def.source}`), column);
  }
});

test('026 CK_jobs_type khớp đúng JOB_TYPES của lib/jobs/queue.js, phân biệt hoa/thường', () => {
  const m = code.match(/CHECK \(type COLLATE Latin1_General_CS_AS IN \(([^)]*)\)\s+AND DATALENGTH\(type\) = LEN\(type\)\)/);
  assert.ok(m, 'không thấy CK_jobs_type');
  assert.deepEqual(m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')), [...JOB_TYPES]);
});

test('026 CHECK status / payload ISJSON / attempts / khoá / finished_at', () => {
  assert.match(code, /CHECK \(status COLLATE Latin1_General_CS_AS IN \('queued', 'running', 'done', 'failed'\)\s+AND DATALENGTH\(status\) = LEN\(status\)\)/);
  assert.match(code, /CHECK \(ISJSON\(payload\) = 1\)/);
  assert.match(code, new RegExp(`CHECK \\(max_attempts BETWEEN 1 AND ${MAX_ATTEMPTS_LIMIT} AND attempts <= max_attempts\\)`));
  assert.match(code, /status = 'running' AND locked_by IS NOT NULL AND LEN\(locked_by\) > 0 AND locked_until IS NOT NULL\)\s+OR \(status <> 'running' AND locked_by IS NULL AND locked_until IS NULL/);
  assert.match(code, /status IN \('done', 'failed'\) AND finished_at IS NOT NULL\)\s+OR \(status IN \('queued', 'running'\) AND finished_at IS NULL/);
});

test('026 IX_jobs_ready (status, run_after) INCLUDE(type); UX_jobs_dedupe UNIQUE có lọc chỉ khi queued', () => {
  assert.match(code, /CREATE INDEX IX_jobs_ready ON dbo\.jobs\(status, run_after\) INCLUDE\(type\);/);
  assert.match(code, /CREATE UNIQUE INDEX UX_jobs_dedupe ON dbo\.jobs\(dedupe_key\)\s+WHERE status = 'queued' AND dedupe_key IS NOT NULL;/);
});
