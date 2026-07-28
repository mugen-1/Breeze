// /api/me — thông tin user hiện tại + cập nhật hồ sơ cá nhân.
//   GET  /api/me           — trả hồ sơ (yêu cầu Firebase ID token hợp lệ).
//   PUT  /api/me           — cập nhật { phone, dob, gender, country } cho user hiện tại.
//   POST /api/me/avatar    — upload ảnh đại diện (multipart/form-data, field "avatar").
// Vì sao avatar nằm ở /api/me chứ không phải /api/account/*: avatar_url là CỘT trong
// dbo.users — cùng bảng mà /api/me sở hữu. /api/account/* dành cho sub-resource có bảng
// riêng (addresses, payment_methods, user_privacy_settings).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth');
const { getPool, sql } = require('../db');

// Cột trả về cho client — dùng chung mọi nơi SELECT lại user sau khi ghi.
const USER_COLS = `id, firebase_uid, email, display_name, role, created_at, last_login,
                   phone, dob, gender, country, avatar_url`;

// Row DB -> JSON trả client (đồng nhất cho GET & PUT & POST /avatar).
function toDto(u) {
  return {
    id: u.id,
    firebase_uid: u.firebase_uid,
    email: u.email,
    display_name: u.display_name,
    role: u.role,
    created_at: u.created_at,
    last_login: u.last_login,
    phone: u.phone,
    dob: u.dob,
    gender: u.gender,
    country: u.country,
    avatar_url: u.avatar_url || null,
  };
}

// ---- GET /api/me ----
router.get('/', verifyFirebaseToken, (req, res) => {
  res.json(toDto(req.user));
});

// ---- Validation cho PUT (trả { ok, value } hoặc { ok:false, message }) ----
const GENDERS = ['male', 'female'];
const COUNTRIES = ['VN', 'US', 'JP', 'KR', 'SG'];
const PHONE_RE = /^[0-9+\-\s()]{6,20}$/;

function vPhone(raw) {
  if (raw == null || String(raw).trim() === '') return { ok: true, value: null };
  const s = String(raw).trim();
  if (!PHONE_RE.test(s)) return { ok: false, message: 'Số điện thoại không hợp lệ' };
  return { ok: true, value: s };
}
function vGender(raw) {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (GENDERS.indexOf(raw) < 0) return { ok: false, message: 'Giới tính không hợp lệ' };
  return { ok: true, value: raw };
}
function vCountry(raw) {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (COUNTRIES.indexOf(raw) < 0) return { ok: false, message: 'Quốc gia không hợp lệ' };
  return { ok: true, value: raw };
}
function vDob(raw) {
  if (raw == null || String(raw).trim() === '') return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim());
  if (!m) return { ok: false, message: 'Ngày sinh không hợp lệ (định dạng YYYY-MM-DD)' };
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Chặn ngày không tồn tại (vd 31/02) qua so khớp ngược.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { ok: false, message: 'Ngày sinh không tồn tại' };
  }
  if (y < 1900) return { ok: false, message: 'Ngày sinh không hợp lệ' };
  if (dt.getTime() > Date.now()) return { ok: false, message: 'Ngày sinh không thể ở tương lai' };
  return { ok: true, value: dt };
}

// ---- PUT /api/me ---- body: { phone?, dob?, gender?, country? }
router.put('/', verifyFirebaseToken, async (req, res) => {
  const b = req.body || {};
  const phone = vPhone(b.phone);
  const dob = vDob(b.dob);
  const gender = vGender(b.gender);
  const country = vCountry(b.country);

  for (const f of [phone, dob, gender, country]) {
    if (!f.ok) return res.status(400).json({ status: 'error', message: f.message });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('uid', sql.VarChar(128), req.user.firebase_uid)
      .input('phone', sql.VarChar(30), phone.value)
      .input('dob', sql.Date, dob.value)
      .input('gender', sql.VarChar(10), gender.value)
      .input('country', sql.VarChar(8), country.value)
      .query(`
        UPDATE dbo.users
           SET phone = @phone, dob = @dob, gender = @gender, country = @country
         WHERE firebase_uid = @uid;

        SELECT ${USER_COLS}
        FROM dbo.users WHERE firebase_uid = @uid;`);

    res.json(toDto(result.recordset[0]));
  } catch (err) {
    console.error('[me] cập nhật hồ sơ lỗi:', err.message);
    res.status(500).json({ status: 'error', message: 'Không cập nhật được hồ sơ' });
  }
});

/* ---------------------- POST /api/me/avatar ----------------------
   Upload ảnh đại diện. Các lớp bảo vệ, theo thứ tự:
     1. verifyFirebaseToken  -> uid lấy TỪ TOKEN đã verify, không bao giờ từ body/query
                                => user A không thể ghi đè avatar của user B.
     2. multer memoryStorage -> không ghi file thô xuống đĩa, chặn cứng 2MB.
     3. magic bytes          -> KHÔNG tin Content-Type/đuôi file client gửi.
     4. sharp re-encode      -> dựng lại ảnh từ pixel => phá mọi payload nhúng
                                (polyglot, script trong EXIF...); sharp mặc định
                                không giữ metadata nên EXIF/GPS bị loại luôn.
     5. tên file sinh từ uid -> chống path traversal, mỗi user đúng 1 file.        */

/* Tên file avatar mang PHIÊN BẢN: '{uid}-{version}.webp'.
   Vì sao không dùng '{uid}.webp' rồi ghi đè: express.static phục vụ file theo 2 bước
   TÁCH RỜI — fs.stat() lấy size, rồi mở read stream giới hạn đúng size đó. Nếu file bị
   thay ngay giữa 2 bước (kể cả thay bằng rename nguyên tử), Content-Length lấy từ ảnh cũ
   còn nội dung đọc từ ảnh mới => client nhận ảnh CỤT. Đã đo được thật: 14/6143 lượt đọc
   hỏng khi ép upload chồng lên nhau.
   Đặt tên mới mỗi lần upload thì file cũ không bao giờ bị đụng vào trong lúc đang đọc,
   và URL tự đổi theo ảnh nên không cần cache-busting '?t=' ở client. */
const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'avatars');

/* Xoá ảnh avatar cũ (best-effort). Chỉ nhận đúng dạng '/avatars/<tên an toàn>.webp'
   rồi ghép lại từ basename — không bao giờ dùng thẳng chuỗi trong DB để tạo đường dẫn,
   phòng trường hợp giá trị đó bị can thiệp.
   ⚠️ Quy tắc resolve path này còn được viết LẠI ở routes/account.js (xoá file khi xoá
   tài khoản). Hai bên phải dùng CÙNG AVATAR_DIR và CÙNG cách ghép tên file —
   đổi chỗ lưu ảnh thì SỬA CẢ HAI. */
function removeOldAvatar(oldUrl, keepFileName) {
  if (!oldUrl || typeof oldUrl !== 'string') return;
  const m = /^\/avatars\/([A-Za-z0-9_-]+\.webp)$/.exec(oldUrl);
  if (!m) return;
  const oldName = m[1];
  if (oldName === keepFileName) return;                 // trùng file vừa ghi -> giữ lại
  fs.promises.unlink(path.join(AVATAR_DIR, oldName)).catch(() => {});
}
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;          // 2MB
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];   // SVG bị loại (XSS)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
});

/* Ghi file NGUYÊN TỬ: ghi ra file tạm rồi rename đè lên file thật.
   Vì sao không writeFile thẳng: mọi user dùng CHUNG một tên file ({uid}.webp) và file
   này đang được express.static phục vụ. writeFile mở với flag 'w' => TRUNCATE file cũ
   rồi mới ghi, nên có một khoảng thời gian file rỗng/dở dang; request GET
   /avatars/{uid}.webp rơi đúng lúc đó sẽ nhận ảnh hỏng.
   rename() là nguyên tử ở tầng filesystem: người đọc luôn thấy TRỌN VẸN ảnh cũ hoặc
   ảnh mới, không có trạng thái ở giữa.
   Tên tạm phải DUY NHẤT để 2 upload đồng thời của cùng một user không đè temp của nhau.
   Prefix '.' để express.static (dotfiles:'ignore' mặc định) không bao giờ phục vụ file tạm. */
async function writeFileAtomic(finalPath, buf) {
  const dir = path.dirname(finalPath);
  const tmpPath = path.join(
    dir,
    '.' + path.basename(finalPath) + '.' + process.pid + '-' + Date.now() +
      '-' + Math.random().toString(36).slice(2, 8) + '.tmp'
  );
  try {
    await fs.promises.writeFile(tmpPath, buf);
    // Windows: MoveFileEx có thể trả EPERM/EBUSY nếu file đích đang bị mở đọc ngay
    // khoảnh khắc đó -> thử lại vài lần thay vì fail luôn.
    for (let i = 0; ; i++) {
      try {
        await fs.promises.rename(tmpPath, finalPath);
        return;
      } catch (err) {
        if (i >= 4 || (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES')) throw err;
        await new Promise((r) => setTimeout(r, 40 * (i + 1)));
      }
    }
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => {});   // dọn temp nếu hỏng giữa chừng
    throw err;
  }
}

// Bọc multer để lỗi (quá dung lượng...) trả JSON gọn thay vì ném ra error handler chung.
function uploadAvatar(req, res, next) {
  upload.single('avatar')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ status: 'error', message: 'Ảnh vượt quá 2MB' });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ status: 'error', message: 'Chỉ nhận 1 file ở field "avatar"' });
    }
    console.error('[me] upload avatar lỗi:', err.message);
    return res.status(400).json({ status: 'error', message: 'Không đọc được file tải lên' });
  });
}

router.post('/avatar', verifyFirebaseToken, uploadAvatar, async (req, res) => {
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    return res.status(400).json({ status: 'error', message: 'Thiếu file ảnh (field "avatar")' });
  }

  // uid từ token đã verify. Chặn ký tự lạ trước khi ghép vào đường dẫn — Firebase uid
  // vốn chỉ [A-Za-z0-9], nhưng không dựa vào giả định đó để tạo path.
  const uid = String(req.user.firebase_uid || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    return res.status(400).json({ status: 'error', message: 'Định danh tài khoản không hợp lệ' });
  }

  try {
    // file-type là ESM-only -> dynamic import trong async handler (repo là commonjs).
    const { fileTypeFromBuffer } = await import('file-type');
    const ft = await fileTypeFromBuffer(req.file.buffer);
    // SVG không có magic bytes -> ft undefined -> bị loại ở đây luôn.
    if (!ft || ALLOWED_MIME.indexOf(ft.mime) < 0) {
      return res.status(415).json({
        status: 'error',
        message: 'Chỉ nhận ảnh PNG, JPEG hoặc WEBP',
      });
    }

    // .rotate() không tham số = áp EXIF orientation TRƯỚC khi metadata bị loại,
    // nếu không ảnh chụp dọc từ điện thoại sẽ bị xoay ngang sau khi re-encode.
    const webp = await sharp(req.file.buffer)
      .rotate()
      .resize(256, 256, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();

    // Tên file có PHIÊN BẢN, mỗi lần upload một tên mới => không bao giờ ghi đè file
    // đang được phục vụ (xem chú thích ở AVATAR_DIR để biết vì sao bắt buộc như vậy).
    const version = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const fileName = uid + '-' + version + '.webp';
    await fs.promises.mkdir(AVATAR_DIR, { recursive: true });
    await writeFileAtomic(path.join(AVATAR_DIR, fileName), webp);

    // DB lưu path SẠCH, tuyệt đối KHÔNG kèm '?t=...'. Bản thân tên file đã đổi mỗi lần
    // upload nên URL tự khác đi — client cứ gán thẳng img.src = avatar_url là ra ảnh mới,
    // không cần cache-busting thủ công ở bất kỳ đâu.
    const avatarUrl = '/avatars/' + fileName;
    const pool = await getPool();
    const result = await pool
      .request()
      .input('uid', sql.VarChar(128), uid)
      .input('url', sql.NVarChar(255), avatarUrl)
      .query(`
        UPDATE dbo.users SET avatar_url = @url
        OUTPUT deleted.avatar_url AS old_url
        WHERE firebase_uid = @uid;

        SELECT ${USER_COLS}
        FROM dbo.users WHERE firebase_uid = @uid;`);

    // Xoá ảnh cũ SAU khi DB đã trỏ sang ảnh mới. Thứ tự này quan trọng: nếu đổi thứ tự,
    // có khoảnh khắc DB trỏ tới file vừa bị xoá -> ảnh vỡ. Xoá lỗi cũng không sao
    // (file thừa nằm lại), nên nuốt lỗi thay vì làm hỏng cả request upload.
    // Dùng OUTPUT deleted.* chứ KHÔNG dùng req.user.avatar_url: req.user là ảnh chụp lúc
    // BẮT ĐẦU request, nên nhiều upload song song sẽ cùng thấy một giá trị cũ và bỏ sót
    // các file trung gian. OUTPUT trả đúng giá trị mà chính câu UPDATE này vừa thay thế,
    // nên mỗi file đều có đúng một request chịu trách nhiệm xoá.
    const oldUrl = result.recordsets[0][0] && result.recordsets[0][0].old_url;
    removeOldAvatar(oldUrl, fileName);

    // recordsets[0] = dòng OUTPUT (avatar cũ), recordsets[1] = hồ sơ trả cho client.
    res.json(toDto(result.recordsets[1][0]));
  } catch (err) {
    // sharp ném lỗi khi buffer không phải ảnh giải mã được (vd file .png giả).
    console.error('[me] xử lý avatar lỗi:', err.message);
    res.status(400).json({ status: 'error', message: 'Không xử lý được ảnh tải lên' });
  }
});

module.exports = router;
