import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseAllData } from './allData.js';
import { buildPlanSchedule, assertAssignable } from './planSchedule.js';
import { createEmployeePdf, documentKinds } from './pdfDocuments.js';
import { importUndoPlan } from './importUndo.js';
import { findDependentRecord } from './references.js';
import { normalizeMaintenance } from '../shared/maintenance.js';
import { validateProduction, productionSourceKey } from './production.js';
import { validateShiftHours } from '../shared/shiftHours.js';
import { validateFuelEntry } from '../shared/fuelEntry.js';
import { mergeEquipmentSource, normalizeVin, normalizePark } from '../shared/equipmentIdentity.js';

const app = express();
const projectContext = new AsyncLocalStorage();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
const dataDir = path.resolve('data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'mpc-hr.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, password TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, type TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS records_type ON records(type);
CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY, assignment_id INTEGER NOT NULL, work_date TEXT NOT NULL, status TEXT NOT NULL, actual_hours REAL NOT NULL DEFAULT 0, actual_fuel REAL NOT NULL DEFAULT 0, actual_output REAL NOT NULL DEFAULT 0, note TEXT, submitted_by INTEGER NOT NULL, submitted_at TEXT NOT NULL, UNIQUE(assignment_id,work_date));`);
if (!db.prepare('PRAGMA table_info(users)').all().some(row=>row.name==='camp_id')) db.exec('ALTER TABLE users ADD COLUMN camp_id INTEGER');
db.exec(`CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS role_permissions (project_id INTEGER NOT NULL, role TEXT NOT NULL, permissions TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(project_id,role));
CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, username TEXT NOT NULL, role TEXT NOT NULL, page TEXT NOT NULL, action TEXT NOT NULL, record_id INTEGER, details TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, employee_id INTEGER NOT NULL, kind TEXT NOT NULL, fields TEXT NOT NULL, approvers TEXT NOT NULL, pdf BLOB NOT NULL, created_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS import_batches (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, type TEXT NOT NULL, filename TEXT, row_count INTEGER NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, undone_at TEXT);`);
if (!db.prepare('PRAGMA table_info(import_batches)').all().some(row=>row.name==='undo_snapshot')) db.exec("ALTER TABLE import_batches ADD COLUMN undo_snapshot TEXT NOT NULL DEFAULT '{}'");
if (!db.prepare('PRAGMA table_info(users)').all().some(row=>row.name==='project_id')) db.exec('ALTER TABLE users ADD COLUMN project_id INTEGER');
if (!db.prepare('PRAGMA table_info(users)').all().some(row=>row.name==='employee_id')) db.exec('ALTER TABLE users ADD COLUMN employee_id INTEGER');
if (!db.prepare('PRAGMA table_info(records)').all().some(row=>row.name==='project_id')) db.exec('ALTER TABLE records ADD COLUMN project_id INTEGER');
if (!db.prepare('PRAGMA table_info(records)').all().some(row=>row.name==='import_batch_id')) db.exec('ALTER TABLE records ADD COLUMN import_batch_id INTEGER');
db.prepare('INSERT OR IGNORE INTO projects(name) VALUES(?)').run('Ууцар');
const defaultProjectId=db.prepare('SELECT id FROM projects WHERE name=?').get('Ууцар').id;
db.prepare('UPDATE users SET project_id=? WHERE project_id IS NULL').run(defaultProjectId);

import { roles, types, required, permitted } from './domain.js';
const clean = (type, body) => Object.fromEntries(permitted[type].filter(key => body[key] !== undefined && body[key] !== null).map(key => [key, typeof body[key] === 'string' ? body[key].trim() : body[key]]));
const currentProject=()=>projectContext.getStore()?.projectId || defaultProjectId;
const all = type => db.prepare('SELECT id, body, created_at, updated_at FROM records WHERE type=? AND project_id=? ORDER BY id DESC').all(type,currentProject()).map(r => ({ id:r.id, ...JSON.parse(r.body), createdAt:r.created_at, updatedAt:r.updated_at }));
const get = (type,id) => all(type).find(r => r.id === Number(id));
const hash = password => { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; };
const validPassword=value=>typeof value==='string'&&value.length>=8&&/\p{Lu}/u.test(value)&&/\p{Ll}/u.test(value)&&/\d/u.test(value)&&/[^\p{L}\p{N}]/u.test(value);
const verify = (password, stored) => { const [salt,digest]=stored.split(':'); const actual=scryptSync(password,salt,64); const expected=Buffer.from(digest,'hex'); return expected.length===actual.length && timingSafeEqual(expected,actual); };
const failedLogins=new Map();
if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) throw new Error('Анхны админ үүсгэхэд ADMIN_PASSWORD (12+ тэмдэгт) шаардлагатай');
  db.prepare('INSERT INTO users(username,name,role,password,project_id) VALUES(?,?,?,?,?)').run(process.env.ADMIN_USER || 'admin', 'Администратор', 'admin', hash(process.env.ADMIN_PASSWORD),defaultProjectId);
  console.log('Анхны админ хэрэглэгч үүсгэгдлээ.');
}

const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=')));
function auth(req,res,next) {
  const token=cookie(req).mpchr;
  const session=token && db.prepare('SELECT u.id,u.username,u.name,u.role,u.camp_id AS campId,u.project_id AS projectId,u.employee_id AS employeeId,u.active,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(token);
  if (!session || !session.active || session.expires_at<Date.now()) return res.status(401).json({ error:'Нэвтэрнэ үү' });
  req.user=session; next();
}
const admin = (req,res,next) => req.user.role==='admin' ? next() : res.status(403).json({error:'Зөвхөн админ эрхтэй'});
const defaultPermissions={dispatcher:{assignments:['read','update'],productionEntries:['read','create','update'],attendance:['read','create','update'],machineLogs:['read','create','update'],maintenance:['read'],equipment:['read'],employees:['read'],camps:['read'],campStays:['read'],guests:['read'],mealMenus:['read'],mealFeedback:['read'],bedAssignments:['read']},clerk:{maintenance:['read','create','update'],equipment:['read'],employees:['read','update'],assignments:['read','update']},camp:{attendance:['read','create','update'],employees:['read'],camps:['read'],assignments:['read','update'],campStays:['read','create','update'],guests:['read','create','update'],mealMenus:['read','create','update'],mealFeedback:['read','create','update'],bedAssignments:['read','create','update']},hr:{employees:['read','create','update'],attendance:['read','create','update'],assignments:['read'],equipment:['read'],camps:['read'],campStays:['read'],guests:['read'],maintenance:['read'],travelExpenses:['read','create','update'],shiftOverrides:['read','create','update'],documents:['read','create'],mealMenus:['read'],mealFeedback:['read','update'],bedAssignments:['read'],payrollEntries:['read','create','update','delete']}};
const permissionPages=[...types,'documents'];
const permissionsFor=user=>user.role==='admin'?Object.fromEntries(permissionPages.map(page=>[page,['read','create','update','delete']])):{...(defaultPermissions[user.role]||{}),...JSON.parse(db.prepare('SELECT permissions FROM role_permissions WHERE project_id=? AND role=?').get(currentProject(),user.role)?.permissions||'{}')};
const allowed=(req,page,action)=>Boolean(permissionsFor(req.user)[page]?.includes(action));
const editor=(req,res,next)=>allowed(req,req.params.type,req.method==='DELETE'?'delete':req.method==='PUT'||req.method==='PATCH'?'update':'create')?next():res.status(403).json({error:'Бүртгэх эрхгүй'});
function audit(req,page,action,recordId,details={}) {db.prepare('INSERT INTO audit_logs(project_id,user_id,username,role,page,action,record_id,details) VALUES(?,?,?,?,?,?,?,?)').run(currentProject(),req.user.id,req.user.username,req.user.role,page,action,recordId||null,JSON.stringify(details))}
const changesBetween=(before,after)=>Object.fromEntries(Object.keys(after).filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key])).map(key=>[key,{before:before[key]??null,after:after[key]??null}]));
app.use('/api',(req,res,next)=>{if(['/login','/health'].includes(req.path))return next();auth(req,res,()=>{const projectId=req.user.role==='admin'&&req.headers['x-project-id']?Number(req.headers['x-project-id']):Number(req.user.projectId);if(!db.prepare('SELECT id FROM projects WHERE id=? AND active=1').get(projectId))return res.status(403).json({error:'Төсөл сонгоно уу'});projectContext.run({projectId},next)})});
function validate(type, body) {
  const value=clean(type,body);
  const missing=required[type].filter(k => value[k]===undefined || value[k]==='');
  if (missing.length) throw new Error(`Заавал бөглөх талбар: ${missing.join(', ')}`);
  if(type==='fuel')validateFuelEntry(value,value.equipmentId?get('equipment',value.equipmentId):null);
  if (type==='employees' && !/^\S{2,}$/.test(String(value.register))) throw new Error('Регистрийн дугаар буруу байна');
  if(type==='employees'&&(['baseSalary','socialSalary','payrollPlannedDays'].some(key=>value[key]!==undefined&&(!Number.isFinite(Number(value[key]))||Number(value[key])<0))||value.insuredShare!==undefined&&(!Number.isFinite(Number(value.insuredShare))||Number(value.insuredShare)<0||Number(value.insuredShare)>1)))throw new Error('Ажилтны цалин, зохих хоног эсвэл НДШ тооцох хувь буруу байна');
  if(type==='payrollEntries') {if(!get('employees',value.employeeId)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value.month))||!['first','second'].includes(value.half))throw new Error('Цалингийн ажилтан эсвэл хугацаа буруу байна');if(['plannedHours','workedHours','travelDays','baseSalary','extraPay','otherDeduction'].some(key=>value[key]!==undefined&&(!Number.isFinite(Number(value[key]))||Number(value[key])<0))||['insuredShare','insuranceRate','taxRate'].some(key=>value[key]!==undefined&&(!Number.isFinite(Number(value[key]))||Number(value[key])<0||Number(value[key])>1)))throw new Error('Цалингийн тоо эсвэл хувь буруу байна');if(value.skipPayroll!==undefined&&typeof value.skipPayroll!=='boolean'||value.skipPayroll&&!['rest','terminated','discipline','other','unknown'].includes(value.skipReason))throw new Error('Цалин бодохгүй шалтгааныг сонгоно уу')}
  if (type==='attendance' && (!get('employees',value.employeeId)||!['day','night','travel','absent','rest','leave'].includes(value.status))) throw new Error('Ажилтан эсвэл төлөв буруу байна');
  if (type==='attendance'&&['day','night'].includes(value.status)&&all('shiftOverrides').some(row=>row.date===value.date&&Number(row.originalEmployeeId)===Number(value.employeeId))) throw new Error('Энэ өдөр өөр ажилтнаар орлуулсан тул ажилласан гэж бүртгэх боломжгүй');
  if (type==='equipment') {value.status ||= 'ready';value.availability ||= value.status==='ready'?'available':'inactive';const crew=['A','B','C','D'].map(group=>[group,value[`operator${group}Id`]]).filter(([,id])=>id);if(new Set(crew.map(([,id])=>Number(id))).size!==crew.length)throw new Error('Нэг операторыг хоёр ээлжид оноож болохгүй');for(const [group,id] of crew){const person=get('employees',id);if(!person||person.shiftGroup!==group)throw new Error(`${group} ээлжийн оператор тухайн бүлгийн ажилтан байх ёстой`)}}
  if (type==='plans') buildPlanSchedule(value,all('employees'),all('equipment'),all('attendance'),all('shiftOverrides'));
  if (type==='productionEntries') validateProduction(value);
  if (type==='assignments' && !value.employeeId && !value.equipmentId) throw new Error('Ажилтан эсвэл техник сонгоно уу');
  if (type==='assignments' && value.employeeId && !get('employees',value.employeeId)) throw new Error('Ажилтан олдсонгүй');
  if (type==='assignments'&&value.employeeId) assertAssignable(get('employees',value.employeeId),value.date,value.shift,all('attendance'),all('shiftOverrides'));
  if (type==='assignments' && value.equipmentId && !get('equipment',value.equipmentId)) throw new Error('Техник олдсонгүй');
  if (type==='assignments' && value.planId && !get('plans',value.planId)) throw new Error('Төлөвлөгөө олдсонгүй');
  if (type==='machineLogs' && (value.employeeId&&!get('employees',value.employeeId) || !get('equipment',value.equipmentId))) throw new Error('Оператор эсвэл техник олдсонгүй');
  if (type==='machineLogs'&&!['day','night'].includes(value.workShift)) throw new Error('Өдөр/шөнийн ээлж сонгоно уу');
  if (type==='machineLogs'&&value.shiftGroup&&!['A','B','C','D'].includes(value.shiftGroup)) throw new Error('A/B/C/D ээлж буруу байна');
  if (type==='machineLogs'&&value.employeeId&&!value.shiftGroup) throw new Error('Операторын A/B/C/D ээлжийг сонгоно уу');
  if (type==='machineLogs'&&value.employeeId&&get('employees',value.employeeId)?.shiftGroup!==value.shiftGroup) throw new Error('Операторын A/B/C/D ээлж ажилтны бүртгэлтэй таарахгүй байна');
  if (type==='machineLogs' && (Number(value.endHours)<Number(value.startHours) || Number(value.startHours)<0)) throw new Error('Төгсгөлийн мото цаг эхлэлээс бага байж болохгүй');
  if (type==='machineLogs') validateShiftHours(value);
  if (type==='machineLogs' && value.endKm!==undefined && Number(value.endKm)<Number(value.startKm || 0)) throw new Error('Төгсгөлийн км эхлэлээс бага байж болохгүй');
  if (['travelExpenses','campStays','mealFeedback','bedAssignments'].includes(type)&&value.employeeId&&!get('employees',value.employeeId)) throw new Error('Ажилтан олдсонгүй');
  if (type==='campStays') {
    if(!get('camps',value.campId)) throw new Error('Camp сонгоно уу');
    if(!['employee','guest','rental'].includes(value.category)||!Number.isInteger(Number(value.count))||Number(value.count)<1) throw new Error('Хоногийн ангилал эсвэл хүний тоо буруу байна');
    if(value.category==='employee'&&(!value.employeeId||Number(value.count)!==1)) throw new Error('Үндсэн ажилтныг нэг бүрчлэн сонгоно уу');
    if(value.category==='guest'&&(!value.guestId||Number(value.count)!==1||!get('guests',value.guestId))) throw new Error('Зочныг зочдын бүртгэлээс сонгоно уу');
    if(value.category==='employee'&&Number(get('employees',value.employeeId)?.campId)!==Number(value.campId)) throw new Error('Ажилтан сонгосон Camp-д харьяалагдахгүй байна');
    if(value.category==='guest'&&Number(get('guests',value.guestId)?.campId)!==Number(value.campId)) throw new Error('Зочин сонгосон Camp-д харьяалагдахгүй байна');
    if(value.category==='rental'&&(value.employeeId||value.guestId)) throw new Error('Түрээсийн ажилтныг хүний тоогоор бүртгэнэ');
    if(['breakfast','lunch','dinner','mealRate','lodgingRate'].some(key=>!Number.isFinite(Number(value[key]||0))||Number(value[key]||0)<0)) throw new Error('Хоол, хоногийн тоо болон үнэ 0-ээс бага байж болохгүй');
  }
  if (['mealMenus','mealFeedback','bedAssignments'].includes(type)&&!get('camps',value.campId)) throw new Error('Camp сонгоно уу');
  if (type==='mealFeedback'&&Number(get('employees',value.employeeId)?.campId)!==Number(value.campId)) throw new Error('Ажилтан сонгосон Camp-д харьяалагдахгүй байна');
  if (type==='bedAssignments'&&value.endDate&&value.endDate<value.startDate) throw new Error('Дуусах өдөр эхлэх өдрөөс өмнө байж болохгүй');
  if (type==='maintenance'&&!get('equipment',value.equipmentId)) throw new Error('Техник олдсонгүй');
  if (type==='maintenance') normalizeMaintenance(value);
  if (type==='shiftOverrides'&&(!get('employees',value.replacementEmployeeId)||value.originalEmployeeId&&!get('employees',value.originalEmployeeId)||Number(value.originalEmployeeId)===Number(value.replacementEmployeeId))) throw new Error('Ээлжийн ажилтан буруу байна');
  if (type==='mealFeedback'&&value.approvedAllowance!==undefined&&(!Number.isFinite(Number(value.approvedAllowance))||Number(value.approvedAllowance)<0)) throw new Error('Баталсан нэмэгдлийн дүн буруу байна');
  if (type==='mealFeedback'&&value.hrStatus&&!['pending','approved','rejected'].includes(value.hrStatus)) throw new Error('HR шийдвэр буруу байна');
  if (type==='mealFeedback'&&value.hrStatus==='approved'&&value.approvedAllowance===undefined) throw new Error('Баталсан нэмэгдлийн дүн оруулна уу');
  if (type==='mealMenus'&&!['breakfast','lunch','dinner'].includes(value.mealType)) throw new Error('Хоолны төрөл буруу байна');
  return value;
}
function ensureUnique(type,value,excludeId) {
  if(type==='machineLogs'&&all(type).some(row=>row.id!==Number(excludeId)&&row.date===value.date&&row.workShift===value.workShift&&Number(row.equipmentId)===Number(value.equipmentId)))throw new Error('Энэ техникийн тухайн ээлжийн бүртгэл аль хэдийн байна');
  if (type==='productionEntries'&&productionSourceKey(value)&&all(type).some(row=>row.id!==Number(excludeId)&&productionSourceKey(row)===productionSourceKey(value))) throw new Error('Энэ Excel мөр өмнө импортлогдсон байна. Эхлээд импортын түүхээс буцаана уу');
  if (type==='employees' && all(type).some(row=>row.id!==Number(excludeId)&&row.register===value.register)) throw new Error('Энэ регистрийн дугаартай ажилтан бүртгэлтэй байна');
  if(type==='payrollEntries'&&all(type).some(row=>row.id!==Number(excludeId)&&Number(row.employeeId)===Number(value.employeeId)&&row.month===value.month&&row.half===value.half))throw new Error('Энэ ажилтны цалингийн хугацааны тохируулга бүртгэлтэй байна');
  if (type==='attendance' && all(type).some(row=>row.id!==Number(excludeId)&&row.date===value.date&&Number(row.employeeId)===Number(value.employeeId))) throw new Error('Энэ ажилтны тухайн өдрийн цаг бүртгэл байна');
  if (type==='equipment' && all(type).some(row=>row.id!==Number(excludeId)&&(value.vin&&row.vin===value.vin||!value.vin&&row.parkNo===value.parkNo))) throw new Error('Энэ VIN эсвэл парк дугаартай техник бүртгэлтэй байна');
  if (type==='campStays'&&all(type).some(row=>row.id!==Number(excludeId)&&row.date===value.date&&(value.employeeId&&Number(row.employeeId)===Number(value.employeeId)||value.guestId&&Number(row.guestId)===Number(value.guestId)))) throw new Error('Энэ хүн тухайн өдөр camp-д бүртгэлтэй байна');
  if (type==='assignments' && all(type).some(row=>row.id!==Number(excludeId)&&row.date===value.date&&(value.employeeId&&Number(row.employeeId)===Number(value.employeeId)||row.shift===value.shift&&value.equipmentId&&Number(row.equipmentId)===Number(value.equipmentId)))) throw new Error('Ажилтан энэ өдөрт эсвэл техник энэ ээлжид өөр ажилд оноогдсон байна');
  if (type==='bedAssignments'&&all(type).some(row=>row.id!==Number(excludeId)&&Number(row.employeeId)===Number(value.employeeId)&&String(row.startDate)<=String(value.endDate||'9999-12-31')&&String(value.startDate)<=String(row.endDate||'9999-12-31'))) throw new Error('Ажилтан тухайн хугацаанд өөр оронд бүртгэлтэй байна');
  if (type==='bedAssignments'&&value.building&&value.room&&value.bed&&all(type).some(row=>row.id!==Number(excludeId)&&Number(row.campId)===Number(value.campId)&&row.building===value.building&&row.room===value.room&&row.bed===value.bed&&String(row.startDate)<=String(value.endDate||'9999-12-31')&&String(value.startDate)<=String(row.endDate||'9999-12-31'))) throw new Error('Энэ ор тухайн хугацаанд эзэнтэй байна');
}
function canEditRecord(req,type,value) {
  if (req.user.role==='admin') return true;
  if (type==='employees'&&req.user.role==='clerk') return /засвар/i.test(String(value.branch||''));
  if (req.user.role==='clerk'&&['assignments','machineLogs'].includes(type)) return /засвар/i.test(String(get('employees',value.employeeId)?.branch||''));
  if (type==='mealFeedback'&&req.user.role==='camp'&&(value.approvedAllowance!==undefined||value.hrStatus!==undefined||value.hrNote!==undefined)) return false;
  if (req.user.role==='camp'&&['attendance','campStays','mealFeedback','bedAssignments'].includes(type)&&value.employeeId&&Number(get('employees',value.employeeId)?.campId)!==Number(req.user.campId)) return false;
  if (req.user.role==='camp'&&['mealMenus','mealFeedback','bedAssignments','campStays','guests'].includes(type)&&Number(value.campId)!==Number(req.user.campId)) return false;
  if (req.user.role==='camp'&&value.campId) return Number(value.campId)===Number(req.user.campId);
  return true;
}
function insert(type,value) {
  ensureUnique(type,value);
  const now=new Date().toISOString();
  const result=db.prepare('INSERT INTO records(type,body,created_at,updated_at,project_id) VALUES(?,?,?,?,?)').run(type,JSON.stringify(value),now,now,currentProject());
  if (type==='machineLogs') updateEquipmentHours(value);
  return get(type,result.lastInsertRowid);
}
function syncPlanAssignments(planId,plan) {
  const assignments=all('assignments');
  const previous=assignments.filter(row=>Number(row.autoPlanId)===Number(planId));
  const next=buildPlanSchedule(plan,all('employees'),all('equipment'),all('attendance'),all('shiftOverrides'));
  const other=assignments.filter(row=>Number(row.autoPlanId)!==Number(planId));
  for(const row of next){const conflict=other.find(item=>item.date===row.date&&(row.employeeId&&Number(item.employeeId)===Number(row.employeeId)||item.shift===row.shift&&row.equipmentId&&Number(item.equipmentId)===Number(row.equipmentId)));if(conflict)throw new Error(`${row.date}-ны ажилтан эсвэл техник өөр ажилд оноогдсон байна`)}
  if (previous.some(row=>row.shiftOverrideId)) throw new Error('Ээлж солигдсон төлөвлөгөөг эхлээд ээлжийн өөрчлөлтөөс чөлөөлнө үү');
  if (previous.some(row=>db.prepare('SELECT id FROM submissions WHERE assignment_id=?').get(row.id))) throw new Error('Гүйцэтгэл илгээгдсэн төлөвлөгөөний хуваарийг өөрчлөх боломжгүй');
  for (const row of previous) db.prepare('DELETE FROM records WHERE type=? AND id=? AND project_id=?').run('assignments',row.id,currentProject());
  for (const row of next) {
    insert('assignments',{...row,planId,autoPlanId:planId});
  }
}
function applyShiftOverride(overrideId,value) {
  const replacement=get('employees',value.replacementEmployeeId);
  const attendance=all('attendance');
  if(value.originalEmployeeId&&attendance.some(row=>row.date===value.date&&Number(row.employeeId)===Number(value.originalEmployeeId)&&['day','night'].includes(row.status)))throw new Error('Солигдох ажилтны ирцийг эхлээд ажиллаагүй/чөлөөтэй болгож засна уу');
  const assignments=all('assignments');
  const targets=assignments.filter(row=>row.date===value.date&&Number(row.employeeId)===Number(value.originalEmployeeId)&&(!value.shift||row.shift===value.shift));
  for(const target of targets){
    if(assignments.some(row=>row.id!==target.id&&row.date===target.date&&Number(row.employeeId)===Number(replacement.id)))throw new Error('Орлон ажиллах ажилтан тухайн өдөр өөр ажилд оноогдсон байна');
    if(db.prepare('SELECT id FROM submissions WHERE assignment_id=?').get(target.id))throw new Error('Гүйцэтгэл илгээгдсэн ажлын ээлжийг солих боломжгүй');
    const {id,createdAt,updatedAt,...body}=target;
    body.originalEmployeeId=Number(value.originalEmployeeId);body.employeeId=replacement.id;body.campId=replacement.campId||body.campId;body.shiftOverrideId=Number(overrideId);
    db.prepare('UPDATE records SET body=?,updated_at=? WHERE id=? AND project_id=?').run(JSON.stringify(body),new Date().toISOString(),target.id,currentProject());
  }
  return targets.length;
}
function undoShiftOverride(overrideId){
  const assignments=all('assignments').filter(row=>Number(row.shiftOverrideId)===Number(overrideId));
  for(const target of assignments){
    if(db.prepare('SELECT id FROM submissions WHERE assignment_id=?').get(target.id))throw new Error('Гүйцэтгэл илгээгдсэн ээлжийн өөрчлөлтийг буцаах боломжгүй');
    const original=get('employees',target.originalEmployeeId);
    const {id,createdAt,updatedAt,originalEmployeeId,shiftOverrideId,...body}=target;
    body.employeeId=originalEmployeeId;body.campId=original?.campId||body.campId;
    db.prepare('UPDATE records SET body=?,updated_at=? WHERE id=? AND project_id=?').run(JSON.stringify(body),new Date().toISOString(),target.id,currentProject());
  }
}
function updateEquipmentHours(log) {
  const equipment=get('equipment',log.equipmentId);
  if (!equipment || Number(log.endHours)<=Number(equipment.currentHours || 0)) return;
  const {id,createdAt,updatedAt,...body}=equipment;
  body.currentHours=Number(log.endHours);
  db.prepare('UPDATE records SET body=?,updated_at=? WHERE id=? AND project_id=?').run(JSON.stringify(body),new Date().toISOString(),id,currentProject());
}
app.post('/api/login',(req,res) => {
  const {username,password}=req.body || {};
  const key=`${req.ip}:${String(username || '')}`;
  const attempts=failedLogins.get(key);
  if (attempts && attempts.until>Date.now() && attempts.count>=10) return res.status(429).json({error:'Олон удаа буруу оролдлоо. Түр хүлээнэ үү'});
  const user=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username || ''));
  if (!user || !verify(String(password || ''),user.password)) {failedLogins.set(key,{count:(attempts?.until>Date.now()?attempts.count:0)+1,until:Date.now()+15*60_000});return res.status(401).json({error:'Нэвтрэх нэр эсвэл нууц үг буруу байна'});}
  failedLogins.delete(key);
  const token=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token,user.id,Date.now()+7*86400000);
  res.cookie('mpchr',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:7*86400000,path:'/'});
  res.json({id:user.id,username:user.username,name:user.name,role:user.role,campId:user.camp_id,projectId:user.project_id,employeeId:user.employee_id});
});
app.post('/api/logout',auth,(req,res) => { db.prepare('DELETE FROM sessions WHERE token=?').run(cookie(req).mpchr); res.clearCookie('mpchr',{path:'/'}); res.json({ok:true}); });
app.get('/api/me',auth,(req,res) => res.json({id:req.user.id,username:req.user.username,name:req.user.name,role:req.user.role,campId:req.user.campId,projectId:req.user.projectId,employeeId:req.user.employeeId}));
app.patch('/api/me/password',auth,(req,res) => {
  const currentPassword=String(req.body?.currentPassword || '');
  const newPassword=String(req.body?.newPassword || '');
  if (!validPassword(newPassword)) return res.status(400).json({error:'Нууц үг 8+ тэмдэгт, том/жижиг үсэг, тоо, тусгай тэмдэгт агуулна'});
  const user=db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
  if (!user || !verify(currentPassword,user.password)) return res.status(400).json({error:'Одоогийн нууц үг буруу байна'});
  if (currentPassword===newPassword) return res.status(400).json({error:'Шинэ нууц үг өмнөхөөс өөр байна'});
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash(newPassword),req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(req.user.id,cookie(req).mpchr);
  res.json({ok:true});
});
app.get('/api/projects',auth,admin,(_req,res)=>res.json(db.prepare('SELECT id,name,active FROM projects ORDER BY id').all()));
app.post('/api/projects',auth,admin,(req,res)=>{const name=String(req.body?.name||'').trim();if(name.length<2||name.length>100)return res.status(400).json({error:'Төслийн нэр 2–100 тэмдэгт байна'});try{const id=db.prepare('INSERT INTO projects(name) VALUES(?)').run(name).lastInsertRowid;audit(req,'projects','create',id,{name});res.json({id,name,active:1})}catch{res.status(409).json({error:'Ийм нэртэй төсөл байна'})}});
app.get('/api/permissions',auth,(req,res)=>{if(req.user.role==='admin'){const stored=db.prepare('SELECT role,permissions FROM role_permissions WHERE project_id=?').all(currentProject());return res.json(Object.fromEntries(roles.map(role=>[role,{...(defaultPermissions[role]||{}),...JSON.parse(stored.find(row=>row.role===role)?.permissions||'{}')}])))}res.json({[req.user.role]:permissionsFor(req.user)})});
app.put('/api/permissions/:role',auth,admin,(req,res)=>{const role=req.params.role,input=req.body?.permissions;if(!roles.includes(role)||role==='admin'||!input||typeof input!=='object'||Array.isArray(input))return res.status(400).json({error:'Эрхийн тохиргоо буруу байна'});const actions=['read','create','update','delete'];const permissions=Object.fromEntries(Object.entries(input).filter(([page])=>permissionPages.includes(page)).map(([page,list])=>[page,Array.isArray(list)?list.filter(action=>actions.includes(action)):[]]));db.prepare('INSERT INTO role_permissions(project_id,role,permissions) VALUES(?,?,?) ON CONFLICT(project_id,role) DO UPDATE SET permissions=excluded.permissions,updated_at=CURRENT_TIMESTAMP').run(currentProject(),role,JSON.stringify(permissions));audit(req,'permissions','update',null,{role,permissions});res.json({role,permissions})});
app.get('/api/audit',auth,admin,(req,res)=>{const role=String(req.query.role||''),page=String(req.query.page||'');res.json(db.prepare(`SELECT id,username,role,page,action,record_id AS recordId,details,created_at AS createdAt FROM audit_logs WHERE project_id=? AND (?='' OR role=?) AND (?='' OR page=?) ORDER BY id DESC LIMIT 1000`).all(currentProject(),role,role,page,page).map(row=>({...row,details:JSON.parse(row.details)})))});
app.get('/api/imports',auth,admin,(_req,res)=>res.json(db.prepare('SELECT id,type,filename,row_count AS rowCount,created_at AS createdAt,undone_at AS undoneAt FROM import_batches WHERE project_id=? ORDER BY id DESC LIMIT 200').all(currentProject())));
const documentEditor=(req,res,next)=>allowed(req,'documents',req.method==='GET'?'read':req.method==='DELETE'?'delete':'create')?next():res.status(403).json({error:'HR баримтын энэ үйлдэлд эрхгүй'});
const documentFields=['date','companyName','companyAddress','companyPhone','companyEmail','contractType','orderNumber','city','legalBasis','effectiveDate','trialMonths','salaryAmount','executiveName','preparedBy','reviewedBy','initiator','reason','location','startDate','endDate','approvalDecision','payMode','payCondition','purpose'];
app.get('/api/documents',auth,documentEditor,(_req,res)=>res.json(db.prepare('SELECT id,employee_id AS employeeId,kind,fields,approvers,created_at AS createdAt FROM documents WHERE project_id=? ORDER BY id DESC LIMIT 200').all(currentProject()).map(row=>({...row,fields:JSON.parse(row.fields),approvers:JSON.parse(row.approvers)}))));
app.post('/api/documents',auth,documentEditor,async(req,res)=>{try{
  const employee=get('employees',req.body?.employeeId),kind=String(req.body?.kind||'');
  if(!employee||!documentKinds[kind])return res.status(400).json({error:'Ажилтан эсвэл баримтын төрөл буруу байна'});
  const fields=Object.fromEntries(documentFields.map(key=>[key,String(req.body?.fields?.[key]??'').trim().slice(0,500)]).filter(([,value])=>value));
  if(fields.trialMonths&&(!/^\d+$/.test(fields.trialMonths)||Number(fields.trialMonths)>12))return res.status(400).json({error:'Туршилтын хугацаа 0–12 сар байна'});
  if(fields.salaryAmount&&(!/^\d+(\.\d{1,2})?$/.test(fields.salaryAmount)||Number(fields.salaryAmount)<=0))return res.status(400).json({error:'Үндсэн цалингийн дүн буруу байна'});
  if(fields.approvalDecision&&!['approved','rejected'].includes(fields.approvalDecision)||fields.payMode&&!['paid_1_5','unpaid'].includes(fields.payMode))return res.status(400).json({error:'Сунаж ажиллах хуудасны сонголт буруу байна'});
  const ids=Array.isArray(req.body?.approverIds)?req.body.approverIds.slice(0,8):[];
  const approvers=ids.map(id=>{const person=get('employees',id);if(!person)throw new Error('Батлах ажилтан энэ төсөлд байхгүй');return {employeeId:person.id,position:person.position||'',name:`${person.lastName||''} ${person.firstName||''}`.trim()}});
  if(kind==='termination'&&!fields.legalBasis)return res.status(400).json({error:'Ажлаас чөлөөлөх тушаалын хуулийн үндэслэлийг оруулна уу'});
  const pdf=await createEmployeePdf({kind,employee,fields:{...fields,projectName:db.prepare('SELECT name FROM projects WHERE id=?').get(currentProject())?.name},approvers});
  const result=db.prepare('INSERT INTO documents(project_id,employee_id,kind,fields,approvers,pdf,created_by) VALUES(?,?,?,?,?,?,?)').run(currentProject(),employee.id,kind,JSON.stringify(fields),JSON.stringify(approvers),pdf,req.user.id);
  audit(req,'documents','create',result.lastInsertRowid,{employeeId:employee.id,kind,fields,approvers});res.json({id:result.lastInsertRowid,employeeId:employee.id,kind,fields,approvers,createdAt:new Date().toISOString()});
}catch(error){res.status(400).json({error:error.message})}});
app.get('/api/documents/:id/pdf',auth,documentEditor,(req,res)=>{const row=db.prepare('SELECT kind,pdf FROM documents WHERE id=? AND project_id=?').get(Number(req.params.id),currentProject());if(!row)return res.status(404).json({error:'Баримт олдсонгүй'});res.set({'Content-Type':'application/pdf','Content-Disposition':`inline; filename="hr-${row.kind}-${req.params.id}.pdf"`,'Cache-Control':'private, no-store'}).send(row.pdf)});
app.delete('/api/documents/:id',auth,admin,(req,res)=>{const row=db.prepare('SELECT id,employee_id,kind FROM documents WHERE id=? AND project_id=?').get(Number(req.params.id),currentProject());if(!row)return res.status(404).json({error:'Баримт олдсонгүй'});db.prepare('DELETE FROM documents WHERE id=?').run(row.id);audit(req,'documents','delete',row.id,{employeeId:row.employee_id,kind:row.kind});res.json({ok:true})});
app.get('/api/users',auth,admin,(_req,res) => res.json(db.prepare('SELECT id,username,name,role,camp_id AS campId,project_id AS projectId,employee_id AS employeeId,active FROM users WHERE project_id=? OR role=? ORDER BY id').all(currentProject(),'admin')));
app.post('/api/users',auth,admin,(req,res) => {
  const {username,name,role,password,campId,employeeId}=req.body;
  if (!username || !name || !roles.includes(role) || !validPassword(password)) return res.status(400).json({error:'Нэр, эрх, 8+ тэмдэгттэй том/жижиг үсэг, тоо, тэмдэгт орсон нууц үг оруулна уу'});
  if (role==='camp'&&!get('camps',campId)) return res.status(400).json({error:'Camp ахлахын camp-ийг сонгоно уу'});
  if (!get('employees',employeeId)) return res.status(400).json({error:'Ажилтан сонгоно уу'});
  try { const result=db.prepare('INSERT INTO users(username,name,role,password,camp_id,project_id,employee_id) VALUES(?,?,?,?,?,?,?)').run(username,name,role,hash(password),role==='camp'?Number(campId):null,currentProject(),Number(employeeId));audit(req,'users','create',result.lastInsertRowid,{username,role,employeeId});res.json({id:result.lastInsertRowid,username,name,role,campId,projectId:currentProject(),employeeId,active:1}); }
  catch { res.status(409).json({error:'Энэ нэвтрэх нэр бүртгэлтэй байна'}); }
});
app.patch('/api/users/:id',auth,admin,(req,res) => {
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
  if (!user) return res.status(404).json({error:'Хэрэглэгч олдсонгүй'});
  const role=roles.includes(req.body.role) ? req.body.role : user.role;
  const campId=role==='camp' ? Number(req.body.campId ?? user.camp_id) : null;
  if (role==='camp'&&!get('camps',campId)) return res.status(400).json({error:'Camp ахлахын camp-ийг сонгоно уу'});
  const active=req.body.active===undefined ? user.active : Number(Boolean(req.body.active));
  if (user.id===req.user.id && (!active || role!=='admin')) return res.status(400).json({error:'Өөрийн админ эрхийг хаах боломжгүй'});
  if (user.id===req.user.id && req.body.password) return res.status(400).json({error:'Өөрийн нууц үгийг тусгай товчоор солино уу'});
  if(req.body.password&&!validPassword(req.body.password))return res.status(400).json({error:'Нууц үг 8+ тэмдэгт, том/жижиг үсэг, тоо, тусгай тэмдэгт агуулна'});
  const employeeId=Number(req.body.employeeId??user.employee_id);
  if(employeeId&&!get('employees',employeeId))return res.status(400).json({error:'Ажилтан олдсонгүй'});
  db.prepare('UPDATE users SET name=?,role=?,camp_id=?,active=?,password=?,employee_id=? WHERE id=?').run(req.body.name || user.name,role,campId,active,req.body.password ? hash(req.body.password) : user.password,employeeId||null,user.id);
  audit(req,'users','update',user.id,{role,active,employeeId});
  res.json({ok:true});
});
app.post('/api/attendance/submit',auth,(req,res) => {
  if (!allowed(req,'attendance','create')) return res.status(403).json({error:'Цаг бүртгэх эрхгүй'});
  const rows=req.body.rows;
  if (!Array.isArray(rows)||!rows.length||rows.length>500) return res.status(400).json({error:'1–500 ажилтан сонгоно уу'});
  try {
    const values=rows.map((row,index)=>{
      try {
        const value=validate('attendance',row);
        const employee=get('employees',value.employeeId);
        value.campId=employee.campId;
        if (!canEditRecord(req,'attendance',value)) throw new Error('Өөр camp-ийн ажилтан');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error('Өдөр буруу байна');
        value.actualHours=['day','night'].includes(value.status)?Number(value.actualHours||0):0;
        if (!Number.isFinite(value.actualHours)||value.actualHours<0||value.actualHours>24) throw new Error('Ажилласан цаг 0–24 байна');
        return value;
      } catch(err) {throw new Error(`${index+1}-р ажилтан: ${err.message}`);}
    });
    if (new Set(values.map(value=>`${value.employeeId}:${value.date}`)).size!==values.length) throw new Error('Нэг ажилтан нэг өдөрт давхар орсон байна');
    db.exec('BEGIN');
    try {
      for(const value of values) {
        const old=all('attendance').find(row=>row.date===value.date&&Number(row.employeeId)===Number(value.employeeId));
        if(old) db.prepare('UPDATE records SET body=?,updated_at=? WHERE id=? AND project_id=?').run(JSON.stringify(value),new Date().toISOString(),old.id,currentProject());
        else insert('attendance',value);
      }
      db.exec('COMMIT');
    } catch(err) {db.exec('ROLLBACK');throw err;}
    audit(req,'attendance','submit',null,{count:values.length,date:values[0]?.date});
    res.json({count:values.length});
  } catch(err) {res.status(400).json({error:err.message});}
});
function visibleRecords(type,user,rows,employees) {
  if(type==='other'&&user.role!=='admin')return [];
  if(type==='employees'&&user.role==='clerk')rows=rows.filter(row=>/засвар/i.test(String(row.branch||'')));
  if(user.role==='clerk'&&['assignments','machineLogs'].includes(type)){const repairIds=new Set(employees.filter(row=>/засвар/i.test(String(row.branch||''))).map(row=>row.id));rows=rows.filter(row=>repairIds.has(Number(row.employeeId)))}
  if(user.role==='camp'){
    const campId=Number(user.campId);
    if(type==='employees')rows=rows.filter(row=>Number(row.campId)===campId);
    if(type==='attendance')rows=rows.filter(row=>Number(employees.find(e=>e.id===Number(row.employeeId))?.campId)===campId);
    if(type==='camps')rows=rows.filter(row=>row.id===campId);
    if(type==='assignments')rows=rows.filter(row=>Number(row.campId)===campId||Number(employees.find(e=>e.id===Number(row.employeeId))?.campId)===campId);
    if(['mealMenus','mealFeedback','bedAssignments','campStays','guests'].includes(type))rows=rows.filter(row=>Number(row.campId)===campId);
  }
  if(user.role!=='admin')rows=rows.map(row=>{
    const safe={...row};
    if(type==='employees'&&user.role!=='hr')['register','civilId','phone','email','homeAddress','bankName','bankAccount','lookupAccount','baseSalary','socialSalary','insuredShare','payrollPlannedDays','birthDate','verificationNote'].forEach(key=>delete safe[key]);
    if(type==='equipment')['unitPriceMnt','currency','contractNo','contractCompany','sourceData','certificate','customsDocument','passport'].forEach(key=>delete safe[key]);
    if(type==='plans')delete safe.unitRevenue;
    if(type==='fuel')delete safe.pricePerLiter;
    return safe;
  });
  return rows;
}
function submissionsForUser(user,assignments,employees) {
  let rows=db.prepare('SELECT s.*,u.name AS submittedByName FROM submissions s JOIN users u ON u.id=s.submitted_by JOIN records r ON r.id=s.assignment_id WHERE r.project_id=? ORDER BY s.submitted_at DESC').all(currentProject());
  if(user.role==='clerk'){const repairIds=new Set(employees.filter(row=>/засвар/i.test(String(row.branch||''))).map(row=>row.id));rows=rows.filter(row=>repairIds.has(Number(assignments.find(task=>task.id===row.assignment_id)?.employeeId)))}
  if(user.role==='camp')rows=rows.filter(row=>{const task=assignments.find(a=>a.id===row.assignment_id);return task&&(Number(task.campId)===Number(user.campId)||Number(employees.find(e=>e.id===Number(task.employeeId))?.campId)===Number(user.campId))});
  return rows;
}
app.get('/api/bootstrap',auth,(req,res)=>{
  const employees=all('employees');
  const assignments=all('assignments');
  const permissions=permissionsFor(req.user);
  const records=Object.fromEntries(types.map(type=>[type,permissions[type]?.includes('read')?visibleRecords(type,req.user,type==='employees'?employees:type==='assignments'?assignments:all(type),employees):[]]));
  const users=req.user.role==='admin'?db.prepare('SELECT id,username,name,role,camp_id AS campId,project_id AS projectId,employee_id AS employeeId,active FROM users WHERE project_id=? OR role=? ORDER BY id').all(currentProject(),'admin'):[];
  res.json({records,submissions:submissionsForUser(req.user,assignments,employees),users,permissions,projectId:currentProject()});
});
app.get('/api/records/:type',auth,(req,res)=>{
  const type=req.params.type;
  if(!types.includes(type))return res.status(404).end();
  if(!allowed(req,type,'read'))return res.status(403).json({error:'Харах эрхгүй'});
  res.json(visibleRecords(type,req.user,all(type),all('employees')));
});
app.post('/api/records/:type',auth,editor,(req,res) => {
  const type=req.params.type; if (!types.includes(type)) return res.status(404).end();
  try { const value=validate(type,req.body);if(!canEditRecord(req,type,value))return res.status(403).json({error:'Өөр camp-ийн ажилтны бүртгэл хийх эрхгүй'});if(type==='plans'){db.exec('BEGIN');try{const plan=insert(type,value);syncPlanAssignments(plan.id,value);audit(req,type,'create',plan.id,{name:plan.name});db.exec('COMMIT');return res.json(plan)}catch(error){db.exec('ROLLBACK');throw error}}if(type==='shiftOverrides'){db.exec('BEGIN');try{const record=insert(type,value);const changed=applyShiftOverride(record.id,value);audit(req,type,'create',record.id,{changedAssignments:changed});db.exec('COMMIT');return res.json(record)}catch(error){db.exec('ROLLBACK');throw error}}const record=insert(type,value);audit(req,type,'create',record.id,{sourceRow:record.sourceRow||null});res.json(record); } catch(err) { res.status(400).json({error:err.message}); }
});
app.post('/api/import/:type',auth,editor,(req,res)=>{
  const type=req.params.type;
  if(!types.includes(type))return res.status(404).end();
  const rows=req.body.rows;
  if(!Array.isArray(rows)||rows.length>(type==='productionEntries'?3000:2000))return res.status(400).json({error:'Импортын мөрийн тоо хэтэрлээ'});
  if(type==='equipment'&&rows.some(row=>String(row.sourceStatus||'').startsWith('OTR 2026-04-03'))&&db.prepare('SELECT name FROM projects WHERE id=?').get(currentProject())?.name!=='Чанд-Үйлс')return res.status(400).json({error:'OTR техникийн жагсаалтыг зөвхөн Чанд-Үйлс төсөлд импортлоно'});
  try{
    const values=rows.map((row,i)=>{try{const value=validate(type,row);if(!canEditRecord(req,type,value))throw new Error('Өөр camp-ийн ажилтан');return value}catch(error){throw new Error(`${i+2}-р мөр: ${error.message}`)}});
    db.exec('BEGIN');
    try{
      const machineIds=type==='machineLogs'?[...new Set(values.map(row=>Number(row.equipmentId)).filter(Boolean))]:[];
      const beforeHours=Object.fromEntries(machineIds.map(id=>[id,Number(get('equipment',id)?.currentHours||0)]));
      const batchId=db.prepare('INSERT INTO import_batches(project_id,type,filename,row_count,created_by) VALUES(?,?,?,?,?)').run(currentProject(),type,String(req.body.filename||'').slice(0,200),values.length,req.user.id).lastInsertRowid;
      const sourceKeys=type==='productionEntries'?new Set(all(type).map(productionSourceKey).filter(Boolean)):null;
      for(const value of values){if(sourceKeys){const key=productionSourceKey(value);if(key&&sourceKeys.has(key))throw new Error(`${value.sourceRow}-р Excel мөр өмнө импортлогдсон байна`);if(key)sourceKeys.add(key)}const stamp=new Date().toISOString();const record=sourceKeys?db.prepare('INSERT INTO records(project_id,type,body,import_batch_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(currentProject(),type,JSON.stringify(value),batchId,stamp,stamp):insert(type,value);if(!sourceKeys)db.prepare('UPDATE records SET import_batch_id=? WHERE id=? AND project_id=?').run(batchId,record.id,currentProject());if(type==='plans')syncPlanAssignments(record.id,value);if(type==='shiftOverrides')applyShiftOverride(record.id,value)}
      if(type==='machineLogs'){const afterHours=Object.fromEntries(machineIds.map(id=>[id,Number(get('equipment',id)?.currentHours||0)]));db.prepare('UPDATE import_batches SET undo_snapshot=? WHERE id=?').run(JSON.stringify({beforeHours,afterHours}),batchId)}
      audit(req,type,'import',null,{batchId,count:values.length,filename:String(req.body.filename||'').slice(0,200)});
      db.exec('COMMIT');res.json({count:values.length,batchId});
    }catch(error){db.exec('ROLLBACK');throw error}
  }catch(error){res.status(400).json({error:error.message})}
});
app.post('/api/imports/:id/undo',auth,admin,(req,res)=>{
  const batch=db.prepare('SELECT * FROM import_batches WHERE id=? AND project_id=? AND undone_at IS NULL').get(Number(req.params.id),currentProject());
  if(!batch)return res.status(404).json({error:'Импорт олдсонгүй эсвэл буцаагдсан байна'});
  db.exec('BEGIN');
  try{
    if(['equipmentAllData','equipmentSource'].includes(batch.type)){
      const snapshot=JSON.parse(batch.undo_snapshot||'{}');
      if(!Array.isArray(snapshot.updated)||!Array.isArray(snapshot.warehouseIds))throw new Error('ALL DATA импортын сэргээх мэдээлэл байхгүй');
      const records=db.prepare('SELECT id,type,body,import_batch_id AS importBatchId,created_at AS createdAt,updated_at AS updatedAt FROM records WHERE project_id=?').all(currentProject()).map(row=>({...row,body:JSON.parse(row.body)}));
      importUndoPlan('equipment',batch.id,records);
      for(const item of snapshot.updated){const current=get('equipment',item.id);const {id,createdAt,updatedAt,...body}=current||{};if(!current||!isDeepStrictEqual(body,item.after))throw new Error('ALL DATA-аар шинэчилсэн техникийг дараа нь зассан тул буцаах боломжгүй')}
      for(const item of snapshot.updated)db.prepare('UPDATE records SET body=?,updated_at=? WHERE id=? AND project_id=?').run(JSON.stringify(item.before),new Date().toISOString(),item.id,currentProject());
      const deleted=db.prepare('DELETE FROM records WHERE type=? AND import_batch_id=? AND project_id=?').run('equipment',batch.id,currentProject());
      for(const id of snapshot.warehouseIds){const warehouse=db.prepare('SELECT id,created_at AS createdAt,updated_at AS updatedAt FROM records WHERE type=? AND id=? AND project_id=?').get('warehouses',id,currentProject());if(!warehouse||warehouse.createdAt!==warehouse.updatedAt)throw new Error('ALL DATA-аар үүссэн агуулахыг зассан тул буцаах боломжгүй');const linked=db.prepare("SELECT id FROM records WHERE project_id=? AND json_extract(body,'$.warehouseId')=? LIMIT 1").get(currentProject(),id);if(linked)throw new Error('ALL DATA-аар үүссэн агуулахыг өөр бүртгэл ашиглаж байна');db.prepare('DELETE FROM records WHERE id=? AND project_id=?').run(id,currentProject())}
      db.prepare('UPDATE import_batches SET undone_at=CURRENT_TIMESTAMP WHERE id=?').run(batch.id);
      audit(req,'equipment','import_undo',null,{batchId:batch.id,deleted:deleted.changes,restored:snapshot.updated.length});db.exec('COMMIT');return res.json({count:deleted.changes+snapshot.updated.length});
    }
    const snapshot=JSON.parse(batch.undo_snapshot||'{}');
    if(batch.type==='machineLogs'){
      if(!snapshot.beforeHours||!snapshot.afterHours)throw new Error('Хуучин мото цагийн импортын суурь заалт хадгалагдаагүй тул автоматаар буцаах боломжгүй');
      for(const [id,hours] of Object.entries(snapshot.afterHours)){const machine=get('equipment',id);if(!machine||Number(machine.currentHours||0)!==Number(hours))throw new Error('Импортын дараа техникийн мото цаг өөрчлөгдсөн тул буцаах боломжгүй')}
    }
    const records=db.prepare('SELECT id,type,body,import_batch_id AS importBatchId,created_at AS createdAt,updated_at AS updatedAt FROM records WHERE project_id=?').all(currentProject()).map(row=>({...row,body:JSON.parse(row.body)}));
    const plan=importUndoPlan(batch.type,batch.id,records);
    const taskIds=[...plan.imported,...plan.generated].filter(row=>row.type==='assignments').map(row=>row.id);
    for(const id of taskIds)if(db.prepare('SELECT id FROM submissions WHERE assignment_id=? LIMIT 1').get(id))throw new Error('Илгээсэн ажлын гүйцэтгэлтэй импорт буцаах боломжгүй');
    if(batch.type==='employees')for(const row of plan.imported){if(db.prepare('SELECT id FROM users WHERE employee_id=? LIMIT 1').get(row.id)||db.prepare('SELECT id FROM documents WHERE employee_id=? LIMIT 1').get(row.id))throw new Error('Импортолсон ажилтанд хэрэглэгч эсвэл баримт үүссэн тул буцаах боломжгүй')}
    if(batch.type==='camps')for(const row of plan.imported)if(db.prepare('SELECT id FROM users WHERE camp_id=? LIMIT 1').get(row.id))throw new Error('Импортолсон camp-д хэрэглэгч оноосон тул буцаах боломжгүй');
    if(batch.type==='shiftOverrides')for(const row of plan.imported)undoShiftOverride(row.id);
    for(const row of plan.generated)db.prepare('DELETE FROM records WHERE id=? AND project_id=?').run(row.id,currentProject());
    const result=db.prepare('DELETE FROM records WHERE import_batch_id=? AND project_id=?').run(batch.id,currentProject());
    if(batch.type==='machineLogs')for(const [id,hours] of Object.entries(snapshot.beforeHours)){const machine=get('equipment',id);const remaining=all('machineLogs').filter(row=>Number(row.equipmentId)===Number(id));const nextHours=Math.max(Number(hours),...remaining.map(row=>Number(row.endHours||0)));const {id:recordId,createdAt,updatedAt,...body}=machine;body.currentHours=nextHours;db.prepare('UPDATE records SET body=?,updated_at=? WHERE id=? AND project_id=?').run(JSON.stringify(body),new Date().toISOString(),recordId,currentProject())}
    db.prepare('UPDATE import_batches SET undone_at=CURRENT_TIMESTAMP WHERE id=?').run(batch.id);
    audit(req,batch.type,'import_undo',null,{batchId:batch.id,count:result.changes});db.exec('COMMIT');res.json({count:result.changes});
  }catch(error){db.exec('ROLLBACK');res.status(400).json({error:error.message})}
});
app.post('/api/equipment-source/import',auth,admin,(req,res)=>{
  const projectName={chand2026:'Чанд-Үйлс',uutsarSerial:'Ууцар'}[req.body.source];
  const rows=req.body.rows;
  if(!projectName||!Array.isArray(rows)||!rows.length||rows.length>500)return res.status(400).json({error:'Техникийн эх файл эсвэл мөрийн тоо буруу байна'});
  if(db.prepare('SELECT name FROM projects WHERE id=?').get(currentProject())?.name!==projectName)return res.status(400).json({error:`Энэ файлыг зөвхөн ${projectName} төсөлд оруулна`});
  let added=0,updated=0,unchanged=0,batchId;
  db.exec('BEGIN');
  try{
    batchId=db.prepare('INSERT INTO import_batches(project_id,type,filename,row_count,created_by) VALUES(?,?,?,?,?)').run(currentProject(),'equipmentSource',String(req.body.filename||'Техникийн эх файл').slice(0,200),rows.length,req.user.id).lastInsertRowid;
    const snapshot={updated:[],warehouseIds:[]};const seenPark=new Set();const seenVin=new Set();
    for(const [index,row] of rows.entries()){
      const value=validate('equipment',{...row,site:projectName,status:'inactive',availability:'inactive'});
      value.parkNo=normalizePark(value.parkNo);value.vin=normalizeVin(value.vin);
      const park=normalizePark(value.parkNo),vin=normalizeVin(value.vin);
      if(seenPark.has(park)||vin&&seenVin.has(vin))throw new Error(`${index+1}-р техникийн парк/VIN файл дотор давхардсан`);
      seenPark.add(park);if(vin)seenVin.add(vin);
      const current=all('equipment');
      const byPark=current.find(item=>normalizePark(item.parkNo)===park);
      const byVin=vin?current.find(item=>normalizeVin(item.vin)===vin):null;
      if(byPark&&byVin&&byPark.id!==byVin.id)throw new Error(`${park}: VIN өөр парк дугаарт бүртгэлтэй`);
      if(byVin&&normalizePark(byVin.parkNo)!==park)throw new Error(`${park}: VIN өөр парк дугаарт бүртгэлтэй`);
      if(byPark){const {id,createdAt,updatedAt,...before}=byPark;const after=mergeEquipmentSource(before,value);if(isDeepStrictEqual(before,after)){unchanged++;continue}snapshot.updated.push({id,before,after});db.prepare('UPDATE records SET body=?,updated_at=? WHERE id=? AND project_id=?').run(JSON.stringify(after),new Date().toISOString(),id,currentProject());updated++}
      else{const record=insert('equipment',value);db.prepare('UPDATE records SET import_batch_id=? WHERE id=? AND project_id=?').run(batchId,record.id,currentProject());added++}
    }
    db.prepare('UPDATE import_batches SET undo_snapshot=? WHERE id=?').run(JSON.stringify(snapshot),batchId);
    audit(req,'equipment','import',null,{batchId,added,updated,unchanged,source:req.body.source});
    db.exec('COMMIT');res.json({added,updated,unchanged,batchId});
  }catch(error){db.exec('ROLLBACK');res.status(400).json({error:error.message})}
});
app.post('/api/equipment-all-data/import',auth,admin,async(req,res) => {
  try {
    const file=Buffer.from(String(req.body.fileBase64 || ''),'base64');
    if (!file.length || file.length>8_000_000) throw new Error('Excel файл 8 MB хүртэл хэмжээтэй байна');
    const {records,totalRows}=await parseAllData(file);
    if (!records.length) throw new Error('VIN-тэй техникийн мөр олдсонгүй');
    let added=0,updated=0;
    let batchId;
    db.exec('BEGIN');
    try {
      batchId=db.prepare('INSERT INTO import_batches(project_id,type,filename,row_count,created_by) VALUES(?,?,?,?,?)').run(currentProject(),'equipmentAllData',String(req.body.filename||'ALL DATA.xlsx').slice(0,200),records.length,req.user.id).lastInsertRowid;
      const existing=new Map(all('equipment').filter(r=>r.vin).map(r=>[String(r.vin).toUpperCase(),r]));
      const snapshot={updated:[],warehouseIds:[]};
      const seenVin=new Set();
      for (const record of records) {
        const vin=String(record.vin||'').toUpperCase();if(seenVin.has(vin))throw new Error(`ALL DATA-д VIN давхардсан: ${vin}`);seenVin.add(vin);
        if (record.availability==='available') {
          const warehouseName=record.site || 'Байршил тодорхойгүй';
          let warehouse=all('warehouses').find(w=>w.name===warehouseName);
          if(!warehouse){warehouse=insert('warehouses',{name:warehouseName,location:warehouseName,notes:'ALL DATA sheet-ийн агуулахад бэлэн техникээс үүсэв'});snapshot.warehouseIds.push(warehouse.id)}
          record.warehouseId=warehouse.id;
        }
        const value=validate('equipment',record);
        const old=existing.get(record.vin.toUpperCase());
        if (old) {
          const {id,createdAt,updatedAt,...before}=old;
          const after={...value,fuelRate:old.fuelRate||value.fuelRate,notes:old.notes||value.notes};
          snapshot.updated.push({id:old.id,before,after});
          db.prepare('UPDATE records SET body=?,updated_at=? WHERE id=? AND project_id=?').run(JSON.stringify(after),new Date().toISOString(),old.id,currentProject());
          updated++;
        } else {const created=insert('equipment',value);db.prepare('UPDATE records SET import_batch_id=? WHERE id=? AND project_id=?').run(batchId,created.id,currentProject());existing.set(vin,created);added++}
      }
      db.prepare('UPDATE import_batches SET undo_snapshot=? WHERE id=?').run(JSON.stringify(snapshot),batchId);
      audit(req,'equipment','import',null,{batchId,added,updated,totalRows});
      db.exec('COMMIT');
    } catch(err) {db.exec('ROLLBACK');throw err;}
    res.json({added,updated,totalRows,batchId});
  } catch(err) {res.status(400).json({error:err.message});}
});
app.put('/api/records/:type/:id',auth,editor,(req,res) => {
  const {type,id}=req.params; if (!types.includes(type)) return res.status(404).end();
  if (!get(type,id)) return res.status(404).json({error:'Бүртгэл олдсонгүй'});
  try { const old=get(type,id);const value=validate(type,type==='employees'&&req.user.role==='clerk'?{...old,...req.body}:req.body);if(type==='employees'&&old.shiftGroup!==value.shiftGroup&&all('equipment').some(machine=>['A','B','C','D'].some(group=>Number(machine[`operator${group}Id`])===Number(id)&&group!==value.shiftGroup)))throw new Error('Техникт оператороор оноосон ажилтны ээлжийг эхлээд техникээс чөлөөлнө');if(type==='employees'&&req.user.role==='clerk'){const operational=['shiftGroup','rotationPattern','shiftStart','status','campId','notes'];const forbidden=Object.keys(value).filter(key=>!operational.includes(key)&&JSON.stringify(value[key])!==JSON.stringify(old[key]));if(forbidden.length)throw new Error('Клерк зөвхөн ээлж, төлөв, Camp болон тэмдэглэл засна')}if(type==='mealFeedback'&&req.user.role==='hr'){const approved=['approvedAllowance','hrStatus','hrNote'];if(Object.keys(value).some(key=>!approved.includes(key)&&JSON.stringify(value[key])!==JSON.stringify(old[key])))throw new Error('HR зөвхөн нэмэгдэл ба шийдвэр засна')}if(!canEditRecord(req,type,value)||!canEditRecord(req,type,old))return res.status(403).json({error:'Өөр camp-ийн бүртгэл засах эрхгүй'});ensureUnique(type,value,id);if(type==='shiftOverrides'){db.exec('BEGIN');try{undoShiftOverride(id);db.prepare('UPDATE records SET body=?,updated_at=? WHERE type=? AND id=? AND project_id=?').run(JSON.stringify(value),new Date().toISOString(),type,Number(id),currentProject());const changed=applyShiftOverride(id,value);audit(req,type,'update',Number(id),{changedAssignments:changed,changes:changesBetween(old,value)});db.exec('COMMIT');return res.json(get(type,id))}catch(error){db.exec('ROLLBACK');throw error}}if(type==='plans')db.exec('BEGIN');try{db.prepare('UPDATE records SET body=?,updated_at=? WHERE type=? AND id=? AND project_id=?').run(JSON.stringify(value),new Date().toISOString(),type,Number(id),currentProject());if(type==='plans')syncPlanAssignments(id,value);audit(req,type,'update',Number(id),{changes:changesBetween(old,value)});if(type==='plans')db.exec('COMMIT');if(type==='machineLogs') updateEquipmentHours(value);res.json(get(type,id))}catch(error){if(type==='plans')db.exec('ROLLBACK');throw error} }
  catch(err) { res.status(400).json({error:err.message}); }
});
app.delete('/api/records/:type/:id',auth,editor,(req,res) => {
  const {type,id}=req.params; if (!types.includes(type)) return res.status(404).end();
  if (!get(type,id)) return res.status(404).json({error:'Бүртгэл олдсонгүй'});
  if (!canEditRecord(req,type,get(type,id))) return res.status(403).json({error:'Өөр camp-ийн бүртгэл устгах эрхгүй'});
  const linkedRows=db.prepare('SELECT type,id,body FROM records WHERE project_id=?').all(currentProject()).reduce((group,row)=>{(group[row.type]??=[]).push({id:row.id,...JSON.parse(row.body)});return group},{});
  const dependent=findDependentRecord(type,id,linkedRows);
  if(dependent)return res.status(400).json({error:`Холбоотой ${dependent.type} #${dependent.id} бүртгэл байгаа тул устгах боломжгүй`});
  if(type==='employees'&&(db.prepare('SELECT id FROM users WHERE employee_id=? LIMIT 1').get(Number(id))||db.prepare('SELECT id FROM documents WHERE employee_id=? AND project_id=? LIMIT 1').get(Number(id),currentProject())))return res.status(400).json({error:'Хэрэглэгч эсвэл PDF баримттай ажилтныг устгах боломжгүй'});
  if(type==='camps'&&db.prepare('SELECT id FROM users WHERE camp_id=? AND project_id=? LIMIT 1').get(Number(id),currentProject()))return res.status(400).json({error:'Хэрэглэгч оноосон Camp-ийг устгах боломжгүй'});
  if (type==='plans') {
    const linked=all('assignments').filter(row=>Number(row.planId)===Number(id));
    if(linked.some(row=>Number(row.autoPlanId)!==Number(id)||db.prepare('SELECT id FROM submissions WHERE assignment_id=?').get(row.id)))return res.status(400).json({error:'Энэ төлөвлөгөөний ажил эсвэл гүйцэтгэлийн бүртгэл байна'});
    db.exec('BEGIN');try{linked.forEach(row=>db.prepare('DELETE FROM records WHERE type=? AND id=? AND project_id=?').run('assignments',row.id,currentProject()));db.prepare('DELETE FROM records WHERE type=? AND id=? AND project_id=?').run(type,Number(id),currentProject());audit(req,type,'delete',Number(id));db.exec('COMMIT');return res.json({ok:true})}catch(error){db.exec('ROLLBACK');return res.status(400).json({error:error.message})}
  }
  if (type==='shiftOverrides'){db.exec('BEGIN');try{undoShiftOverride(id);db.prepare('DELETE FROM records WHERE type=? AND id=? AND project_id=?').run(type,Number(id),currentProject());audit(req,type,'delete',Number(id));db.exec('COMMIT');return res.json({ok:true})}catch(error){db.exec('ROLLBACK');return res.status(400).json({error:error.message})}}
  if (type==='assignments') db.prepare('DELETE FROM submissions WHERE assignment_id=?').run(Number(id));
  db.prepare('DELETE FROM records WHERE type=? AND id=? AND project_id=?').run(type,Number(id),currentProject());audit(req,type,'delete',Number(id));res.json({ok:true});
});
app.get('/api/submissions',auth,(req,res)=>res.json(submissionsForUser(req.user,all('assignments'),all('employees'))));
app.post('/api/submissions',auth,(req,res) => {
  if(!allowed(req,'assignments','update'))return res.status(403).json({error:'Гүйцэтгэл илгээх эрхгүй'});
  const {assignmentId,status,actualHours,actualFuel,actualOutput,note}=req.body;
  const task=get('assignments',assignmentId);
  if (!task) return res.status(404).json({error:'Даалгавар олдсонгүй'});
  if (req.user.role==='camp'&&Number(task.campId)!==Number(req.user.campId)&&Number(get('employees',task.employeeId)?.campId)!==Number(req.user.campId)) return res.status(403).json({error:'Өөр camp-ийн даалгавар илгээх эрхгүй'});
  if (req.user.role==='clerk'&&!canEditRecord(req,'assignments',task)) return res.status(403).json({error:'Клерк зөвхөн засварын ажилтны ажлыг шалгана'});
  if (!['done','not_done'].includes(status)) return res.status(400).json({error:'Төлөв сонгоно уу'});
  const values=[actualHours,actualFuel,actualOutput].map(v=>Number(v || 0));
  if (values.some(v=>!Number.isFinite(v) || v<0)) return res.status(400).json({error:'Бодит утга 0-ээс бага байж болохгүй'});
  db.prepare(`INSERT INTO submissions(assignment_id,work_date,status,actual_hours,actual_fuel,actual_output,note,submitted_by,submitted_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(assignment_id,work_date) DO UPDATE SET status=excluded.status,actual_hours=excluded.actual_hours,actual_fuel=excluded.actual_fuel,actual_output=excluded.actual_output,note=excluded.note,submitted_by=excluded.submitted_by,submitted_at=excluded.submitted_at`)
    .run(task.id,task.date,status,...values,String(note || ''),req.user.id,new Date().toISOString());
  audit(req,'assignments','submit',task.id,{status,actualHours:values[0],actualFuel:values[1],actualOutput:values[2]});
  res.json({ok:true});
});
app.post('/api/submissions/batch',auth,(req,res) => {
  if(!allowed(req,'assignments','update'))return res.status(403).json({error:'Гүйцэтгэл илгээх эрхгүй'});
  const rows=req.body?.rows;
  if(!Array.isArray(rows)||!rows.length||rows.length>200)return res.status(400).json({error:'1–200 ажлын гүйцэтгэл сонгоно уу'});
  try {
    const values=rows.map(row=>{
      const task=get('assignments',row.assignmentId);
      if(!task)throw new Error('Ажлын хуваарь олдсонгүй');
      if(req.user.role==='camp'&&Number(task.campId)!==Number(req.user.campId)&&Number(get('employees',task.employeeId)?.campId)!==Number(req.user.campId))throw new Error('Өөр camp-ийн ажил илгээх эрхгүй');
      if(req.user.role==='clerk'&&!canEditRecord(req,'assignments',task))throw new Error('Клерк зөвхөн засварын ажилтны ажлыг шалгана');
      if(!['done','not_done'].includes(row.status))throw new Error('Ажил бүрт хийсэн эсэхийг сонгоно уу');
      const numbers=[row.actualHours,row.actualFuel,row.actualOutput].map(value=>Number(value||0));
      if(numbers.some(value=>!Number.isFinite(value)||value<0))throw new Error('Бодит утга 0-ээс бага байж болохгүй');
      return {task,status:row.status,numbers,note:String(row.note||'')};
    });
    if(new Set(values.map(row=>row.task.id)).size!==values.length)throw new Error('Ажил давхар сонгогдсон байна');
    db.exec('BEGIN');try{for(const row of values){db.prepare(`INSERT INTO submissions(assignment_id,work_date,status,actual_hours,actual_fuel,actual_output,note,submitted_by,submitted_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(assignment_id,work_date) DO UPDATE SET status=excluded.status,actual_hours=excluded.actual_hours,actual_fuel=excluded.actual_fuel,actual_output=excluded.actual_output,note=excluded.note,submitted_by=excluded.submitted_by,submitted_at=excluded.submitted_at`).run(row.task.id,row.task.date,row.status,...row.numbers,row.note,req.user.id,new Date().toISOString());audit(req,'assignments','submit',row.task.id,{status:row.status,actualHours:row.numbers[0],actualFuel:row.numbers[1],actualOutput:row.numbers[2]})}db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
    res.json({count:values.length});
  }catch(error){res.status(400).json({error:error.message})}
});
const dist=path.resolve('dist');
app.use(express.static(dist));
app.get('/{*path}',(_req,res) => res.sendFile(path.join(dist,'index.html')));
const host=process.env.HOST || '127.0.0.1';
app.listen(Number(process.env.PORT || 3001), host, () => console.log(`MPC HR API http://${host}:${process.env.PORT || 3001}`));
