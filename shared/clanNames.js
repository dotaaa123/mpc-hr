// Common names listed by the National Statistics Office. The registry contains
// many more names, so the employee form also accepts any name typed by the user.
// https://www.1212.mn/mn/statistic/fun-statistic/family-name
export const commonClanNames = [
  'Боржигон', 'Сартуул', 'Тайж', 'Монгол', 'Шарнууд', 'Бэсүд',
  'Харчин', 'Чонос', 'Өөлд', 'Олхонууд', 'Хотгойд', 'Борлууд',
  'Урианхай', 'Гөрөөчин', 'Хатгин', 'Тайжууд', 'Жалайр',
  'Түгчин', 'Харнууд', 'Зуутраг', 'Хиад Боржигон',
];

export const clanNameOptions = employees => [...new Set([
  ...commonClanNames,
  ...employees.map(employee => String(employee.clanName || '').trim()).filter(Boolean),
])].sort((a, b) => a.localeCompare(b, 'mn')).map(value => ({ value }));
