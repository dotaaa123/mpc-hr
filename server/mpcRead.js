import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const mpcViews = {
  items: { title:'Барааны жагсаалт', path:'/items?page=1&pageSize=100000', columns:[['partNo','Барааны дугаар'],['name','Барааны нэр'],['groupName','Ангилал'],['unit','Нэгж'],['balance','Үлдэгдэл'],['salePrice','Үнэ']] },
  balance: { title:'Агуулахын үлдэгдэл', path:'/reports/balance', columns:[['partNo','Барааны дугаар'],['name','Барааны нэр'],['group','Ангилал'],['unit','Нэгж'],['opening','Эхний үлдэгдэл'],['inQty','Орлого'],['outQty','Зарлага'],['balance','Эцсийн үлдэгдэл']] },
  orders: { title:'Захиалга', path:'/orders', columns:[['docNo','Дугаар'],['docDate','Огноо'],['status','Төлөв'],['warehouse','Агуулах'],['partner','Нийлүүлэгч'],['qty','Тоо'],['progress','Явц']] },
  purchases: { title:'Худалдан авалт', path:'/purchases', columns:[['docNo','Дугаар'],['docDate','Огноо'],['status','Төлөв'],['partner','Нийлүүлэгч'],['invoiceNo','Нэхэмжлэх'],['total','Дүн']] },
  income: { title:'Орлого, нэхэмжлэх', path:'/receipts', columns:[['docNo','Дугаар'],['docDate','Огноо'],['status','Төлөв'],['source','Эх үүсвэр'],['warehouse','Агуулах'],['partner','Нийлүүлэгч'],['invoiceNo','Нэхэмжлэх'],['total','Дүн']] },
  issues: { title:'Зарлага', path:'/issues', columns:[['docNo','Дугаар'],['docDate','Огноо'],['status','Төлөв'],['type','Төрөл'],['warehouse','Агуулах'],['parkNo','Техник'],['total','Дүн']] },
  transfers: { title:'Дотоод хөдөлгөөн', path:'/issues', columns:[['docNo','Дугаар'],['docDate','Огноо'],['direction','Чиглэл'],['status','Төлөв'],['warehouse','Агуулах'],['purpose','Зориулалт'],['total','Дүн']] },
};
export const mpcPageKeys={items:'mpcItems',balance:'mpcBalance',orders:'mpcOrders',purchases:'mpcPurchases',income:'mpcIncome',issues:'mpcIssues',transfers:'mpcTransfers'};
const tokenCache=new Map();

function key() {
  const source=process.env.MPC_INTEGRATION_KEY || [process.env.POSTGRES_URL,process.env.ADMIN_PASSWORD].filter(Boolean).join(':');
  if(!source)throw new Error('MPC холболтын түлхүүр тохируулаагүй байна');
  return createHash('sha256').update(source).digest();
}

export function sealCredentials(credentials) {
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key(),iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(credentials),'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(part=>part.toString('base64url')).join('.');
}

export function openCredentials(value) {
  const [iv,tag,encrypted]=String(value).split('.').map(part=>Buffer.from(part,'base64url'));
  const decipher=createDecipheriv('aes-256-gcm',key(),iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8'));
}

export async function readMpcView(view, credentials) {
  const config=mpcViews[view];
  if(!config)throw new Error('MPC хуудас олдсонгүй');
  const base=(process.env.MPC_API_BASE_URL||'https://selbeg-api.vercel.app/api').replace(/\/$/,'');
  const cacheKey=createHash('sha256').update(JSON.stringify([base,credentials])).digest('hex');
  async function token(force=false){
    const cached=tokenCache.get(cacheKey);
    if(!force&&cached?.expiresAt>Date.now())return cached.value;
    const login=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(20000)});
    if(!login.ok)throw new Error('MPC API-д нэвтрэх нэр эсвэл нууц үг буруу байна');
    const value=(await login.json()).token;
    tokenCache.set(cacheKey,{value,expiresAt:Date.now()+100*60*1000});
    return value;
  }
  async function get(path){
    let value=await token();
    let response=await fetch(`${base}${path}`,{headers:{authorization:`Bearer ${value}`},signal:AbortSignal.timeout(60000)});
    if(response.status===401){value=await token(true);response=await fetch(`${base}${path}`,{headers:{authorization:`Bearer ${value}`},signal:AbortSignal.timeout(60000)})}
    return response;
  }
  const response=await get(config.path);
  if(!response.ok)throw new Error(`MPC API мэдээлэл буцаасангүй (${response.status})`);
  const result=await response.json();
  let rows=Array.isArray(result)?result:Array.isArray(result.rows)?result.rows:[];
  if(view==='transfers'){
    const receipts=await get('/receipts?source=internal');
    if(!receipts.ok)throw new Error(`MPC API дотоод орлого буцаасангүй (${receipts.status})`);
    const inward=await receipts.json();
    rows=[...rows.filter(row=>row.type==='transfer').map(row=>({...row,mirrorKey:`out-${row.id}`,direction:'Гаргалт'})),...inward.map(row=>({...row,mirrorKey:`in-${row.id}`,direction:'Хүлээн авалт'}))].sort((a,b)=>String(b.docDate).localeCompare(String(a.docDate)));
  }
  return { title:config.title, columns:config.columns, rows, total:view==='transfers'?rows.length:result.total??rows.length, fetchedAt:new Date().toISOString() };
}

export async function readMpcDetail(view, id, credentials) {
  const config=mpcViews[view];
  if(!config || !/^[\w-]+$/.test(String(id)))throw new Error('MPC бичлэг олдсонгүй');
  const base=(process.env.MPC_API_BASE_URL||'https://selbeg-api.vercel.app/api').replace(/\/$/,'');
  const cacheKey=createHash('sha256').update(JSON.stringify([base,credentials])).digest('hex');
  let cached=tokenCache.get(cacheKey);
  if(!cached || cached.expiresAt<=Date.now()) {
    const login=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(20000)});
    if(!login.ok)throw new Error('MPC API-д нэвтрэх боломжгүй');
    cached={value:(await login.json()).token,expiresAt:Date.now()+100*60*1000};tokenCache.set(cacheKey,cached);
  }
  const path=config.path.split('?')[0];
  let response=await fetch(`${base}${path}/${encodeURIComponent(id)}`,{headers:{authorization:`Bearer ${cached.value}`},signal:AbortSignal.timeout(30000)});
  if(response.status===401){
    const login=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(20000)});
    if(!login.ok)throw new Error('MPC API-д нэвтрэх боломжгүй');
    cached={value:(await login.json()).token,expiresAt:Date.now()+100*60*1000};tokenCache.set(cacheKey,cached);
    response=await fetch(`${base}${path}/${encodeURIComponent(id)}`,{headers:{authorization:`Bearer ${cached.value}`},signal:AbortSignal.timeout(30000)});
  }
  if(!response.ok)throw new Error(`MPC дэлгэрэнгүй мэдээлэл олдсонгүй (${response.status})`);
  return response.json();
}
