import { haulCapacityForPark } from '../shared/productionReference.js';

// Active park numbers transcribed from the user supplied dispatcher fleet list.
const excavators = [
  ['EX-01','FR800F'],['EX-02','FR800F'],['EX-03','FR800F'],['EX-04','FR1000F'],
  ['EX-05','Hitachi 1200'],['EX-06','FR1000F'],['EX-128','CAT395'],['EX-130','CAT395'],['LO-02','FL976F'],
];
const hauls = [
  ...Array.from({length:20},(_,i)=>448+i).filter(n=>n!==450).map(n=>[String(n),'LOVOL WT-105']),
  ...['MT-01','MT-02','MT-03','MT-04','MT-05','MT-06','MT-08','MT-4823','MT-4832','MT-4833','MT-7831','MT-7843','MT-7865'].map(n=>[n,'MT#86']),
  ['DT-13','MT#86'],['DT-18','TONLY'],['DT-25','MT#86'],['DT-26','MT#86'],['DT-28','HOWO 371'],['DT-363','HOWO'],
];
const rentals = [['DZ-01','FD320','Бульдозер'],['DZ-02','FD320','Бульдозер'],['LO-01','FL955F','Авто ачигч'],['LO-03','FL955F','Авто ачигч'],['LO-04','FL955F','Авто ачигч'],['GR-01','FPY210','Автогрейдер'],['FT-01','Faw','Түлшний машин'],['WT-01','Dongfeng','Усны машин']];
export const activeFleet = [
  ...excavators.map(([parkNo,model])=>({parkNo,model,kind:parkNo.startsWith('LO')?'Авто ачигч':'Экскаватор'})),
  ...hauls.map(([parkNo,model])=>({parkNo,model,kind:'Дамп',haulCapacity:haulCapacityForPark(parkNo)})),
  ...rentals.map(([parkNo,model,kind])=>({parkNo,model,kind})),
];

const text = cell => String(cell?.value ?? '').trim();
export function matchFleetSerialRows(sourceRows) {
  const active=new Map(activeFleet.map(row=>[row.parkNo,row]));
  const exact=new Map();const unmatched=[];const issues=[];
  for(const row of sourceRows){
    const parkNo=String(row.parkNo||'').trim().toUpperCase();
    const vin=String(row.vin||'').trim();
    if(!parkNo||!vin){issues.push({row:row.sourceRow,sheet:'СЕРИАЛ ДУГААРУУД',message:!parkNo?'Парк дугаар оруулна уу':'VIN оруулна уу'});continue}
    if(!active.has(parkNo)){unmatched.push({row:row.sourceRow,parkNo});issues.push({row:row.sourceRow,sheet:'СЕРИАЛ ДУГААРУУД',message:`${parkNo} парк идэвхтэй жагсаалтад байхгүй`});continue}
    if(exact.has(parkNo)){issues.push({row:row.sourceRow,sheet:'СЕРИАЛ ДУГААРУУД',message:`${parkNo} парк дугаар файл дотор давхардсан`});continue}
    exact.set(parkNo,{vin,brand:row.brand,plateNo:row.plateNo,year:row.year,sourceSheet:'СЕРИАЛ ДУГААРУУД',sourceRow:row.sourceRow});
  }
  return {sourceRows,records:activeFleet.map(row=>({...row,...(exact.get(row.parkNo)||{}),status:'inactive',availability:'inactive',site:'Ууцар'})),matched:exact.size,unmatched,issues};
}
export async function matchFleetSerials(file) {
  const {default:ExcelJS}=await import('exceljs');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await file.arrayBuffer());
  const sheet=workbook.getWorksheet('СЕРИАЛ ДУГААРУУД');
  if(!sheet||text(sheet.getCell('F2'))!=='СЕРИЙН ДУГААР')throw new Error('Техникийн мэдээллийн СЕРИАЛ ДУГААРУУД хуудас олдсонгүй');
  const sourceRows=[];
  for(let n=3;n<=sheet.rowCount;n++){
    const parkNo=text(sheet.getCell(`I${n}`))||text(sheet.getCell(`H${n}`));
    const vin=text(sheet.getCell(`F${n}`));
    if(!parkNo&&!vin)continue;
    sourceRows.push({parkNo,vin,brand:text(sheet.getCell(`D${n}`)),plateNo:text(sheet.getCell(`G${n}`)),year:text(sheet.getCell(`M${n}`)),sourceSheet:'СЕРИАЛ ДУГААРУУД',sourceRow:n,__sheet:'СЕРИАЛ ДУГААРУУД',__excelRow:n});
  }
  return matchFleetSerialRows(sourceRows);
}
