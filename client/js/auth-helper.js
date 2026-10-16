/* auth-helper.js — cầu nối Firebase Auth (client) <-> backend API.
   Tải SAU firebase-app/auth-compat + firebase-config.js (định nghĩa global `firebase`, `auth`).
   Nếu trang KHÔNG nạp Firebase => coi như khách (guest), mọi thứ vẫn chạy bằng localStorage.

   Cung cấp window.AuthHelper:
     - isLoggedIn()            -> boolean (đồng bộ)
     - getUser()              -> firebase user | null
     - getToken()             -> Promise<idToken|null>  (đính Bearer)
     - onChange(cb)           -> gọi cb(user) mỗi lần trạng thái đăng nhập đổi (và ngay nếu đã sẵn)
     - apiFetch(path, opts)   -> Promise<Response>, tự gắn Authorization: Bearer <idToken>
   Đồng thời phát sự kiện document 'authchange' { detail: { user } }. */
(function () {
  'use strict';

  var hasFirebase = !!(window.firebase && firebase.auth);

  var AuthHelper = {
    ready: false,
    user: null,
    _cbs: [],

    isLoggedIn: function () {
      return hasFirebase && !!firebase.auth().currentUser;
    },

    getUser: function () {
      return hasFirebase ? firebase.auth().currentUser : null;
    },

    // Chờ bước kiểm tra lại email_verified (nếu đang chạy) rồi mới lấy token — để lệnh
    // gọi API đầu tiên của trang đã mang token mới. Xem refreshIfNewlyVerified.
    getToken: function () {
      if (!hasFirebase) return Promise.resolve(null);
      return (_verifyCheck || Promise.resolve()).then(function () {
        var u = firebase.auth().currentUser;
        return u ? u.getIdToken() : null;
      });
    },

    onChange: function (cb) {
      if (typeof cb !== 'function') return;
      this._cbs.push(cb);
      if (this.ready) { try { cb(this.user); } catch (e) { console.error(e); } }
    },

    // fetch tự đính token. Ném lỗi nếu chưa đăng nhập (route bảo vệ sẽ 401 nếu cố gọi).
    apiFetch: function (path, opts) {
      opts = opts || {};
      var base = window.API_BASE || '';
      return this.getToken().then(function (token) {
        var headers = {};
        if (opts.headers) for (var k in opts.headers) headers[k] = opts.headers[k];
        if (token) headers['Authorization'] = 'Bearer ' + token;
        // FormData (upload file): TUYỆT ĐỐI không tự set Content-Type — trình duyệt phải
        // tự sinh 'multipart/form-data; boundary=...'. Set tay là mất boundary, server
        // không parse được file. Các body khác vẫn mặc định JSON như cũ.
        var isFormData = (typeof FormData !== 'undefined') && (opts.body instanceof FormData);
        if (opts.body && !isFormData && !headers['Content-Type']) {
          headers['Content-Type'] = 'application/json';
        }
        var final = {};
        for (var p in opts) final[p] = opts[p];
        final.headers = headers;
        return fetch(base + path, final);
      });
    },
  };

  /* Cờ email_verified nằm TRONG ID token, mà token chỉ tự làm mới ~1 giờ một lần. Người
     dùng bấm link xác minh (thường ở tab khác) rồi quay lại: phiên đang có vẫn mang token
     cũ ghi false, nên server (tự phong admin theo ADMIN_EMAILS) chưa thấy đã xác minh.
     Vì vậy khi có phiên mà emailVerified còn false: reload() hỏi lại Firebase; nếu nay đã
     true thì getIdToken(true) lấy token MỚI. getToken() chờ bước này xong mới trả token.
     Chỉ chạy cho tài khoản CHƯA xác minh, mỗi trang một lần; đã xác minh thì bỏ qua.
     Không cần làm ngay sau signInWithEmailAndPassword (auth.js): token lúc đó vốn mới.
     Lỗi (mất mạng...) thì bỏ qua, dùng token hiện có — không được chặn trang. */
  var _verifyCheck = null;
  function refreshIfNewlyVerified(user) {
    if (!user || user.emailVerified) { _verifyCheck = null; return; }
    _verifyCheck = user.reload()
      .then(function () {
        if (user.emailVerified) return user.getIdToken(true);
      })
      .catch(function (e) {
        console.warn('[auth-helper] không kiểm tra lại được email_verified:', e && e.code);
      })
      .then(function () { _verifyCheck = null; });
  }

  function emit(user) {
    AuthHelper.ready = true;
    AuthHelper.user = user;
    AuthHelper._cbs.forEach(function (cb) { try { cb(user); } catch (e) { console.error(e); } });
    document.dispatchEvent(new CustomEvent('authchange', { detail: { user: user } }));
  }

  if (hasFirebase) {
    // Kiểm tra lại email_verified TRƯỚC emit: callback nào gọi apiFetch ngay thì getToken()
    // đã có _verifyCheck để chờ. Bản thân emit không bị trễ — giao diện không phải đợi.
    firebase.auth().onAuthStateChanged(function (user) {
      refreshIfNewlyVerified(user);
      emit(user);
    });
  } else {
    // Không có Firebase trên trang này: phát 1 lần trạng thái "guest".
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { emit(null); });
    } else {
      emit(null);
    }
  }

  window.AuthHelper = AuthHelper;
})();
