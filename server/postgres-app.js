import express from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import { parseAllData } from './allData.js';
import { buildPlanSchedule, assertAssignable } from './planSchedule.js';
import { createEmployeePdf, documentKinds } from './pdfDocuments.js';
import { importUndoPlan } from './importUndo.js';
import { roles, types, required, permitted } from './domain.js';
import { ensureSchema, getPool, withTransaction } from './pgdb.js';

const app = express();
const projectContext = new AsyncLocalStorage();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

const query = (sql, params = [], db = getPool()) => db.query(sql, params);
const clean = (type, body) => Object.fromEntries(permitted[type].filter(key => body?.[key] !== undefined && body[key] !== null).map(key => [key, typeof body[key] === 'string' ? body[key].trim() : body[key]]));
const rowRecord = row => ({ id: row.id, ...row.body, createdAt: row.created_at, updatedAt: row.updated_at });
const currentProject = () => projectContext.getStore()?.projectId;
const all = async (type, db) => (await query('SELECT id,body,created_at,updated_at FROM public.records WHERE type=$1 AND project_id=$2 ORDER BY id DESC', [type, currentProject()], db)).rows.map(rowRecord);
const get = async (type, id, db) => {
  const { rows } = await query('SELECT id,body,created_at,updated_at FROM public.records WHERE type=$1 AND id=$2 AND project_id=$3', [type, Number(id) || 0, currentProject()], db);
  return rows[0] && rowRecord(rows[0]);
};
const hash = password => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; };
const validPassword = value => typeof value === 'string' && value.length >= 8 && /\p{Lu}/u.test(value) && /\p{Ll}/u.test(value) && /\d/u.test(value) && /[^\p{L}\p{N}]/u.test(value);
const verify = (password, stored) => {
  try { const [salt, digest] = stored.split(':'); const actual = scryptSync(password, salt, 64); const expected = Buffer.from(digest, 'hex'); return expected.length === actual.length && timingSafeEqual(expected, actual); }
  catch { return false; }
};
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(part => { const index = part.indexOf('='); return [part.slice(0, index).trim(), part.slice(index + 1)]; }));

let seeded;
async function initialize() {
  await ensureSchema();
  if (!seeded) seeded = (async () => {
    await query("INSERT INTO public.projects(name) VALUES('Ууцар') ON CONFLICT(name) DO NOTHING");
    const projectId = (await query("SELECT id FROM public.projects WHERE name='Ууцар'")).rows[0].id;
    const { rows } = await query('SELECT count(*)::integer AS count FROM public.users');
    if (!rows[0].count && process.env.ADMIN_PASSWORD?.length >= 12) {
      await query('INSERT INTO public.users(username,name,role,password,project_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT (username) DO NOTHING', [process.env.ADMIN_USER || 'admin', 'Администратор', 'admin', hash(process.env.ADMIN_PASSWORD), projectId]);
    }
    await query('UPDATE public.users SET project_id=$1 WHERE project_id IS NULL', [projectId]);
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
    const { rows } = await query('SELECT u.id,u.username,u.name,u.role,u.camp_id AS "campId",u.project_id AS "projectId",u.employee_id AS "employeeId",u.active,s.expires_at FROM public.sessions s JOIN public.users u ON u.id=s.user_id WHERE s.token=$1', [token]);
    const session = rows[0];
    if (!session || !session.active || Number(session.expires_at) < Date.now()) return res.status(401).json({ error: 'Нэвтэрнэ үү' });
    req.user = session;
    next();
  } catch (error) { next(error); }
}
const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Зөвхөн админ эрхтэй' });
const defaultPermissions = {
  dispatcher: { assignments:['read','update'],attendance:['read','create','update'],machineLogs:['read','create','update'],maintenance:['read'],equipment:['read'],employees:['read'],camps:['read'],campStays:['read'],guests:['read'],mealMenus:['read'],mealFeedback:['read'],bedAssignments:['read'] },
  clerk: { maintenance:['read','create','update'],equipment:['read'],employees:['read','update'],assignments:['read','update'] },
  camp: { attendance:['read','create','update'],employees:['read'],camps:['read'],assignments:['read','update'],campStays:['read','create','update'],guests:['read','create','update'],mealMenus:['read','create','update'],mealFeedback:['read','create','update'],bedAssignments:['read','create','update'] },
  hr: { employees:['read','create','update'],attendance:['read','create','update'],assignments:['read'],equipment:['read'],camps:['read'],campStays:['read'],guests:['read'],maintenance:['read'],travelExpenses:['read','create','update'],shiftOverrides:['read','create','update'],documents:['read','create'],mealMenus:['read'],mealFeedback:['read','update'],bedAssignments:['read'] },
};
const permissionPages=[...types,'documents'];
async function allowed(req, page, action) {
  if (req.user.role === 'admin') return true;
  const { rows } = await query('SELECT permissions FROM public.role_permissions WHERE project_id=$1 AND role=$2', [currentProject(), req.user.role]);
  const permissions = rows[0]?.permissions || defaultPermissions[req.user.role] || {};
  return Array.isArray(permissions[page]) && permissions[page].includes(action);
}
const editor = async (req, res, next) => {
  try { return await allowed(req, req.params.type, req.method === 'DELETE' ? 'delete' : req.method === 'PUT' || req.method === 'PATCH' ? 'update' : 'create') ? next() : res.status(403).json({ error: 'Бүртгэх эрхгүй' }); }
  catch (error) { next(error); }
};
async function audit(req, page, action, recordId, details = {}, db) {
  await query('INSERT INTO public.audit_logs(project_id,user_id,username,role,page,action,record_id,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [currentProject(), req.user.id, req.user.username, req.user.role, page, action, recordId || null, JSON.stringify(details)], db);
}
const changesBetween=(before,after)=>Object.fromEntries(Object.keys(after).filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key])).map(key=>[key,{before:before[key]??null,after:after[key]??null}]));
app.use('/api', (req, res, next) => {
  if (['/login','/health'].includes(req.path)) return next();
  auth(req, res, async () => {
    try {
      const projectId = req.user.role === 'admin' && req.headers['x-project-id'] ? Number(req.headers['x-project-id']) : Number(req.user.projectId);
      if (!projectId || !(await query('SELECT id FROM public.projects WHERE id=$1 AND active=true', [projectId])).rowCount) return res.status(403).json({ error: 'Төсөл сонгоно уу' });
      projectContext.run({ projectId }, next);
    } catch (error) { next(error); }
  });
});

async function validate(type, body, db) {
  const value = clean(type, body);
  const missing = required[type].filter(key => value[key] === undefined || value[key] === '');
  if (missing.length) throw new Error(`Заавал бөглөх талбар: ${missing.join(', ')}`);
  if (type === 'employees' && !/^\S{2,}$/.test(String(value.register))) throw new Error('Регистрийн дугаар буруу байна');
  if (type === 'attendance' && (!await get('employees', value.employeeId, db) || !['day','night','travel','absent','rest','leave'].includes(value.status))) throw new Error('Ажилтан эсвэл төлөв буруу байна');
  if (type === 'attendance' && ['day','night'].includes(value.status) && (await all('shiftOverrides',db)).some(row=>row.date===value.date&&Number(row.originalEmployeeId)===Number(value.employeeId))) throw new Error('Энэ өдөр өөр ажилтнаар орлуулсан тул ажилласан гэж бүртгэх боломжгүй');
  if (type === 'equipment') { value.status ||= 'ready'; value.availability ||= value.status === 'ready' ? 'available' : 'inactive'; }
  if (type === 'plans') buildPlanSchedule(value, await all('employees', db), await all('equipment', db), await all('attendance', db), await all('shiftOverrides', db));
  if (type === 'assignments' && !value.employeeId && !value.equipmentId) throw new Error('Ажилтан эсвэл техник сонгоно уу');
  if (type === 'assignments' && value.employeeId && !await get('employees', value.employeeId, db)) throw new Error('Ажилтан олдсонгүй');
  if (type === 'assignments' && value.employeeId) assertAssignable(await get('employees',value.employeeId,db),value.date,value.shift,await all('attendance',db),await all('shiftOverrides',db));
  if (type === 'assignments' && value.equipmentId && !await get('equipment', value.equipmentId, db)) throw new Error('Техник олдсонгүй');
  if (type === 'assignments' && value.planId && !await get('plans', value.planId, db)) throw new Error('Төлөвлөгөө олдсонгүй');
  if (type === 'machineLogs' && (!await get('employees', value.employeeId, db) || !await get('equipment', value.equipmentId, db))) throw new Error('Оператор эсвэл техник олдсонгүй');
  if (type === 'machineLogs' && (Number(value.endHours) < Number(value.startHours) || Number(value.startHours) < 0)) throw new Error('Төгсгөлийн мото цаг эхлэлээс бага байж болохгүй');
  if (type === 'machineLogs' && value.endKm !== undefined && Number(value.endKm) < Number(value.startKm || 0)) throw new Error('Төгсгөлийн км эхлэлээс бага байж болохгүй');
  if (['travelExpenses','campStays','mealFeedback','bedAssignments'].includes(type) && value.employeeId && !await get('employees', value.employeeId, db)) throw new Error('Ажилтан олдсонгүй');
  if (type === 'campStays') {
    if(!await get('camps',value.campId,db)) throw new Error('Camp сонгоно уу');
    if(!['employee','guest','rental'].includes(value.category)||!Number.isInteger(Number(value.count))||Number(value.count)<1) throw new Error('Хоногийн ангилал эсвэл хүний тоо буруу байна');
    if(value.category==='employee'&&(!value.employeeId||Number(value.count)!==1)) throw new Error('Үндсэн ажилтныг нэг бүрчлэн сонгоно уу');
    if(value.category==='guest'&&(!value.guestId||Number(value.count)!==1||!await get('guests',value.guestId,db))) throw new Error('Зочныг зочдын бүртгэлээс сонгоно уу');
    if(value.category==='employee'&&Number((await get('employees',value.employeeId,db))?.campId)!==Number(value.campId)) throw new Error('Ажилтан сонгосон Camp-д харьяалагдахгүй байна');
    if(value.category==='guest'&&Number((await get('guests',value.guestId,db))?.campId)!==Number(value.campId)) throw new Error('Зочин сонгосон Camp-д харьяалагдахгүй байна');
    if(value.category==='rental'&&(value.employeeId||value.guestId)) throw new Error('Түрээсийн ажилтныг хүний тоогоор бүртгэнэ');
    if(['breakfast','lunch','dinner','mealRate','lodgingRate'].some(key=>!Number.isFinite(Number(value[key]||0))||Number(value[key]||0)<0)) throw new Error('Хоол, хоногийн тоо болон үнэ 0-ээс бага байж болохгүй');
  }
  if (['mealMenus','mealFeedback','bedAssignments'].includes(type) && !await get('camps', value.campId, db)) throw new Error('Camp сонгоно уу');
  if (type === 'mealFeedback' && Number((await get('employees',value.employeeId,db))?.campId) !== Number(value.campId)) throw new Error('Ажилтан сонгосон Camp-д харьяалагдахгүй байна');
  if (type === 'bedAssignments' && value.endDate && value.endDate < value.startDate) throw new Error('Дуусах өдөр эхлэх өдрөөс өмнө байж болохгүй');
  if (['maintenance'].includes(type) && !await get('equipment', value.equipmentId, db)) throw new Error('Техник олдсонгүй');
  if (type === 'shiftOverrides') {
    if (!await get('employees', value.replacementEmployeeId, db)) throw new Error('Орлон ажиллах ажилтан олдсонгүй');
    if (value.originalEmployeeId && !await get('employees', value.originalEmployeeId, db)) throw new Error('Солигдох ажилтан олдсонгүй');
    if (Number(value.originalEmployeeId) === Number(value.replacementEmployeeId)) throw new Error('Ижил ажилтан сонгож болохгүй');
  }
  if (type === 'mealFeedback' && value.approvedAllowance !== undefined && (!Number.isFinite(Number(value.approvedAllowance)) || Number(value.approvedAllowance) < 0)) throw new Error('Баталсан нэмэгдлийн дүн буруу байна');
  if (type === 'mealFeedback' && value.hrStatus && !['pending','approved','rejected'].includes(value.hrStatus)) throw new Error('HR шийдвэр буруу байна');
  if (type === 'mealFeedback' && value.hrStatus === 'approved' && value.approvedAllowance === undefined) throw new Error('Баталсан нэмэгдлийн дүн оруулна уу');
  if (type === 'mealMenus' && !['breakfast','lunch','dinner'].includes(value.mealType)) throw new Error('Хоолны төрөл буруу байна');
  return value;
}
async function ensureUnique(type, value, excludeId, db) {
  if (!['employees','attendance','equipment','assignments','campStays','bedAssignments'].includes(type)) return;
  const rows = await all(type, db);
  if (type === 'employees' && rows.some(row => row.id !== Number(excludeId) && row.register === value.register)) throw new Error('Энэ регистрийн дугаартай ажилтан бүртгэлтэй байна');
  if (type === 'attendance' && rows.some(row => row.id !== Number(excludeId) && row.date === value.date && Number(row.employeeId) === Number(value.employeeId))) throw new Error('Энэ ажилтны тухайн өдрийн цаг бүртгэл байна');
  if (type === 'equipment' && rows.some(row => row.id !== Number(excludeId) && (value.vin && row.vin === value.vin || !value.vin && row.parkNo === value.parkNo))) throw new Error('Энэ VIN эсвэл парк дугаартай техник бүртгэлтэй байна');
  if (type === 'campStays' && rows.some(row => row.id !== Number(excludeId) && row.date === value.date && (value.employeeId && Number(row.employeeId) === Number(value.employeeId) || value.guestId && Number(row.guestId) === Number(value.guestId)))) throw new Error('Энэ хүн тухайн өдөр camp-д бүртгэлтэй байна');
  if (type === 'assignments' && rows.some(row => row.id !== Number(excludeId) && row.date === value.date && (value.employeeId && Number(row.employeeId) === Number(value.employeeId) || row.shift === value.shift && value.equipmentId && Number(row.equipmentId) === Number(value.equipmentId)))) throw new Error('Ажилтан энэ өдөрт эсвэл техник энэ ээлжид өөр ажилд оноогдсон байна');
  if (type === 'bedAssignments' && rows.some(row => row.id !== Number(excludeId) && Number(row.employeeId) === Number(value.employeeId) && String(row.startDate) <= String(value.endDate || '9999-12-31') && String(value.startDate) <= String(row.endDate || '9999-12-31'))) throw new Error('Ажилтан тухайн хугацаанд өөр оронд бүртгэлтэй байна');
  if (type === 'bedAssignments' && value.building && value.room && value.bed && rows.some(row => row.id !== Number(excludeId) && Number(row.campId) === Number(value.campId) && row.building === value.building && row.room === value.room && row.bed === value.bed && String(row.startDate) <= String(value.endDate || '9999-12-31') && String(value.startDate) <= String(row.endDate || '9999-12-31'))) throw new Error('Энэ ор тухайн хугацаанд эзэнтэй байна');
}
async function canEditRecord(req, type, value, db) {
  if (req.user.role === 'admin') return true;
  if (type === 'employees' && req.user.role === 'clerk') return /засвар/i.test(String(value.branch || ''));
  if (req.user.role === 'clerk' && ['assignments','machineLogs'].includes(type)) return /засвар/i.test(String((await get('employees',value.employeeId,db))?.branch||''));
  if (type === 'mealFeedback' && req.user.role === 'camp' && (value.approvedAllowance !== undefined || value.hrStatus !== undefined || value.hrNote !== undefined)) return false;
  if (req.user.role === 'camp' && ['attendance','campStays','mealFeedback','bedAssignments'].includes(type) && value.employeeId && Number((await get('employees', value.employeeId, db))?.campId) !== Number(req.user.campId)) return false;
  if (req.user.role === 'camp' && ['mealMenus','mealFeedback','bedAssignments','campStays','guests'].includes(type) && Number(value.campId) !== Number(req.user.campId)) return false;
  if (req.user.role === 'camp' && value.campId) return Number(value.campId) === Number(req.user.campId);
  return true;
}
async function updateEquipmentHours(log, db) {
  const equipment = await get('equipment', log.equipmentId, db);
  if (!equipment || Number(log.endHours) <= Number(equipment.currentHours || 0)) return;
  const { id, createdAt, updatedAt, ...body } = equipment;
  body.currentHours = Number(log.endHours);
  await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE id=$2 AND project_id=$3', [JSON.stringify(body), id, currentProject()], db);
}
async function insert(type, value, db, importBatchId = null) {
  await ensureUnique(type, value, undefined, db);
  const { rows } = await query('INSERT INTO public.records(type,body,project_id,import_batch_id) VALUES($1,$2::jsonb,$3,$4) RETURNING id,body,created_at,updated_at', [type, JSON.stringify(value), currentProject(), importBatchId], db);
  if (type === 'machineLogs') await updateEquipmentHours(value, db);
  return rowRecord(rows[0]);
}
async function syncPlanAssignments(planId, plan, db) {
  const assignments = await all('assignments', db);
  const previous = assignments.filter(row => Number(row.autoPlanId) === Number(planId));
  const next = buildPlanSchedule(plan, await all('employees', db), await all('equipment', db), await all('attendance', db), await all('shiftOverrides', db));
  const other = assignments.filter(row => Number(row.autoPlanId) !== Number(planId));
  for (const row of next) {
    const conflict = other.find(item => item.date === row.date && (row.employeeId && Number(item.employeeId) === Number(row.employeeId) || item.shift === row.shift && row.equipmentId && Number(item.equipmentId) === Number(row.equipmentId)));
    if (conflict) throw new Error(`${row.date}-ны ажилтан эсвэл техник өөр ажилд оноогдсон байна`);
  }
  for (const row of previous) {
    if (row.shiftOverrideId) throw new Error('Ээлж солигдсон төлөвлөгөөг эхлээд ээлжийн өөрчлөлтөөс чөлөөлнө үү');
    const used = await query('SELECT id FROM public.submissions WHERE assignment_id=$1 LIMIT 1', [row.id], db);
    if (used.rowCount) throw new Error('Гүйцэтгэл илгээгдсэн төлөвлөгөөний хуваарийг өөрчлөх боломжгүй');
  }
  for (const row of previous) await query('DELETE FROM public.records WHERE type=$1 AND id=$2 AND project_id=$3', ['assignments', row.id, currentProject()], db);
  for (const row of next) await insert('assignments', { ...row, planId, autoPlanId: planId }, db);
}
async function applyShiftOverride(overrideId, value, db) {
  const replacement = await get('employees', value.replacementEmployeeId, db);
  if (!replacement) throw new Error('Орлон ажиллах ажилтан олдсонгүй');
  const attendance = await all('attendance', db);
  if (value.originalEmployeeId && attendance.some(row => row.date === value.date && Number(row.employeeId) === Number(value.originalEmployeeId) && ['day','night'].includes(row.status))) throw new Error('Солигдох ажилтны ирцийг эхлээд ажиллаагүй/чөлөөтэй болгож засна уу');
  const assignments = await all('assignments', db);
  const targets = assignments.filter(row => row.date === value.date && Number(row.employeeId) === Number(value.originalEmployeeId) && (!value.shift || row.shift === value.shift));
  for (const target of targets) {
    if (assignments.some(row => row.id !== target.id && row.date === target.date && Number(row.employeeId) === Number(replacement.id))) throw new Error('Орлон ажиллах ажилтан тухайн өдөр өөр ажилд оноогдсон байна');
    if ((await query('SELECT id FROM public.submissions WHERE assignment_id=$1 LIMIT 1', [target.id], db)).rowCount) throw new Error('Гүйцэтгэл илгээгдсэн ажлын ээлжийг солих боломжгүй');
    const { id,createdAt,updatedAt,...body } = target;
    body.originalEmployeeId = Number(value.originalEmployeeId);
    body.employeeId = replacement.id;
    body.campId = replacement.campId || body.campId;
    body.shiftOverrideId = Number(overrideId);
    await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE id=$2 AND project_id=$3', [JSON.stringify(body),target.id,currentProject()],db);
  }
  return targets.length;
}
async function undoShiftOverride(overrideId, db) {
  const assignments = (await all('assignments', db)).filter(row => Number(row.shiftOverrideId) === Number(overrideId));
  for (const target of assignments) {
    if ((await query('SELECT id FROM public.submissions WHERE assignment_id=$1 LIMIT 1', [target.id], db)).rowCount) throw new Error('Гүйцэтгэл илгээгдсэн ээлжийн өөрчлөлтийг буцаах боломжгүй');
    const original = await get('employees', target.originalEmployeeId, db);
    const { id,createdAt,updatedAt,originalEmployeeId,shiftOverrideId,...body } = target;
    body.employeeId = originalEmployeeId;
    body.campId = original?.campId || body.campId;
    await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE id=$2 AND project_id=$3', [JSON.stringify(body),target.id,currentProject()],db);
  }
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
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role, campId: user.camp_id, projectId: user.project_id, employeeId: user.employee_id });
});

app.post('/api/logout', auth, async (req, res) => {
  await query('DELETE FROM public.sessions WHERE token=$1', [cookies(req).mpchr]);
  res.clearCookie('mpchr', { path: '/' });
  res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json({ id: req.user.id, username: req.user.username, name: req.user.name, role: req.user.role, campId: req.user.campId, projectId: req.user.projectId, employeeId: req.user.employeeId }));
app.patch('/api/me/password', auth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!validPassword(newPassword)) return res.status(400).json({ error: 'Нууц үг 8+ тэмдэгт, том/жижиг үсэг, тоо, тусгай тэмдэгт агуулна' });
  const user = (await query('SELECT password FROM public.users WHERE id=$1', [req.user.id])).rows[0];
  if (!user || !verify(currentPassword, user.password)) return res.status(400).json({ error: 'Одоогийн нууц үг буруу байна' });
  if (currentPassword === newPassword) return res.status(400).json({ error: 'Шинэ нууц үг өмнөхөөс өөр байна' });
  await withTransaction(async db => {
    await query('UPDATE public.users SET password=$1 WHERE id=$2', [hash(newPassword), req.user.id], db);
    await query('DELETE FROM public.sessions WHERE user_id=$1 AND token<>$2', [req.user.id, cookies(req).mpchr], db);
  });
  res.json({ ok: true });
});
app.get('/api/projects', auth, admin, async (_req, res) => res.json((await query('SELECT id,name,active FROM public.projects ORDER BY id')).rows));
app.post('/api/projects', auth, admin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Төслийн нэр 2–100 тэмдэгт байна' });
  try {
    const { rows } = await query('INSERT INTO public.projects(name) VALUES($1) RETURNING id,name,active', [name]);
    await audit(req, 'projects', 'create', rows[0].id, { name });
    res.json(rows[0]);
  } catch (error) { if (error.code === '23505') return res.status(409).json({ error: 'Ийм нэртэй төсөл байна' }); throw error; }
});
app.get('/api/permissions', auth, async (req, res) => {
  if (req.user.role === 'admin') {
    const rows = (await query('SELECT role,permissions FROM public.role_permissions WHERE project_id=$1', [currentProject()])).rows;
    return res.json(Object.fromEntries(roles.map(role => [role, rows.find(row => row.role === role)?.permissions || defaultPermissions[role] || {}])));
  }
  res.json({ [req.user.role]: (await query('SELECT permissions FROM public.role_permissions WHERE project_id=$1 AND role=$2', [currentProject(), req.user.role])).rows[0]?.permissions || defaultPermissions[req.user.role] || {} });
});
app.put('/api/permissions/:role', auth, admin, async (req, res) => {
  const role = req.params.role;
  if (!roles.includes(role) || role === 'admin') return res.status(400).json({ error: 'Эрх буруу байна' });
  const input = req.body?.permissions;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return res.status(400).json({ error: 'Эрхийн тохиргоо буруу байна' });
  const actions = ['read','create','update','delete'];
  const permissions = Object.fromEntries(Object.entries(input).filter(([page]) => permissionPages.includes(page)).map(([page, list]) => [page, Array.isArray(list) ? list.filter(action => actions.includes(action)) : []]));
  await query('INSERT INTO public.role_permissions(project_id,role,permissions) VALUES($1,$2,$3::jsonb) ON CONFLICT(project_id,role) DO UPDATE SET permissions=$3::jsonb,updated_at=now()', [currentProject(), role, JSON.stringify(permissions)]);
  await audit(req, 'permissions', 'update', null, { role, permissions });
  res.json({ role, permissions });
});
app.get('/api/audit', auth, admin, async (req, res) => {
  const role = String(req.query.role || '');
  const page = String(req.query.page || '');
  const { rows } = await query('SELECT id,username,role,page,action,record_id AS "recordId",details,created_at AS "createdAt" FROM public.audit_logs WHERE project_id=$1 AND ($2::text = \'\' OR role=$2) AND ($3::text = \'\' OR page=$3) ORDER BY id DESC LIMIT 1000', [currentProject(), role, page]);
  res.json(rows);
});
app.get('/api/imports', auth, admin, async (_req, res) => res.json((await query('SELECT id,type,filename,row_count AS "rowCount",created_at AS "createdAt",undone_at AS "undoneAt" FROM public.import_batches WHERE project_id=$1 ORDER BY id DESC LIMIT 200', [currentProject()])).rows));
const documentEditor = async (req,res,next) => {try{const action=req.method==='GET'?'read':req.method==='DELETE'?'delete':'create';return await allowed(req,'documents',action)?next():res.status(403).json({error:'HR баримтын энэ үйлдэлд эрхгүй'})}catch(error){next(error)}};
const documentFields = ['date','companyName','companyAddress','orderNumber','city','legalBasis','effectiveDate','trialMonths','salaryAmount','executiveName','preparedBy','reviewedBy','initiator','reason','location','startDate','endDate','approvalDecision','payMode','payCondition','purpose'];
app.get('/api/documents',auth,documentEditor,async (_req,res)=>{
  const {rows}=await query('SELECT id,employee_id AS "employeeId",kind,fields,approvers,created_at AS "createdAt" FROM public.documents WHERE project_id=$1 ORDER BY id DESC LIMIT 200',[currentProject()]);
  res.json(rows);
});
app.post('/api/documents',auth,documentEditor,async (req,res)=>{
  try {
    const employee=await get('employees',req.body?.employeeId);
    const kind=String(req.body?.kind||'');
    if(!employee||!documentKinds[kind])return res.status(400).json({error:'Ажилтан эсвэл баримтын төрөл буруу байна'});
    const fields=Object.fromEntries(documentFields.map(key=>[key,String(req.body?.fields?.[key]??'').trim().slice(0,500)]).filter(([,value])=>value));
    if(fields.trialMonths&&(!/^\d+$/.test(fields.trialMonths)||Number(fields.trialMonths)>12))return res.status(400).json({error:'Туршилтын хугацаа 0–12 сар байна'});
    if(fields.salaryAmount&&(!/^\d+(\.\d{1,2})?$/.test(fields.salaryAmount)||Number(fields.salaryAmount)<=0))return res.status(400).json({error:'Үндсэн цалингийн дүн буруу байна'});
    if(fields.approvalDecision&&!['approved','rejected'].includes(fields.approvalDecision)||fields.payMode&&!['paid_1_5','unpaid'].includes(fields.payMode))return res.status(400).json({error:'Сунаж ажиллах хуудасны сонголт буруу байна'});
    const ids=Array.isArray(req.body?.approverIds)?req.body.approverIds.slice(0,8):[];
    const approvers=[];
    for(const id of ids){const person=await get('employees',id);if(!person)return res.status(400).json({error:'Батлах ажилтан энэ төсөлд байхгүй'});approvers.push({employeeId:person.id,position:person.position||'',name:`${person.lastName||''} ${person.firstName||''}`.trim()})}
    if(kind==='termination'&&!fields.legalBasis)return res.status(400).json({error:'Ажлаас чөлөөлөх тушаалын хуулийн үндэслэлийг оруулна уу'});
    const pdf=await createEmployeePdf({kind,employee,fields:{...fields,projectName:(await query('SELECT name FROM public.projects WHERE id=$1',[currentProject()])).rows[0]?.name},approvers});
    const {rows}=await query('INSERT INTO public.documents(project_id,employee_id,kind,fields,approvers,pdf,created_by) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) RETURNING id,created_at AS "createdAt"',[currentProject(),employee.id,kind,JSON.stringify(fields),JSON.stringify(approvers),pdf,req.user.id]);
    await audit(req,'documents','create',rows[0].id,{employeeId:employee.id,kind,fields,approvers});
    res.json({id:rows[0].id,employeeId:employee.id,kind,fields,approvers,createdAt:rows[0].createdAt});
  }catch(error){res.status(400).json({error:error.message})}
});
app.get('/api/documents/:id/pdf',auth,documentEditor,async(req,res)=>{
  const row=(await query('SELECT kind,pdf FROM public.documents WHERE id=$1 AND project_id=$2',[Number(req.params.id),currentProject()])).rows[0];
  if(!row)return res.status(404).json({error:'Баримт олдсонгүй'});
  res.set({'Content-Type':'application/pdf','Content-Disposition':`inline; filename="hr-${row.kind}-${req.params.id}.pdf"`,'Cache-Control':'private, no-store'}).send(row.pdf);
});
app.delete('/api/documents/:id',auth,admin,async(req,res)=>{
  const {rows}=await query('DELETE FROM public.documents WHERE id=$1 AND project_id=$2 RETURNING id,employee_id,kind',[Number(req.params.id),currentProject()]);
  if(!rows[0])return res.status(404).json({error:'Баримт олдсонгүй'});
  await audit(req,'documents','delete',rows[0].id,{employeeId:rows[0].employee_id,kind:rows[0].kind});res.json({ok:true});
});
app.get('/api/users', auth, admin, async (_req, res) => res.json((await query('SELECT id,username,name,role,camp_id AS "campId",project_id AS "projectId",employee_id AS "employeeId",active FROM public.users WHERE project_id=$1 OR role=$2 ORDER BY id', [currentProject(),'admin'])).rows));
app.post('/api/users', auth, admin, async (req, res) => {
  const { username, name, role, password, campId, projectId, employeeId } = req.body;
  if (!username || !name || !roles.includes(role) || !validPassword(password)) return res.status(400).json({ error: 'Нэр, эрх, 8+ тэмдэгттэй том/жижиг үсэг, тоо, тэмдэгт орсон нууц үг оруулна уу' });
  if (role === 'camp' && !await get('camps', campId)) return res.status(400).json({ error: 'Camp ахлахын camp-ийг сонгоно уу' });
  if (!await get('employees', employeeId)) return res.status(400).json({ error: 'Ажилтан сонгоно уу' });
  const chosenProject = role === 'admin' ? Number(projectId || currentProject()) : currentProject();
  try {
    const { rows } = await query('INSERT INTO public.users(username,name,role,password,camp_id,project_id,employee_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [username, name, role, hash(password), role === 'camp' ? Number(campId) : null, chosenProject, Number(employeeId)]);
    await audit(req, 'users', 'create', rows[0].id, { username, role, projectId: chosenProject, employeeId });
    res.json({ id: rows[0].id, username, name, role, campId, projectId: chosenProject, employeeId, active: true });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Энэ нэвтрэх нэр бүртгэлтэй байна' });
    throw error;
  }
});
app.patch('/api/users/:id', auth, admin, async (req, res) => {
  const user = (await query('SELECT * FROM public.users WHERE id=$1', [Number(req.params.id)])).rows[0];
  if (!user || (user.role !== 'admin' && Number(user.project_id) !== currentProject())) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
  const role = roles.includes(req.body.role) ? req.body.role : user.role;
  const campId = role === 'camp' ? Number(req.body.campId ?? user.camp_id) : null;
  if (role === 'camp' && !await get('camps', campId)) return res.status(400).json({ error: 'Camp ахлахын camp-ийг сонгоно уу' });
  const active = req.body.active === undefined ? user.active : Boolean(req.body.active);
  if (user.id === req.user.id && (!active || role !== 'admin')) return res.status(400).json({ error: 'Өөрийн админ эрхийг хаах боломжгүй' });
  if (user.id === req.user.id && req.body.password) return res.status(400).json({ error: 'Өөрийн нууц үгийг тусгай товчоор солино уу' });
  if (req.body.password && !validPassword(req.body.password)) return res.status(400).json({ error: 'Нууц үг 8+ тэмдэгт, том/жижиг үсэг, тоо, тусгай тэмдэгт агуулна' });
  const employeeId = Number(req.body.employeeId ?? user.employee_id);
  if (employeeId && !await get('employees', employeeId)) return res.status(400).json({ error: 'Ажилтан олдсонгүй' });
  await query('UPDATE public.users SET name=$1,role=$2,camp_id=$3,active=$4,password=$5,employee_id=$7 WHERE id=$6', [req.body.name || user.name, role, campId, active, req.body.password ? hash(req.body.password) : user.password, user.id, employeeId || null]);
  await audit(req, 'users', 'update', user.id, { role, active, employeeId });
  res.json({ ok: true });
});

app.post('/api/attendance/submit', auth, async (req, res) => {
  if (!await allowed(req, 'attendance', 'create')) return res.status(403).json({ error: 'Цаг бүртгэх эрхгүй' });
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
        if (old) await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE id=$2 AND project_id=$3', [JSON.stringify(value), old.id, currentProject()], db);
        else await insert('attendance', value, db);
      }
      await audit(req, 'attendance', 'submit', null, { count: values.length, date: values[0]?.date }, db);
    });
    res.json({ count: rows.length });
  } catch (error) { bad(res, error); }
});

function visibleRecords(type,user,rows,employees) {
  if(type==='other'&&user.role!=='admin')return [];
  if(type==='employees'&&user.role==='clerk') rows=rows.filter(row=>/засвар/i.test(String(row.branch||'')));
  if(user.role==='clerk'&&['assignments','machineLogs'].includes(type)){const repairIds=new Set(employees.filter(row=>/засвар/i.test(String(row.branch||''))).map(row=>row.id));rows=rows.filter(row=>repairIds.has(Number(row.employeeId)))}
  if(user.role==='camp'){
    const campId=Number(user.campId);
    const employeeCamp=new Map(employees.map(row=>[row.id,Number(row.campId)]));
    if(type==='employees')rows=rows.filter(row=>Number(row.campId)===campId);
    if(type==='attendance')rows=rows.filter(row=>employeeCamp.get(Number(row.employeeId))===campId);
    if(type==='assignments')rows=rows.filter(row=>Number(row.campId)===campId||employeeCamp.get(Number(row.employeeId))===campId);
    if(['mealMenus','mealFeedback','bedAssignments','campStays','guests'].includes(type))rows=rows.filter(row=>Number(row.campId)===campId);
    if(type==='camps')rows=rows.filter(row=>row.id===campId);
  }
  if(user.role!=='admin')rows=rows.map(row=>{
    const safe={...row};
    if(type==='employees'&&user.role!=='hr') ['register','civilId','phone','email','homeAddress','bankName','bankAccount','lookupAccount','baseSalary','socialSalary','birthDate','verificationNote'].forEach(key=>delete safe[key]);
    if(type==='equipment')['unitPriceMnt','currency','contractNo','contractCompany','sourceData','certificate','customsDocument','passport'].forEach(key=>delete safe[key]);
    if(type==='plans')delete safe.unitRevenue;
    if(type==='fuel')delete safe.pricePerLiter;
    return safe;
  });
  return rows;
}
const submissionSql='SELECT s.id,s.assignment_id,s.work_date::text AS work_date,s.status,s.actual_hours::float8 AS actual_hours,s.actual_fuel::float8 AS actual_fuel,s.actual_output::float8 AS actual_output,s.note,s.submitted_by,s.submitted_at,u.name AS "submittedByName" FROM public.submissions s JOIN public.users u ON u.id=s.submitted_by JOIN public.records r ON r.id=s.assignment_id WHERE r.project_id=$1 ORDER BY s.submitted_at DESC';
function visibleSubmissions(rows,user,assignments,employees){
  if(user.role==='clerk'){const repairIds=new Set(employees.filter(row=>/засвар/i.test(String(row.branch||''))).map(row=>row.id));const assignmentMap=new Map(assignments.map(row=>[row.id,row]));return rows.filter(row=>repairIds.has(Number(assignmentMap.get(row.assignment_id)?.employeeId)))}
  if(user.role!=='camp')return rows;
  const assignmentMap=new Map(assignments.map(row=>[row.id,row]));
  const employeeCamp=new Map(employees.map(row=>[row.id,Number(row.campId)]));
  return rows.filter(row=>{const task=assignmentMap.get(row.assignment_id);return task&&(Number(task.campId)===Number(user.campId)||employeeCamp.get(Number(task.employeeId))===Number(user.campId))});
}
app.get('/api/bootstrap',auth,async(req,res)=>{
  const [recordResult,submissionResult,userResult]=await Promise.all([
    query('SELECT id,type,body,created_at,updated_at FROM public.records WHERE type=ANY($1::text[]) AND project_id=$2 ORDER BY id DESC',[types,currentProject()]),
    query(submissionSql,[currentProject()]),
    req.user.role==='admin'?query('SELECT id,username,name,role,camp_id AS "campId",project_id AS "projectId",employee_id AS "employeeId",active FROM public.users WHERE project_id=$1 OR role=$2 ORDER BY id',[currentProject(),'admin']):Promise.resolve({rows:[]})
  ]);
  const grouped=Object.fromEntries(types.map(type=>[type,[]]));
  for(const row of recordResult.rows)grouped[row.type].push(rowRecord(row));
  const employees=grouped.employees,assignments=grouped.assignments;
  const permissionRows = (await query('SELECT permissions FROM public.role_permissions WHERE project_id=$1 AND role=$2', [currentProject(),req.user.role])).rows;
  const permissions = req.user.role==='admin' ? Object.fromEntries(types.map(type=>[type,['read','create','update','delete']])) : permissionRows[0]?.permissions || defaultPermissions[req.user.role] || {};
  const records=Object.fromEntries(types.map(type=>[type,permissions[type]?.includes('read')?visibleRecords(type,req.user,grouped[type],employees):[]]));
  res.json({records,submissions:visibleSubmissions(submissionResult.rows,req.user,assignments,employees),users:userResult.rows,permissions,projectId:currentProject()});
});
app.get('/api/records/:type',auth,async(req,res)=>{
  const type=req.params.type;
  if(!types.includes(type))return res.status(404).end();
  if (!await allowed(req,type,'read')) return res.status(403).json({ error: 'Харах эрхгүй' });
  const rows=await all(type);
  res.json(visibleRecords(type,req.user,rows,['camp','clerk'].includes(req.user.role)&&['attendance','assignments','machineLogs'].includes(type)?await all('employees'):[]));
});
app.post('/api/records/:type', auth, editor, async (req, res) => {
  const type = req.params.type;
  if (!types.includes(type)) return res.status(404).end();
  try {
    const value = await validate(type, req.body);
    if (!await canEditRecord(req, type, value)) return res.status(403).json({ error: 'Өөр camp-ийн ажилтны бүртгэл хийх эрхгүй' });
    if (type === 'plans') {
      const plan = await withTransaction(async db => { const created = await insert(type, value, db); await syncPlanAssignments(created.id, value, db); await audit(req,type,'create',created.id,{name:created.name},db); return created; });
      return res.json(plan);
    }
    if (type === 'shiftOverrides') {
      const created = await withTransaction(async db => { const record=await insert(type,value,db);const changed=await applyShiftOverride(record.id,value,db);await audit(req,type,'create',record.id,{changedAssignments:changed},db);return record; });
      return res.json(created);
    }
    const created = await insert(type, value);
    await audit(req,type,'create',created.id,{ sourceRow: created.sourceRow || null });
    res.json(created);
  } catch (error) { bad(res, error); }
});
app.put('/api/records/:type/:id', auth, editor, async (req, res) => {
  const { type, id } = req.params;
  if (!types.includes(type)) return res.status(404).end();
  const old = await get(type, id);
  if (!old) return res.status(404).json({ error: 'Бүртгэл олдсонгүй' });
  try {
    const value = await validate(type, type==='employees'&&req.user.role==='clerk'?{...old,...req.body}:req.body);
    if (type==='employees'&&req.user.role==='clerk') {
      const operational=['shiftGroup','rotationPattern','shiftStart','status','campId','notes'];
      const forbidden=Object.keys(value).filter(key=>!operational.includes(key)&&JSON.stringify(value[key])!==JSON.stringify(old[key]));
      if (forbidden.length) throw new Error('Клерк зөвхөн ээлж, төлөв, Camp болон тэмдэглэл засна');
    }
    if (type === 'mealFeedback' && req.user.role === 'hr' && Object.keys(value).some(key => !['approvedAllowance','hrStatus','hrNote'].includes(key) && JSON.stringify(value[key]) !== JSON.stringify(old[key]))) throw new Error('HR зөвхөн нэмэгдэл ба шийдвэр засна');
    if (!await canEditRecord(req, type, value) || !await canEditRecord(req, type, old)) return res.status(403).json({ error: 'Өөр camp-ийн бүртгэл засах эрхгүй' });
    await ensureUnique(type, value, id);
    if (type === 'shiftOverrides') {
      await withTransaction(async db => {await undoShiftOverride(id,db);await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE type=$2 AND id=$3 AND project_id=$4',[JSON.stringify(value),type,Number(id),currentProject()],db);const changed=await applyShiftOverride(id,value,db);await audit(req,type,'update',Number(id),{changedAssignments:changed,changes:changesBetween(old,value)},db)});
      return res.json(await get(type,id));
    }
    if (type === 'plans') await withTransaction(async db => {
      await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE type=$2 AND id=$3 AND project_id=$4', [JSON.stringify(value), type, Number(id), currentProject()], db);
      await syncPlanAssignments(id, value, db);
      await audit(req,type,'update',Number(id),{ changes:changesBetween(old,value) },db);
    });
    else {
      await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE type=$2 AND id=$3 AND project_id=$4', [JSON.stringify(value), type, Number(id), currentProject()]);
      await audit(req,type,'update',Number(id),{ changes:changesBetween(old,value) });
    }
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
          await query('DELETE FROM public.records WHERE type=$1 AND id=$2 AND project_id=$3', ['assignments', row.id, currentProject()], db);
        }
      }
      if (type === 'shiftOverrides') await undoShiftOverride(id,db);
      await query('DELETE FROM public.records WHERE type=$1 AND id=$2 AND project_id=$3', [type, Number(id), currentProject()], db);
      await audit(req,type,'delete',Number(id),{ deletedFields:Object.keys(old).filter(key=>!['createdAt','updatedAt'].includes(key)) },db);
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
    let batchId;
    await withTransaction(async db => {
      const machineIds=type==='machineLogs'?[...new Set(rows.map(row=>Number(row.equipmentId)).filter(Boolean))]:[];
      const beforeHours=Object.fromEntries(await Promise.all(machineIds.map(async id=>[id,Number((await get('equipment',id,db))?.currentHours||0)])));
      const attendanceKeys=type==='attendance'?new Set((await all('attendance',db)).map(row=>`${row.employeeId}:${row.date}`)):null;
      const batch = await query('INSERT INTO public.import_batches(project_id,type,filename,row_count,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id', [currentProject(),type,String(req.body.filename || '').slice(0,200),rows.length,req.user.id],db);
      batchId = batch.rows[0].id;
      for (const [index, row] of rows.entries()) {
        try {
          const value = await validate(type, row, db);
          if (!await canEditRecord(req, type, value, db)) throw new Error('Өөр camp-ийн ажилтан');
          if(attendanceKeys){const key=`${value.employeeId}:${value.date}`;if(attendanceKeys.has(key))throw new Error('Энэ ажилтны тухайн өдрийн цаг бүртгэл байна');attendanceKeys.add(key)}
          const record = attendanceKeys ? rowRecord((await query('INSERT INTO public.records(type,body,project_id,import_batch_id) VALUES($1,$2::jsonb,$3,$4) RETURNING id,body,created_at,updated_at',[type,JSON.stringify(value),currentProject(),batchId],db)).rows[0]) : await insert(type, value, db, batchId);
          if (type === 'plans') await syncPlanAssignments(record.id, value, db);
          if (type === 'shiftOverrides') await applyShiftOverride(record.id,value,db);
        } catch (error) { throw new Error(`${index + 2}-р мөр: ${error.message}`); }
      }
      if(type==='machineLogs'){
        const afterHours=Object.fromEntries(await Promise.all(machineIds.map(async id=>[id,Number((await get('equipment',id,db))?.currentHours||0)])));
        await query('UPDATE public.import_batches SET undo_snapshot=$1::jsonb WHERE id=$2',[JSON.stringify({beforeHours,afterHours}),batchId],db);
      }
      await audit(req,type,'import',null,{ batchId, count:rows.length, filename:String(req.body.filename || '').slice(0,200) },db);
    });
    res.json({ count: rows.length, batchId });
  } catch (error) { bad(res, error); }
});
app.post('/api/imports/:id/undo', auth, admin, async (req, res) => {
  try {
    const batch = (await query('SELECT * FROM public.import_batches WHERE id=$1 AND project_id=$2 AND undone_at IS NULL', [Number(req.params.id), currentProject()])).rows[0];
    if (!batch) return res.status(404).json({ error: 'Импорт олдсонгүй эсвэл буцаагдсан байна' });
    const count = await withTransaction(async db => {
      if(batch.type==='equipmentAllData'){
        const snapshot=batch.undo_snapshot||{};
        if(!Array.isArray(snapshot.updated)||!Array.isArray(snapshot.warehouseIds))throw new Error('ALL DATA импортын сэргээх мэдээлэл байхгүй');
        const records=(await query('SELECT id,type,body,import_batch_id AS "importBatchId",created_at AS "createdAt",updated_at AS "updatedAt" FROM public.records WHERE project_id=$1',[currentProject()],db)).rows;
        importUndoPlan('equipment',batch.id,records);
        for(const item of snapshot.updated){const current=await get('equipment',item.id,db);const {id,createdAt,updatedAt,...body}=current||{};if(!current||!isDeepStrictEqual(body,item.after))throw new Error('ALL DATA-аар шинэчилсэн техникийг дараа нь зассан тул буцаах боломжгүй')}
        for(const item of snapshot.updated)await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE id=$2 AND project_id=$3',[JSON.stringify(item.before),item.id,currentProject()],db);
        const deleted=await query('DELETE FROM public.records WHERE type=$1 AND import_batch_id=$2 AND project_id=$3',['equipment',batch.id,currentProject()],db);
        for(const id of snapshot.warehouseIds){const warehouse=(await query('SELECT id,created_at,updated_at FROM public.records WHERE type=$1 AND id=$2 AND project_id=$3',['warehouses',id,currentProject()],db)).rows[0];if(!warehouse||String(warehouse.created_at)!==String(warehouse.updated_at))throw new Error('ALL DATA-аар үүссэн агуулахыг зассан тул буцаах боломжгүй');const linked=(await query("SELECT id FROM public.records WHERE project_id=$1 AND body->>'warehouseId'=$2 LIMIT 1",[currentProject(),String(id)],db)).rows[0];if(linked)throw new Error('ALL DATA-аар үүссэн агуулахыг өөр бүртгэл ашиглаж байна');await query('DELETE FROM public.records WHERE id=$1 AND project_id=$2',[id,currentProject()],db)}
        await query('UPDATE public.import_batches SET undone_at=now() WHERE id=$1',[batch.id],db);
        await audit(req,'equipment','import_undo',null,{batchId:batch.id,deleted:deleted.rowCount,restored:snapshot.updated.length},db);
        return deleted.rowCount+snapshot.updated.length;
      }
      const snapshot=batch.undo_snapshot||{};
      if(batch.type==='machineLogs'){
        if(!snapshot.beforeHours||!snapshot.afterHours)throw new Error('Хуучин мото цагийн импортын суурь заалт хадгалагдаагүй тул автоматаар буцаах боломжгүй');
        for(const [id,hours] of Object.entries(snapshot.afterHours)){const machine=await get('equipment',id,db);if(!machine||Number(machine.currentHours||0)!==Number(hours))throw new Error('Импортын дараа техникийн мото цаг өөрчлөгдсөн тул буцаах боломжгүй')}
      }
      const records=(await query('SELECT id,type,body,import_batch_id AS "importBatchId",created_at AS "createdAt",updated_at AS "updatedAt" FROM public.records WHERE project_id=$1',[currentProject()],db)).rows;
      const plan=importUndoPlan(batch.type,batch.id,records);
      const taskIds=[...plan.imported,...plan.generated].filter(row=>row.type==='assignments').map(row=>row.id);
      if(taskIds.length&&(await query('SELECT id FROM public.submissions WHERE assignment_id=ANY($1::int[]) LIMIT 1',[taskIds],db)).rowCount)throw new Error('Илгээсэн ажлын гүйцэтгэлтэй импорт буцаах боломжгүй');
      if(batch.type==='employees'&&plan.imported.length){const ids=plan.imported.map(row=>row.id);if((await query('SELECT id FROM public.users WHERE employee_id=ANY($1::int[]) LIMIT 1',[ids],db)).rowCount||(await query('SELECT id FROM public.documents WHERE employee_id=ANY($1::int[]) LIMIT 1',[ids],db)).rowCount)throw new Error('Импортолсон ажилтанд хэрэглэгч эсвэл баримт үүссэн тул буцаах боломжгүй')}
      if(batch.type==='camps'&&plan.imported.length&&(await query('SELECT id FROM public.users WHERE camp_id=ANY($1::int[]) LIMIT 1',[plan.imported.map(row=>row.id)],db)).rowCount)throw new Error('Импортолсон camp-д хэрэглэгч оноосон тул буцаах боломжгүй');
      if(batch.type==='shiftOverrides')for(const row of plan.imported)await undoShiftOverride(row.id,db);
      if(plan.generated.length)await query('DELETE FROM public.records WHERE id=ANY($1::int[]) AND project_id=$2',[plan.generated.map(row=>row.id),currentProject()],db);
      const deleted = await query('DELETE FROM public.records WHERE import_batch_id=$1 AND project_id=$2 RETURNING id', [batch.id,currentProject()],db);
      if(batch.type==='machineLogs')for(const [id,hours] of Object.entries(snapshot.beforeHours)){const machine=await get('equipment',id,db);const remaining=(await all('machineLogs',db)).filter(row=>Number(row.equipmentId)===Number(id));const nextHours=Math.max(Number(hours),...remaining.map(row=>Number(row.endHours||0)));const {id:recordId,createdAt,updatedAt,...body}=machine;body.currentHours=nextHours;await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE id=$2 AND project_id=$3',[JSON.stringify(body),recordId,currentProject()],db)}
      await query('UPDATE public.import_batches SET undone_at=now() WHERE id=$1', [batch.id],db);
      await audit(req,batch.type,'import_undo',null,{batchId:batch.id,count:deleted.rowCount},db);
      return deleted.rowCount;
    });
    res.json({count});
  } catch (error) { bad(res,error); }
});
app.post('/api/equipment-all-data/import', auth, admin, async (req, res) => {
  try {
    const file = Buffer.from(String(req.body.fileBase64 || ''), 'base64');
    if (!file.length || file.length > 8_000_000) throw new Error('Excel файл 8 MB хүртэл хэмжээтэй байна');
    const { records, totalRows } = await parseAllData(file);
    if (!records.length) throw new Error('VIN-тэй техникийн мөр олдсонгүй');
    let added = 0, updated = 0;
    let batchId;
    await withTransaction(async db => {
      const batch=await query('INSERT INTO public.import_batches(project_id,type,filename,row_count,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[currentProject(),'equipmentAllData',String(req.body.filename||'ALL DATA.xlsx').slice(0,200),records.length,req.user.id],db);
      batchId=batch.rows[0].id;
      const existing = new Map((await all('equipment', db)).filter(row => row.vin).map(row => [String(row.vin).toUpperCase(), row]));
      const warehouses = await all('warehouses', db);
      const snapshot={updated:[],warehouseIds:[]};
      const seenVin=new Set();
      for (const record of records) {
        const vin=String(record.vin||'').toUpperCase();if(seenVin.has(vin))throw new Error(`ALL DATA-д VIN давхардсан: ${vin}`);seenVin.add(vin);
        if (record.availability === 'available') {
          const name = record.site || 'Байршил тодорхойгүй';
          let warehouse = warehouses.find(row => row.name === name);
          if (!warehouse) { warehouse = await insert('warehouses', { name, location: name, notes: 'ALL DATA sheet-ийн агуулахад бэлэн техникээс үүсэв' }, db); warehouses.push(warehouse); snapshot.warehouseIds.push(warehouse.id); }
          record.warehouseId = warehouse.id;
        }
        const value = await validate('equipment', record, db);
        const old = existing.get(String(record.vin).toUpperCase());
        if (old) {
          const {id,createdAt,updatedAt,...before}=old;
          const after={...value,fuelRate:old.fuelRate||value.fuelRate,notes:old.notes||value.notes};
          snapshot.updated.push({id:old.id,before,after});
          await query('UPDATE public.records SET body=$1::jsonb,updated_at=now() WHERE id=$2 AND project_id=$3', [JSON.stringify(after), old.id, currentProject()], db);
          updated++;
        } else { const created = await insert('equipment', value, db, batchId); existing.set(String(record.vin).toUpperCase(), created); added++; }
      }
      await query('UPDATE public.import_batches SET undo_snapshot=$1::jsonb WHERE id=$2',[JSON.stringify(snapshot),batchId],db);
      await audit(req,'equipment','import',null,{batchId,added,updated,totalRows},db);
    });
    res.json({ added, updated, totalRows, batchId });
  } catch (error) { bad(res, error); }
});

app.get('/api/submissions',auth,async(req,res)=>{
  const rows=(await query(submissionSql,[currentProject()])).rows;
  if(!['camp','clerk'].includes(req.user.role))return res.json(rows);
  res.json(visibleSubmissions(rows,req.user,await all('assignments'),await all('employees')));
});
app.post('/api/submissions', auth, async (req, res) => {
  if (!await allowed(req,'assignments','update')) return res.status(403).json({error:'Гүйцэтгэл илгээх эрхгүй'});
  const { assignmentId, status, actualHours, actualFuel, actualOutput, note } = req.body;
  const task = await get('assignments', assignmentId);
  if (!task) return res.status(404).json({ error: 'Даалгавар олдсонгүй' });
  if (req.user.role === 'camp' && Number(task.campId) !== Number(req.user.campId) && Number((await get('employees', task.employeeId))?.campId) !== Number(req.user.campId)) return res.status(403).json({ error: 'Өөр camp-ийн даалгавар илгээх эрхгүй' });
  if (req.user.role === 'clerk' && !await canEditRecord(req,'assignments',task)) return res.status(403).json({error:'Клерк зөвхөн засварын ажилтны ажлыг шалгана'});
  if (!['done','not_done'].includes(status)) return res.status(400).json({ error: 'Төлөв сонгоно уу' });
  const values = [actualHours, actualFuel, actualOutput].map(value => Number(value || 0));
  if (values.some(value => !Number.isFinite(value) || value < 0)) return res.status(400).json({ error: 'Бодит утга 0-ээс бага байж болохгүй' });
  await query(`INSERT INTO public.submissions(assignment_id,work_date,status,actual_hours,actual_fuel,actual_output,note,submitted_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(assignment_id,work_date) DO UPDATE SET status=EXCLUDED.status,actual_hours=EXCLUDED.actual_hours,actual_fuel=EXCLUDED.actual_fuel,actual_output=EXCLUDED.actual_output,note=EXCLUDED.note,submitted_by=EXCLUDED.submitted_by,submitted_at=now()`,
  [task.id, task.date, status, ...values, String(note || ''), req.user.id]);
  await audit(req,'assignments','submit',task.id,{status,actualHours:values[0],actualFuel:values[1],actualOutput:values[2]});
  res.json({ ok: true });
});
app.post('/api/submissions/batch', auth, async (req, res) => {
  if (!await allowed(req,'assignments','update')) return res.status(403).json({ error: 'Гүйцэтгэл илгээх эрхгүй' });
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
        if (req.user.role === 'clerk' && !await canEditRecord(req,'assignments',task,db)) throw new Error('Клерк зөвхөн засварын ажилтны ажлыг шалгана');
        if (!['done','not_done'].includes(row.status)) throw new Error('Ажил бүрт хийсэн эсэхийг сонгоно уу');
        const numbers = [row.actualHours,row.actualFuel,row.actualOutput].map(value => Number(value || 0));
        if (numbers.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Бодит утга 0-ээс бага байж болохгүй');
        await query(`INSERT INTO public.submissions(assignment_id,work_date,status,actual_hours,actual_fuel,actual_output,note,submitted_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(assignment_id,work_date) DO UPDATE SET status=EXCLUDED.status,actual_hours=EXCLUDED.actual_hours,actual_fuel=EXCLUDED.actual_fuel,actual_output=EXCLUDED.actual_output,note=EXCLUDED.note,submitted_by=EXCLUDED.submitted_by,submitted_at=now()`,
        [task.id,task.date,row.status,...numbers,String(row.note || ''),req.user.id],db);
        await audit(req,'assignments','submit',task.id,{status:row.status,actualHours:numbers[0],actualFuel:numbers[1],actualOutput:numbers[2]},db);
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
