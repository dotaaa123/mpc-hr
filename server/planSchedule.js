import { rosterState } from '../shared/rotation.js';

const ids = value => {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return items.filter(item => item !== '' && item !== null && item !== undefined).map(Number);
};

export function assertAssignable(employee,date,shift,attendance=[],overrides=[]) {
  if(!['day','night'].includes(shift))throw new Error('Өдрийн эсвэл шөнийн ээлж сонгоно уу');
  const state=rosterState(employee,date,attendance,overrides);
  if(!state.available||state.shift&&state.shift!==shift)throw new Error(`${date}: ${employee.lastName} ${employee.firstName} ${shift==='night'?'шөнийн':'өдрийн'} ээлжид ажиллах боломжгүй (${state.label})`);
}

export function buildPlanSchedule(plan, employees, equipment, attendance = [], overrides = []) {
  const employeeIds = ids(plan.employeeIds);
  const equipmentIds = ids(plan.equipmentIds);
  if (employeeIds.some(id => !Number.isInteger(id) || id < 1) || new Set(employeeIds).size !== employeeIds.length) throw new Error('Ажилтны сонголт давхардсан эсвэл буруу байна');
  if (equipmentIds.some(id => !Number.isInteger(id) || id < 1) || new Set(equipmentIds).size !== equipmentIds.length) throw new Error('Техникийн сонголт давхардсан эсвэл буруу байна');
  plan.employeeIds = employeeIds;
  plan.equipmentIds = equipmentIds;
  if (employeeIds.length !== Number(plan.requiredWorkers || 0)) throw new Error(`Шаардлагатай ${plan.requiredWorkers || 0} ажилтныг бүгдийг сонгоно уу`);
  if (equipmentIds.length !== Number(plan.requiredEquipment || 0)) throw new Error(`Шаардлагатай ${plan.requiredEquipment || 0} техникийг бүгдийг сонгоно уу`);
  if (!employeeIds.length && !equipmentIds.length) return [];
  if (!['day','night'].includes(plan.shift)) throw new Error('Өдрийн эсвэл шөнийн ээлж сонгоно уу');
  const start = Date.parse(`${plan.startDate}T00:00:00Z`);
  const end = Date.parse(`${plan.endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || (end - start) / 86400000 > 30) throw new Error('Хуваарийн хугацаа 1–31 өдөр байна');
  if ((employeeIds.length + Math.max(0,equipmentIds.length - employeeIds.length)) * ((end-start)/86400000+1) > 500) throw new Error('Нэг төлөвлөгөөнд 500 хүртэл өдрийн даалгавар үүсгэнэ');
  const people = new Map(employees.map(row => [row.id,row]));
  const machines = new Map(equipment.map(row => [row.id,row]));
  for (const id of employeeIds) if (!people.has(id)) throw new Error(`Ажилтан ${id} олдсонгүй`);
  for (const id of equipmentIds) {
    const machine = machines.get(id);
    if (!machine) throw new Error(`Техник ${id} олдсонгүй`);
    if (!plan.warehouseId || Number(machine.warehouseId) !== Number(plan.warehouseId)) throw new Error(`${machine.parkNo} сонгосон агуулахад байхгүй`);
    if (machine.status !== 'ready' || machine.availability !== 'available') throw new Error(`${machine.parkNo} ажилд бэлэн биш байна`);
  }
  const days = Math.round((end-start)/86400000)+1;
  const countPerDay = Math.max(employeeIds.length,equipmentIds.length);
  if (countPerDay > 200) throw new Error('Нэг өдөрт 200 хүртэл ажилтан, техник онооно');
  const assignments=[];
  for (let day=0;day<days;day++) {
    const date=new Date(start+day*86400000).toISOString().slice(0,10);
    for (let index=0;index<countPerDay;index++) {
      const employeeId=employeeIds[index];
      const equipmentId=equipmentIds[index];
      const employee=people.get(employeeId);
      if(employee)assertAssignable(employee,date,plan.shift,attendance,overrides);
      assignments.push({date,title:plan.name,site:plan.site,shift:plan.shift,employeeId,equipmentId,campId:employee?.campId,
        plannedHours:employeeId?Number(plan.plannedHours || 12):0,
        plannedFuel:equipmentId?Number(plan.plannedFuel || 0)/days/Math.max(1,equipmentIds.length):0,
        plannedOutput:employeeId?Number(plan.targetOutput || 0)/days/Math.max(1,employeeIds.length):0,
        notes:plan.notes || '',scheduleKey:`${date}:${employeeId ? `w${employeeId}` : `e${equipmentId}`}`});
    }
  }
  return assignments;
}
