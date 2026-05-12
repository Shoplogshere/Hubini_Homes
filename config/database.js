const { Pool } = require('pg');

let pool = null;

const createPool = () => {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        require: true,
        rejectUnauthorized: false
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return pool;
};

const getPool = () => {
  if (!pool) return createPool();
  return pool;
};

const testConnection = async () => {
  try {
    const client = await getPool().connect();
    console.log('✅ Connected to PostgreSQL database');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

// Helper function to execute queries
const query = async (sql, params = []) => {
  // Convert MySQL ? placeholders to PostgreSQL $1, $2, $3...
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const result = await getPool().query(pgSql, params);
  return result.rows;
};

// Transaction helper
const transaction = async (callback) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  createPool,
  getPool,
  testConnection,
  query,
  transaction
};