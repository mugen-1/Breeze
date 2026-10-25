'use strict';
const router = require('express').Router();
const { getPool } = require('../db');
const { verifyFirebaseToken } = require('../middleware/auth');
const { buildUserActionLimiter } = require('../middleware/security');
const support = require('../lib/customer-support');
const { COOKIE, cookieOptions, guestToken, jsonMutation, handle } = require('../middleware/support');
const { stream } = require('../middleware/support-stream');
const sessions = require('../lib/support-session');
function viewer(req, res, next) {
  if (req.headers.authorization !== undefined) return verifyFirebaseToken(req, res, () => {
    if (req.user.role !== 'customer' && req.path !== '/session') return res.status(403).json({ status: 'error', code: 'SUPPORT_CUSTOMER_ONLY', message: 'Admin sử dụng hộp thư quản trị' });
    req.supportPrincipal = { kind: req.user.role, userId: req.user.id }; next();
  });
  next();
}
function principal(req) {
  if (req.supportPrincipal) return req.supportPrincipal;
  const token = guestToken(req);
  if (!token) throw new support.SupportError(401, 'SUPPORT_SESSION_REQUIRED', 'Vui lòng nhập tên và email để bắt đầu chat');
  return { kind: 'guest', hash: support.hashToken(token) };
}
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(viewer);
const sendLimiter = buildUserActionLimiter({ limit: 30, message: 'Bạn gửi quá nhanh, vui lòng đợi một phút' });
const createLimiter = buildUserActionLimiter({ limit: 5, message: 'Bạn tạo phiên quá nhanh, vui lòng đợi một phút' });
function emptyInput(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length || Object.keys(req.query).length) {
    throw new support.SupportError(400, 'SUPPORT_INVALID_INPUT', 'Dữ liệu phiên không hợp lệ');
  }
}
router.post('/session', jsonMutation, buildUserActionLimiter({ limit: 120 }), handle(async (req, res) => {
  emptyInput(req);
  const who = req.supportPrincipal;
  let token;
  try { token = guestToken(req); }
  catch (e) {
    if (!who || e.status !== 401) throw e;
    res.clearCookie(COOKIE, cookieOptions(req)); // Valid account proof cannot claim a malformed guest credential.
  }
  if (who && who.kind === 'admin') {
    const result = token ? await sessions.discardGuest(await getPool(), who, support.hashToken(token)) : { discarded: false };
    res.clearCookie(COOKIE, cookieOptions(req));
    return res.json({ role: 'admin', active: false, merged: false, ...result });
  }
  if (who) {
    const result = token ? await sessions.mergeGuest(await getPool(), who, support.hashToken(token)) : { merged: false };
    res.clearCookie(COOKIE, cookieOptions(req));
    return res.json({ role: 'customer', active: false, ...result });
  }
  res.json(token ? { role: 'guest', ...await sessions.heartbeat(await getPool(), support.hashToken(token)) } : { role: 'guest', active: false });
}));
router.post('/heartbeat', jsonMutation, buildUserActionLimiter({ limit: 120 }), handle(async (req, res) => {
  emptyInput(req);
  if (req.supportPrincipal) throw new support.SupportError(403, 'SUPPORT_GUEST_ONLY', 'Tài khoản đăng nhập không dùng heartbeat khách');
  const token = guestToken(req);
  res.json(token ? await sessions.heartbeat(await getPool(), support.hashToken(token)) : { active: false });
}));
router.get('/events', handle(async (req, res) => {
  const who = principal(req);
  if (req.user) who.firebaseUid = req.user.firebase_uid;
  await stream.open(req, res, who);
}));
router.post('/guest-session', jsonMutation, createLimiter, handle(async (req, res) => {
  if (req.supportPrincipal) throw new support.SupportError(403, 'SUPPORT_GUEST_ONLY', 'Tài khoản đã đăng nhập sử dụng hội thoại tài khoản');
  const data = support.guestInput(req.body), token = guestToken(req);
  const result = await support.startGuest(await getPool(), data, token);
  res.cookie(COOKIE, result.token, cookieOptions(req));
  const { token: _secret, ...body } = result;
  res.status(result.replayed ? 200 : 201).json(body);
}));
router.get('/conversation', handle(async (req, res) => {
  support.historyInput(req.query); // Reject unknown/forged query identity fields.
  if (Object.keys(req.query).length) throw new support.SupportError(400, 'SUPPORT_INVALID_INPUT', 'Dữ liệu chat không hợp lệ');
  if (!req.supportPrincipal && !guestToken(req)) return res.json({ conversation: null });
  res.json(await support.currentConversation(await getPool(), principal(req)) || { conversation: null });
}));
router.get('/conversation/messages', handle(async (req, res) => {
  const options = support.historyInput(req.query), who = principal(req);
  res.json(await support.history(await getPool(), who, null, options) || { conversation: null, messages: [], nextBefore: null });
}));
router.post('/messages', jsonMutation, sendLimiter, handle(async (req, res) => {
  const data = support.messageInput(req.body), who = principal(req);
  const result = await support.send(await getPool(), who, null, data);
  res.status(result.replayed ? 200 : 201).json(result);
}));
module.exports = router;
