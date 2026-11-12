'use strict';
// Mounted behind the existing Admin router's Firebase + SQL-role (back-office) middleware.
// principal.kind = 'admin' nghĩa là "phía quản trị" (admin hoặc staff), không phải tên role.
const router = require('express').Router();
const { requirePermission } = require('../middleware/requirePermission');
const { getPool } = require('../db');
const { buildUserActionLimiter } = require('../middleware/security');
const support = require('../lib/customer-support');
const { jsonMutation, handle } = require('../middleware/support');
const { stream } = require('../middleware/support-stream');
const principal = req => ({ kind: 'admin', userId: req.user.id });
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(requirePermission('support:reply')); // Mọi route dưới /api/admin/support, gồm SSE.
router.get('/events', handle(async (req, res) => {
  await stream.open(req, res, { ...principal(req), firebaseUid: req.user.firebase_uid });
}));
router.get('/conversations', handle(async (req, res) => {
  const options = support.inboxInput(req.query);
  res.json(await support.inbox(await getPool(), principal(req), options));
}));
router.get('/conversations/:conversationId/messages', handle(async (req, res) => {
  const cid = support.id(req.params.conversationId), options = support.historyInput(req.query);
  res.json(await support.history(await getPool(), principal(req), cid, options));
}));
router.post('/conversations/:conversationId/read', jsonMutation, buildUserActionLimiter({ limit: 120 }), handle(async (req, res) => {
  const cid = support.id(req.params.conversationId), data = support.readInput(req.body);
  if (Object.keys(req.query).length) throw new support.SupportError(400, 'SUPPORT_INVALID_INPUT', 'Dữ liệu chat không hợp lệ');
  res.json(await support.markRead(await getPool(), principal(req), cid, data.messageId, data.messageCount));
}));
router.post('/conversations/:conversationId/messages', jsonMutation, buildUserActionLimiter({ limit: 30 }), handle(async (req, res) => {
  const cid = support.id(req.params.conversationId), data = support.messageInput(req.body);
  const result = await support.send(await getPool(), principal(req), cid, data);
  res.status(result.replayed ? 200 : 201).json(result);
}));
module.exports = router;
