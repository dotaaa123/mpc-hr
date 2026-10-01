import { normalizeParkNo } from '../shared/parkNo.js';

export function validateProduction(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value.date || '')) || Number.isNaN(Date.parse(`${value.date}T00:00:00Z`)) || new Date(`${value.date}T00:00:00Z`).toISOString().slice(0,10)!==value.date) throw new Error('Бүтээлийн огноо буруу байна');
  value.haulParkNo=normalizeParkNo(value.haulParkNo);
  value.excavatorParkNo=normalizeParkNo(value.excavatorParkNo);
  if (!['actual','plan'].includes(value.kind)) throw new Error('Бүтээлийн төрөл буруу байна');
  if (!String(value.material || '').trim()) throw new Error('Материал сонгоно уу');
  if (!Number.isFinite(Number(value.amount)) || Number(value.amount) < 0) throw new Error('Бүтээлийн хэмжээ 0-ээс бага байж болохгүй');
  if (value.kind === 'actual') {
    if (!['day','night'].includes(value.shift)) throw new Error('Өдөр эсвэл шөнийн ээлж сонгоно уу');
    if (!String(value.haulParkNo || '').trim() || !String(value.excavatorParkNo || '').trim()) throw new Error('Автосамосвал болон ачигчийн парк дугаар оруулна уу');
    if (!Number.isInteger(Number(value.race)) || Number(value.race) < 1) throw new Error('Рейсийн тоо 1-ээс бага байж болохгүй');
    if (!Number.isFinite(Number(value.capacity)) || Number(value.capacity) <= 0) throw new Error('Нэг рейсийн багтаамж оруулна уу');
    if (Math.abs(Number(value.race) * Number(value.capacity) - Number(value.amount)) > 0.01) throw new Error('Бүтээл = рейс × нэг рейсийн багтаамж байх ёстой');
  }
  if (value.kind === 'plan' && !String(value.excavatorParkNo || '').trim()) throw new Error('Төлөвлөгөөний ачигчийг оруулна уу');
  if (value.sourceRow !== undefined && (!Number.isInteger(Number(value.sourceRow)) || Number(value.sourceRow) < 1)) throw new Error('Эх Excel-ийн мөр буруу байна');
  return value;
}

export function productionSourceKey(value) {
  return value.sourceFile && value.sourceSheet && value.sourceRow
    ? `${String(value.sourceFile).trim().toLowerCase()}|${String(value.sourceSheet).trim().toLowerCase()}|${Number(value.sourceRow)}`
    : null;
}
