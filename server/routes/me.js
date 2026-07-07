// GET /api/me — thông tin user hiện tại (yêu cầu Firebase ID token hợp lệ).
const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth');

router.get('/', verifyFirebaseToken, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id,
    firebase_uid: u.firebase_uid,
    email: u.email,
    display_name: u.display_name,
    role: u.role,
    created_at: u.created_at,
    last_login: u.last_login,
  });
});

module.exports = router;
