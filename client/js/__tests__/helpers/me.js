// Fixture GET /api/me cho test trang admin: permissions lấy từ CHÍNH ma trận server
// (server/lib/permissions.js), không chép lại danh sách — đổi quyền ở server thì fixture
// đổi theo. admin.js coi thiếu permissions là KHÔNG có quyền nào, nên fixture phải có.
const { permsFor } = require('../../../../server/lib/permissions');

const adminMe = (extra = {}) => ({ role: 'admin', permissions: [...permsFor('admin')], ...extra });
const staffMe = (extra = {}) => ({ role: 'staff', permissions: [...permsFor('staff')], ...extra });

module.exports = { adminMe, staffMe };
