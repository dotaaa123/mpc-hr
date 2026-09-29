import express from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { parseAllData } from './allData.js';
import { buildPlanSchedule } from './planSchedule.js';
import { roles, types, required, permitted } from './domain.js';
import { ensureSchema, getPool, withTransaction } from './pgdb.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

const query = (sql, params = [], db = getPool()) => db.query(sql, params);
const clean = (type, body) => Object.fromEntries(permitted[type].filter(key => body?.[key] !== undefined && body[key] !== null).map(key => [key, typeof body[key] === 'string' ? body[key].trim() : body[key]]));
const rowRecord = row => ({ id: row.id, ...row.body, createdAt: row.created_at, updatedAt: row.updated_at });
const all = async (type, db) => (await query('SELECT id,body,created_at,updated_at FROM public.records WHERE type=$1 ORDER BY id DESC', [type], db)).rows.map(rowRecord);
const get = async (type, id, db) => {
  const { rows } = await query('SELECT id,body,created_at,updated_at FROM public.records WHERE type=$1 AND id=$2', [type, Number(id) || 0], db);
  return rows[0] && rowRecord(rows[0]);
};
const hash = password => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; };
const verify = (password, stored) => {
  try { const [salt, digest] = stored.split(':'); const actual = scryptSync(password, salt, 64); const expected = Buffer.from(digest, 'hex'); return expected.length === actual.length && timingSafeEqual(expected, actual); }
  catch { return false; }
};
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(part => { const index = part.indexOf('='); return [part.slice(0, index).trim(), part.slice(index + 1)]; }));

let seeded;
async function initialize() {
  await ensureSchema();
  if (!seeded) seeded = (async () => {
    const { rows } = await query('SELECT count(*)::integer AS count FROM public.users');
    if (!rows[0].count && process.env.ADMIN_PASSWORD?.length >= 12) {
      await query('INSERT INTO public.users(username,name,role,password) VALUES($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING', [process.env.ADMIN_USER || 'admin', 'Администратор', 'admin', hash(process.env.ADMIN_PASSWORD)]);
    }
  })().catch(error => { seeded = undefined; throw error; });
  await seeded;
}
app.use('/api', async (_req, _res, next) => { try { await initialize(); next(); } catch (error) { next(error); } });

app.get('/api/health', async (_req, res) => {
  const { rows } = await query('SELECT EXISTS(SELECT 1 FROM public.users WHERE role=$1 AND active=true) AS "adminReady"', ['admin']);
  const databaseRegion = new URL(process.env.POSTGRES_URL).hostname.match(/(?:ap|us|eu|sa|ca|me)-[a-z]+-\d/)?.[0] || null;
  res.json({ ok: true, database: 'supabase', adminReady: rows[0].adminReady, functionRegion: process.env.VERCEL_REGION || null, databaseRegion });
});

async function auth(req, res, next) {
  try {
    const token = cookies(req).mpchr;
    if (!token) return res.status(401).json({ error: 'Нэвтэрнэ үү' });
    const { rows } = await query('SELECT u.id,u.username,u.name,u.role,u.camp_id AS "campId",u.active,s.expires_at FROM public.sessions s JOIN public.users u ON u.id=s.user_id WHERE s.token=$1', [token]);
    const session = rows[0];
    if (!session || !session.active || Number(session.expires_at) < Date.now()) return res.status(401).json({ error: 'Нэвтэрнэ үү' });
    req.user = session;
    next();
  } catch (error) { next(error); }
}
const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Зөвхөн админ эрхтэй' });
const editor = (req, res, next) => req.user.role === 'admin' || (req.params.type === 'machineLogs' && req.user.role === 'dispatcher') || (req.params.type === 'attendance' && ['hr', 'camp'].includes(req.user.role)) ? next() : res.status(403).json({ error: 'Бүртгэх эрхгүй' });

async function validate(type, body, db) {
  const value = clean(type, body);
  const missing = required[type].filter(key => value[key] === undefined || value[key] === '');
  if (missing.length) throw new Error(`Заавал бөглөх талбар: ${missing.join(', ')}`);
  if (type === 'employees' && !/^\S{2,}$/.test(String(value.register))) throw new Error('Регистрийн дугаар буруу байна');
  if (type === 'attendance' && (!await get('employees', value.employeeId, db) || !['day','night','absent','rest','leave'].includes(value.status))) throw new Error('Ажилтан эсвэл төлөв буруу байна');
  if (type === 'equipment') { value.status ||= 'ready'; value.availability ||= value.status === 'ready' ? 'available' : 'inactive'; }
  if (type === 'plans') buildPlanSchedule(value, await all('employees', db), await all('equipment', db));
  if (type === 'assignments' && !value.employeeId && !value.equipmentId) throw new Error('Ажилтан эсвэл техник сонгоно уу');
  if (type === 'assignments' && value.employeeId && !await get('employees', value.employeeId, db)) throw new Error('Ажилтан олдсонгүй');
  if (type === 'assignments' && value.equipmentId && !await get('equipment', value.equipmentId, db)) throw new Error('Техник олдсонгүй');
  if (type === 'assignments' && value.planId && !await get('plans', value.planId, db)) throw new Error('Төлөвлөгөө олдсонгүй');
  if (type === 'machineLogs' && (!await get('employees', value.employeeId, db) || !await get('equipment', value.equipmentId, db))) throw new Error('Оператор эсвэл техник олдсонгүй');
  if (type === 'machineLogs' && (Number(value.endHours) < Number(value.startHours) || Number(value.startHours) < 0)) throw new Error('Төгсгөлийн мото цаг эхлэлээс бага байж болохгүй');
  if (type === 'machineLogs' && value.endKm !== undefined && Number(value.endKm) < Number(value.startKm || 0)) throw new Error('Төгсгөлийн км эхлэлээс бага байж болохгүй');
  return value;
}
async function ensureUnique(type, value, excludeId, db) {
  if (!['employees','attendance','equipment'].includes(type)) return;
  const rows = await all(type, db);
  if (type === 'employees' && rows.some(row => row.id !== Number(excludeId) && row.register === value.register)) throw new Error('Энэ регистрийн дугаартай ажилтан бүртгэлтэй байна');
  if (type === 'attendance' && rows.some(row => row.id !== Number(excludeId) && row.date === value.date && Number(row.employeeId) === Number(value.employeeId))) throw new Error('Энэ ажилтны тухайн өдрийн цаг бүртгэл байна');
  if (type === 'equipment' && rows.some(row => row.id !== Number(excludeId) && (value.vin && row.vin === value.vin || !value.vin && row.parkNo === value.parkNo))) throw new Error('Энэ VIN эсвэл парк дугаартай техник бүртгэлтэй байна');
}
async function canEditRecord(req, type, value, db) {
  if (req.user.role === 'admin') return true;
  if (type === 'machineLogs') return req.user.role === 'dispatcher';
  if (type === 'attendance' && req.user.role === 'hr') return true;
  if (type === 'attendance' && req.user.role === 'camp') return Number((await get('employees', value.employeeId, db))?.campId) === Number(req.user.campId);
  return false;
}
async function updateEquipmentHours(log, db) {
  const equipment = await get('equipment', log.equipmentId, db);
  if (!equipment || Number(log.endHours) <= Number(equipment.currentHours || 0)) return;
  const { id, createdAt, updatedAt, ...body } = equipment;
  body.currentHours = Number(log.endHours);
  await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE id=$2', [JSON.stringify(body), id], db);
}
async function insert(type, value, db) {
  await ensureUnique(type, value, undefined, db);
  const { rows } = await query('INSERT INTO public.records(type,body) VALUES($1,$2::jsonb) RETURNING id,body,created_at,updated_at', [type, JSON.stringify(value)], db);
  if (type === 'machineLogs') await updateEquipmentHours(value, db);
  return rowRecord(rows[0]);
}
async function syncPlanAssignments(planId, plan, db) {
  const assignments = await all('assignments', db);
  const previous = assignments.filter(row => Number(row.autoPlanId) === Number(planId));
  const next = buildPlanSchedule(plan, await all('employees', db), await all('equipment', db));
  const other = assignments.filter(row => Number(row.autoPlanId) !== Number(planId));
  for (const row of next) {
    const conflict = other.find(item => item.date === row.date && item.shift === row.shift && (row.employeeId && Number(item.employeeId) === Number(row.employeeId) || row.equipmentId && Number(item.equipmentId) === Number(row.equipmentId)));
    if (conflict) throw new Error(`${row.date}-ны ээлжид сонгосон ажилтан эсвэл техник өөр ажилд оноогдсон байна`);
  }
  for (const row of previous) {
    const used = await query('SELECT id FROM public.submissions WHERE assignment_id=$1 LIMIT 1', [row.id], db);
    if (used.rowCount) throw new Error('Гүйцэтгэл илгээгдсэн төлөвлөгөөний хуваарийг өөрчлөх боломжгүй');
  }
  for (const row of previous) await query('DELETE FROM public.records WHERE type=$1 AND id=$2', ['assignments', row.id], db);
  for (const row of next) await insert('assignments', { ...row, planId, autoPlanId: planId }, db);
}
const bad = (res, error) => res.status(400).json({ error: error.message });

app.post('/api/login', async (req, res) => {
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  const key = `${req.ip}:${username}`;
  const attempts = (await query('SELECT count,reset_at FROM public.login_attempts WHERE key=$1', [key])).rows[0];
  if (attempts && Number(attempts.reset_at) > Date.now() && attempts.count >= 10) return res.status(429).json({ error: 'Олон удаа буруу оролдлоо. Түр хүлээнэ үү' });
  const user = (await query('SELECT * FROM public.users WHERE username=$1 AND active=true', [username])).rows[0];
  if (!user) {
    const { rows } = await query('SELECT EXISTS(SELECT 1 FROM public.users WHERE role=$1 AND active=true) AS ready', ['admin']);
    if (!rows[0].ready) return res.status(503).json({ error: 'Анхны админ үүсээгүй байна. Vercel-д ADMIN_PASSWORD тохируулж дахин deploy хийнэ үү.' });
  }
  if (!user || !verify(password, user.password)) {
    const count = attempts && Number(attempts.reset_at) > Date.now() ? attempts.count + 1 : 1;
    await query('INSERT INTO public.login_attempts(key,count,reset_at) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET count=$2,reset_at=$3', [key, count, Date.now() + 15 * 60_000]);
    return res.status(401).json({ error: 'Нэвтрэх нэр эсвэл нууц үг буруу байна' });
  }
  await query('DELETE FROM public.login_attempts WHERE key=$1', [key]);
  const token = randomBytes(32).toString('hex');
  await query('INSERT INTO public.sessions(token,user_id,expires_at) VALUES($1,$2,$3)', [token, user.id, Date.now() + 7 * 86400000]);
  res.cookie('mpchr', token, { httpOnly: true, sameSite: 'strict', secure: Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production'), maxAge: 7 * 86400000, path: '/' });
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role, campId: user.camp_id });
});

app.post('/api/logout', auth, async (req, res) => {
  await query('DELETE FROM public.sessions WHERE token=$1', [cookies(req).mpchr]);
  res.clearCookie('mpchr', { path: '/' });
  res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json({ id: req.user.id, username: req.user.username, name: req.user.name, role: req.user.role, campId: req.user.campId }));
app.patch('/api/me/password', auth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: 'Шинэ нууц үг 8-аас дээш тэмдэгттэй байна' });
  const user = (await query('SELECT password FROM public.users WHERE id=$1', [req.user.id])).rows[0];
  if (!user || !verify(currentPassword, user.password)) return res.status(400).json({ error: 'Одоогийн нууц үг буруу байна' });
  if (currentPassword === newPassword) return res.status(400).json({ error: 'Шинэ нууц үг өмнөхөөс өөр байна' });
  await withTransaction(async db => {
    await query('UPDATE public.users SET password=$1 WHERE id=$2', [hash(newPassword), req.user.id], db);
    await query('DELETE FROM public.sessions WHERE user_id=$1 AND token<>$2', [req.user.id, cookies(req).mpchr], db);
  });
  res.json({ ok: true });
});
app.get('/api/users', auth, admin, async (_req, res) => res.json((await query('SELECT id,username,name,role,camp_id AS "campId",active FROM public.users ORDER BY id')).rows));
app.post('/api/users', auth, admin, async (req, res) => {
  const { username, name, role, password, campId } = req.body;
  if (!username || !name || !roles.includes(role) || String(password || '').length < 8) return res.status(400).json({ error: 'Нэр, эрх, 8+ тэмдэгттэй нууц үг оруулна уу' });
  if (role === 'camp' && !await get('camps', campId)) return res.status(400).json({ error: 'Camp ахлахын camp-ийг сонгоно уу' });
  try {
    const { rows } = await query('INSERT INTO public.users(username,name,role,password,camp_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [username, name, role, hash(password), role === 'camp' ? Number(campId) : null]);
    res.json({ id: rows[0].id, username, name, role, campId, active: true });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Энэ нэвтрэх нэр бүртгэлтэй байна' });
    throw error;
  }
});
app.patch('/api/users/:id', auth, admin, async (req, res) => {
  const user = (await query('SELECT * FROM public.users WHERE id=$1', [Number(req.params.id)])).rows[0];
  if (!user) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
  const role = roles.includes(req.body.role) ? req.body.role : user.role;
  const campId = role === 'camp' ? Number(req.body.campId ?? user.camp_id) : null;
  if (role === 'camp' && !await get('camps', campId)) return res.status(400).json({ error: 'Camp ахлахын camp-ийг сонгоно уу' });
  const active = req.body.active === undefined ? user.active : Boolean(req.body.active);
  if (user.id === req.user.id && (!active || role !== 'admin')) return res.status(400).json({ error: 'Өөрийн админ эрхийг хаах боломжгүй' });
  if (user.id === req.user.id && req.body.password) return res.status(400).json({ error: 'Өөрийн нууц үгийг тусгай товчоор солино уу' });
  await query('UPDATE public.users SET name=$1,role=$2,camp_id=$3,active=$4,password=$5 WHERE id=$6', [req.body.name || user.name, role, campId, active, req.body.password ? hash(req.body.password) : user.password, user.id]);
  res.json({ ok: true });
});

app.post('/api/attendance/submit', auth, async (req, res) => {
  if (!['admin','hr','camp'].includes(req.user.role)) return res.status(403).json({ error: 'Цаг бүртгэх эрхгүй' });
  const rows = req.body.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) return res.status(400).json({ error: '1–500 ажилтан сонгоно уу' });
  try {
    await withTransaction(async db => {
      const values = [];
      for (const [index, row] of rows.entries()) {
        try {
          const value = await validate('attendance', row, db);
          const employee = await get('employees', value.employeeId, db);
          value.campId = employee.campId;
          if (!await canEditRecord(req, 'attendance', value, db)) throw new Error('Өөр camp-ийн ажилтан');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error('Өдөр буруу байна');
          value.actualHours = ['day','night'].includes(value.status) ? Number(value.actualHours || 0) : 0;
          if (!Number.isFinite(value.actualHours) || value.actualHours < 0 || value.actualHours > 24) throw new Error('Ажилласан цаг 0–24 байна');
          values.push(value);
        } catch (error) { throw new Error(`${index + 1}-р ажилтан: ${error.message}`); }
      }
      if (new Set(values.map(value => `${value.employeeId}:${value.date}`)).size !== values.length) throw new Error('Нэг ажилтан нэг өдөрт давхар орсон байна');
      const existing = await all('attendance', db);
      for (const value of values) {
        const old = existing.find(row => row.date === value.date && Number(row.employeeId) === Number(value.employeeId));
        if (old) await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE id=$2', [JSON.stringify(value), old.id], db);
        else await insert('attendance', value, db);
      }
    });
    res.json({ count: rows.length });
  } catch (error) { bad(res, error); }
});

function visibleRecords(type,user,rows,employees) {
  if(type==='other'&&user.role!=='admin')return [];
  if(user.role==='camp'){
    const campId=Number(user.campId);
    const employeeCamp=new Map(employees.map(row=>[row.id,Number(row.campId)]));
    if(type==='employees')rows=rows.filter(row=>Number(row.campId)===campId);
    if(type==='attendance')rows=rows.filter(row=>employeeCamp.get(Number(row.employeeId))===campId);
    if(type==='assignments')rows=rows.filter(row=>Number(row.campId)===campId||employeeCamp.get(Number(row.employeeId))===campId);
    if(type==='camps')rows=rows.filter(row=>row.id===campId);
  }
  if(user.role!=='admin')rows=rows.map(row=>{
    const safe={...row};
    if(type==='employees'&&user.role!=='hr'){delete safe.register;delete safe.phone;delete safe.bankAccount}
    if(type==='equipment')['unitPriceMnt','currency','contractNo','contractCompany','sourceData','certificate','customsDocument','passport'].forEach(key=>delete safe[key]);
    if(type==='plans')delete safe.unitRevenue;
    if(type==='fuel')delete safe.pricePerLiter;
    return safe;
  });
  return rows;
}
const submissionSql='SELECT s.id,s.assignment_id,s.work_date::text AS work_date,s.status,s.actual_hours::float8 AS actual_hours,s.actual_fuel::float8 AS actual_fuel,s.actual_output::float8 AS actual_output,s.note,s.submitted_by,s.submitted_at,u.name AS "submittedByName" FROM public.submissions s JOIN public.users u ON u.id=s.submitted_by ORDER BY s.submitted_at DESC';
function visibleSubmissions(rows,user,assignments,employees){
  if(user.role!=='camp')return rows;
  const assignmentMap=new Map(assignments.map(row=>[row.id,row]));
  const employeeCamp=new Map(employees.map(row=>[row.id,Number(row.campId)]));
  return rows.filter(row=>{const task=assignmentMap.get(row.assignment_id);return task&&(Number(task.campId)===Number(user.campId)||employeeCamp.get(Number(task.employeeId))===Number(user.campId))});
}
app.get('/api/bootstrap',auth,async(req,res)=>{
  const [recordResult,submissionResult,userResult]=await Promise.all([
    query('SELECT id,type,body,created_at,updated_at FROM public.records WHERE type=ANY($1::text[]) ORDER BY id DESC',[types]),
    query(submissionSql),
    req.user.role==='admin'?query('SELECT id,username,name,role,camp_id AS "campId",active FROM public.users ORDER BY id'):Promise.resolve({rows:[]})
  ]);
  const grouped=Object.fromEntries(types.map(type=>[type,[]]));
  for(const row of recordResult.rows)grouped[row.type].push(rowRecord(row));
  const employees=grouped.employees,assignments=grouped.assignments;
  const records=Object.fromEntries(types.map(type=>[type,visibleRecords(type,req.user,grouped[type],employees)]));
  res.json({records,submissions:visibleSubmissions(submissionResult.rows,req.user,assignments,employees),users:userResult.rows});
});
app.get('/api/records/:type',auth,async(req,res)=>{
  const type=req.params.type;
  if(!types.includes(type))return res.status(404).end();
  const rows=await all(type);
  res.json(visibleRecords(type,req.user,rows,req.user.role==='camp'&&['attendance','assignments'].includes(type)?await all('employees'):[]));
});
app.post('/api/records/:type', auth, editor, async (req, res) => {
  const type = req.params.type;
  if (!types.includes(type)) return res.status(404).end();
  try {
    const value = await validate(type, req.body);
    if (!await canEditRecord(req, type, value)) return res.status(403).json({ error: 'Өөр camp-ийн ажилтны бүртгэл хийх эрхгүй' });
    if (type === 'plans') {
      const plan = await withTransaction(async db => { const created = await insert(type, value, db); await syncPlanAssignments(created.id, value, db); return created; });
      return res.json(plan);
    }
    res.json(await insert(type, value));
  } catch (error) { bad(res, error); }
});
app.put('/api/records/:type/:id', auth, editor, async (req, res) => {
  const { type, id } = req.params;
  if (!types.includes(type)) return res.status(404).end();
  const old = await get(type, id);
  if (!old) return res.status(404).json({ error: 'Бүртгэл олдсонгүй' });
  try {
    const value = await validate(type, req.body);
    if (!await canEditRecord(req, type, value) || !await canEditRecord(req, type, old)) return res.status(403).json({ error: 'Өөр camp-ийн бүртгэл засах эрхгүй' });
    await ensureUnique(type, value, id);
    if (type === 'plans') await withTransaction(async db => {
      await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE type=$2 AND id=$3', [JSON.stringify(value), type, Number(id)], db);
      await syncPlanAssignments(id, value, db);
    });
    else await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE type=$2 AND id=$3', [JSON.stringify(value), type, Number(id)]);
    if (type === 'machineLogs') await updateEquipmentHours(value);
    res.json(await get(type, id));
  } catch (error) { bad(res, error); }
});
app.delete('/api/records/:type/:id', auth, editor, async (req, res) => {
  const { type, id } = req.params;
  if (!types.includes(type)) return res.status(404).end();
  const old = await get(type, id);
  if (!old) return res.status(404).json({ error: 'Бүртгэл олдсонгүй' });
  if (!await canEditRecord(req, type, old)) return res.status(403).json({ error: 'Өөр camp-ийн бүртгэл устгах эрхгүй' });
  try {
    await withTransaction(async db => {
      if (type === 'plans') {
        const linked = (await all('assignments', db)).filter(row => Number(row.planId) === Number(id));
        for (const row of linked) {
          const used = await query('SELECT id FROM public.submissions WHERE assignment_id=$1 LIMIT 1', [row.id], db);
          if (Number(row.autoPlanId) !== Number(id) || used.rowCount) throw new Error('Энэ төлөвлөгөөний ажил эсвэл гүйцэтгэлийн бүртгэл байна');
          await query('DELETE FROM public.records WHERE type=$1 AND id=$2', ['assignments', row.id], db);
        }
      }
      await query('DELETE FROM public.records WHERE type=$1 AND id=$2', [type, Number(id)], db);
    });
    res.json({ ok: true });
  } catch (error) { bad(res, error); }
});

app.post('/api/import/:type', auth, editor, async (req, res) => {
  const type = req.params.type;
  if (!types.includes(type)) return res.status(404).end();
  const rows = req.body.rows;
  if (!Array.isArray(rows) || rows.length > 2000) return res.status(400).json({ error: '2000 хүртэл мөр импортлох боломжтой' });
  try {
    await withTransaction(async db => {
      for (const [index, row] of rows.entries()) {
        try {
          const value = await validate(type, row, db);
          if (!await canEditRecord(req, type, value, db)) throw new Error('Өөр camp-ийн ажилтан');
          const record = await insert(type, value, db);
          if (type === 'plans') await syncPlanAssignments(record.id, value, db);
        } catch (error) { throw new Error(`${index + 2}-р мөр: ${error.message}`); }
      }
    });
    res.json({ count: rows.length });
  } catch (error) { bad(res, error); }
});

app.post('/api/equipment-all-data/import', auth, admin, async (req, res) => {
  try {
    const file = Buffer.from(String(req.body.fileBase64 || ''), 'base64');
    if (!file.length || file.length > 8_000_000) throw new Error('Excel файл 8 MB хүртэл хэмжээтэй байна');
    const { records, totalRows } = await parseAllData(file);
    if (!records.length) throw new Error('VIN-тэй техникийн мөр олдсонгүй');
    let added = 0, updated = 0;
    await withTransaction(async db => {
      const existing = new Map((await all('equipment', db)).filter(row => row.vin).map(row => [String(row.vin).toUpperCase(), row]));
      const warehouses = await all('warehouses', db);
      for (const record of records) {
        if (record.availability === 'available') {
          const name = record.site || 'Байршил тодорхойгүй';
          let warehouse = warehouses.find(row => row.name === name);
          if (!warehouse) { warehouse = await insert('warehouses', { name, location: name, notes: 'ALL DATA sheet-ийн агуулахад бэлэн техникээс үүсэв' }, db); warehouses.push(warehouse); }
          record.warehouseId = warehouse.id;
        }
        const value = await validate('equipment', record, db);
        const old = existing.get(String(record.vin).toUpperCase());
        if (old) {
          await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE id=$2', [JSON.stringify({ ...value, fuelRate: old.fuelRate || value.fuelRate, notes: old.notes || value.notes }), old.id], db);
          updated++;
        } else { const created = await insert('equipment', value, db); existing.set(String(record.vin).toUpperCase(), created); added++; }
      }
    });
    res.json({ added, updated, totalRows });
  } catch (error) { bad(res, error); }
});

app.get('/api/submissions',auth,async(req,res)=>{
  const rows=(await query(submissionSql)).rows;
  if(req.user.role!=='camp')return res.json(rows);
  res.json(visibleSubmissions(rows,req.user,await all('assignments'),await all('employees')));
});
app.post('/api/submissions', auth, async (req, res) => {
  const { assignmentId, status, actualHours, actualFuel, actualOutput, note } = req.body;
  const task = await get('assignments', assignmentId);
  if (!task) return res.status(404).json({ error: 'Даалгавар олдсонгүй' });
  if (req.user.role === 'camp' && Number(task.campId) !== Number(req.user.campId) && Number((await get('employees', task.employeeId))?.campId) !== Number(req.user.campId)) return res.status(403).json({ error: 'Өөр camp-ийн даалгавар илгээх эрхгүй' });
  if (!['done','not_done'].includes(status)) return res.status(400).json({ error: 'Төлөв сонгоно уу' });
  const values = [actualHours, actualFuel, actualOutput].map(value => Number(value || 0));
  if (values.some(value => !Number.isFinite(value) || value < 0)) return res.status(400).json({ error: 'Бодит утга 0-ээс бага байж болохгүй' });
  await query(`INSERT INTO public.submissions(assignment_id,work_date,status,actual_hours,actual_fuel,actual_output,note,submitted_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(assignment_id,work_date) DO UPDATE SET status=EXCLUDED.status,actual_hours=EXCLUDED.actual_hours,actual_fuel=EXCLUDED.actual_fuel,actual_output=EXCLUDED.actual_output,note=EXCLUDED.note,submitted_by=EXCLUDED.submitted_by,submitted_at=now()`,
  [task.id, task.date, status, ...values, String(note || ''), req.user.id]);
  res.json({ ok: true });
});
app.post('/api/submissions/batch', auth, async (req, res) => {
  if (!['admin','dispatcher','clerk','camp'].includes(req.user.role)) return res.status(403).json({ error: 'Гүйцэтгэл илгээх эрхгүй' });
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) return res.status(400).json({ error: '1–200 ажлын гүйцэтгэл сонгоно уу' });
  try {
    await withTransaction(async db => {
      const seen = new Set();
      for (const row of rows) {
        const task = await get('assignments', row.assignmentId, db);
        if (!task) throw new Error('Ажлын хуваарь олдсонгүй');
        if (seen.has(task.id)) throw new Error('Ажил давхар сонгогдсон байна');
        seen.add(task.id);
        if (req.user.role === 'camp' && Number(task.campId) !== Number(req.user.campId) && Number((await get('employees', task.employeeId, db))?.campId) !== Number(req.user.campId)) throw new Error('Өөр camp-ийн ажил илгээх эрхгүй');
        if (!['done','not_done'].includes(row.status)) throw new Error('Ажил бүрт хийсэн эсэхийг сонгоно уу');
        const numbers = [row.actualHours,row.actualFuel,row.actualOutput].map(value => Number(value || 0));
        if (numbers.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Бодит утга 0-ээс бага байж болохгүй');
        await query(`INSERT INTO public.submissions(assignment_id,work_date,status,actual_hours,actual_fuel,actual_output,note,submitted_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(assignment_id,work_date) DO UPDATE SET status=EXCLUDED.status,actual_hours=EXCLUDED.actual_hours,actual_fuel=EXCLUDED.actual_fuel,actual_output=EXCLUDED.actual_output,note=EXCLUDED.note,submitted_by=EXCLUDED.submitted_by,submitted_at=now()`,
        [task.id,task.date,row.status,...numbers,String(row.note || ''),req.user.id],db);
      }
    });
    res.json({ count: rows.length });
  } catch (error) { bad(res, error); }
});

app.use((error, _req, res, _next) => {
  console.error('MPC HR API error:', error);
  if (!res.headersSent) res.status(500).json({ error: 'Серверийн алдаа. Supabase холболт болон тохиргоог шалгана уу.' });
});

export default app;
