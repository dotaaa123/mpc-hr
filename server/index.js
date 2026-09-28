import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseAllData } from './allData.js';

const app = express();
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

import { roles, types, required, permitted } from './domain.js';
const clean = (type, body) => Object.fromEntries(permitted[type].filter(key => body[key] !== undefined && body[key] !== null).map(key => [key, typeof body[key] === 'string' ? body[key].trim() : body[key]]));
const all = type => db.prepare('SELECT id, body, created_at, updated_at FROM records WHERE type=? ORDER BY id DESC').all(type).map(r => ({ id:r.id, ...JSON.parse(r.body), createdAt:r.created_at, updatedAt:r.updated_at }));
const get = (type,id) => all(type).find(r => r.id === Number(id));
const hash = password => { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; };
const verify = (password, stored) => { const [salt,digest]=stored.split(':'); const actual=scryptSync(password,salt,64); const expected=Buffer.from(digest,'hex'); return expected.length===actual.length && timingSafeEqual(expected,actual); };
const failedLogins=new Map();
if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) throw new Error('Анхны админ үүсгэхэд ADMIN_PASSWORD (12+ тэмдэгт) шаардлагатай');
  db.prepare('INSERT INTO users(username,name,role,password) VALUES(?,?,?,?)').run(process.env.ADMIN_USER || 'admin', 'Администратор', 'admin', hash(process.env.ADMIN_PASSWORD));
  console.log('Анхны админ хэрэглэгч үүсгэгдлээ.');
}

const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=')));
function auth(req,res,next) {
  const token=cookie(req).mpchr;
  const session=token && db.prepare('SELECT u.id,u.username,u.name,u.role,u.camp_id AS campId,u.active,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(token);
  if (!session || !session.active || session.expires_at<Date.now()) return res.status(401).json({ error:'Нэвтэрнэ үү' });
  req.user=session; next();
}
const admin = (req,res,next) => req.user.role==='admin' ? next() : res.status(403).json({error:'Зөвхөн админ эрхтэй'});
const editor = (req,res,next) => req.user.role==='admin' || (req.params.type==='machineLogs' && req.user.role==='dispatcher') || (req.params.type==='attendance'&&['hr','camp'].includes(req.user.role)) ? next() : res.status(403).json({error:'Бүртгэх эрхгүй'});
function validate(type, body) {
  const value=clean(type,body);
  const missing=required[type].filter(k => value[k]===undefined || value[k]==='');
  if (missing.length) throw new Error(`Заавал бөглөх талбар: ${missing.join(', ')}`);
  if (type==='employees' && !/^\S{2,}$/.test(String(value.register))) throw new Error('Регистрийн дугаар буруу байна');
  if (type==='attendance' && (!get('employees',value.employeeId)||!['day','night','absent','rest','leave'].includes(value.status))) throw new Error('Ажилтан эсвэл төлөв буруу байна');
  if (type==='equipment') {value.status ||= 'ready';value.availability ||= value.status==='ready'?'available':'inactive';}
  if (type==='assignments' && !value.employeeId && !value.equipmentId) throw new Error('Ажилтан эсвэл техник сонгоно уу');
  if (type==='assignments' && value.employeeId && !get('employees',value.employeeId)) throw new Error('Ажилтан олдсонгүй');
  if (type==='assignments' && value.equipmentId && !get('equipment',value.equipmentId)) throw new Error('Техник олдсонгүй');
  if (type==='assignments' && value.planId && !get('plans',value.planId)) throw new Error('Төлөвлөгөө олдсонгүй');
  if (type==='machineLogs' && (!get('employees',value.employeeId) || !get('equipment',value.equipmentId))) throw new Error('Оператор эсвэл техник олдсонгүй');
  if (type==='machineLogs' && (Number(value.endHours)<Number(value.startHours) || Number(value.startHours)<0)) throw new Error('Төгсгөлийн мото цаг эхлэлээс бага байж болохгүй');
  if (type==='machineLogs' && value.endKm!==undefined && Number(value.endKm)<Number(value.startKm || 0)) throw new Error('Төгсгөлийн км эхлэлээс бага байж болохгүй');
  return value;
}
function ensureUnique(type,value,excludeId) {
  if (type==='employees' && all(type).some(row=>row.id!==Number(excludeId)&&row.register===value.register)) throw new Error('Энэ регистрийн дугаартай ажилтан бүртгэлтэй байна');
  if (type==='attendance' && all(type).some(row=>row.id!==Number(excludeId)&&row.date===value.date&&Number(row.employeeId)===Number(value.employeeId))) throw new Error('Энэ ажилтны тухайн өдрийн цаг бүртгэл байна');
  if (type==='equipment' && all(type).some(row=>row.id!==Number(excludeId)&&(value.vin&&row.vin===value.vin||!value.vin&&row.parkNo===value.parkNo))) throw new Error('Энэ VIN эсвэл парк дугаартай техник бүртгэлтэй байна');
}
function canEditRecord(req,type,value) {
  if (req.user.role==='admin') return true;
  if (type==='machineLogs') return req.user.role==='dispatcher';
  if (type==='attendance'&&req.user.role==='hr') return true;
  if (type==='attendance'&&req.user.role==='camp') return Number(get('employees',value.employeeId)?.campId)===Number(req.user.campId);
  return false;
}
function insert(type,value) {
  ensureUnique(type,value);
  const now=new Date().toISOString();
  const result=db.prepare('INSERT INTO records(type,body,created_at,updated_at) VALUES(?,?,?,?)').run(type,JSON.stringify(value),now,now);
  if (type==='machineLogs') updateEquipmentHours(value);
  return get(type,result.lastInsertRowid);
}
function updateEquipmentHours(log) {
  const equipment=get('equipment',log.equipmentId);
  if (!equipment || Number(log.endHours)<=Number(equipment.currentHours || 0)) return;
  const {id,createdAt,updatedAt,...body}=equipment;
  body.currentHours=Number(log.endHours);
  db.prepare('UPDATE records SET body=?,updated_at=? WHERE id=?').run(JSON.stringify(body),new Date().toISOString(),id);
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
  res.json({id:user.id,username:user.username,name:user.name,role:user.role,campId:user.camp_id});
});
app.post('/api/logout',auth,(req,res) => { db.prepare('DELETE FROM sessions WHERE token=?').run(cookie(req).mpchr); res.clearCookie('mpchr',{path:'/'}); res.json({ok:true}); });
app.get('/api/me',auth,(req,res) => res.json({id:req.user.id,username:req.user.username,name:req.user.name,role:req.user.role,campId:req.user.campId}));
app.patch('/api/me/password',auth,(req,res) => {
  const currentPassword=String(req.body?.currentPassword || '');
  const newPassword=String(req.body?.newPassword || '');
  if (newPassword.length<8) return res.status(400).json({error:'Шинэ нууц үг 8-аас дээш тэмдэгттэй байна'});
  const user=db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
  if (!user || !verify(currentPassword,user.password)) return res.status(400).json({error:'Одоогийн нууц үг буруу байна'});
  if (currentPassword===newPassword) return res.status(400).json({error:'Шинэ нууц үг өмнөхөөс өөр байна'});
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash(newPassword),req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(req.user.id,cookie(req).mpchr);
  res.json({ok:true});
});
app.get('/api/users',auth,admin,(_req,res) => res.json(db.prepare('SELECT id,username,name,role,camp_id AS campId,active FROM users ORDER BY id').all()));
app.post('/api/users',auth,admin,(req,res) => {
  const {username,name,role,password,campId}=req.body;
  if (!username || !name || !roles.includes(role) || String(password || '').length<8) return res.status(400).json({error:'Нэр, эрх, 8+ тэмдэгттэй нууц үг оруулна уу'});
  if (role==='camp'&&!get('camps',campId)) return res.status(400).json({error:'Camp ахлахын camp-ийг сонгоно уу'});
  try { const result=db.prepare('INSERT INTO users(username,name,role,password,camp_id) VALUES(?,?,?,?,?)').run(username,name,role,hash(password),role==='camp'?Number(campId):null); res.json({id:result.lastInsertRowid,username,name,role,campId,active:1}); }
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
  db.prepare('UPDATE users SET name=?,role=?,camp_id=?,active=?,password=? WHERE id=?').run(req.body.name || user.name,role,campId,active,req.body.password ? hash(req.body.password) : user.password,user.id);
  res.json({ok:true});
});
app.post('/api/attendance/submit',auth,(req,res) => {
  if (!['admin','hr','camp'].includes(req.user.role)) return res.status(403).json({error:'Цаг бүртгэх эрхгүй'});
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
        if(old) db.prepare('UPDATE records SET body=?,updated_at=? WHERE id=?').run(JSON.stringify(value),new Date().toISOString(),old.id);
        else insert('attendance',value);
      }
      db.exec('COMMIT');
    } catch(err) {db.exec('ROLLBACK');throw err;}
    res.json({count:values.length});
  } catch(err) {res.status(400).json({error:err.message});}
});
app.get('/api/records/:type',auth,(req,res) => {
  if (!types.includes(req.params.type)) return res.status(404).end();
  const type=req.params.type;
  if (type==='other' && req.user.role!=='admin') return res.json([]);
  let rows=all(type);
  if (req.user.role==='camp') {
    const campId=Number(req.user.campId);
    if (type==='employees') rows=rows.filter(row=>Number(row.campId)===campId);
    if (type==='attendance') rows=rows.filter(row=>Number(get('employees',row.employeeId)?.campId)===campId);
    if (type==='camps') rows=rows.filter(row=>row.id===campId);
    if (type==='assignments') rows=rows.filter(row=>Number(row.campId)===campId||Number(get('employees',row.employeeId)?.campId)===campId);
  }
  if (req.user.role!=='admin') rows=rows.map(row=>{
    const safe={...row};
    if (type==='employees' && req.user.role!=='hr') {delete safe.register;delete safe.phone;delete safe.bankAccount;}
    if (type==='equipment') ['unitPriceMnt','currency','contractNo','contractCompany','sourceData','certificate','customsDocument','passport'].forEach(key=>delete safe[key]);
    if (type==='plans') delete safe.unitRevenue;
    if (type==='fuel') delete safe.pricePerLiter;
    return safe;
  });
  res.json(rows);
});
app.post('/api/records/:type',auth,editor,(req,res) => {
  const type=req.params.type; if (!types.includes(type)) return res.status(404).end();
  try { const value=validate(type,req.body);if(!canEditRecord(req,type,value))return res.status(403).json({error:'Өөр camp-ийн ажилтны бүртгэл хийх эрхгүй'});res.json(insert(type,value)); } catch(err) { res.status(400).json({error:err.message}); }
});
app.post('/api/import/:type',auth,editor,(req,res) => {
  const type=req.params.type; if (!types.includes(type)) return res.status(404).end();
  const rows=req.body.rows;
  if (!Array.isArray(rows) || rows.length>2000) return res.status(400).json({error:'2000 хүртэл мөр импортлох боломжтой'});
  try {
    const values=rows.map((row,i) => { try { const value=validate(type,row);if(!canEditRecord(req,type,value))throw new Error('Өөр camp-ийн ажилтан');return value; } catch(err) { throw new Error(`${i+2}-р мөр: ${err.message}`); } });
    db.exec('BEGIN');
    try { values.forEach(value => insert(type,value)); db.exec('COMMIT'); } catch(err) { db.exec('ROLLBACK'); throw err; }
    res.json({count:values.length});
  } catch(err) { res.status(400).json({error:err.message}); }
});
app.post('/api/equipment-all-data/import',auth,admin,async(req,res) => {
  try {
    const file=Buffer.from(String(req.body.fileBase64 || ''),'base64');
    if (!file.length || file.length>8_000_000) throw new Error('Excel файл 8 MB хүртэл хэмжээтэй байна');
    const {records,totalRows}=await parseAllData(file);
    if (!records.length) throw new Error('VIN-тэй техникийн мөр олдсонгүй');
    const existing=new Map(all('equipment').filter(r=>r.vin).map(r=>[String(r.vin).toUpperCase(),r]));
    let added=0,updated=0;
    db.exec('BEGIN');
    try {
      for (const record of records) {
        if (record.availability==='available') {
          const warehouseName=record.site || 'Байршил тодорхойгүй';
          const warehouse=all('warehouses').find(w=>w.name===warehouseName) || insert('warehouses',{name:warehouseName,location:warehouseName,notes:'ALL DATA sheet-ийн агуулахад бэлэн техникээс үүсэв'});
          record.warehouseId=warehouse.id;
        }
        const value=validate('equipment',record);
        const old=existing.get(record.vin.toUpperCase());
        if (old) {
          db.prepare('UPDATE records SET body=?,updated_at=? WHERE id=?').run(JSON.stringify({...value,fuelRate:old.fuelRate||value.fuelRate,notes:old.notes||value.notes}),new Date().toISOString(),old.id);
          updated++;
        } else { insert('equipment',value); added++; }
      }
      db.exec('COMMIT');
    } catch(err) {db.exec('ROLLBACK');throw err;}
    res.json({added,updated,totalRows});
  } catch(err) {res.status(400).json({error:err.message});}
});
app.put('/api/records/:type/:id',auth,editor,(req,res) => {
  const {type,id}=req.params; if (!types.includes(type)) return res.status(404).end();
  if (!get(type,id)) return res.status(404).json({error:'Бүртгэл олдсонгүй'});
  try { const value=validate(type,req.body);if(!canEditRecord(req,type,value)||!canEditRecord(req,type,get(type,id)))return res.status(403).json({error:'Өөр camp-ийн бүртгэл засах эрхгүй'});ensureUnique(type,value,id); db.prepare('UPDATE records SET body=?,updated_at=? WHERE type=? AND id=?').run(JSON.stringify(value),new Date().toISOString(),type,Number(id)); if(type==='machineLogs') updateEquipmentHours(value); res.json(get(type,id)); }
  catch(err) { res.status(400).json({error:err.message}); }
});
app.delete('/api/records/:type/:id',auth,editor,(req,res) => {
  const {type,id}=req.params; if (!types.includes(type)) return res.status(404).end();
  if (!get(type,id)) return res.status(404).json({error:'Бүртгэл олдсонгүй'});
  if (!canEditRecord(req,type,get(type,id))) return res.status(403).json({error:'Өөр camp-ийн бүртгэл устгах эрхгүй'});
  if (type==='assignments') db.prepare('DELETE FROM submissions WHERE assignment_id=?').run(Number(id));
  db.prepare('DELETE FROM records WHERE type=? AND id=?').run(type,Number(id)); res.json({ok:true});
});
app.get('/api/submissions',auth,(req,res) => {let rows=db.prepare('SELECT s.*,u.name AS submittedByName FROM submissions s JOIN users u ON u.id=s.submitted_by ORDER BY s.submitted_at DESC').all();if(req.user.role==='camp')rows=rows.filter(row=>{const task=get('assignments',row.assignment_id);return task&&(Number(task.campId)===Number(req.user.campId)||Number(get('employees',task.employeeId)?.campId)===Number(req.user.campId))});res.json(rows)});
app.post('/api/submissions',auth,(req,res) => {
  const {assignmentId,status,actualHours,actualFuel,actualOutput,note}=req.body;
  const task=get('assignments',assignmentId);
  if (!task) return res.status(404).json({error:'Даалгавар олдсонгүй'});
  if (req.user.role==='camp'&&Number(task.campId)!==Number(req.user.campId)&&Number(get('employees',task.employeeId)?.campId)!==Number(req.user.campId)) return res.status(403).json({error:'Өөр camp-ийн даалгавар илгээх эрхгүй'});
  if (!['done','not_done'].includes(status)) return res.status(400).json({error:'Төлөв сонгоно уу'});
  const values=[actualHours,actualFuel,actualOutput].map(v=>Number(v || 0));
  if (values.some(v=>!Number.isFinite(v) || v<0)) return res.status(400).json({error:'Бодит утга 0-ээс бага байж болохгүй'});
  db.prepare(`INSERT INTO submissions(assignment_id,work_date,status,actual_hours,actual_fuel,actual_output,note,submitted_by,submitted_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(assignment_id,work_date) DO UPDATE SET status=excluded.status,actual_hours=excluded.actual_hours,actual_fuel=excluded.actual_fuel,actual_output=excluded.actual_output,note=excluded.note,submitted_by=excluded.submitted_by,submitted_at=excluded.submitted_at`)
    .run(task.id,task.date,status,...values,String(note || ''),req.user.id,new Date().toISOString());
  res.json({ok:true});
});
const dist=path.resolve('dist');
app.use(express.static(dist));
app.get('/{*path}',(_req,res) => res.sendFile(path.join(dist,'index.html')));
const host=process.env.HOST || '127.0.0.1';
app.listen(Number(process.env.PORT || 3001), host, () => console.log(`MPC HR API http://${host}:${process.env.PORT || 3001}`));
