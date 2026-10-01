const links = {
  employees: {attendance:['employeeId'],assignments:['employeeId'],machineLogs:['employeeId'],travelExpenses:['employeeId'],shiftOverrides:['originalEmployeeId','replacementEmployeeId'],campStays:['employeeId'],mealFeedback:['employeeId'],bedAssignments:['employeeId'],plans:['employeeIds'],equipment:['operatorAId','operatorBId','operatorCId','operatorDId']},
  equipment: {assignments:['equipmentId'],machineLogs:['equipmentId'],maintenance:['equipmentId'],fuel:['equipmentId'],plans:['equipmentIds']},
  camps: {employees:['campId'],attendance:['campId'],assignments:['campId'],guests:['campId'],campStays:['campId'],mealMenus:['campId'],mealFeedback:['campId'],bedAssignments:['campId']},
  warehouses: {equipment:['warehouseId'],plans:['warehouseId']},
  guests: {campStays:['guestId']},
};

export function findDependentRecord(type,id,records) {
  if(type==='equipment'){
    const parkNo=String((records.equipment||[]).find(row=>Number(row.id)===Number(id))?.parkNo||'').trim().toUpperCase();
    const production=parkNo&&(records.productionEntries||[]).find(row=>row.haulParkNo===parkNo||row.excavatorParkNo===parkNo);
    if(production)return {type:'productionEntries',id:production.id};
  }
  for (const [source,fields] of Object.entries(links[type]||{})) {
    const row=(records[source]||[]).find(item=>fields.some(field=>Array.isArray(item[field])?item[field].some(value=>Number(value)===Number(id)):Number(item[field])===Number(id)));
    if(row)return {type:source,id:row.id};
  }
  return null;
}
