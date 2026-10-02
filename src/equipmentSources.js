import { normalizeVin } from '../shared/equipmentIdentity.js';
const value = cell => { try { return String(cell?.text ?? cell?.value ?? '').trim(); } catch { return ''; } };
const yearOf = input => String(input || '').match(/20\d{2}/)?.[0] || '';
const typeOf = text => /EXCAVATOR|экскаватор/i.test(text) ? 'Экскаватор' : /WT\s?1[03]0|дамп|самосвал|өөрөө буулгагч/i.test(text) ? 'Дамп' : /GREADER|грейдер/i.test(text) ? 'Автогрейдер' : /DOZER|бульдозер/i.test(text) ? 'Бульдозер' : /LIGHT VEHICLE/i.test(text) ? 'Суудлын машин' : text || 'Техник';

async function sheetFrom(file, sheetName) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`${sheetName} хуудас олдсонгүй`);
  return sheet;
}

export async function parseOtrEquipment(file) {
  const sheet = await sheetFrom(file, 'OTR 2');
  if (!value(sheet.getCell('A2')).includes('Чанд-Үйлс') || !value(sheet.getCell('G4')).includes('Парк')) {
    throw new Error('Чанд-Үйлсийн OTR техникийн Excel биш байна');
  }
  const rows = [];
  const issues = [];
  const parks = new Set();
  const vins = new Set();
  let current = null;
  for (let n = 5; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n);
    const order = value(row.getCell(1));
    if (!/^\d+$/.test(order)) continue;
    const modelCell = row.getCell(2);
    const description = modelCell.isMerged && modelCell.master.address !== modelCell.address ? '' : value(modelCell);
    if (description) current = description;
    const parkNo = value(row.getCell(7)).replace(/\s+/g, ' ').toUpperCase();
    const vin = value(row.getCell(3)).toUpperCase();
    if (!parkNo || !current || (!vin && !description)) {
      issues.push(`${n}-р мөр: парк, төрөл эсвэл арлын дугаар дутуу; импортлохгүй`);
      continue;
    }
    if (parks.has(parkNo) || vin && vins.has(vin)) {
      issues.push(`${n}-р мөр: давхардсан парк эсвэл арлын дугаар; импортлохгүй`);
      continue;
    }
    parks.add(parkNo);
    if (vin) vins.add(vin);
    const kind = /экскаватор/i.test(current) ? 'Экскаватор' : /өөрөө буулгагч/i.test(current) ? 'Дамп' : /автогрейдер/i.test(current) ? 'Автогрейдер' : /бульдозер/i.test(current) ? 'Бульдозер' : 'Техник';
    const year = value(row.getCell(4)).match(/20\d{2}/)?.[0] || '';
    const remark = value(row.getCell(5));
    rows.push({ parkNo, kind, model: current, vin, plateNo: value(row.getCell(6)), year,
      site: 'Чанд-Үйлс', status: 'inactive', availability: 'inactive',
      sourceStatus: 'OTR 2026-04-03 · баталгаажаагүй', sourceSheet: sheet.name, sourceRow: n,
      notes: [remark, value(row.getCell(8)), '2026-04-03-ны жагсаалт; өнөөдрийн ажлын бэлэн байдал болон мото цагийг тусад нь батална.'].filter(Boolean).join(' · ') });
  }
  return { rows, issues };
}

export async function parseSoldEquipment(file) {
  const sheet = await sheetFrom(file, 'СЕРИАЛ ДУГААРУУД');
  if (!value(sheet.getCell('B2')).includes('модел') || !value(sheet.getCell('C2')).includes('Тоо')) {
    throw new Error('Зарсан техникийн нэгтгэлийн Excel биш байна');
  }
  const rows = [];
  const issues = [];
  for (let n = 3; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n);
    const model = value(row.getCell(2));
    const count = Number(value(row.getCell(3)));
    if (!model && !value(row.getCell(3))) continue;
    if (!model || !Number.isInteger(count) || count < 1) {
      issues.push(`${n}-р мөр: загвар эсвэл тоо ширхэг буруу`);
      continue;
    }
    rows.push({ sourceRow: n, model, count, buyer: value(row.getCell(4)), location: value(row.getCell(5)),
      motorHours: value(row.getCell(6)), note: value(row.getCell(7)) });
  }
  return { rows, issues, total: rows.reduce((sum, row) => sum + row.count, 0) };
}

export async function parseChandFleet(file) {
  const sheet = await sheetFrom(file, '2026');
  if (!value(sheet.getCell('G2')).includes('Парк дугаар') || !value(sheet.getCell('H2')).includes('Арлын дугаар')) throw new Error('2026 хуудасны парк/VIN багана олдсонгүй');
  const rows=[]; const issues=[]; const parks=new Set(); const vins=new Set();
  for(let n=4;n<=sheet.rowCount;n++){
    const row=sheet.getRow(n);
    const parkNo=value(row.getCell(7)).toUpperCase();
    const rawVin=value(row.getCell(8));
    if(!parkNo&&!rawVin)continue;
    const vin=normalizeVin(rawVin);
    const model=value(row.getCell(5))||value(row.getCell(4));
    const rawKind=value(row.getCell(3));
    if(!parkNo||!vin||!model||!rawKind){issues.push(`${n}-р мөр: парк, VIN, төрөл эсвэл загвар дутуу`);continue}
    if(parks.has(parkNo)||vins.has(vin)){issues.push(`${n}-р мөр: давхардсан парк/VIN (${parkNo})`);continue}
    parks.add(parkNo);vins.add(vin);
    const tank=Number(value(row.getCell(14)).replaceAll(',',''));
    rows.push({parkNo,kind:typeOf(rawKind),brand:value(row.getCell(4)),model,vin,plateNo:value(row.getCell(9)),year:yearOf(value(row.getCell(21))),site:'Чанд-Үйлс',status:'inactive',availability:'inactive',...(tank>0?{tankCapacityLiters:tank}:{}),sourceStatus:'Чанд-Үйлс 2026 · бэлэн байдал баталгаажаагүй',sourceSheet:'2026',sourceRow:n,notes:rawVin!==vin?`Эх файлын VIN: ${rawVin}`:''});
  }
  return {rows,issues};
}

export async function parseUutsarFleet(file) {
  const sheet=await sheetFrom(file,'СЕРИАЛ ДУГААРУУД');
  if(!value(sheet.getCell('F2')).includes('СЕРИЙН ДУГААР')||!value(sheet.getCell('I2')).includes('Заамар'))throw new Error('Техникийн серийн Excel-ийн багана олдсонгүй');
  const rows=[];const issues=[];const parks=new Set();const vins=new Set();
  for(let n=3;n<=sheet.rowCount;n++){
    const row=sheet.getRow(n);
    const kind=value(row.getCell(5));const model=value(row.getCell(10));
    if(!kind||!model)continue;
    const parkNo=value(row.getCell(9)).toUpperCase();const vin=normalizeVin(value(row.getCell(6)));
    if(!parkNo){issues.push(`${n}-р мөр: парк дугаар байхгүй (${model})`);continue}
    if(parks.has(parkNo)||vin&&vins.has(vin)){issues.push(`${n}-р мөр: давхардсан парк/VIN (${parkNo})`);continue}
    parks.add(parkNo);if(vin)vins.add(vin);
    const moto=value(row.getCell(12));
    rows.push({parkNo,kind:typeOf(kind),brand:value(row.getCell(4)),model,vin,plateNo:value(row.getCell(7)),year:yearOf(value(row.getCell(13))),site:'Ууцар',status:'inactive',availability:'inactive',sourceStatus:'Ууцар серийн жагсаалт · бэлэн байдал баталгаажаагүй',sourceSheet:sheet.name,sourceRow:n,notes:[value(row.getCell(8))&&`Хуучин парк: ${value(row.getCell(8))}`,moto&&`Эх файлын мото цаг: ${moto}`].filter(Boolean).join(' · ')});
  }
  return {rows,issues};
}
