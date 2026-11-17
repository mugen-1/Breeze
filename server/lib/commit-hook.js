'use strict';
// Điểm móc onCommitting cho các hàm lib tự mở transaction (cancelOrder, changeSizes, changeColors,
// createReview, changeOwnerReview, setReviewVisibility). Hợp đồng:
//   await onCommitting(tx, result, ctx) — sau thao tác ghi cuối, NGAY TRƯỚC tx.commit(), trong try của hàm:
//   tx = transaction đang mở; result = đúng giá trị hàm sẽ trả về; ctx.before = trạng thái cũ hàm đã đọc.
//   Hook ném lỗi -> catch của hàm rollback và ném lại đúng lỗi đó.
//   Chỉ gọi trên đường thực sự ghi dữ liệu; thoát sớm / commit không đổi gì thì không gọi.
// Không truyền (undefined) -> null (bỏ qua). Có nhưng không phải hàm (kể cả null) -> TypeError.
function commitHook(opts) {
  const hook = opts == null ? undefined : opts.onCommitting;
  if (hook === undefined) return null;
  if (typeof hook !== 'function') throw new TypeError('onCommitting phải là hàm');
  return hook;
}

module.exports = { commitHook };
