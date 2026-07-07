const ERROR_MESSAGES = {
    'auth/email-already-in-use': 'Email nay da duoc su dung.',
    'auth/invalid-email': 'Email khong hop le.',
    'auth/weak-password': 'Mat khau phai it nhat 6 ky tu.',
    'auth/user-not-found': 'Tai khoan khong ton tai.',
    'auth/wrong-password': 'Mat khau khong dung.',
    'auth/invalid-credential': 'Email hoac mat khau khong chinh xac.',
    'auth/too-many-requests': 'Qua nhieu lan thu. Vui long thu lai sau.'
};

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
        showMessage('signup-msg', 'Vui long dien day du thong tin.', true);
        return;
    }
    if (matKhau !== xacNhan) {
        showMessage('signup-msg', 'Mat khau xac nhan khong khop.', true);
        return;
    }
    if (matKhau.length < 6) {
        showMessage('signup-msg', 'Mat khau phai it nhat 6 ky tu.', true);
        return;
    }

    auth.createUserWithEmailAndPassword(email, matKhau)
        .then((userCredential) => {
            return userCredential.user.updateProfile({ displayName: ten });
        })
        .then(() => {
            showMessage('signup-msg', 'Dang ky thanh cong! Dang chuyen trang...', false);
            setTimeout(() => { window.location.href = 'login.html'; }, 1500);
        })
        .catch((error) => {
            showMessage('signup-msg', ERROR_MESSAGES[error.code] || error.message, true);
        });
}

function dangNhap() {
    const email = document.getElementById('login-email').value.trim();
    const matKhau = document.getElementById('login-password').value;

    if (!email || !matKhau) {
        showMessage('login-msg', 'Vui long nhap email va mat khau.', true);
        return;
    }

    auth.signInWithEmailAndPassword(email, matKhau)
        .then((userCredential) => {
            const user = userCredential.user;
            localStorage.setItem('userName', user.displayName || user.email);
            window.location.href = 'index.html';
        })
        .catch((error) => {
            showMessage('login-msg', ERROR_MESSAGES[error.code] || error.message, true);
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
