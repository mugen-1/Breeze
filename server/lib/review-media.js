'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const sharp = require('sharp');
const { MAX_IMAGE_BYTES, ALLOWED_MIME, detectImage, writeFileAtomic } = require('./image-upload');
const REVIEW_DIR = path.join(__dirname, '..', 'uploads', 'reviews');
// Ảnh gốc chờ xử lý nền (JOBS_MODE=async). KHÔNG được mount tĩnh: server.js chỉ phục vụ
// uploads/avatars và uploads/reviews, nên ảnh chưa qua re-encode không bao giờ tới trình duyệt.
const PENDING_DIR = path.join(__dirname, '..', 'uploads', 'reviews-pending');
const PUBLIC_PREFIX = '/review-images/';
const MAX_INPUT_PIXELS = 4096 * 4096;
// Mọi tên file trên đĩa chỉ dựng từ 32 ký tự hex do server sinh + đuôi trong danh sách cố định;
// tên/đuôi file client gửi lên chỉ dùng để so khớp với nội dung, không bao giờ vào đường dẫn.
const HEX = /^[0-9a-f]{32}$/;
const SOURCE_EXTS = Object.freeze(['jpg', 'png', 'webp']);
const SOURCE_EXT_BY_MIME = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' });
const CLIENT_EXTENSIONS = Object.freeze({ 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'] });
class ReviewError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const invalidImage = () => new ReviewError(415, 'REVIEW_INVALID_IMAGE', 'Không xử lý được ảnh tải lên');

function checkCount(files) {
  if (files.length > 5) throw new ReviewError(400, 'REVIEW_TOO_MANY_IMAGES', 'Chỉ nhận tối đa 5 ảnh');
}
// Dung lượng, magic byte, MIME khai báo và đuôi file phải khớp nhau. Trả MIME thật của nội dung.
async function checkUpload(file) {
  if (!file.buffer?.length || file.buffer.length > MAX_IMAGE_BYTES) {
    throw new ReviewError(413, 'REVIEW_IMAGE_TOO_LARGE', 'Mỗi ảnh tối đa 2MB');
  }
  let type;
  try { type = await detectImage(file.buffer); } catch (_) { /* invalid image */ }
  if (!type || !ALLOWED_MIME.includes(type.mime) || file.mimetype !== type.mime ||
      !CLIENT_EXTENSIONS[type.mime].includes(path.extname(file.originalname || '').toLowerCase())) {
    throw new ReviewError(415, 'REVIEW_INVALID_IMAGE', 'Chỉ nhận ảnh PNG, JPEG hoặc WEBP hợp lệ');
  }
  return type.mime;
}
// Same pixel budget, EXIF removal and WebP encoding as avatars. Dùng chung cho đường đồng bộ
// và handler chạy nền, nên ảnh ra giống hệt nhau ở cả hai chế độ.
function processImage(buffer) {
  return sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).rotate()
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
}

// JOBS_MODE=sync: kiểm tra + xử lý ngay trong request (hành vi gốc).
async function prepareImages(files) {
  checkCount(files);
  const prepared = [];
  for (const file of files) {
    await checkUpload(file);
    try { prepared.push(await processImage(file.buffer)); } catch (_) { throw invalidImage(); }
  }
  return prepared;
}

// JOBS_MODE=async: giữ mọi kiểm tra đồng bộ, thêm đọc header (không giải mã điểm ảnh) để từ chối
// ngay ảnh hỏng header hoặc vượt ngân sách điểm ảnh; phần rotate/resize/WebP để worker làm.
async function inspectImages(files) {
  checkCount(files);
  const accepted = [];
  for (const file of files) {
    const mime = await checkUpload(file);
    let meta = null;
    try { meta = await sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata(); } catch (_) { /* header hỏng */ }
    if (!meta || !Number.isInteger(meta.width) || !Number.isInteger(meta.height) || meta.width < 1 || meta.height < 1 ||
        meta.width * meta.height > MAX_INPUT_PIXELS) throw invalidImage();
    accepted.push({ buffer: file.buffer, ext: SOURCE_EXT_BY_MIME[mime] });
  }
  return accepted;
}

function hexOf(url) {
  const match = /^\/review-images\/([0-9a-f]{32})\.webp$/.exec(typeof url === 'string' ? url : '');
  return match ? match[1] : null;
}
function parseSource(name) {
  const match = /^([0-9a-f]{32})\.(jpg|png|webp)$/.exec(typeof name === 'string' ? name : '');
  return match ? { hex: match[1], ext: match[2] } : null;
}

// directory: ảnh cuối (được phục vụ tĩnh). pendingDirectory: ảnh gốc chờ xử lý; mặc định là
// uploads/reviews-pending cho thư mục thật, còn thư mục khác (test) dùng thư mục anh em "<dir>-pending".
function createStorage(directory = REVIEW_DIR, pendingDirectory = directory === REVIEW_DIR ? PENDING_DIR : directory + '-pending') {
  function finalPath(hex) {
    if (!HEX.test(hex)) throw new Error('Tên ảnh không hợp lệ');
    return path.join(directory, hex + '.webp');
  }
  function pendingPath(hex, ext) {
    if (!HEX.test(hex) || !SOURCE_EXTS.includes(ext)) throw new Error('Tên ảnh gốc không hợp lệ');
    return path.join(pendingDirectory, hex + '.' + ext);
  }
  async function unlinkQuietly(file) {
    try { await fs.promises.unlink(file); }
    catch (error) { if (error.code !== 'ENOENT') console.error('[reviews] file cleanup failed:', error.code); }
  }
  async function removeOriginals(urls) {
    await Promise.all(urls.map(hexOf).filter(Boolean).flatMap(hex => SOURCE_EXTS.map(ext => unlinkQuietly(pendingPath(hex, ext)))));
  }
  return {
    directory, pendingDirectory,
    async save(buffer) {
      const name = crypto.randomBytes(16).toString('hex') + '.webp';
      await fs.promises.mkdir(directory, { recursive: true });
      await writeFileAtomic(path.join(directory, name), buffer);
      return PUBLIC_PREFIX + name;
    },
    // Ảnh gốc dùng cùng 32 hex với URL cuối sinh sẵn: từ image_path suy ra được ảnh gốc để dọn.
    async savePending(buffer, ext) {
      const hex = crypto.randomBytes(16).toString('hex');
      await fs.promises.mkdir(pendingDirectory, { recursive: true });
      await writeFileAtomic(pendingPath(hex, ext), buffer);
      return { url: PUBLIC_PREFIX + hex + '.webp', source: hex + '.' + ext };
    },
    // Đọc trọn file vào bộ nhớ: không giữ handle mở trong lúc xử lý, xoá ảnh gốc trên Windows không vướng.
    async readPending(source) {
      const parsed = parseSource(source);
      if (!parsed) throw new Error('Tên ảnh gốc không hợp lệ');
      return fs.promises.readFile(pendingPath(parsed.hex, parsed.ext));
    },
    // Ghi đè cùng tên khi thử lại: rename nguyên tử thay file cũ (nếu lần trước đã ghi).
    async saveFinal(hex, buffer) {
      await fs.promises.mkdir(directory, { recursive: true });
      await writeFileAtomic(finalPath(hex), buffer);
      return PUBLIC_PREFIX + hex + '.webp';
    },
    async removeFinal(hex) { await unlinkQuietly(finalPath(hex)); },
    async removePending(source) {
      const parsed = parseSource(source);
      if (parsed) await unlinkQuietly(pendingPath(parsed.hex, parsed.ext));
    },
    removeOriginals,
    // Xoá ảnh cuối VÀ ảnh gốc chờ xử lý (nếu còn) của các URL: dùng khi rollback, khi chủ review
    // xoá ảnh hoặc xoá cả đánh giá. Job của ảnh đó sau này thấy dòng đã mất thì chỉ dọn rồi xong.
    async remove(urls) {
      await Promise.all(urls.map(hexOf).filter(Boolean).map(hex => unlinkQuietly(finalPath(hex))));
      await removeOriginals(urls);
    },
  };
}
module.exports = {
  REVIEW_DIR, PENDING_DIR, PUBLIC_PREFIX, MAX_INPUT_PIXELS, SOURCE_EXTS, ReviewError,
  prepareImages, inspectImages, processImage, hexOf, parseSource, createStorage, storage: createStorage(),
};
