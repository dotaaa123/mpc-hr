import { normalizeParkNo } from '../shared/parkNo.js';

const value = cell => {
  const raw = cell?.value;
  return raw && typeof raw === 'object' && 'formula' in raw ? raw.result : raw;
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
    if (!day) continue;
    const shift={Day:'day',Night:'night'}[string(row.getCell(8))];
    const haul=normalizeParkNo(string(row.getCell(9)));
    const excavator=normalizeParkNo(string(row.getCell(10)));
    const material=string(row.getCell(14));
    const race=number(row.getCell(16));
    const capacity=capacities.get(haul);
    const cached=number(row.getCell(18));
    if (!haul && !excavator && !Number.isFinite(race)) continue;
    if (!shift || !haul || !excavator || !material || !Number.isInteger(race) || race<1 || !capacity || !Number.isFinite(cached) || Math.abs(cached-race*capacity)>0.01) {
      issues.push(`Actual!${n}: ээлж, техник, материал, рейс, багтаамж эсвэл тооцоолсон м³ зөрсөн`);
      continue;
    }
    rows.push({date:day,kind:'actual',shift,haulParkNo:haul,excavatorParkNo:excavator,pit:string(row.getCell(11)),block:string(row.getCell(12)),level:string(row.getCell(13)),material,materialType:string(row.getCell(15))||material,race,capacity,amount:cached,dump:string(row.getCell(17)),sourceFile:filename,sourceSheet:'Actual',sourceRow:n});
  }
  const planRows=[];
  for (let n=3;n<=plan.rowCount;n++) {
    const row=plan.getRow(n);
    const day=date(row.getCell(2));
    if (!day) continue;
    const material=string(row.getCell(12))||string(row.getCell(13));
    const amount=number(row.getCell(15));
    if (!material || !Number.isFinite(amount) || amount<=0) continue;
    const excavatorParkNo=normalizeParkNo(string(row.getCell(8)));
    if (!excavatorParkNo) {issues.push(`Plan!${n}: ачигчийн парк дугааргүй`);continue}
    planRows.push({date:day,kind:'plan',excavatorParkNo,pit:string(row.getCell(9)),block:string(row.getCell(10)),level:string(row.getCell(11)),material,materialType:string(row.getCell(13))||material,amount,dump:string(row.getCell(14)),sourceFile:filename,sourceSheet:'Plan',sourceRow:n});
  }
  if (!rows.length) throw new Error('Actual хуудаснаас импортлох бодит рейс олдсонгүй');
  const dates=rows.map(row=>row.date).sort();
  const planDates=planRows.map(row=>row.date).sort();
  return {actualRows:rows,planRows,issues,actualRange:[dates[0],dates.at(-1)],planRange:planDates.length?[planDates[0],planDates.at(-1)]:null,actualAmount:rows.reduce((sum,row)=>sum+row.amount,0),planAmount:planRows.reduce((sum,row)=>sum+row.amount,0)};
}
