import { productionSourceKey } from './production.js';

export function importBatchKey(type, value) {
  switch (type) {
    case 'employees': return value.register && `employee:${value.register}`;
    case 'attendance': return value.employeeId && value.date && `attendance:${value.employeeId}:${value.date}`;
    case 'equipment': return value.vin ? `equipment-vin:${value.vin}` : value.parkNo && `equipment-park:${value.parkNo}`;
    case 'productionEntries': return productionSourceKey(value);
    case 'machineLogs': return value.equipmentId && value.date && value.workShift && `machine:${value.equipmentId}:${value.date}:${value.workShift}`;
    case 'payrollEntries': return value.employeeId && value.month && value.half && `payroll:${value.employeeId}:${value.month}:${value.half}`;
    case 'campStays': return value.date && (value.employeeId || value.guestId) && `stay:${value.date}:${value.employeeId || `guest-${value.guestId}`}`;
    default: return null;
  }
}
