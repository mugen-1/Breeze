// Gucci Shop API server.
// Bootstrapping step: Express app on port 3000 with a real SQL Server health check.
// Business logic (products, cart, orders, Firebase token verification) comes later.

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const { getPool, sql } = require('./db');

const categoriesRouter = require('./routes/categories');
const productsRouter = require('./routes/products');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

// --- Health check ------------------------------------------------------------
// Opens (or reuses) the SQL Server pool and runs a trivial query to prove the
// connection is real, not just that the process is up.
app.get('/api/health', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      "SELECT DB_NAME() AS db, SUSER_SNAME() AS login, GETDATE() AS serverTime"
    );
    const row = result.recordset[0];

    console.log('[health] SQL Server OK ->', row);

    res.json({
      status: 'ok',
      database: row.db,
      login: row.login,
      serverTime: row.serverTime,
    });
  } catch (err) {
    console.error('[health] SQL Server connection FAILED:', err.message);

    res.status(500).json({
      status: 'error',
      message: 'Cannot connect to SQL Server',
      detail: err.message,
      code: err.code,
    });
  }
});

// --- API routes --------------------------------------------------------------
app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);

// --- Static frontend ---------------------------------------------------------
// Tiện dev: phục vụ client/ ngay trên cùng origin => mở http://localhost:3000/ao-nam.html
// (fetch API cùng origin, không vướng CORS). Production sẽ tách CDN ở Phase 5.
app.use(express.static(path.join(__dirname, '..', 'client')));

app.listen(PORT, () => {
  console.log(`[server] Gucci Shop API listening on http://localhost:${PORT}`);
  console.log(`[server] Health check: http://localhost:${PORT}/api/health`);
  console.log(`[server] Frontend:     http://localhost:${PORT}/index.html`);
});
