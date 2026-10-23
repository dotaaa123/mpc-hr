export const rosterCodes = ['d', 'n', 'rr', 'in', 'out', 'adl', 'tr', 'si', 'pl', 'al'];
export const readinessStatuses = ['Ажиллаж байгаа', 'Ажилд бэлэн', 'Засвартай', 'Сэлбэг хүлээлттэй', 'Операторгүй', 'Зогссон'];

export const rosterEmployeeView = employee => Object.fromEntries(
  ['id','code','lastName','firstName','position','shiftGroup','rotationPattern','shiftStart','initialDayNight','hireDate','terminationDate','status']
    .map(key=>[key,employee[key]]).filter(([,value])=>value!==undefined)
);

export function validDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

// The end date is exclusive: October 23 → October 30 covers seven days.
export function rosterRangeDates(startDate, endDate) {
  if (!validDay(startDate) || !validDay(endDate)) throw new Error('Ростерын огноо буруу байна');
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const count = (end - start) / 86400000;
  if (!Number.isInteger(count) || count < 1 || count > 400)
    throw new Error('Дуусах өдөр эхлэх өдрөөс хойш, 400 хоногийн дотор байна');
  return Array.from({ length: count }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
}

export function parseRosterPattern(pattern, expectedDays) {
  const parts = String(pattern || '').split(',').map(part => part.trim());
  if (!parts.length || parts.some(part => !part)) throw new Error('Төлөвийн дараалал оруулна уу');
  const sequence = [];
  for (const part of parts) {
    const match = /^([a-z]+)\s*-\s*([1-9]\d*)$/i.exec(part);
    const code = match?.[1].toLowerCase() === 'e' ? 'd' : match?.[1].toLowerCase();
    const count = Number(match?.[2]);
    if (!match || !rosterCodes.includes(code) || !Number.isSafeInteger(count) || count > 366)
      throw new Error(`Төлөвийн дараалал буруу байна: ${part}`);
    if (sequence.length + count > 400) throw new Error('Нэг дараалал 400 хоногоос их байж болохгүй');
    sequence.push(...Array(count).fill(code));
  }
  if (expectedDays !== undefined && sequence.length !== expectedDays) throw new Error(`Төлөвийн нийлбэр ${expectedDays} өдөр байх ёстой (${sequence.length} өдөр байна)`);
  return sequence;
}

export function buildRosterSequence(startDate, pattern, repeatCount = 1) {
  if (!validDay(startDate)) throw new Error('Эхлэх өдөр буруу байна');
  const codes = parseRosterPattern(pattern);
  const repeats = Number(repeatCount);
  if (!Number.isSafeInteger(repeats) || repeats < 1 || codes.length * repeats > 400)
    throw new Error('Давталтын нийт хугацаа 1–400 хоног байна');
  const endDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + codes.length * repeats * 86400000).toISOString().slice(0, 10);
  const dates = rosterRangeDates(startDate, endDate);
  return dates.map((date, index) => ({ date, code: codes[index % codes.length] }));
}

export function validateRosterEntry(value, getEmployee) {
  if (!validDay(value.date) || !getEmployee(value.employeeId) || !rosterCodes.includes(value.code))
    throw new Error('Ростерын өдөр, ажилтан эсвэл төлөв буруу байна');
}

export function validateTechnicalReadiness(value, getEquipment, getEmployee) {
  if (!validDay(value.weekStart) || !getEquipment(value.equipmentId) ||
      !readinessStatuses.includes(value.dayStatus) || !readinessStatuses.includes(value.nightStatus))
    throw new Error('7 хоногийн техникийн төлөвийн мэдээлэл буруу байна');
  for (const key of ['dayOperatorId', 'nightOperatorId']) {
    if (value[key] && !getEmployee(value[key])) throw new Error('Сонгосон оператор олдсонгүй');
  }
}
