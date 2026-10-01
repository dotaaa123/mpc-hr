export const shiftHourFields = [
  ['productiveHours','Бүтээлтэй ажилласан'],
  ['moveHours','Экс/дамп нүүдэл'],
  ['fuelingHours','Түлш цэнэглэлт'],
  ['noFuelHours','Түлшгүй'],
  ['noOperatorHours','Операторгүй'],
  ['surveyHours','Маркшейдерийн хэмжилт'],
  ['safetyHours','Зөрчил арилгах / ХАБ'],
  ['loadingWaitHours','Асаалттай ачилт хүлээсэн'],
  ['engineeringHours','Инженерийн ажил'],
  ['personalHours','Хувийн цаг'],
  ['safetyMeetingHours','АА цаг'],
  ['handoverHours','Ээлж солих'],
  ['mealBreakHours','Цайны цаг'],
  ['repairHours','Засвар'],
  ['lubricationHours','Тосолгоо'],
  ['readyHours','Бэлэн байдал'],
  ['weatherHours','Цаг агаар'],
  ['managementHours','Удирдлагын шийдвэр'],
];
export const shiftHourTotal = value => shiftHourFields.reduce((sum,[key])=>sum+Number(value[key]||0),0);
export function validateShiftHours(value) {
  for(const [key,label] of shiftHourFields) if(value[key]!==undefined&&(!Number.isFinite(Number(value[key]))||Number(value[key])<0||Number(value[key])>12))throw new Error(`${label}: 0–12 цаг оруулна уу`);
  if(value.productiveHours===undefined)throw new Error('Бүтээлтэй ажилласан цаг болон зогсолтын цагуудыг бөглөнө үү');
  const total=shiftHourTotal(value);
  if(Math.abs(total-12)>0.01)throw new Error(`Ажилласан ба зогссон цагийн нийлбэр 12 байх ёстой. Одоо ${total.toFixed(2)} цаг байна`);
  if(Number(value.endHours)-Number(value.startHours)+0.01<Number(value.productiveHours||0))throw new Error('Бүтээлтэй ажилласан цаг мото цагийн зөрүүнээс их байж болохгүй');
  return value;
}
