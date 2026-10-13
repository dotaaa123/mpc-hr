// Book1.xlsx-ийн ирцийн өдөр тутмын багана, сарын хоёр хагасын бүтэц.
// Эх Excel-ийн ажилтны мэдээлэл болон эвдэрсэн томьёог хуулж нийтлэхгүй.
export const attendanceCode = {arrival:'Ир',day:'Өд',departure:'Бу',night:'Шө',travel:'Зам',rest:'Ам',leave:'Ч',absent:'Т'};

export function monthDates(month) {
  const [year,number]=month.split('-').map(Number);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Сар буруу байна');
  const days=new Date(Date.UTC(year,number,0)).getUTCDate();
  return Array.from({length:days},(_,index)=>`${month}-${String(index+1).padStart(2,'0')}`);
}

const count=(daily,dates,status)=>dates.filter(date=>daily[date]?.status===status).length;
export function attendanceSummary(daily,dates) {
  const day=count(daily,dates,'day');
  const night=count(daily,dates,'night');
  const arrival=count(daily,dates,'arrival');
  const departure=count(daily,dates,'departure');
  const travel=count(daily,dates,'travel');
  return {day,night,arrival,departure,travel,rest:count(daily,dates,'rest'),leave:count(daily,dates,'leave'),absent:count(daily,dates,'absent'),workedDays:day+night,workedHours:dates.reduce((sum,date)=>sum+(['day','night'].includes(daily[date]?.status)?Number(daily[date]?.actualHours||0):0),0)};
}

export async function exportBook1Timesheet({month,employees,attendance,includeSalary=false}) {
  const {default:ExcelJS}=await import('exceljs');
  const dates=monthDates(month);
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('Цагийн бүртгэл');
  const basics=['№','Хувийн дугаар','Овог','Нэр','Хэлтэс','Албан тушаал','Цалин','Өдрийн цалин','Компани'];
  const summaryHeaders=['Өдөр ажилласан','Шөнө ажилласан','Ирсэн зам хоног','Явсан зам хоног','Бусад зам хоног','Амарсан','Чөлөөтэй','Тасалсан','Ажилласан өдөр','Ажилласан цаг'];
  const labels=[...basics,...dates.map(date=>new Date(`${date}T00:00:00Z`)),'Ээлжийн код ABCD','Ажиллавал зохих өдөр','Ажиллавал зохих цаг','Тайлбар',...summaryHeaders,...summaryHeaders,...summaryHeaders];
  sheet.addRow([`${month.replace('-',' оны ')} сар · Цагийн бүртгэл`]);
  sheet.mergeCells(1,1,1,labels.length);
  sheet.addRow([]);
  const header=sheet.addRow(labels);
  for(let i=10;i<10+dates.length;i++) header.getCell(i).numFmt='m/d';
  const firstStart=14+dates.length;
  sheet.getCell(2,firstStart).value='Сарын эхний хагас';
  sheet.getCell(2,firstStart+10).value='Сарын сүүлийн хагас';
  sheet.getCell(2,firstStart+20).value='НИЙТ';
  [0,10,20].forEach(offset=>sheet.mergeCells(2,firstStart+offset,2,firstStart+offset+9));
  const attendanceMap=new Map(attendance.filter(item=>dates.includes(item.date)).map(item=>[`${item.employeeId}:${item.date}`,item]));
  employees.forEach((employee,index)=>{
    const daily=Object.fromEntries(dates.map(date=>[date,attendanceMap.get(`${employee.id}:${date}`)]));
    const summaries=[dates.slice(0,15),dates.slice(15),dates].map(period=>attendanceSummary(daily,period));
    const plannedDays=Number(employee.payrollPlannedDays||14);
    const baseSalary=includeSalary?Number(employee.baseSalary||0):null;
    const base=[index+1,employee.code||'',employee.lastName||'',employee.firstName||'',employee.branch||'',employee.position||'',baseSalary,baseSalary&&plannedDays?baseSalary/plannedDays:null,employee.company||''];
    const extra=[employee.shiftGroup||'',plannedDays,plannedDays*12,employee.notes||''];
    const summaryCells=summaries.flatMap(item=>[item.day,item.night,item.arrival,item.departure,item.travel,item.rest,item.leave,item.absent,item.workedDays,item.workedHours]);
    sheet.addRow([...base,...dates.map(date=>attendanceCode[daily[date]?.status]||''),...extra,...summaryCells]);
  });
  sheet.views=[{state:'frozen',xSplit:9,ySplit:3}];
  sheet.autoFilter={from:{row:3,column:1},to:{row:3,column:labels.length}};
  sheet.getRow(3).height=42;
  [1,2,3].forEach(rowNumber=>{const row=sheet.getRow(rowNumber);row.font={bold:true,color:{argb:'FFFFFFFF'}};row.fill={type:'pattern',pattern:'solid',fgColor:{argb:rowNumber===3?'FF7155D8':'FF30235E'}};row.alignment={vertical:'middle',wrapText:true,horizontal:'center'}});
  labels.forEach((_,index)=>{sheet.getColumn(index+1).width=index<9?[7,18,18,18,22,25,15,17,25][index]:index<9+dates.length?7:16});
  sheet.getColumn(7).numFmt='#,##0.00';sheet.getColumn(8).numFmt='#,##0.00';
  const buffer=await workbook.xlsx.writeBuffer();
  const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`цагийн-бүртгэл-${month}.xlsx`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
