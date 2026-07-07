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

    getToken: function () {
      if (!hasFirebase) return Promise.resolve(null);
      var u = firebase.auth().currentUser;
      return u ? u.getIdToken() : Promise.resolve(null);
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
        if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
        var final = {};
        for (var p in opts) final[p] = opts[p];
        final.headers = headers;
        return fetch(base + path, final);
      });
    },
  };

  function emit(user) {
    AuthHelper.ready = true;
    AuthHelper.user = user;
    AuthHelper._cbs.forEach(function (cb) { try { cb(user); } catch (e) { console.error(e); } });
    document.dispatchEvent(new CustomEvent('authchange', { detail: { user: user } }));
  }

  if (hasFirebase) {
    firebase.auth().onAuthStateChanged(function (user) { emit(user); });
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
