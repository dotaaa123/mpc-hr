const dayNumber = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? Math.floor(time / 86400000) : null;
};

export function rosterState(employee, date, attendance = [], overrides = []) {
  const employeeId = Number(employee?.id);
  if (!employee || !employeeId) return { code:'unknown', label:'Ажилтан тодорхойгүй', available:false };
  if (employee.terminationDate && employee.terminationDate <= date || employee.status === 'inactive')
    return { code:'inactive', label:'Ажлаас гарсан / идэвхгүй', available:false };

  const replacement = overrides.find(row => row.date === date && Number(row.replacementEmployeeId) === employeeId);
  const replaced = overrides.find(row => row.date === date && Number(row.originalEmployeeId) === employeeId);
  if (replaced) return { code:'replaced', label:'Орлогдон солигдсон', available:false, overrideId:replaced.id };

  const actual = attendance.find(row => row.date === date && Number(row.employeeId) === employeeId);
  if (actual) {
    const labels = { day:'Өдөр ажилласан', night:'Шөнө ажилласан', travel:'Замд явсан', absent:'Ажиллаагүй', rest:'Амралттай', leave:'Чөлөөтэй' };
    return { code:actual.status, label:labels[actual.status] || actual.status, available:['day','night'].includes(actual.status), shift:['day','night'].includes(actual.status)?actual.status:null, actualHours:Number(actual.actualHours || 0), recorded:true };
  }
  if (replacement) return { code:'extended', label:'Орлон / сунгаж ажиллах', available:true, shift:replacement.shift || null, overrideId:replacement.id };
  if (employee.status === 'leave') return { code:'leave', label:'Чөлөөтэй', available:false };

  const start = dayNumber(employee.shiftStart);
  const current = dayNumber(date);
  if (start === null || current === null) return { code:'unassigned', label:'Ээлж тохируулаагүй', available:false };
  const diff = current - start;
  if (diff < 0) return { code:'rest', label:'Ээлж эхлээгүй', available:false };

  const pattern = employee.rotationPattern || '14/14';
  const lengths = pattern === '20/10' ? [20,10] : pattern === '14/14' ? [14,14] : null;
  if (!lengths) return { code:'unassigned', label:'Хос ээлжийн хоногийн горим тохируулаагүй', available:false };
  const [workDays,restDays] = lengths;
  const phase = diff % (workDays + restDays);
  const available = phase < workDays;
  const initial = employee.initialDayNight === 'night' ? 'night' : 'day';
  const shift = available ? Math.floor(diff / 7) % 2 === 0 ? initial : initial === 'day' ? 'night' : 'day' : null;
  return { code:available?'ready':'rest', label:available?`${shift === 'night' ? 'Шөнийн' : 'Өдрийн'} ээлжийн хуваарь`:'Амралттай', available, shift, daysLeft:available?workDays-phase:workDays+restDays-phase, pattern };
}
