const cellValue = cell => cell?.value && typeof cell.value === 'object' && 'result' in cell.value ? cell.value.result : cell?.value;

export async function parsePayrollWorkbook(file) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet || !String(cellValue(sheet.getCell('M5')) || '').includes('Регистр') || !String(cellValue(sheet.getCell('O5')) || '').includes('Ажиллавал зохих')) throw new Error('Цалингийн загварын 5-р мөрийн толгой олдсонгүй');
  const rows=[];
  const seen=new Set();
  for (let index=6;index<=sheet.rowCount;index++) {
    const plannedDays=Number(cellValue(sheet.getCell(`O${index}`)));
    if (!Number.isFinite(plannedDays) || plannedDays<=0) continue;
    const register=String(cellValue(sheet.getCell(`M${index}`))||'').trim().toUpperCase();
    const salary=Number(cellValue(sheet.getCell(`T${index}`)));
    const insuredShare=Number(cellValue(sheet.getCell(`V${index}`)));
    if (register && seen.has(register)) throw new Error(`${index}-р мөрийн регистр давхардсан`);
    if (!Number.isFinite(salary) || salary<=0 || !Number.isFinite(insuredShare) || insuredShare<0 || insuredShare>1) throw new Error(`${index}-р мөрийн цалин эсвэл НДШ тооцох хувь буруу`);
    if (register) seen.add(register);
    rows.push({sourceRow:index,register,sourceName:`${String(cellValue(sheet.getCell(`K${index}`))||'').trim()} ${String(cellValue(sheet.getCell(`L${index}`))||'').trim()}`.trim(),plannedDays,salary,insuredShare});
  }
  if (!rows.length) throw new Error('Цалингийн ажилтны мөр олдсонгүй');
  return rows;
}
