export const roles = ['admin', 'dispatcher', 'clerk', 'camp', 'hr'];
export const types = ['employees', 'attendance', 'equipment', 'camps', 'warehouses', 'plans', 'assignments', 'fuel', 'other', 'machineLogs'];
export const required = {
  employees: ['lastName', 'firstName', 'register', 'position'],
  attendance: ['date','employeeId','status'],
  equipment: ['parkNo', 'kind', 'model'],
  camps: ['name'],
  warehouses: ['name'],
  plans: ['name', 'startDate', 'endDate', 'targetOutput'],
  assignments: ['date', 'title', 'shift'],
  fuel: ['date', 'kind', 'liters'],
  other: ['date', 'name', 'amount'],
  machineLogs: ['date','equipmentId','employeeId','shiftGroup','startHours','endHours'],
};
export const permitted = {
  employees: ['lastName','firstName','register','phone','bankAccount','position','campId','shiftStart','shiftGroup','status','notes'],
  attendance: ['date','employeeId','status','plannedHours','actualHours','campId','notes'],
  equipment: ['parkNo','kind','brand','model','vin','plateNo','site','warehouseId','owner','currentHours','fuelRate','status','availability','year','sourceStatus','contractNo','contractCompany','unitPriceMnt','currency','warranty','certificate','customsDocument','passport','sourceSheet','sourceRow','sourceData','notes'],
  camps: ['name','location','capacity','workType','manager','notes'],
  warehouses: ['name','location','manager','notes'],
  plans: ['name','startDate','endDate','site','warehouseId','shift','targetOutput','outputUnit','unitRevenue','requiredEquipment','equipmentNeeds','requiredWorkers','employeeIds','equipmentIds','plannedHours','plannedFuel','notes'],
  assignments: ['date','title','site','shift','employeeId','equipmentId','planId','campId','plannedHours','plannedFuel','plannedOutput','autoPlanId','scheduleKey','notes'],
  fuel: ['date','kind','equipmentId','liters','pricePerLiter','supplier','notes'],
  other: ['date','name','category','amount','notes'],
  machineLogs: ['date','equipmentId','employeeId','shiftGroup','startHours','endHours','startKm','endKm','startTime','endTime','stopMinutes','stopReason','operatorConfirmed','masterConfirmed','dispatcherChecked','fuelUsed','notes'],
};
