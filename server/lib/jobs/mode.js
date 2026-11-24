'use strict';
// JOBS_MODE quyết định request upload ảnh đánh giá xử lý ảnh ở đâu:
//   sync  (mặc định, để trống cũng vậy): rotate/resize/WebP ngay trong request, ảnh 'ready' luôn.
//   async: request chỉ kiểm tra rồi lưu ảnh gốc + đưa job review_image.process vào hàng đợi;
//          ảnh 'pending' tới khi worker (JOBS_WORKER=on hoặc server/worker.js) xử lý xong.
// Giá trị lạ -> sync kèm cảnh báo, để gõ sai không đổi hành vi đang chạy.
const MODES = Object.freeze(['sync', 'async']);

function parseJobsMode(raw) {
  const value = raw == null ? '' : String(raw).trim().toLowerCase();
  if (value === '') return { mode: 'sync', value: 'sync', valid: true };
  if (MODES.includes(value)) return { mode: value, value, valid: true };
  return { mode: 'sync', value, valid: false };
}

// Đọc ở mỗi request (rẻ): test và công cụ đo bật/tắt được bằng biến môi trường.
function jobsMode(env = process.env) { return parseJobsMode(env.JOBS_MODE).mode; }

module.exports = { MODES, parseJobsMode, jobsMode };
