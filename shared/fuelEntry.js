import { normalizePark } from './equipmentIdentity.js';

export function validateFuelEntry(value, equipment) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value.date||'')) || Number.isNaN(Date.parse(`${value.date}T00:00:00Z`))) throw new Error('Түлш авсан огноо буруу байна');
  if(!['receipt','usage'].includes(value.kind)) throw new Error('Түлшний гүйлгээний төрөл буруу байна');
  if(!Number.isFinite(Number(value.liters))||Number(value.liters)<=0) throw new Error('Авсан түлшний литр 0-ээс их байна');
  if(value.receivedTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value.receivedTime))) throw new Error('Түлш авсан цагийг HH:MM хэлбэрээр оруулна уу');
  if(value.motorHours!==undefined&&value.motorHours!==''&&(!Number.isFinite(Number(value.motorHours))||Number(value.motorHours)<0)) throw new Error('Түлш авсан үеийн мото цаг буруу байна');
  if(value.equipmentId){
    if(!equipment)throw new Error('Сонгосон техник олдсонгүй');
    if(value.parkNo&&normalizePark(value.parkNo)!==normalizePark(equipment.parkNo))throw new Error('Түлшний парк дугаар сонгосон техниктэй зөрж байна');
    value.parkNo=equipment.parkNo;
    value.equipmentType ||= equipment.kind;
  }
  if(value.kind==='usage'&&!value.equipmentId&&!String(value.parkNo||'').trim())throw new Error('Техник эсвэл парк дугаар сонгоно уу');
  return value;
}
