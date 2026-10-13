// Pages backed by a record type use that type's permissions. These views have
// their own visibility switch and keep their underlying record permissions.
export const viewPages = [
  {key:'dashboard',label:'Хяналтын самбар',adminOnly:true},
  {key:'timesheet',label:'Цагийн мэдээ',source:'attendance'},
  {key:'payroll',label:'Цалин бодолт',source:'payrollEntries'},
  {key:'roster',label:'Ээлжийн мэдээ',source:'employees'},
  {key:'rosterSketch',label:'Ростерын зураглал',source:'employees'},
  {key:'campCheck',label:'Хүмүүсээ шалгах',campOnly:true,source:'attendance'},
  {key:'tasks',label:'Ажлын хуваарь',source:'assignments'},
  {key:'reports',label:'Тайлан',adminOnly:true},
  {key:'users',label:'Хэрэглэгчид',adminOnly:true},
  {key:'permissions',label:'Эрхийн тохиргоо',adminOnly:true,alwaysVisible:true},
  {key:'audit',label:'Аудит лог',adminOnly:true},
  {key:'desktopRelease',label:'Windows програм',adminOnly:true},
];

export const addViewPermissions = (role, base) => {
  const result={...base};
  for(const page of viewPages) {
    if(result[page.key]!==undefined)continue;
    const visible=role==='admin'&&!page.campOnly
      ||(!page.adminOnly&&(!page.campOnly||role==='camp')&&base[page.source]?.includes('read'));
    result[page.key]=visible?['read']:[];
  }
  return result;
};

export const permissionMatrix = (role, defaults, stored, recordTypes) => {
  if(role!=='admin') {
    const matrix=addViewPermissions(role,{...defaults,...stored});
    for(const page of viewPages) {
      if(page.adminOnly||page.campOnly&&role!=='camp')matrix[page.key]=[];
    }
    return matrix;
  }
  const matrix=addViewPermissions('admin',Object.fromEntries(recordTypes.map(key=>[key,['read','create','update','delete']])));
  for(const [key,actions] of Object.entries(stored||{})) {
    if(Array.isArray(actions)&&!actions.includes('read')&&key!=='permissions'&&matrix[key]) {
      matrix[key]=matrix[key].filter(action=>action!=='read');
    }
  }
  matrix.campCheck=[];
  return matrix;
};
