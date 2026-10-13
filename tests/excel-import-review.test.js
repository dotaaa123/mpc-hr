import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {parsePayrollWorkbook} from '../src/payrollWorkbook.js';
import {parseProductionWorkbook} from '../src/productionWorkbook.js';
import {parseAllData,applyAllDataEdits,checkAllDataRows} from '../server/allData.js';
import {validateProduction} from '../server/production.js';

const asFile=async(workbook,name='example.xlsx')=>({name,arrayBuffer:()=>workbook.xlsx.writeBuffer()});

test('payroll preview retains invalid rows for correction',async()=>{
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Цалин');
  sheet.getCell('M5').value='Регистрийн дугаар';sheet.getCell('O5').value='Ажиллавал зохих хоног';
  sheet.getCell('M6').value='АА12345678';sheet.getCell('O6').value=10;sheet.getCell('T6').value=1000;sheet.getCell('V6').value=0.5;
  sheet.getCell('M7').value='АА12345678';sheet.getCell('O7').value=12;sheet.getCell('T7').value=0;sheet.getCell('V7').value=1.5;
  const result=await parsePayrollWorkbook(await asFile(book));
  assert.deepEqual(result.rows.map(row=>row.sourceRow),[6,7]);
  assert.match(result.issues[0].message,/давхардсан/);
  assert.match(result.issues[0].message,/цалин/);
});

test('ALL DATA preview keeps source row numbers and editable missing VIN',async()=>{
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('ALL DATA');
  sheet.getCell('K2').value='VIN';sheet.getCell('N3').value='P-1';sheet.getCell('K5').value='VIN-5';
  const parsed=await parseAllData(await book.xlsx.writeBuffer());
  assert.deepEqual(parsed.records.map(row=>row.sourceRow),[3,5]);
  const issues=await checkAllDataRows(parsed.records,async()=>{});
  assert.equal(issues[0].row,3);assert.match(issues[0].message,/VIN/);
  const changed=applyAllDataEdits(parsed.records,[{sourceRow:3,values:{vin:'VIN-3',sourceRow:99,sourceData:{}}}],[5]);
  assert.equal(changed.length,1);assert.equal(changed[0].vin,'VIN-3');assert.equal(changed[0].sourceRow,3);
  assert.deepEqual(changed[0].sourceData,parsed.records[0].sourceData);
});

test('production preview exposes invalid shift and can validate corrected row',async()=>{
  const book=new ExcelJS.Workbook();const actual=book.addWorksheet('Actual');const plan=book.addWorksheet('Plan');const data=book.addWorksheet('Data');
  actual.getCell('B5').value='DATE';actual.getCell('R5').value='AMOUNT';plan.getCell('B2').value='DATE';plan.getCell('O2').value='AMOUNT';
  data.getCell('F24').value='449';data.getCell('G24').value=27;
  actual.getCell('B6').value=new Date('2026-10-01T00:00:00Z');actual.getCell('H6').value='Wrong';actual.getCell('I6').value='449';actual.getCell('J6').value='EX-01';actual.getCell('N6').value='Waste';actual.getCell('P6').value=2;actual.getCell('R6').value=54;
  const parsed=await parseProductionWorkbook(await asFile(book));
  assert.equal(parsed.actualRows.length,1);assert.equal(parsed.actualRows[0].sourceRow,6);
  assert.match(parsed.issues[0].message,/ээлж/);
  const fixed=validateProduction({...parsed.actualRows[0],shift:'DAY'});
  assert.equal(fixed.shift,'day');
});
