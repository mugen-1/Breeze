// Thông báo lỗi Firebase -> khoá i18n (js/i18n.js). Nhãn tĩnh trên form do data-i18n lo.
const ERROR_KEYS = {
    'auth/email-already-in-use': 'au.eInUse',
    'auth/invalid-email': 'au.eBadEmail',
    'auth/weak-password': 'au.eWeakPw',
    'auth/user-not-found': 'au.eNoUser',
    'auth/wrong-password': 'au.eWrongPw',
    'auth/invalid-credential': 'au.eBadCred',
    'auth/too-many-requests': 'au.eTooMany'
};

function authError(error) {
    return ERROR_KEYS[error.code] ? t(ERROR_KEYS[error.code]) : error.message;
}

function showMessage(elementId, message, isError) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? '#e53e3e' : '#276749';
    el.style.display = 'block';
}

function dangKy() {
    const ten = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const matKhau = document.getElementById('reg-password').value;
    const xacNhan = document.getElementById('reg-confirm').value;

    if (!ten || !email || !matKhau || !xacNhan) {
        showMessage('signup-msg', t('au.errFillAll'), true);
        return;
    }
    if (matKhau !== xacNhan) {
        showMessage('signup-msg', t('au.errConfirm'), true);
        return;
    }
    if (matKhau.length < 6) {
        showMessage('signup-msg', t('au.errShortPw'), true);
        return;
    }

    // Gửi email xác minh ngay sau khi tạo tài khoản: server chỉ tự phong admin cho email
    // đã xác minh (email_verified), nên thiếu bước này thì không ai chứng minh được mình
    // sở hữu hộp thư. Gửi lỗi (vd auth/too-many-requests) KHÔNG được chặn phần còn lại:
    // tài khoản đã tạo xong rồi, nên vẫn lưu tên hiển thị và chỉ đổi câu thông báo.
    auth.createUserWithEmailAndPassword(email, matKhau)
        .then((userCredential) => {
            const user = userCredential.user;
            return user.sendEmailVerification()
                .then(() => true, (err) => {
                    console.error('[auth] không gửi được email xác minh:', err && err.code);
                    return false;
                })
                .then((sent) => user.updateProfile({ displayName: ten }).then(() => sent));
        })
        .then((sent) => {
            // Câu nhắc kiểm tra email dài hơn -> chờ lâu hơn trước khi chuyển trang.
            showMessage('signup-msg', t(sent ? 'au.signupVerify' : 'au.signupOk'), false);
            setTimeout(() => { window.location.href = window.BreezeRoutes.to('login'); }, sent ? 3500 : 1500);
        })
        .catch((error) => {
            showMessage('signup-msg', authError(error), true);
        });
}

function dangNhap() {
    const email = document.getElementById('login-email').value.trim();
    const matKhau = document.getElementById('login-password').value;

    if (!email || !matKhau) {
        showMessage('login-msg', t('au.errNeedEmailPw'), true);
        return;
    }

    auth.signInWithEmailAndPassword(email, matKhau)
        .then((userCredential) => {
            const user = userCredential.user;
            localStorage.setItem('userName', user.displayName || user.email);
            // Gọi /api/me để (a) đồng bộ user vào DB lần đầu / cập nhật last_login,
            // (b) biết role hiện tại (auto-admin theo ADMIN_EMAILS áp dụng ngay ở đây)
            // rồi điều hướng: admin -> admin.html, còn lại -> trang chủ.
            return user.getIdToken().then((token) => {
                const base = window.API_BASE || '';
                return fetch(base + '/api/me', { headers: { Authorization: 'Bearer ' + token } })
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null);
            });
        })
        .then((me) => {
            const isAdmin = !!(me && me.role === 'admin');
            // Luồng thanh toán: login.html?redirect=checkout.html
            const redirect = new URLSearchParams(window.location.search).get('redirect');
            if (window.BreezeRoutes.keyOf(redirect) === 'checkout') {
                if (isAdmin) {
                    // Admin không được đặt đơn -> báo lỗi, ở lại trang login.
                    showMessage('login-msg', t('au.errBadAccount'), true);
                    return;
                }
                window.location.href = window.BreezeRoutes.to('checkout');
                return;
            }
            window.location.href = window.BreezeRoutes.to(isAdmin ? 'admin' : 'index');
        })
        .catch((error) => {
            showMessage('login-msg', authError(error), true);
        });
}

function dangXuat() {
    auth.signOut().then(() => {
        localStorage.removeItem('userName');
        window.location.href = window.BreezeRoutes.to('login');
    });
}

// Form đăng nhập / đăng ký / quên mật khẩu: data-action trên <form> chọn việc cần làm,
// thay cho onsubmit="event.preventDefault(); ..." inline cũ (CSP chặn handler inline).
// Gắn ở document (sự kiện submit nổi bọt) nên không phụ thuộc thứ tự nạp so với markup.
// reset-password: tính năng gửi mail đặt lại CHƯA làm — chỉ chặn submit như trước
// (trước đây gọi guiEmailDatLai() không tồn tại, cũng không làm gì ngoài lỗi console).
const FORM_ACTIONS = {
    'login': () => dangNhap(),
    'signup': () => dangKy(),
    'reset-password': () => {},
};
document.addEventListener('submit', (e) => {
    const act = e.target && e.target.getAttribute && e.target.getAttribute('data-action');
    // hasOwnProperty: 'constructor', 'toString'... là khoá kế thừa, không phải hành động.
    if (!act || !Object.prototype.hasOwnProperty.call(FORM_ACTIONS, act)) return;
    e.preventDefault();
    FORM_ACTIONS[act]();
});

// Dựng thẻ <a> bằng DOM API, KHÔNG dùng innerHTML: displayName do người dùng tự đặt lúc
// đăng ký, ghép thẳng vào HTML là XSS (tên kiểu '<img src=x onerror=...>'). textContent
// luôn ra chữ thuần. Handler gắn bằng addEventListener chứ không phải onclick="..." để
// không vướng Content-Security-Policy (CSP chặn mọi handler inline).
// Hiện KHÔNG trang nào có #nav-login nên khối này chưa chạy — giữ để an toàn nếu markup
// quay lại.
auth.onAuthStateChanged((user) => {
    const navLogin = document.getElementById('nav-login');
    if (!navLogin) return;
    const a = document.createElement('a');
    if (user) {
        a.href = '#';
        a.style.color = '#fff';
        a.textContent = (user.displayName || user.email) + ' | Dang xuat';
        a.addEventListener('click', (e) => {
            e.preventDefault();
            dangXuat();
        });
    } else {
        a.href = window.BreezeRoutes.to('login');
        a.textContent = 'Dang nhap / Dang ky';
    }
    navLogin.replaceChildren(a);
});
