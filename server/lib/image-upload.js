'use strict';
// Shared primitives from the existing avatar upload pipeline.
const fs = require('node:fs'), path = require('node:path');
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
async function detectImage(buffer) {
  const { fileTypeFromBuffer } = await import('file-type');
  return fileTypeFromBuffer(buffer);
}
async function writeFileAtomic(finalPath, buf) {
  // Write to a unique hidden temp file, then rename atomically. Readers (especially
  // avatars sharing one URL per user) never receive a truncated or partial image.
  // dotfiles:'deny' on the static mounts prevents serving these temporary files.
  const dir = path.dirname(finalPath);
  const tmpPath = path.join(dir, '.' + path.basename(finalPath) + '.' + process.pid + '-' + Date.now() +
    '-' + Math.random().toString(36).slice(2, 8) + '.tmp');
  try {
    await fs.promises.writeFile(tmpPath, buf);
    for (let i = 0; ; i++) {
      try { await fs.promises.rename(tmpPath, finalPath); return; }
      catch (err) {
        // Windows can briefly hold the destination open while an image is being read.
        if (i >= 4 || !['EPERM','EBUSY','EACCES'].includes(err.code)) throw err;
        await new Promise(resolve => setTimeout(resolve, 40 * (i + 1)));
      }
    }
  } catch (err) { await fs.promises.unlink(tmpPath).catch(() => {}); throw err; }
}
module.exports = { MAX_IMAGE_BYTES, ALLOWED_MIME, detectImage, writeFileAtomic };
