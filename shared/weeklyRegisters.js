export const rosterCodes = ['d', 'n', 'rr', 'in', 'out', 'adl', 'tr', 'si', 'pl', 'al'];
export const readinessStatuses = ['Ажиллаж байгаа', 'Ажилд бэлэн', 'Засвартай', 'Сэлбэг хүлээлттэй', 'Операторгүй', 'Зогссон'];

export function validDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
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
