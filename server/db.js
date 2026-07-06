// SQL Server connection pool.
// Reads connection settings from environment variables (see .env / .env.example).
// Exposes a single shared connection pool so the whole app reuses one set of
// connections instead of opening a new one per request.

const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT) || 1433,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: String(process.env.DB_ENCRYPT).toLowerCase() === 'true',
    trustServerCertificate:
      String(process.env.DB_TRUST_SERVER_CERTIFICATE).toLowerCase() === 'true',
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// A promise that resolves to the connected pool. Created lazily on first use.
let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        console.log(`[db] Connected to SQL Server "${config.server}" / DB "${config.database}"`);
        return pool;
      })
      .catch((err) => {
        // Reset so a later call can retry instead of caching the failed promise.
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

module.exports = { sql, getPool, config };
