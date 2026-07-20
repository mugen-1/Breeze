/* theme.js — controller Dark/Light dùng chung (toàn site).
   KHÔNG tự set theme khi load — inline snippet ở <head> đã set data-theme sẵn
   (chạy trước render để chống FOUC). File này chỉ để UI gọi BreezeTheme.set().
   set(): đổi data-theme trên <html> + lưu localStorage + phát 'breeze:themechange'. */
window.BreezeTheme = {
  STORAGE_KEY: 'breeze-theme',

  get: function () {
    return document.documentElement.getAttribute('data-theme') || 'light';
  },

  set: function (mode) {
    if (mode !== 'light' && mode !== 'dark') return;
    document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem(this.STORAGE_KEY, mode); } catch (e) {}
    document.dispatchEvent(new CustomEvent('breeze:themechange', { detail: { mode: mode } }));
  }
};
