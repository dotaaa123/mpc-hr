import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { ensureSchema, getPool, withTransaction } from '../server/pgdb.js';

const sqliteFile = resolve(process.argv[2] || 'data/mpc-hr.sqlite');
if (!existsSync(sqliteFile)) throw new Error(`SQLite файл олдсонгүй: ${sqliteFile}`);
if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL орчны хувьсагч шаардлагатай');
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD 12+ тэмдэгттэй байх ёстой');

const db = new DatabaseSync(sqliteFile, { readOnly: true });
const users = db.prepare('SELECT id,username,name,role,password,active,camp_id FROM users ORDER BY id').all();
const records = db.prepare('SELECT id,type,body,created_at,updated_at FROM records ORDER BY id').all();
const submissions = db.prepare('SELECT * FROM submissions ORDER BY id').all();
const salt = randomBytes(16).toString('hex');
const adminHash = `${salt}:${scryptSync(process.env.ADMIN_PASSWORD, salt, 64).toString('hex')}`;

await ensureSchema();
await withTransaction(async client => {
  const current = (await client.query('SELECT (SELECT count(*) FROM public.records)::integer AS records,(SELECT count(*) FROM public.submissions)::integer AS submissions,(SELECT count(*) FROM public.users)::integer AS users')).rows[0];
  if (current.records || current.submissions || current.users > 1) throw new Error('Supabase сан хоосон биш байна. Давхар импорт хийхгүй.');
  for (const user of users) {
    await client.query(`INSERT INTO public.users(id,username,name,role,password,active,camp_id) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,role=EXCLUDED.role,password=EXCLUDED.password,active=EXCLUDED.active,camp_id=EXCLUDED.camp_id`,
    [user.id, user.username, user.name, user.role, user.role === 'admin' ? adminHash : user.password, Boolean(user.active), user.camp_id]);
  }
  for (const record of records) await client.query('INSERT INTO public.records(id,type,body,created_at,updated_at) VALUES($1,$2,$3::jsonb,$4,$5)', [record.id, record.type, record.body, record.created_at, record.updated_at]);
  for (const row of submissions) await client.query('INSERT INTO public.submissions(id,assignment_id,work_date,status,actual_hours,actual_fuel,actual_output,note,submitted_by,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [row.id, row.assignment_id, row.work_date, row.status, row.actual_hours, row.actual_fuel, row.actual_output, row.note, row.submitted_by, row.submitted_at]);
  for (const table of ['users','records','submissions']) await client.query(`SELECT setval(pg_get_serial_sequence('public.${table}', 'id'), COALESCE((SELECT max(id) FROM public.${table}), 1), true)`);
});
await getPool().end();
db.close();
console.log(`Supabase руу ${users.length} хэрэглэгч, ${records.length} бүртгэл, ${submissions.length} гүйцэтгэл шилжүүллээ.`);
