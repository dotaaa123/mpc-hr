import pg from 'pg';
import schema from './schema.js';

let pool;
let ready;

export function getPool() {
  if (!process.env.POSTGRES_URL) throw new Error('Supabase POSTGRES_URL тохируулаагүй байна');
  if (!pool) {
    const url = new URL(process.env.POSTGRES_URL);
    const options = { max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 };
    if (url.hostname.endsWith('.supabase.com') || url.hostname.endsWith('.supabase.co')) {
      if (process.env.SUPABASE_DB_CA) {
        url.searchParams.delete('sslmode');
        url.searchParams.delete('uselibpqcompat');
        options.ssl = { ca: process.env.SUPABASE_DB_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true };
      } else {
        url.searchParams.set('sslmode', 'require');
        url.searchParams.set('uselibpqcompat', 'true');
      }
    }
    pool = new pg.Pool({ connectionString: url.toString(), ...options });
  }
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
