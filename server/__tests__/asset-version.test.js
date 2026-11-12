'use strict';

// lib/asset-version.js + routes/static-pages.js trên thư mục tạm, Express thật.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { addVersions, stripVersion } = require('../lib/asset-version');
const staticPages = require('../routes/static-pages');

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);

function tmpRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-ver-'));
  fs.mkdirSync(path.join(root, 'js'));
  fs.mkdirSync(path.join(root, 'css'));
  fs.writeFileSync(path.join(root, 'js', 'a.js'), 'console.log(1)');
  fs.writeFileSync(path.join(root, 'css', 'b.css'), 'body{}');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('gắn ?v=<hash nội dung> vào link js/ và css/ nội bộ', (t) => {
  const root = tmpRoot(t);
  const { html } = addVersions('<link rel="stylesheet" href="css/b.css"><script src="js/a.js"></script>', root);
  assert.equal(html, '<link rel="stylesheet" href="css/b.css?v=' + hash('body{}') + '">' +
    '<script src="js/a.js?v=' + hash('console.log(1)') + '"></script>');
});

test('sửa file -> hash đổi (không cần khởi động lại)', (t) => {
  const root = tmpRoot(t);
  const before = addVersions('<script src="js/a.js"></script>', root).html;
  const f = path.join(root, 'js', 'a.js');
  fs.writeFileSync(f, 'console.log(2) // dài hơn');
  const after = addVersions('<script src="js/a.js"></script>', root).html;
  assert.notEqual(before, after);
  assert.match(after, new RegExp('\\?v=' + hash('console.log(2) // dài hơn')));
});

test('?v= gõ tay bị thay bằng hash thật', (t) => {
  const root = tmpRoot(t);
  const { html } = addVersions('<script src="js/a.js?v=20261104"></script>', root);
  assert.equal(html, '<script src="js/a.js?v=' + hash('console.log(1)') + '"></script>');
});

test('không đụng CDN, ảnh, file không tồn tại, đường dẫn có ..', (t) => {
  const root = tmpRoot(t);
  const src = '<script src="https://cdn.x/js/a.js"></script><img src="img/x.png">' +
    '<script src="js/khong-co.js"></script><script src="js/../../etc/x.js"></script>';
  assert.equal(addVersions(src, root).html, src);
});

test('stripVersion bỏ đúng phần ?v=', () => {
  assert.equal(stripVersion('js/a.js?v=0123abcdef'), 'js/a.js');
  assert.equal(stripVersion('js/a.js'), 'js/a.js');
});

test('trang tĩnh: gắn ?v=, giữ Cache-Control + Last-Modified + ETag/304, HEAD, bỏ qua tên lạ', async (t) => {
  const root = tmpRoot(t);
  fs.writeFileSync(path.join(root, 'admin.html'), '<html><script src="js/a.js"></script></html>');
  const app = express();
  app.use(staticPages(root));
  app.use((req, res) => res.status(404).send('next'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = (p) => 'http://127.0.0.1:' + server.address().port + p;

  const r = await fetch(url('/admin.html'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=0');
  assert.ok(r.headers.get('last-modified'));
  assert.equal(await r.text(), '<html><script src="js/a.js?v=' + hash('console.log(1)') + '"></script></html>');

  // fetch tự thêm Cache-Control: no-cache khi có If-None-Match (theo spec) -> ghi rõ
  // max-age=0 như trình duyệt khi F5, nếu không Express luôn trả 200.
  const etag = r.headers.get('etag');
  assert.ok(etag);
  assert.equal((await fetch(url('/admin.html'), { headers: { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' } })).status, 304);

  // Sửa JS -> ETag đổi -> trình duyệt không nhận 304 cũ.
  fs.writeFileSync(path.join(root, 'js', 'a.js'), 'console.log("moi hon")');
  const r2 = await fetch(url('/admin.html'), { headers: { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' } });
  assert.equal(r2.status, 200);
  assert.notEqual(r2.headers.get('etag'), etag);

  const head = await fetch(url('/admin.html'), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  assert.equal((await fetch(url('/khong-co.html'))).status, 404);
  assert.equal((await fetch(url('/js/a.js'))).status, 404);          // không phải .html -> next()
  assert.equal((await fetch(url('/a/../admin.html'))).status, 200);   // fetch tự chuẩn hoá URL
  assert.equal((await fetch(url('/admin.html'), { method: 'POST' })).status, 404);
});
