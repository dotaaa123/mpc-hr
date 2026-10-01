const lookalikes = {А:'A',В:'B',Е:'E',К:'K',М:'M',Н:'H',О:'O',Р:'P',С:'C',Т:'T',У:'Y',Х:'X'};
export const normalizeParkNo = value => String(value ?? '').trim().toUpperCase().replace(/[АВЕКМНОРСТУХ]/g,letter=>lookalikes[letter]);
