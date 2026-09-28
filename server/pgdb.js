import pg from 'pg';
import schema from './schema.js';

let pool;
let ready;

export function getPool() {
  if (!process.env.POSTGRES_URL) throw new Error('Supabase POSTGRES_URL тохируулаагүй байна');
  if (!pool) pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
  return pool;
}

export async function ensureSchema() {
  if (!ready) ready = (async () => {
    await getPool().query(schema);
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}

export async function withTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
