const cellValue = cell => cell?.value && typeof cell.value === 'object' && 'result' in cell.value ? cell.value.result : cell?.value;

export async function parsePayrollWorkbook(file) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet || !String(cellValue(sheet.getCell('M5')) || '').includes('Регистр') || !String(cellValue(sheet.getCell('O5')) || '').includes('Ажиллавал зохих')) throw new Error('Цалингийн загварын 5-р мөрийн толгой олдсонгүй');
  const rows=[];
  const issues=[];
  const seen=new Set();
  for (let index=6;index<=sheet.rowCount;index++) {
    const rawDays=cellValue(sheet.getCell(`O${index}`));
    const plannedDays=Number(rawDays);
    const register=String(cellValue(sheet.getCell(`M${index}`))||'').trim().toUpperCase();
    const salary=Number(cellValue(sheet.getCell(`T${index}`)));
    const insuredShare=Number(cellValue(sheet.getCell(`V${index}`)));
    if(!register&&!rawDays&&!cellValue(sheet.getCell(`T${index}`)))continue;
    const problems=[];
    if(!Number.isFinite(plannedDays)||plannedDays<=0)problems.push('ажиллавал зохих хоног буруу');
    if(!register)problems.push('регистрийн дугаар хоосон');
    if(register&&seen.has(register))problems.push('регистр давхардсан');
    if(!Number.isFinite(salary)||salary<=0)problems.push('үндсэн цалин буруу');
    if(!Number.isFinite(insuredShare)||insuredShare<0||insuredShare>1)problems.push('НДШ тооцох хувь буруу');
    if(problems.length)issues.push({row:index,message:problems.join('; ')});
    if (register) seen.add(register);
    rows.push({sourceRow:index,__excelRow:index,register,sourceName:`${String(cellValue(sheet.getCell(`K${index}`))||'').trim()} ${String(cellValue(sheet.getCell(`L${index}`))||'').trim()}`.trim(),plannedDays:Number.isFinite(plannedDays)?plannedDays:'',salary:Number.isFinite(salary)?salary:'',insuredShare:Number.isFinite(insuredShare)?insuredShare:''});
  }
  if (!rows.length) throw new Error('Цалингийн ажилтны мөр олдсонгүй');
  return {rows,issues};
}
