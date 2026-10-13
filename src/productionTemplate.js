import { saveBlob } from './fileDownload.js';

export async function saveProductionTemplate(fields) {
  const {default:ExcelJS}=await import('exceljs');
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('Бүтээлийн гүйцэтгэл');
  sheet.columns=fields.map(field=>({header:field.label,key:field.key,width:Math.min(34,Math.max(17,field.label.length+5))}));
  sheet.getRow(1).height=42;
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF7656D8'}};
  sheet.getRow(1).alignment={vertical:'middle',wrapText:true};
  sheet.views=[{state:'frozen',ySplit:1}];
  sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:fields.length}};
  for(const [index,field] of fields.entries()){
    const column=index+1;
    if(field.required)sheet.getCell(1,column).note='Заавал бөглөнө';
    if(field.key==='date')sheet.getColumn(column).numFmt='yyyy-mm-dd';
    if(field.key==='kind'||field.key==='shift'){
      const values=field.key==='kind'?['actual','plan']:['day','night'];
      for(let row=2;row<=500;row++)sheet.getCell(row,column).dataValidation={type:'list',allowBlank:field.key==='shift',formulae:[`"${values.join(',')}"`],showErrorMessage:true,error:'Жагсаалтаас утга сонгоно уу'};
    }
  }
  const help=workbook.addWorksheet('Бөглөх заавар');
  [
    ['Талбар','Бөглөх утга'],
    ['Төрөл','actual = бодит гүйцэтгэл, plan = төлөвлөгөө. Жагсаалтаас сонгоно.'],
    ['Өдөр / шөнө','Бодит гүйцэтгэлд day эсвэл night сонгоно.'],
    ['Операторын код','Ажилтан хуудсанд бүртгэсэн давтагдашгүй кодыг бичнэ. Нэр эсвэл регистр бичихгүй.'],
    ['Огноо','Зөвхөн бүртгэлийн өдрийг YYYY-MM-DD хэлбэрээр оруулна.'],
    ['Бодит гүйцэтгэл','Автосамосвал, ачигч, рейс, багтаамж, бүтээл м³-г бөглөнө. Бүтээл = рейс × багтаамж.'],
    ['Төлөвлөгөө','Ачигч, материал, материалын төрөл, бүтээл м³-г бөглөнө.'],
    ['Парк дугаар','Техник хуудсанд бүртгэлтэй парк дугаарыг ашиглана.'],
    ['Импорт','Зөвхөн эхний хуудасны толгойг хэвээр үлдээж, 2-р мөрөөс өгөгдөл оруулаад Excel импорт дарна.'],
  ].forEach(row=>help.addRow(row));
  help.getColumn(1).width=25;help.getColumn(2).width=100;
  help.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  help.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF7656D8'}};
  const blob=new Blob([await workbook.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  return saveBlob(blob,'productionEntries-загвар.xlsx');
}
