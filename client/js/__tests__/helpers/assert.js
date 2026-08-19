/* Assertion tối giản cho bộ test client — không cần cài thư viện ngoài.
   Dùng:
     const { check, eq, note } = require('./helpers/assert');
     check('mô tả', điều_kiện);
     eq('mô tả', giá_trị_thực, giá_trị_mong_đợi);
   Cuối tiến trình tự in tổng kết và đặt exit code khác 0 nếu có case fail,
   nhờ vậy run-all.js biết được test nào hỏng mà không cần đọc log bằng mắt. */

let passed = 0;
const failures = [];

function record(name, okFlag, detail) {
  if (okFlag) {
    passed++;
    console.log('  ✓ ' + name + (detail ? '  ' + detail : ''));
  } else {
    failures.push(name + (detail ? '  ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? '  ' + detail : ''));
  }
  return okFlag;
}

function check(name, cond, detail) {
  return record(name, !!cond, detail);
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  return record(name, a === e, a === e ? '(' + a + ')' : '\n      nhận: ' + a + '\n      cần : ' + e);
}

// Ghi chú thông tin, không tính pass/fail.
function note(msg) {
  console.log('    · ' + msg);
}

process.on('exit', function () {
  console.log('');
  if (failures.length) {
    console.log('KET QUA: ' + passed + ' pass, ' + failures.length + ' FAIL');
    failures.forEach(function (f) { console.log('  - ' + f); });
    process.exitCode = 1;
  } else {
    console.log('KET QUA: ' + passed + ' pass, 0 fail');
  }
});

// Bắt lỗi async không ai catch — nếu không, test có thể "im lặng đi qua".
process.on('unhandledRejection', function (e) {
  failures.push('unhandledRejection: ' + (e && e.message));
  console.log('  ✗ unhandledRejection: ' + (e && e.stack || e));
  process.exitCode = 1;
});

module.exports = { check, eq, note };
