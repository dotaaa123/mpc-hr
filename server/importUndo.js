const references = {
  employees: ['employeeId','originalEmployeeId','replacementEmployeeId','employeeIds'],
  equipment: ['equipmentId','equipmentIds'],
  camps: ['campId'],
  warehouses: ['warehouseId'],
  plans: ['planId','autoPlanId'],
  guests: ['guestId'],
};

export function importUndoPlan(type,batchId,records) {
  const imported=records.filter(row=>Number(row.importBatchId)===Number(batchId));
  if(imported.some(row=>String(row.updatedAt)!==String(row.createdAt)))throw new Error('Импортолсон мөрийг дараа нь зассан тул автоматаар буцаах боломжгүй');
  const importedIds=new Set(imported.map(row=>Number(row.id)));
  const generated=type==='plans'?records.filter(row=>row.type==='assignments'&&importedIds.has(Number(row.body?.autoPlanId))):[];
  const deleteIds=new Set([...imported,...generated].map(row=>Number(row.id)));
  if(generated.some(row=>String(row.updatedAt)!==String(row.createdAt)))throw new Error('Төлөвлөгөөний үүсгэсэн ажлыг зассан тул буцаах боломжгүй');
  const fields=references[type]||[];
  for(const row of records){
    if(deleteIds.has(Number(row.id)))continue;
    for(const field of fields){
      const value=row.body?.[field];
      if((Array.isArray(value)?value:[value]).some(id=>importedIds.has(Number(id))))throw new Error(`Импортолсон ${type} бүртгэлийг өөр бүртгэл ашиглаж байгаа тул буцаах боломжгүй`);
    }
  }
  return {imported,generated,deleteIds};
}
