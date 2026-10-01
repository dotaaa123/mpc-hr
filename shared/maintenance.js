const minutesOfDay=value=>{
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||'')))throw new Error('Цагийг HH:MM хэлбэрээр оруулна уу');
  const [hour,minute]=value.split(':').map(Number);
  return hour*60+minute;
};

export function normalizeMaintenance(value) {
  const start=minutesOfDay(value.startTime);
  if(value.endTime){
    const end=minutesOfDay(value.endTime);
    value.minutes=(end-start+1440)%1440;
    value.status='closed';
  }else{
    const minutes=Number(value.minutes||0);
    if(!Number.isFinite(minutes)||minutes<0||minutes>1440)throw new Error('Зогссон минут 0–1440 байна');
    value.minutes=minutes;
    value.status='open';
  }
  return value;
}
