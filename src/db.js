const { Pool } = require('pg');

const isRenderDatabase =
  process.env.DATABASE_URL &&
  process.env.DATABASE_URL.includes('render.com');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: isRenderDatabase
    ? { rejectUnauthorized: false }
    : false,

  connectionTimeoutMillis: 15000,

  idleTimeoutMillis: 30000,

  max: 10,
});

pool.on('error', (err) => {
  console.error('Erro inesperado no PostgreSQL:', err);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await fn(client);

    await client.query('COMMIT');

    return result;

  } catch (error) {
    await client.query('ROLLBACK');

    throw error;

  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  withTransaction,
};