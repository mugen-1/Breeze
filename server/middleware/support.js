'use strict';
const { allowedOrigins } = require('./security');
const { SupportError } = require('../lib/customer-support');
const COOKIE = 'breeze_support_guest';
function cookieOptions(req) { return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' || req.secure, path: '/api/support' }; }
function guestToken(req) {
  const matches = (req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(COOKIE + '='));
  if (!matches.length) return null;
  if (matches.length !== 1 || !new RegExp('^' + COOKIE + '=[A-Za-z0-9_-]{43}$').test(matches[0])) {
    throw new SupportError(401, 'SUPPORT_SESSION_EXPIRED', 'Phiên chat không hợp lệ hoặc đã hết hạn');
  }
  return matches[0].slice(COOKIE.length + 1);
}
function jsonMutation(req, res, next) {
  const origin = req.headers.origin;
  if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && !allowedOrigins().includes(origin))) {
    return res.status(403).json({ status: 'error', code: 'SUPPORT_ORIGIN_BLOCKED', message: 'Nguồn gửi yêu cầu không hợp lệ' });
  }
  if (!req.is('application/json')) return res.status(415).json({ status: 'error', code: 'SUPPORT_JSON_REQUIRED', message: 'Yêu cầu dữ liệu JSON' });
  next();
}
function handle(action) {
  return async (req, res) => {
    try { await action(req, res); }
    catch (error) {
      if (error instanceof SupportError) {
        if (error.code === 'SUPPORT_SESSION_EXPIRED' && !req.headers.authorization) res.clearCookie(COOKIE, cookieOptions(req));
        return res.status(error.status).json({ status: 'error', code: error.code, message: error.message });
      }
      console.error('[support] request failed:', error.code || 'database-error');
      res.status(500).json({ status: 'error', code: 'SUPPORT_ERROR', message: 'Không xử lý được hội thoại. Vui lòng thử lại' });
    }
  };
}
module.exports = { COOKIE, cookieOptions, guestToken, jsonMutation, handle };
