import { normalizeParkNo } from '../shared/parkNo.js';

const value = cell => {
  const raw = cell?.value;
  return raw && typeof raw === 'object' && 'result' in raw ? raw.result : raw;
};
const string = cell => String(value(cell) ?? '').trim();
const number = cell => { const raw=value(cell);return raw===null||raw===undefined||raw===''?Number.NaN:Number(raw) };
const date = cell => {
  const raw = value(cell);
  if (!(raw instanceof Date) || Number.isNaN(raw.getTime())) return '';
  return `${raw.getUTCFullYear()}-${String(raw.getUTCMonth()+1).padStart(2,'0')}-${String(raw.getUTCDate()).padStart(2,'0')}`;
};
const sourceFile = file => String(file.name || '').trim().toLowerCase();

export async function parseProductionWorkbook(file) {
  const {default:ExcelJS} = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const actual = workbook.getWorksheet('Actual');
  const plan = workbook.getWorksheet('Plan');
  const lookup = workbook.getWorksheet('Data');
  if (!actual || !plan || !lookup || string(actual.getCell('B5')) !== 'DATE' || string(actual.getCell('R5')) !== 'AMOUNT' || string(plan.getCell('B2')) !== 'DATE' || string(plan.getCell('O2')) !== 'AMOUNT') {
    throw new Error('Ууцар тайлангийн Actual, Plan, Data хуудас болон баганууд таарахгүй байна');
  }
  const capacities = new Map();
  for (let n=24;n<=lookup.rowCount;n++) {
    const park=normalizeParkNo(string(lookup.getCell(`F${n}`)));
    const capacity=number(lookup.getCell(`G${n}`));
    if (park && Number.isFinite(capacity) && capacity>0) capacities.set(park,capacity);
  }
  const rows=[];
  const issues=[];
  const filename=sourceFile(file);
  for (let n=6;n<=actual.rowCount;n++) {
    const row=actual.getRow(n);
    const day=date(row.getCell(2));
    const shift=string(row.getCell(8)).toLowerCase();
    const haul=normalizeParkNo(string(row.getCell(9)));
    const excavator=normalizeParkNo(string(row.getCell(10)));
    const material=string(row.getCell(14));
    const race=number(row.getCell(16));
    const capacity=capacities.get(haul);
    const cached=number(row.getCell(18));
    if (!day && !haul && !excavator && !Number.isFinite(race) && !material) continue;
    const problems=[];
    if(!day)problems.push('огноо буруу');
    if(!['day','night'].includes(shift))problems.push('өдөр/шөнийн ээлж буруу');
    if(!haul||!excavator)problems.push('техникийн парк дутуу');
    if(!material)problems.push('материал дутуу');
    if(!Number.isInteger(race)||race<1)problems.push('рейс буруу');
    if(!capacity)problems.push('багтаамж дутуу');
    if(!Number.isFinite(cached)||Number.isFinite(race)&&capacity&&Math.abs(cached-race*capacity)>0.01)problems.push('бүтээл м³ рейс × багтаамжтай таарахгүй');
    if(problems.length)issues.push({row:n,sheet:'Actual',message:problems.join('; ')});
    rows.push({date:day,kind:'actual',shift,haulParkNo:haul,excavatorParkNo:excavator,pit:string(row.getCell(11)),block:string(row.getCell(12)),level:string(row.getCell(13)),material,materialType:string(row.getCell(15))||material,race:Number.isFinite(race)?race:'',capacity:capacity||'',amount:Number.isFinite(cached)?cached:'',dump:string(row.getCell(17)),sourceFile:filename,sourceSheet:'Actual',sourceRow:n,__sheet:'Actual',__excelRow:n});
  }
  const planRows=[];
  for (let n=3;n<=plan.rowCount;n++) {
    const row=plan.getRow(n);
    const day=date(row.getCell(2));
    const material=string(row.getCell(12))||string(row.getCell(13));
    const amount=number(row.getCell(15));
    const excavatorParkNo=normalizeParkNo(string(row.getCell(8)));
    if(!day&&!material&&!excavatorParkNo&&!Number.isFinite(amount))continue;
    const problems=[];
    if(!day)problems.push('огноо буруу');
    if(!material)problems.push('материал дутуу');
    if(!Number.isFinite(amount)||amount<=0)problems.push('бүтээл м³ буруу');
    if(!excavatorParkNo)problems.push('ачигчийн парк дугааргүй');
    if(problems.length)issues.push({row:n,sheet:'Plan',message:problems.join('; ')});
    planRows.push({date:day,kind:'plan',excavatorParkNo,pit:string(row.getCell(9)),block:string(row.getCell(10)),level:string(row.getCell(11)),material,materialType:string(row.getCell(13))||material,amount:Number.isFinite(amount)?amount:'',dump:string(row.getCell(14)),sourceFile:filename,sourceSheet:'Plan',sourceRow:n,__sheet:'Plan',__excelRow:n});
  }
  if (!rows.length) throw new Error('Actual хуудаснаас импортлох бодит рейс олдсонгүй');
  const dates=rows.map(row=>row.date).filter(Boolean).sort();
  const planDates=planRows.map(row=>row.date).filter(Boolean).sort();
  return {actualRows:rows,planRows,issues,actualRange:dates.length?[dates[0],dates.at(-1)]:[],planRange:planDates.length?[planDates[0],planDates.at(-1)]:null,actualAmount:rows.reduce((sum,row)=>sum+(Number(row.amount)||0),0),planAmount:planRows.reduce((sum,row)=>sum+(Number(row.amount)||0),0)};
}
