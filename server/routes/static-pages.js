/* static-pages.js — phục vụ các trang .html tĩnh (admin, checkout, invoice) có gắn ?v=.

   Ba trang này không qua EJS (cố ý không migrate), trước đây do express.static trả
   nguyên file. Giờ đọc file, gắn ?v=<hash> vào link CSS/JS (lib/asset-version.js) rồi
   mới gửi — để F5 là thấy CSS/JS mới, không phải đợi cache Cloudflare 4 giờ.

   Giữ y header của express.static: Cache-Control public, max-age=0 + Last-Modified +
   ETag (res.send tự tạo, tự trả 304, tự xử lý HEAD). Last-Modified lấy mtime MỚI NHẤT
   giữa file .html và các CSS/JS nó gắn: sửa riêng CSS thì trang cũng tính là mới.
   regression.js hạng mục 10 dựa vào Last-Modified để biết trang vẫn là file tĩnh.

   Chỉ nhận tên ở thư mục gốc client/ dạng /<tên>.html — không có '/', '..' ở giữa.
   File không tồn tại -> next(), để express.static / 404 lo như cũ. */
'use strict';

const fs = require('fs');
const path = require('path');
const { addVersions, CLIENT_ROOT } = require('../lib/asset-version');

const NAME_RE = /^\/([A-Za-z0-9_-]+)\.html$/;

module.exports = function staticPages(root) {
  const base = root || CLIENT_ROOT;
  return function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const m = NAME_RE.exec(req.path);
    if (!m) return next();
    const file = path.join(base, m[1] + '.html');
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return next();
      fs.readFile(file, 'utf8', (err2, raw) => {
        if (err2) return next();
        const { html, newestMtimeMs } = addVersions(raw, base);
        res.set('Cache-Control', 'public, max-age=0');
        res.set('Last-Modified', new Date(Math.max(st.mtimeMs, newestMtimeMs)).toUTCString());
        res.type('html').send(html);
      });
    });
  };
};
