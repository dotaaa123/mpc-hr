export const normalizeVin = input => String(input || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[АВЕКМНОРСТУХ]/g, letter => ({А:'A',В:'B',Е:'E',К:'K',М:'M',Н:'H',О:'O',Р:'P',С:'C',Т:'T',У:'Y',Х:'X'})[letter]);
export const normalizePark = input => String(input || '').trim().toUpperCase().replace(/\s+/g, ' ');

export function mergeEquipmentSource(old, incoming) {
  const oldVin=normalizeVin(old.vin);
  const newVin=normalizeVin(incoming.vin);
  if(oldVin&&newVin&&oldVin!==newVin)throw new Error(`${incoming.parkNo}: бүртгэлтэй VIN болон Excel-ийн VIN зөрж байна`);
  if(normalizePark(old.parkNo)!==normalizePark(incoming.parkNo))throw new Error(`${incoming.parkNo}: парк дугаар зөрж байна`);
  const after={...old};
  for(const key of ['vin','brand','plateNo','year','tankCapacityLiters']) if((after[key]===undefined||after[key]===null||after[key]==='')&&incoming[key])after[key]=incoming[key];
  if(!after.model||after.model==='Тодорхойгүй')after.model=incoming.model;
  if(!after.kind||after.kind==='Техник')after.kind=incoming.kind;
  return after;
}
