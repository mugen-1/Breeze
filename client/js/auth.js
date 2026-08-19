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

    auth.createUserWithEmailAndPassword(email, matKhau)
        .then((userCredential) => {
            return userCredential.user.updateProfile({ displayName: ten });
        })
        .then(() => {
            showMessage('signup-msg', t('au.signupOk'), false);
            setTimeout(() => { window.location.href = 'login.html'; }, 1500);
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
            if (redirect === 'checkout.html') {
                if (isAdmin) {
                    // Admin không được đặt đơn -> báo lỗi, ở lại trang login.
                    showMessage('login-msg', t('au.errBadAccount'), true);
                    return;
                }
                window.location.href = 'checkout.html';
                return;
            }
            window.location.href = isAdmin ? 'admin.html' : 'index.html';
        })
        .catch((error) => {
            showMessage('login-msg', authError(error), true);
        });
}

function dangXuat() {
    auth.signOut().then(() => {
        localStorage.removeItem('userName');
        window.location.href = 'login.html';
    });
}

auth.onAuthStateChanged((user) => {
    const navLogin = document.getElementById('nav-login');
    if (!navLogin) return;
    if (user) {
        const ten = user.displayName || user.email;
        navLogin.innerHTML = `<a href="javascript:void(0);" onclick="dangXuat()" style="color:#fff">${ten} | Dang xuat</a>`;
    } else {
        navLogin.innerHTML = `<a href="login.html">Dang nhap / Dang ky</a>`;
    }
});
