'use strict';

// JOBS_MODE (lib/jobs/mode.js) + dòng log khởi động trong server.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseJobsMode, jobsMode, MODES } = require('../lib/jobs/mode');

test('JOBS_MODE: trống/không đặt -> sync; sync|async nhận (không phân biệt hoa thường, bỏ khoảng trắng); lạ -> sync + không hợp lệ', () => {
  assert.deepEqual([...MODES], ['sync', 'async']);
  for (const raw of [undefined, null, '', '  ']) assert.deepEqual(parseJobsMode(raw), { mode: 'sync', value: 'sync', valid: true });
  assert.deepEqual(parseJobsMode('sync'), { mode: 'sync', value: 'sync', valid: true });
  assert.deepEqual(parseJobsMode(' ASYNC '), { mode: 'async', value: 'async', valid: true });
  for (const raw of ['on', 'true', 'background', 'asyn']) assert.deepEqual(parseJobsMode(raw), { mode: 'sync', value: raw, valid: false });
});

test('jobsMode() đọc biến môi trường ở mỗi lần gọi', () => {
  assert.equal(jobsMode({}), 'sync');
  assert.equal(jobsMode({ JOBS_MODE: 'async' }), 'async');
  assert.equal(jobsMode({ JOBS_MODE: 'lạ' }), 'sync');
  const old = process.env.JOBS_MODE;
  try {
    process.env.JOBS_MODE = 'async'; assert.equal(jobsMode(), 'async');
    delete process.env.JOBS_MODE; assert.equal(jobsMode(), 'sync');
  } finally { if (old === undefined) delete process.env.JOBS_MODE; else process.env.JOBS_MODE = old; }
});

test('server.js in 1 dòng log hai cờ, cảnh báo giá trị lạ, cảnh báo async khi worker không bật', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /parseJobsMode\(process\.env\.JOBS_MODE\)/);
  assert.match(server, /console\.log\(`\[jobs\] JOBS_MODE=\$\{jobsMode\.mode\} JOBS_WORKER=\$\{jobsFlag\.enabled \? 'on' : 'off'\}`\);/);
  assert.match(server, /if \(!jobsMode\.valid\) console\.warn\(`\[jobs\] JOBS_MODE="\$\{jobsMode\.value\}" không hợp lệ \(async\|sync\) -> sync`\);/);
  assert.match(server, /if \(jobsMode\.mode === 'async' && !jobsFlag\.enabled\) \{\s+console\.warn\([^)]*KHÔNG được xử lý nếu không chạy worker riêng: node server\/worker\.js'\);/);
});

test('route đánh giá chọn đường xử lý ảnh theo JOBS_MODE cho cả tạo và sửa', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'product-reviews.js'), 'utf8');
  assert.match(route, /const readImages = \(mode, files\) => \(mode === 'async' \? inspectImages\(files\) : prepareImages\(files\)\);/);
  assert.equal((route.match(/jobsMode\(\)/g) || []).length, 2);
  assert.ok(route.includes('changeOwnerReview(await getPool(),{userId:req.user.id,productId:req.reviewProductId,reviewId:req.reviewId,data,images,storage,mode,'));
  assert.ok(route.includes('createReview(await getPool(),{userId:req.user.id,productId:req.reviewProductId,data,images,storage,mode,'));
});
