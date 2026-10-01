const references = {
  employees: ['employeeId','originalEmployeeId','replacementEmployeeId','employeeIds','operatorAId','operatorBId','operatorCId','operatorDId'],
  equipment: ['equipmentId','equipmentIds'],
  camps: ['campId'],
  warehouses: ['warehouseId'],
  plans: ['planId','autoPlanId'],
  guests: ['guestId'],
};

export function importUndoPlan(type,batchId,records) {
  const imported=records.filter(row=>row.type===type&&Number(row.importBatchId)===Number(batchId));
  if(imported.some(row=>String(row.updatedAt)!==String(row.createdAt)))throw new Error('Импортолсон мөрийг дараа нь зассан тул автоматаар буцаах боломжгүй');
  const importedIds=new Set(imported.map(row=>Number(row.id)));
  const generated=type==='plans'?records.filter(row=>row.type==='assignments'&&importedIds.has(Number(row.body?.autoPlanId))):[];
  const deleteIds=new Set([...imported,...generated].map(row=>Number(row.id)));
  if(generated.some(row=>String(row.updatedAt)!==String(row.createdAt)))throw new Error('Төлөвлөгөөний үүсгэсэн ажлыг зассан тул буцаах боломжгүй');
  const fields=references[type]||[];
  if(type==='equipment'){
    const parks=new Set(imported.map(row=>String(row.body?.parkNo||'').trim().toUpperCase()).filter(Boolean));
    const production=records.find(row=>row.type==='productionEntries'&&[row.body?.haulParkNo,row.body?.excavatorParkNo].some(park=>parks.has(String(park||'').trim().toUpperCase())));
    if(production)throw new Error('Импортолсон техник бүтээлийн бүртгэлд ашиглагдсан тул буцаах боломжгүй');
  }
  for(const row of records){
    if(deleteIds.has(Number(row.id)))continue;
    for(const field of fields){
      const value=row.body?.[field];
      if((Array.isArray(value)?value:[value]).some(id=>importedIds.has(Number(id))))throw new Error(`Импортолсон ${type} бүртгэлийг өөр бүртгэл ашиглаж байгаа тул буцаах боломжгүй`);
    }
  }
  return {imported,generated,deleteIds};
}
