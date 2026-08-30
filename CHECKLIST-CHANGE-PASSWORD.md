# Checklist test tay — modal đổi mật khẩu

Phần này máy **không** làm được: cần tài khoản Firebase thật, cần mắt nhìn giao diện,
cần bàn phím thật. Mọi thứ tự động hoá được đã chạy rồi (xem cuối file).

**Trước khi bắt đầu:** `node server/server.js`, mở `http://localhost:3000/profile.html`,
đăng nhập, vào mục **Chi tiết tài khoản**, tìm hàng `Mật khẩu · •••••••••• · Đổi`.

Modal đổi mật khẩu **không có URL riêng** — nó nằm trong `profile.html`. Trang
`change-password.html` đã bị xoá ở Phase 2B, gõ thẳng địa chỉ đó phải ra 404.

> ⚠ **Chuẩn bị 2 tài khoản test.** Mỗi lần đổi mật khẩu thành công là mật khẩu cũ mất
> hiệu lực thật. Ghi lại mật khẩu vừa đặt trước khi bấm nút.

---

## A. Bốn nhánh lỗi — modal phải Ở LẠI, không được đóng

Sau mỗi ca: đọc câu báo, xác nhận **modal vẫn mở** và nút "Đổi mật khẩu" **bấm lại được**.

- [ ] **Mật khẩu hiện tại sai** — gõ bừa ô đầu, 2 ô sau hợp lệ và khớp nhau
      → *"Mật khẩu hiện tại không đúng."*, con trỏ nhảy về ô "Mật khẩu hiện tại"
- [ ] **Xác nhận không khớp** — ô 2 và ô 3 khác nhau
      → *"Mật khẩu xác nhận không khớp."*, con trỏ về ô xác nhận
- [ ] **Mật khẩu mới trùng mật khẩu cũ** — cả 3 ô cùng một chuỗi
      → *"Mật khẩu mới phải khác mật khẩu hiện tại."*
- [ ] **Mật khẩu mới dưới 8 ký tự** — thử đúng **7** ký tự
      → *"Mật khẩu mới phải có ít nhất 8 ký tự."*
- [ ] Thử đúng **8** ký tự → **phải qua được** (đây là ranh giới, dễ lệch 1 đơn vị)

> Bốn ca trên chặn ở client, chưa gọi Firebase. Ca "mật khẩu hiện tại sai" là ca **duy
> nhất** trong nhóm này thật sự đi tới Firebase.

## B. Đổi thành công — vòng đầy đủ

- [ ] Điền đúng mật khẩu hiện tại + mật khẩu mới ≥ 8 ký tự, khớp xác nhận
- [ ] Trong lúc chờ: nút đổi chữ thành **"Đang đổi…"** và **bị khoá**
- [ ] Hiện *"Đã đổi mật khẩu thành công."* **màu xanh, ngay trong modal**
- [ ] **~1,5 giây sau modal tự đóng**, vẫn ở lại mục Chi tiết tài khoản — **không nhảy trang**
- [ ] Có thêm một **toast** xác nhận nổi lên ở đáy trang
- [ ] **Đăng xuất** (menu tài khoản)
- [ ] **Đăng nhập lại bằng mật khẩu MỚI** → vào được
- [ ] Thử đăng nhập bằng mật khẩu **cũ** → phải bị từ chối

> **Về các phiên đăng nhập khác** (điện thoại, trình duyệt khác): Firebase thu hồi
> refresh token của chúng, nhưng ID token đã phát vẫn còn hiệu lực tới khi hết hạn
> (**~1 giờ**) vì `server/middleware/auth.js:75` gọi `verifyIdToken` không kèm
> `checkRevoked: true`. Nên **đừng coi là lỗi** nếu tab khác vẫn gọi được `/api/*` một
> lúc sau khi đổi mật khẩu — đó là hiện trạng đã biết, không phải hồi quy.

## C. Mật khẩu không được nằm lại trong DOM

Đây là điểm sống còn của tính năng. Làm đủ cả ba đường đóng:

- [ ] **Gõ dở rồi bấm Huỷ** → mở lại modal, **cả 3 ô phải trống trơn**, không còn câu báo cũ
- [ ] **Gõ dở rồi bấm ESC** → mở lại, 3 ô trống
- [ ] **Gõ dở rồi click ra nền tối** → mở lại, 3 ô trống
- [ ] **Gõ dở rồi bấm nút ✕** → mở lại, 3 ô trống
- [ ] Sau khi **đổi thành công** → mở lại modal, 3 ô trống
- [ ] Bấm nút 👁 cho hiện mật khẩu rồi đóng modal → mở lại, ô phải về **dạng chấm**,
      nút 👁 về trạng thái chưa bấm

## D. Chống dùng sai

- [ ] **Nhập sai mật khẩu hiện tại liên tiếp nhiều lần** (~5–10 lần) cho tới khi Firebase
      chặn → *"Quá nhiều lần thử. Vui lòng thử lại sau."*
      Nếu ra câu chung *"Không đổi được mật khẩu"* thì mở Console xem
      `[change-password] mã lỗi chưa map: …` và báo lại mã đó
- [ ] **Bấm nút Đổi liên tiếp thật nhanh** → chỉ chạy một lần, không ra 2 thông báo
- [ ] Mở **Console** trong suốt cả buổi test → **không được thấy chuỗi mật khẩu nào**
      xuất hiện, kể cả trong thông báo lỗi

## E. Giao diện — cần nhìn bằng mắt

Làm **cả chế độ Sáng và Tối** (đổi ở Hồ sơ → Giao diện):

- [ ] Modal căn giữa, nền sau mờ, **giống hệt modal "Thêm địa chỉ"**
- [ ] Nhãn, ô nhập, cặp nút Huỷ/Đổi trông y như modal địa chỉ — không lệch font, cỡ chữ
- [ ] Nút 👁 nằm **gọn bên trong** ô nhập, không đè lên chữ, không tràn ra ngoài
- [ ] Chữ trong ô không chui xuống dưới nút 👁 khi mật khẩu dài
- [ ] Câu báo **lỗi** đọc rõ trên nền tối (không phải chữ đỏ chìm)
- [ ] Câu báo **thành công** ra màu xanh, không phải đỏ
- [ ] Hàng `Mật khẩu · ••••• · Đổi` — chữ "Đổi" vẫn trông như **liên kết gạch chân**,
      không ra hình cái nút xám (nó đã đổi từ thẻ `<a>` sang `<button>`)
- [ ] Thu nhỏ cửa sổ xuống cỡ điện thoại → modal không tràn, 2 nút xếp dọc
- [ ] Đổi **VI ↔ EN** khi modal đang mở → mọi nhãn đổi ngôn ngữ, kể cả nhãn nút 👁
      (rê chuột vào xem tooltip / dùng trình đọc màn hình)

## F. Bàn phím — không được thoát ra ngoài modal

- [ ] Bấm "Đổi" bằng **phím Enter/Space** → modal mở, con trỏ **tự nhảy vào ô "Mật khẩu
      hiện tại"**
- [ ] **Tab** đi hết một vòng: ô 1 → 👁 → ô 2 → 👁 → ô 3 → 👁 → Huỷ → Đổi mật khẩu → **quay
      lại đầu**. Không được tab ra header/footer phía sau
- [ ] **Shift+Tab** từ phần tử đầu → nhảy về **phần tử cuối** của modal
- [ ] Gõ xong bấm **Enter** trong bất kỳ ô nào → gửi form (không phải chỉ click nút mới được)
- [ ] **ESC** đóng modal
- [ ] Đóng modal xong → con trỏ **quay về đúng chữ "Đổi"** vừa bấm lúc nãy
- [ ] Nút 👁 bấm bằng **Space/Enter** → đổi hiện/ẩn, **không** gửi form

## G. Trang cũ đã gỡ sạch

- [ ] `http://localhost:3000/change-password.html` → **404**
- [ ] `http://localhost:3000/profile.html` → vẫn 200, modal hoạt động

---

## Máy đã kiểm giúp rồi — không phải làm tay

```bash
node client/js/__tests__/run-all.js       # 13 file, 408 assertion
node client/js/__tests__/change-password.test.js   # 89 assertion riêng modal này
node server/tools/verify-all.js           # so DOM 18 trang với bản trước migrate
node server/tools/regression.js           # 12 hạng mục toàn site (cần server + SQL)
```

Đã tự động khẳng định: thứ tự và ngưỡng validate (8 ký tự, không trim, không lọc ký tự
đặc biệt), 7 mã lỗi Firebase ra đúng câu, không in raw error ra UI, không log mật khẩu ra
console, xoá sạch 3 ô ở **cả bốn** đường đóng, chặn double-submit, mở/đóng modal đúng
pattern modal địa chỉ, tài khoản social-only bị khoá nút gửi.

**Máy KHÔNG kiểm được** (nên mới có file này): giao diện thật, chế độ tối, thứ tự tab
thật của trình duyệt, focus trap thật, việc Firebase có chặn `too-many-requests` hay
không, và mật khẩu mới có đăng nhập lại được thật hay không.
