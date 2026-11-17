'use strict';
// Dựng before/after cho audit log blacklist (USER_BLACKLIST / USER_UNBLACKLIST) và ẩn/hiện đánh giá
// (REVIEW_VISIBILITY). Hàm thuần, không chạm DB. Gói trong khóa con (`user`, `review`) để khóa không đổi
// (email, product_id) còn ở cả 2 phía sau khi buildAuditRow lọc khóa bằng nhau (cùng cách khóa `order` của lib/order-audit.js).
// Không lưu role / firebase_uid của người bị chặn, không lưu nội dung đánh giá.

// Trả null khi trạng thái không đổi (gọi lặp lại) -> route KHÔNG ghi log.
function blacklistChange({ email, wasBlacklisted, isBlacklisted }) {
  if (!!wasBlacklisted === !!isBlacklisted) return null;
  const user = b => ({ email: email == null ? null : email, is_blacklisted: !!b });
  return { before: { user: user(wasBlacklisted) }, after: { user: user(isBlacklisted) } };
}
function reviewVisibility({ productId, wasHidden, isHidden }) {
  const review = h => ({ product_id: productId == null ? null : productId, is_hidden: !!h });
  return { before: { review: review(wasHidden) }, after: { review: review(isHidden) } };
}

// ROLE_CHANGE (script CLI db/set-role.js, db/create-staff.js): khóa con `user` {email, role}; after có `source`.
// oldRole null = tài khoản mới tạo (before = null). Cùng role -> null (KHÔNG ghi log). Không lưu mật khẩu / firebase_uid.
function roleChange({ email, oldRole, newRole, source }) {
  if (oldRole != null && oldRole === newRole) return null;
  const user = r => ({ email: email == null ? null : email, role: r });
  return { before: oldRole == null ? null : { user: user(oldRole) }, after: { user: user(newRole), source } };
}

// REVIEW_CREATE / REVIEW_UPDATE / REVIEW_DELETE (khách): khóa con `review`, CHỈ trường cho phép dựng từ giá trị
// rời — không email / tên hiển thị / sđt / firebase_uid của người viết, không nội dung file (chỉ số ảnh hoặc đường dẫn).
// content = cột comment, lưu nguyên văn. Hệ thống không có video nên không có videos_count.
const variantOf = (id, size, color) => ({ id: id == null ? null : id, size: size == null ? null : size, color: color == null ? null : color });
function reviewCreate(result) { // result = giá trị trả về của createReview
  return { before: null, after: { review: { product_id: result.productId, rating: result.rating, images_count: (result.images || []).length } } };
}
function reviewUpdate(ctx, result) { // ctx.before = { review, images } dòng cũ đã khoá; result = dto trả về
  const old = ctx.before.review;
  return {
    before: { review: { product_id: old.product_id, rating: old.rating, content: old.comment, images_count: (ctx.before.images || []).length,
      variant: variantOf(old.variant_id, old.size_snapshot, old.color_snapshot) } },
    after: { review: { product_id: result.productId, rating: result.rating, content: result.comment, images_count: (result.images || []).length,
      variant: variantOf(result.variant && result.variant.id, result.variant && result.variant.size, result.variant && result.variant.color) } },
  };
}
function reviewDelete(ctx) { // before của REVIEW_DELETE; after = null
  const old = ctx.before.review;
  return { review: { product_id: old.product_id, rating: old.rating, content: old.comment,
    variant: variantOf(old.variant_id, old.size_snapshot, old.color_snapshot),
    is_hidden: old.is_hidden == null ? null : !!old.is_hidden, created_at: old.created_at }, // thiếu cột -> null, không đoán false
  media: (ctx.before.images || []).map(i => i.image_path) };
}

module.exports = { blacklistChange, reviewVisibility, roleChange, reviewCreate, reviewUpdate, reviewDelete };
