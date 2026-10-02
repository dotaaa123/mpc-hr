const value = cell => String(cell?.text ?? cell?.value ?? '').trim();

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
