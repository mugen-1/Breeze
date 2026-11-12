# Checklist test tay — Role `staff` (Phase A + Phase C)

Phạm vi: role `staff` dùng tài khoản riêng do admin tạo, đăng nhập vào **cùng trang quản trị**
(`admin.html`). Từ Phase C, staff **không** có 5 quyền: `product:delete`, `order:delete`,
`user:view_admin_detail`, `user:blacklist_release`, `user:manage_role`. Giao diện staff giống admin,
trừ pill "Nhân viên", logo **BREEZE STAFF** và 4 nút bị ẩn (mục 4). Ma trận quyền nằm ở
`server/lib/permissions.js`; mọi giới hạn đều chặn ở backend, UI chỉ ẩn cho gọn.

Unit test (`cd server && npm test`, `node client/js/__tests__/run-all.js`) đã phủ logic. Checklist
này kiểm những thứ DOM giả không kiểm được: giao diện thật, CSS `[hidden]`, điều hướng thật,
đăng nhập Firebase thật.

**Chỉ test trên local** (`http://localhost:3000`). Không test trên domain public.

---

## 0. Chuẩn bị

- [ ] Migration 023 đã chạy trên DB đang dùng. Lệnh dưới phải in ra định nghĩa có
      `collate Latin1_General_CS_AS` và `datalength([role])=len([role])`:
    ```sql
    SELECT definition, is_not_trusted FROM sys.check_constraints WHERE name = 'CK_users_role';
    ```
      Nếu chưa có: `cd server && node db/run-sql.js db/migrations/023_staff_role.sql`
- [ ] Dừng server cũ (cổng 3000), rồi khởi động lại. Code phân quyền chỉ có hiệu lực sau khi khởi động lại.
- [ ] Mở trang bằng F5 thường. Server tự gắn `?v=` nên không cần Ctrl+F5.
- [ ] Email dùng cho staff **không** nằm trong `ADMIN_EMAILS`, vì email trong danh sách đó sẽ tự lên admin.

## 1. Tạo tài khoản staff — `server/db/create-staff.js`

Chạy trong `server/`, bằng PowerShell, cmd hoặc terminal VS Code. Nếu dùng Git Bash thì thêm `winpty` trước `node`.

- [ ] **Sinh mật khẩu**: `node db/create-staff.js nv1@example.com "Nhân Viên Một"`
  - [ ] In mật khẩu 20 ký tự **đúng 1 lần**, kèm Firebase UID và `dbo.users.id`.
  - [ ] Firebase Console → Authentication: có user mới, đã xác minh email, đúng tên hiển thị.
  - [ ] `SELECT id, email, display_name, role FROM dbo.users WHERE email = 'nv1@example.com';` → `role = staff`.
- [ ] **Tự nhập**: `node db/create-staff.js nv2@example.com "Nhân Viên Hai" --password`
  - [ ] Gõ mật khẩu không hiện ký tự nào, kể cả `*`. Phải nhập 2 lần.
  - [ ] Hai lần không khớp → báo lỗi, không tạo gì.
  - [ ] Mật khẩu < 12 ký tự hoặc phổ biến (vd `Breeze@2026`) → cảnh báo **màu vàng**
        "…chỉ dùng local, đổi trước khi public qua Cloudflare", hỏi `(y/N)`; Enter = N = huỷ.
  - [ ] Tạo xong, màn hình **không** in mật khẩu vừa nhập.
- [ ] **Từ chối** (mỗi lệnh phải báo lỗi và không tạo gì trên Firebase lẫn DB):
  - [ ] Email đã có nhưng khác hoa/thường: `node db/create-staff.js NV1@EXAMPLE.COM "X"`
  - [ ] Email của một khách đang có trong DB
  - [ ] Email nằm trong `ADMIN_EMAILS`
  - [ ] `node db/create-staff.js nv3@example.com "X" --password=abc` → báo không nhận mật khẩu qua tham số.
        **Xoá dòng lệnh đó khỏi lịch sử shell** (PowerShell: `Clear-History`, và xoá dòng tương ứng
        trong `(Get-PSReadLineOption).HistorySavePath`).

## 2. Admin

- [ ] Đăng nhập → vào thẳng `admin.html`. **Không** có pill "Nhân viên" cạnh tên.
- [ ] Logo góc trên trái là **BREEZE ADMIN**. Đổi VI/EN → vẫn ADMIN.
- [ ] 8 mục menu trái đều tải được: Network không có 401/403.
- [ ] Thấy đủ nút: **Xoá** sản phẩm, **Xoá** đơn, **Gỡ khỏi danh sách đen**, và **Xem chi tiết** ở cả dòng
      admin (mở được chi tiết tài khoản admin).
- [ ] Người dùng: badge đúng 3 loại (Admin nền đen · Nhân viên viền đen · Khách hàng nền kem).
      Dòng admin và staff không có nút "Thêm vào danh sách đen" (hiện "—").
- [ ] Chi tiết một tài khoản staff → dòng Vai trò ghi "Nhân viên" (EN: "Staff").
- [ ] Hồ sơ, đổi mật khẩu, đăng xuất vẫn chạy như cũ.

## 3. Customer

- [ ] Mở `admin.html` → màn "không có quyền". Không thấy dữ liệu quản trị.
- [ ] Giỏ hàng → Thanh toán → checkout bình thường, đặt được đơn.
- [ ] Widget chat hỗ trợ hiện trên trang khách và gửi được tin.
- [ ] DevTools Console (đang đăng nhập customer, ở một trang bất kỳ):
      `AuthHelper.apiFetch('/api/admin/orders').then(r => r.status)` → `403`. Sau đó
      `node scripts/show-security-events.js` có thêm 1 dòng `FORBIDDEN` (chỉ 1 dòng cho request đó).

## 4. Staff

Đăng nhập bằng tài khoản vừa tạo ở mục 1.

- [ ] `login.html` → tự chuyển sang `admin.html`.
- [ ] User card đáy menu trái có pill **"Nhân viên"** cạnh tên. Chuyển EN → "Staff".
- [ ] Đặt tên rất dài (Hồ sơ → sửa tên) → tên bị cắt "…", pill vẫn nằm trọn trong card.
- [ ] 8 mục menu trái đều hiện và tải được, Network không có 401/403.
- [ ] **Đơn hàng**: đổi trạng thái đơn được; đổi trạng thái giao hàng được; "Hoá đơn" mở tab in được.
- [ ] **Phản hồi của khách hàng**: thấy danh sách hội thoại, mở được, trả lời được, đánh dấu đã đọc được.
      Phía khách thấy câu trả lời đứng tên **"BREEZE"**.
- [ ] **Đánh giá**: ẩn/hiện được một đánh giá.
- [ ] **Logo** góc trên trái là **BREEZE STAFF**. Đổi VI/EN → vẫn STAFF. Đăng xuất → đăng nhập bằng
      admin (cùng tab) → về **BREEZE ADMIN**, không sót chữ STAFF.
- [ ] **4 nút bị ẩn** (Phase C) — ô nào hết nút thì hiện "—", bảng không lệch cột:
  - [ ] Sản phẩm: **không** có nút Xoá (vẫn có Sửa, Lịch sử kho, và Quản lý size với sản phẩm có size).
  - [ ] Hoá đơn: **không** có nút Xoá (vẫn có Chi tiết, Hoá đơn).
  - [ ] Danh sách đen: **không** có nút "Gỡ khỏi danh sách đen" (ô hiện "—").
  - [ ] Người dùng: dòng admin (vd `admin@…`) **vẫn hiện**, nhưng ô Xem chi tiết là "—". Dòng khách và
        dòng staff vẫn có nút Xem chi tiết và mở được.
- [ ] **Vẫn làm được**: thêm sản phẩm; sửa giá, kho, size, màu; đổi trạng thái đơn và trạng thái giao hàng;
      **thêm** một khách vào danh sách đen.
- [ ] **Gọi thẳng API vẫn bị chặn** — DevTools Console trên `admin.html`, đang đăng nhập **staff**
      (`AuthHelper.apiFetch` tự gắn token của phiên đang đăng nhập).
  - [ ] **3 lệnh ghi — dùng id `999999999`** (không cần id thật): staff bị chặn ở bước kiểm quyền *trước*
        khi route tìm bản ghi, nên id nào cũng ra 403; lỡ chạy bằng admin thì chỉ nhận 404, **không xoá gì**.
      ```js
      AuthHelper.apiFetch('/api/admin/products/999999999', { method: 'DELETE' }).then(r => r.status)          // 403
      AuthHelper.apiFetch('/api/admin/orders/999999999', { method: 'DELETE' }).then(r => r.status)            // 403
      AuthHelper.apiFetch('/api/admin/blacklist/999999999/release', { method: 'POST' }).then(r => r.status)   // 403
      ```
      Mong đợi: cả 3 → `403`, body `{status:'error', code:'FORBIDDEN', …}`.
  - [ ] **Xem chi tiết admin — PHẢI dùng id THẬT của một tài khoản admin**, KHÔNG dùng `999999999`: route
        đọc tài khoản đích trước rồi mới xét quyền, nên id không tồn tại chỉ ra `NOT_FOUND`, không phải
        `PERMISSION_DENIED`. Lấy id admin bằng 1 trong 3 cách:
    - Network: mở mục Người dùng → request `GET /api/admin/users?...` → tab Response → tìm phần tử có
      `"role": "admin"` → lấy `"id"`.
    - Console (staff có `user:read`):
      `AuthHelper.apiFetch('/api/admin/users?limit=100').then(r => r.json()).then(d => d.users.filter(u => u.role === 'admin').map(u => u.id))`
    - SQL: `SELECT id FROM dbo.users WHERE role = 'admin';`

    Thay `ID_ADMIN` bằng id vừa lấy:
      ```js
      AuthHelper.apiFetch('/api/admin/users/ID_ADMIN/detail').then(async r => [r.status, await r.json()])
      ```
      Mong đợi: `[404, {status:'error', message:'Không tìm thấy người dùng'}]`.
  - [ ] *(Đối chứng, không bắt buộc)* `AuthHelper.apiFetch('/api/admin/users/999999999/detail').then(async r => [r.status, await r.json()])`
        → phải ra **y hệt** lệnh trên (staff không phân biệt được id admin với id không tồn tại). Lệnh này
        ghi `NOT_FOUND` (low), **không** tính vào số dòng ở bước dưới.
  - [ ] `cd server && node scripts/show-security-events.js` → **4 dòng `PERMISSION_DENIED` (medium)**:
        3 dòng status 403 (2 lệnh xoá + gỡ blacklist) và 1 dòng status 404 (`/api/admin/users/ID_ADMIN/detail`).
        **Chỉ thấy 3 dòng** → kiểm lại `ID_ADMIN`: id không tồn tại cho `NOT_FOUND`, còn id của khách hoặc
        staff thì staff xem được (200), cả hai đều không ghi `PERMISSION_DENIED`.
- [ ] Bị chặn mua hàng:
  - [ ] Thêm vào giỏ → Thanh toán → báo "Tài Khoản Không Đúng — tài khoản quản trị không thể thanh toán đơn hàng."
  - [ ] Gõ thẳng `checkout.html` → hiện cảnh báo trên rồi về trang chủ.
  - [ ] `login.html?redirect=checkout` → đăng nhập staff → "Tài khoản không hợp lệ.", ở lại trang login.
  - [ ] Đăng xuất → "Mua ngay" ở trang sản phẩm → đăng nhập staff → báo "…tài khoản quản trị…", không vào giỏ.
  - [ ] Đang đăng nhập staff → "Mua ngay" vẫn thêm vào giỏ và mở trang giỏ, **giống admin hiện nay**.
        Bị chặn ở bước "Thanh toán" (dòng đầu của mục này) và ở `POST /api/orders` (backend).
- [ ] Trang khách (trang chủ, sản phẩm): **không** hiện widget chat. Chuyển tab qua lại vài lần →
      Network **không** gọi lại `/api/me` mỗi lần quay về trang.
- [ ] Hồ sơ → Mật khẩu "Đổi" → đổi được. Đăng xuất, đăng nhập lại bằng mật khẩu mới được;
      mật khẩu cũ báo "Sai mật khẩu, vui lòng thử lại."

## 5. Đổi mật khẩu staff trước khi bật Cloudflare Tunnel

Mật khẩu do script sinh đã từng hiện trên terminal. Mật khẩu tự nhập có thể đã được chấp nhận
dù yếu (cảnh báo "chỉ dùng local"). **Trước khi bật Tunnel (site public):**

- [ ] Liệt kê staff:
      `SELECT id, email, display_name, created_at, last_login FROM dbo.users WHERE role = 'staff';`
- [ ] Mỗi staff còn dùng: đăng nhập local → Hồ sơ → Mật khẩu "Đổi" → mật khẩu mới ≥ 12 ký tự,
      không phổ biến, không chứa email/tên, lưu trong trình quản lý mật khẩu. Quên mật khẩu cũ thì
      đặt lại ở Firebase Console → Authentication.
- [ ] Đăng nhập lại bằng mật khẩu mới được; mật khẩu cũ bị từ chối.
- [ ] Staff không còn dùng: `node db/set-role.js <email> customer`, hoặc xoá user trong Firebase
      Console (bị xoá trên Firebase thì không đăng nhập được nữa).
- [ ] `ADMIN_EMAILS` (`server/.env`) không chứa email staff nào.
- [ ] Xoá khỏi lịch sử terminal mọi dòng lệnh, ghi chú, ảnh chụp có mật khẩu staff.
- [ ] Chỉ sau khi xong các mục trên mới bật Cloudflare Tunnel.

## 6. Dọn dẹp cuối Phase A

- [x] Xoá `server/middleware/requireAdmin.js`. Từ Bước 2 không còn code chạy thật nào import file này.
- [x] Sửa mock trong `server/scripts/verify-order-payment-sql.js` (~dòng 78) và
      `server/scripts/verify-order-shipping-sql.js` (~dòng 72): bỏ `requireAdmin` giả trong mock
      `middleware/auth`. Chạy lại 2 script đó.
      `verify-order-shipping-sql` pass. `verify-order-payment-sql` dừng ở lần đặt đơn Visa đầu tiên
      (`PAYMENT_INFO_REQUIRED`) — lỗi **có từ trước**: bản chưa dọn cũng fail y hệt, do luật bắt lưu thẻ
      từ commit `e1a304b` mà fixture của script chưa tạo thẻ. Script dừng trước phần `/api/admin`.
- [x] Đổi tên fixture `'staff'` / `'staff-two'` (thực ra là role **admin**) thành `'admin'` / `'admin-two'`
      ở **cả 6** script support, để không nhầm với role staff thật (fixture role staff thật tên
      `'real-staff'`, trong `verify-support-api-sql.js`):
  - [x] `verify-customer-support-sql.js`
  - [x] `verify-support-api-sql.js`
  - [x] `verify-support-read-sql.js`
  - [x] `verify-support-session-sql.js`
  - [x] `verify-support-sse-sql.js`
  - [x] `verify-support-ui-sql.js`

  Đổi cả biến (`staff`, `staffTwo`, `secondStaff`), các chuỗi token và tên trong label check. Mỗi script
  tự tạo rồi xoá database tạm `Breeze*Test_*`, không đụng DB thật.
- [ ] Sau khi dọn: `cd server && npm test`, `node client/js/__tests__/run-all.js`, rồi chạy lại các
      script `verify-*-sql.js` vừa sửa.

## 7. Việc sau Phase A

- [ ] Nút "Mua ngay" ở trang sản phẩm chưa chặn admin/staff đang đăng nhập ở client: vẫn thêm vào giỏ
      và mở trang giỏ. Server đã chặn đặt hàng tại `POST /api/orders`, và client chặn ở bước "Thanh toán".
      Cần chặn sớm ngay khi bấm (`client/js/page-product.js`), giống cách `buy-now-intent.js` làm sau đăng nhập.

## 8. Giới hạn đã biết (Phase C)

Phase C chỉ chặn 4 thao tác (xoá sản phẩm, xoá đơn, gỡ blacklist, xem chi tiết tài khoản admin). Các
chỗ dưới đây staff vẫn thấy hoặc làm được — **cố ý giữ nguyên**, ghi lại để không nhầm là lỗi:

1. **Danh sách Người dùng (`GET /api/admin/users`) vẫn hiện email và lần đăng nhập cuối của admin.**
   Lý do: yêu cầu giữ dòng admin trong danh sách (chỉ ẩn "Xem chi tiết"); ẩn từng cột theo role người
   xem là thay đổi API/giao diện ngoài phạm vi Phase C.
2. **Chat hỗ trợ hiện tên hiển thị (và id) của admin đã trả lời cho staff.**
   Lý do: người trực cần biết ai đã trả lời để không trả lời trùng; khách vẫn chỉ thấy "BREEZE".
3. **Danh sách Đơn hàng và Danh sách đen có email/tên chủ tài khoản.**
   Lý do: thực tế không có dòng nào của admin — admin không đặt đơn được (`POST /api/orders` chặn) và
   không thể bị đưa vào danh sách đen.
4. **Câu lỗi khi thêm blacklist tài khoản quản trị ("Không thể đưa tài khoản quản trị…") cho biết id đó
   là admin/staff.**
   Lý do: staff vốn đã thấy role của mọi tài khoản trong danh sách Người dùng, nên câu lỗi không lộ thêm gì.
5. **Staff xem được chi tiết tài khoản staff khác** (sđt, ngày sinh, giới tính, quốc gia).
   Lý do: Phase C chỉ giới hạn chi tiết tài khoản **admin**; staff với nhau cùng cấp.
6. **Staff vẫn xoá được ảnh của màu sản phẩm** (`DELETE /products/:id/colors/:colorId/images/:imageId`).
   Lý do: route này dùng `product:write` — xoá một ảnh là *sửa* sản phẩm (sản phẩm vẫn còn), khớp yêu cầu
   "staff được thêm/sửa sản phẩm (màu)"; `product:delete` chỉ dành cho ẩn cả sản phẩm.
