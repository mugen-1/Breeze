// GET /api/categories — danh sách danh mục (id, slug, name_vi, name_en).
const express = require('express');
const router = express.Router();
const { getPool } = require('../db');

router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      'SELECT id, slug, name_vi, name_en FROM dbo.categories ORDER BY id'
    );
    res.json(result.recordset);
  } catch (err) {
    console.error('[categories] error:', err.message);
    res.status(500).json({ status: 'error', message: 'Không tải được danh mục' });
  }
});

module.exports = router;
