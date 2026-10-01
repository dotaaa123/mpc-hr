import { timesheetRows } from './timesheet.js';

const amount = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const rounded = value => Math.round((value + Number.EPSILON) * 100) / 100;

// Mirrors the brackets in the supplied September 2026 payroll workbook.
export function workbookTaxRelief(base) {
  if (base <= 0) return 0;
  if (base <= 500000) return 20000;
  if (base <= 1000000) return 18000;
  if (base <= 1500000) return 16000;
  if (base <= 2000000) return 14000;
  if (base <= 2500000) return 12000;
  if (base <= 3000000) return 10000;
  return 0;
}

export function calculatePayroll(employee, time, entry = {}) {
  const baseSalary = amount(entry.baseSalary ?? employee.baseSalary);
  // Recorded planned hours cover only entered dates, so they cannot stand in for
  // the pay period denominator (14/20/30 days in the supplied workbook).
  const plannedHours = amount(entry.plannedHours ?? amount(employee.payrollPlannedDays) * 12);
  const workedHours = amount(entry.workedHours ?? time.workHours);
  const travelDays = amount(entry.travelDays ?? time.travelCount);
  const insuredShare = amount(entry.insuredShare ?? employee.insuredShare ?? 0.5);
  const insuranceRate = amount(entry.insuranceRate ?? 0.115);
  const taxRate = amount(entry.taxRate ?? 0.1);
  const otherDeduction = amount(entry.otherDeduction);
  const extraPay = amount(entry.extraPay);
  const errors = [];
  if (baseSalary <= 0) errors.push('Үндсэн цалин оруулаагүй');
  if (plannedHours <= 0) errors.push('Ажиллавал зохих цаг оруулаагүй');
  if ((entry.workedHours === undefined && (time.missingDays || time.missingWorkHours)) || time.employmentConflictDays) errors.push('Цагийн бүртгэл дутуу эсвэл зөрүүтэй');
  if (insuredShare < 0 || insuredShare > 1) errors.push('НДШ тооцох хувь 0–100% байх ёстой');
  if (workedHours < 0 || travelDays < 0 || otherDeduction < 0 || extraPay < 0) errors.push('Сөрөг дүн байж болохгүй');
  const hourlyRate = plannedHours > 0 ? baseSalary / plannedHours : 0;
  const workPay = hourlyRate * workedHours;
  const travelPay = hourlyRate * travelDays;
  const grossPay = workPay + travelPay + extraPay;
  const insuredBase = grossPay * insuredShare;
  const insurance = insuredBase * insuranceRate;
  const taxBase = insuredBase - insurance;
  const taxRelief = workbookTaxRelief(taxBase);
  const incomeTax = Math.max(0, taxBase * taxRate - taxRelief);
  const totalDeduction = insurance + incomeTax + otherDeduction;
  const netPay = grossPay - totalDeduction;
  if (netPay < 0 || insuredBase - totalDeduction < 0) errors.push('Суутгал дансаар олгох дүнгээс их');
  const result={ employeeId: employee.id, baseSalary, plannedHours, workedHours, travelDays, hourlyRate:rounded(hourlyRate), workPay:rounded(workPay), travelPay:rounded(travelPay), extraPay, grossPay:rounded(grossPay), insuredShare, insuredBase:rounded(insuredBase), insuranceRate, insurance:rounded(insurance), taxBase:rounded(taxBase), taxRate, taxRelief, incomeTax:rounded(incomeTax), otherDeduction, totalDeduction:rounded(totalDeduction), netPay:rounded(netPay), bankPay:rounded(insuredBase - totalDeduction), cashPay:rounded(grossPay - insuredBase), errors };
  return entry.skipPayroll ? {...result,workPay:0,travelPay:0,extraPay:0,grossPay:0,insuredBase:0,insurance:0,taxBase:0,taxRelief:0,incomeTax:0,totalDeduction:0,netPay:0,bankPay:0,cashPay:0,errors:[],skipped:true,skipReason:entry.skipReason,notes:entry.notes} : result;
}

export function payrollRows(employees, attendance, entries, month, half) {
  const time = timesheetRows(employees, attendance, month, half);
  const entryByEmployee = new Map(entries.filter(row => row.month === month && row.half === half).map(row => [Number(row.employeeId), row]));
  return time.map(row => ({ ...calculatePayroll(row.employee, row, entryByEmployee.get(row.employee.id)), employee:row.employee, time:row, entry:entryByEmployee.get(row.employee.id) }));
}
