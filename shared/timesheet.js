const pad=value=>String(value).padStart(2,'0');

export function timesheetDates(month,half){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)))throw new Error('Сар буруу байна');
  const [year,number]=month.split('-').map(Number);
  const last=new Date(Date.UTC(year,number,0)).getUTCDate();
  const start=half==='second'?16:1;
  const end=half==='second'?last:15;
  return Array.from({length:end-start+1},(_,index)=>`${month}-${pad(start+index)}`);
}

export function timesheetRows(employees,attendance,month,half){
  const dates=timesheetDates(month,half);
  const records=new Map(attendance.filter(row=>dates.includes(row.date)).map(row=>[`${row.employeeId}:${row.date}`,row]));
  return employees.map(employee=>{
    const eligible=date=>!(employee.hireDate&&date<employee.hireDate||employee.terminationDate&&date>employee.terminationDate);
    const daily=Object.fromEntries(dates.map(date=>[date,records.get(`${employee.id}:${date}`)||(eligible(date)?undefined:null)]));
    const values=Object.values(daily).filter(Boolean);
    const count=status=>values.filter(row=>row.status===status).length;
    const workHours=values.filter(row=>['day','night'].includes(row.status)).reduce((sum,row)=>sum+Number(row.actualHours||0),0);
    const travelHours=count('travel')*8;
    const missingDays=dates.filter(date=>eligible(date)&&!records.has(`${employee.id}:${date}`)).length;
    const employmentConflictDays=dates.filter(date=>!eligible(date)&&records.has(`${employee.id}:${date}`)).length;
    return {employee,daily,dayCount:count('day'),nightCount:count('night'),travelCount:count('travel'),absentCount:count('absent'),restCount:count('rest'),leaveCount:count('leave'),workHours,travelHours,creditedHours:workHours+travelHours,missingDays,employmentConflictDays,missingWorkHours:values.filter(row=>['day','night'].includes(row.status)&&!(Number(row.actualHours)>0)).length};
  });
}
