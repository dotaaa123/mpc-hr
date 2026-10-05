import { normalizeParkNo } from './parkNo.js';

// Ууцар 2026-9сар.xlsx: Actual!O and Data!F:G.
export const materialTypes = ['Waste', 'Sand', 'Engineering'];

const haulCapacities = new Map([
  ...[448,449,...Array.from({length:17},(_,index)=>451+index)].map(park=>[String(park),27]),
  ...['MT-01','MT-02','MT-03','MT-04','MT-05','MT-06','MT-08','MT-4823','MT-4832','MT-4833','MT-7831','MT-7843','MT-7865','DT-13','DT-18','DT-25','DT-26','DT-28','DT-363','MT-4844'].map(park=>[park,22]),
]);

export const haulCapacityForPark = park => haulCapacities.get(normalizeParkNo(park));
