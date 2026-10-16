'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const sharp = require('sharp');
const { MAX_IMAGE_BYTES, ALLOWED_MIME, detectImage, writeFileAtomic } = require('./image-upload');
const REVIEW_DIR = path.join(__dirname, '..', 'uploads', 'reviews');
const PUBLIC_PREFIX = '/review-images/';
class ReviewError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
async function prepareImages(files) {
  if (files.length > 5) throw new ReviewError(400,'REVIEW_TOO_MANY_IMAGES','Chỉ nhận tối đa 5 ảnh');
  const prepared = [];
  for (const file of files) {
    if (!file.buffer?.length || file.buffer.length > MAX_IMAGE_BYTES) {
      throw new ReviewError(413,'REVIEW_IMAGE_TOO_LARGE','Mỗi ảnh tối đa 2MB');
    }
    const extensions = {'image/png':['.png'],'image/jpeg':['.jpg','.jpeg'],'image/webp':['.webp']};
    let type;
    try { type = await detectImage(file.buffer); } catch (_) { /* invalid image */ }
    if (!type || !ALLOWED_MIME.includes(type.mime) || file.mimetype !== type.mime ||
        !extensions[type.mime].includes(path.extname(file.originalname || '').toLowerCase())) {
      throw new ReviewError(415,'REVIEW_INVALID_IMAGE','Chỉ nhận ảnh PNG, JPEG hoặc WEBP hợp lệ');
    }
    try {
      // Same magic-byte check, pixel budget, EXIF removal and WebP encoding as avatars.
      prepared.push(await sharp(file.buffer,{limitInputPixels:4096*4096}).rotate()
        .resize(1600,1600,{fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer());
    } catch (_) { throw new ReviewError(415,'REVIEW_INVALID_IMAGE','Không xử lý được ảnh tải lên'); }
  }
  return prepared;
}
function createStorage(directory = REVIEW_DIR) {
  return {
    async save(buffer) {
      const name = crypto.randomBytes(16).toString('hex') + '.webp';
      await fs.promises.mkdir(directory,{recursive:true});
      await writeFileAtomic(path.join(directory,name),buffer);
      return PUBLIC_PREFIX + name;
    },
    async remove(urls) {
      await Promise.all(urls.map(async url => {
        const name = /^\/review-images\/([a-f0-9]{32}\.webp)$/.exec(url);
        if (!name) return;
        try { await fs.promises.unlink(path.join(directory,name[1])); }
        catch (error) { if (error.code !== 'ENOENT') console.error('[reviews] file cleanup failed:',error.code); }
      }));
    }
  };
}
module.exports = { REVIEW_DIR, PUBLIC_PREFIX, ReviewError, prepareImages, createStorage, storage:createStorage() };
