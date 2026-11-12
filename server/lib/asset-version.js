/* asset-version.js — tự gắn ?v=<hash nội dung> vào link CSS/JS nội bộ trong HTML.

   VÌ SAO CẦN
   Site public chạy qua Cloudflare. Server gửi Cache-Control: max-age=0 cho file tĩnh,
   nhưng Cloudflare ghi đè thành max-age=14400 (4 giờ) => sửa CSS/JS xong, F5 vẫn thấy
   bản cũ tới 4 giờ. HTML thì không bị cache. Gắn ?v=<hash> vào link: file đổi -> hash
   đổi -> URL mới -> trình duyệt và Cloudflare đều tải bản mới ngay. File không đổi giữ
   URL cũ nên vẫn dùng cache như bình thường.

   PHẠM VI
   Chỉ thuộc tính src="..." / href="..." có giá trị bắt đầu bằng js/ hoặc css/ và kết
   thúc .js/.css (đúng dạng mọi trang đang dùng). Không đụng link ngoài (CDN), ảnh, font
   gọi trong CSS, hay file do JS tự nạp thêm. ?v= có sẵn (gõ tay) bị thay bằng hash thật.

   AN TOÀN
   - Không tìm thấy / không đọc được file -> giữ nguyên link gốc, trang vẫn chạy.
   - Đường dẫn có '..' hoặc '\' bị bỏ qua: không bao giờ đọc file ngoài client/.
   - Hash tính 1 lần cho mỗi file, chỉ tính lại khi mtime/size đổi -> không phải khởi
     động lại server sau khi sửa CSS/JS. */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CLIENT_ROOT = path.join(__dirname, '..', '..', 'client');

// Nhóm 1: ' src="' / ' href="' ; nhóm 2: đường dẫn ; phần ?v=... cũ (nếu có) bị bỏ.
const ASSET_RE = /(\s(?:src|href)=")((?:js|css)\/[^"?#\\]+?\.(?:js|css))(?:\?v=[^"#]*)?"/g;

const cache = new Map();   // đường dẫn tuyệt đối -> { mtimeMs, size, v }

/* Trả { v, mtimeMs } cho một file trong root, hoặc null nếu không dùng được. */
function versionOf(rel, root) {
  if (rel.split('/').includes('..')) return null;
  const base = path.resolve(root || CLIENT_ROOT);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  let st;
  try { st = fs.statSync(abs); } catch (e) { return null; }
  if (!st.isFile()) return null;
  const hit = cache.get(abs);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
  let v;
  try {
    v = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 10);
  } catch (e) { return null; }
  const entry = { mtimeMs: st.mtimeMs, size: st.size, v };
  cache.set(abs, entry);
  return entry;
}

/* Gắn ?v= vào mọi link CSS/JS nội bộ. Trả về HTML mới và mtime lớn nhất của các file
   đã gắn (dùng cho Last-Modified của trang tĩnh). */
function addVersions(html, root) {
  let newest = 0;
  const out = String(html).replace(ASSET_RE, (all, pre, rel) => {
    const info = versionOf(rel, root);
    if (!info) return pre + rel + '"';
    if (info.mtimeMs > newest) newest = info.mtimeMs;
    return pre + rel + '?v=' + info.v + '"';
  });
  return { html: out, newestMtimeMs: newest };
}

/* Bỏ ?v= khỏi một đường dẫn — cho công cụ test so tên file. */
function stripVersion(url) {
  return String(url).replace(/\?v=[^"#&]*$/, '');
}

module.exports = { addVersions, versionOf, stripVersion, CLIENT_ROOT, _cache: cache };
