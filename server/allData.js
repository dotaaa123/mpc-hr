import ExcelJS from 'exceljs';

const cell = (row,index) => String(row[index] ?? '').trim();
const numeric = value => {
  const n=Number(String(value ?? '').replaceAll(',',''));
  return Number.isFinite(n) ? n : 0;
};
const column = index => { let n=index+1; let text=''; while(n){n--;text=String.fromCharCode(65+n%26)+text;n=Math.floor(n/26)} return text; };
export async function parseAllData(buffer) {
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet=workbook.getWorksheet('ALL DATA');
  if (!sheet) throw new Error('ALL DATA нэртэй sheet олдсонгүй');
  const grid=Array.from({length:sheet.rowCount},(_,index)=>Array.from({length:sheet.columnCount},(_,col)=>sheet.getRow(index+1).getCell(col+1).text));
  const headers=grid[1];
  if (!headers || cell(headers,10).toUpperCase()!=='VIN') throw new Error('ALL DATA sheet-ийн 2-р мөрөнд VIN багана олдсонгүй');
  const records=grid.slice(2).filter(row=>cell(row,10)).map((row,index)=>{
    const sourceData=Object.fromEntries(headers.map((heading,col)=>[column(col),{heading:String(heading || '').trim(),value:row[col] ?? ''}]));
    const sourceStatus=cell(row,30);
    const availability=/агуулах/i.test(sourceStatus)?'available':/ашиглаж/i.test(sourceStatus)?'assigned':/борлуул/i.test(sourceStatus)?'sold':'inactive';
    const status=availability==='sold'?'inactive':/засвар/i.test(sourceStatus)?'maintenance':'ready';
    return {
      parkNo:cell(row,13)||cell(row,8)||cell(row,10).slice(-5),
      kind:cell(row,6)||'Бусад',brand:cell(row,2)||'Weichai',model:cell(row,5)||'Тодорхойгүй',
      vin:cell(row,10),plateNo:cell(row,8),site:cell(row,35),owner:cell(row,39)||cell(row,4),
      currentHours:numeric(row[36]),fuelRate:0,status,availability,
      year:cell(row,11),sourceStatus,contractNo:cell(row,1),contractCompany:cell(row,4),
      unitPriceMnt:numeric(row[16]),currency:cell(row,15),warranty:cell(row,37),
      certificate:cell(row,41),customsDocument:cell(row,43),passport:cell(row,44),
      sourceSheet:'ALL DATA',sourceRow:index+3,sourceData,
      notes:cell(row,12),
    };
  });
  return {records,totalRows:grid.length-2};
}
