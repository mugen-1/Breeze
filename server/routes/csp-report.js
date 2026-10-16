/* csp-report.js — nhận báo cáo vi phạm CSP từ trình duyệt (directive report-uri trong
   middleware/security.js). CHỈ ghi log server: không lưu DB, không trả dữ liệu gì.

   Mount TRƯỚC express.json() chung trong server.js, vì hai lý do:
     - giới hạn body 10kb áp ngay tại đây (parser chung cho tới 100kb);
     - KHÔNG tính vào rate limit chung của /api: một trang vi phạm nhiều chỗ bắn nhiều báo
       cáo, không được làm cạn hạn mức gọi API thật của người dùng. Có limiter riêng.

   Hai định dạng trình duyệt gửi:
     report-uri   (application/csp-report):
       { "csp-report": { "document-uri", "effective-directive", "violated-directive",
                         "blocked-uri", "source-file", "line-number", "disposition" } }
     Reporting API (application/reports+json):
       [ { "type": "csp-violation", "url", "body": { "documentURL", "effectiveDirective",
                                                     "blockedURL", "sourceFile", "lineNumber", "disposition" } } ]

   Nội dung do trình duyệt — hoặc BẤT KỲ AI gửi POST — tạo ra, nên là dữ liệu không tin
   cậy: cắt ngắn từng trường, bỏ ký tự điều khiển (không cho giả dòng log bằng \n), bỏ
   query string của URL (có thể chứa từ khoá tìm kiếm, tham số redirect...). */
const express = require('express');
const { rateLimit } = require('express-rate-limit');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { status: 'error', message: 'Quá nhiều báo cáo CSP' },
});

const parse = express.json({
  limit: '10kb',
  type: ['application/csp-report', 'application/reports+json', 'application/json'],
});

function clean(v, max) {
  if (v === undefined || v === null || v === '') return '-';
  return String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
}
function noQuery(u) {
  const s = clean(u, 300);
  const i = s.search(/[?#]/);
  return i >= 0 ? s.slice(0, i) : s;
}

// Đưa hai định dạng về một dạng. Reporting API gom nhiều báo cáo một lần: tối đa 20.
function normalize(body) {
  if (body && typeof body === 'object' && body['csp-report']) {
    const r = body['csp-report'];
    return [{
      disp: r.disposition, dir: r['effective-directive'] || r['violated-directive'],
      blocked: r['blocked-uri'], doc: r['document-uri'], src: r['source-file'], line: r['line-number'],
    }];
  }
  if (Array.isArray(body)) {
    return body
      .filter((x) => x && x.type === 'csp-violation' && x.body && typeof x.body === 'object')
      .slice(0, 20)
      .map((x) => ({
        disp: x.body.disposition, dir: x.body.effectiveDirective,
        blocked: x.body.blockedURL, doc: x.body.documentURL || x.url, src: x.body.sourceFile, line: x.body.lineNumber,
      }));
  }
  return [];
}

router.post('/', limiter, parse, (req, res) => {
  normalize(req.body).forEach((r) => {
    console.warn('[csp] ' + clean(r.disp, 10) + ' ' + clean(r.dir, 60) +
      ' blocked=' + noQuery(r.blocked) + ' page=' + noQuery(r.doc) +
      ' at=' + noQuery(r.src) + ':' + clean(r.line, 10));
  });
  res.status(204).end();
});

module.exports = router;
