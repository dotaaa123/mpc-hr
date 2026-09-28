import React, { useEffect, useMemo, useState } from 'react';
import { ConfigProvider, App as AntApp, Layout, Menu, Drawer, Button, Card, Table, Tag, Space, Typography, Input, Form, Modal, Select, InputNumber, DatePicker, message, Statistic, Row, Col, Upload, Empty, Popconfirm, Segmented, Alert, Descriptions, Progress, Badge } from 'antd';
import { DashboardOutlined, TeamOutlined, ApartmentOutlined, ToolOutlined, HomeOutlined, BarChartOutlined, FileDoneOutlined, FireOutlined, MoreOutlined, UserOutlined, PlusOutlined, UploadOutlined, DownloadOutlined, EditOutlined, DeleteOutlined, LogoutOutlined, SearchOutlined, CalendarOutlined, CheckCircleOutlined, WarningOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined, DisconnectOutlined, ReloadOutlined } from '@ant-design/icons';
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import dayjs from 'dayjs';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;
const today = () => dayjs().format('YYYY-MM-DD');
const money = n => new Intl.NumberFormat('mn-MN').format(Math.round(Number(n || 0)));
const num = n => Number(n || 0);
const roleNames = {admin:'Админ',dispatcher:'Диспетчер',clerk:'Клерк',camp:'Camp',hr:'HR'};
const statusColors = {ready:'green',maintenance:'orange',inactive:'default',available:'green',assigned:'blue',sold:'default',day:'blue',night:'purple',absent:'red',leave:'gold',rest:'default',done:'green',not_done:'red'};
const statusLabels = {ready:'Бэлэн',maintenance:'Засварт',inactive:'Идэвхгүй',available:'Сул нөөц',assigned:'Ашиглаж буй',sold:'Борлуулсан',day:'Өдөр',night:'Шөнө',absent:'Ажиллаагүй',leave:'Чөлөөтэй',rest:'Амралттай',done:'Хийсэн',not_done:'Хийгээгүй',pending:'Хүлээгдэж буй',yes:'Тийм',no:'Үгүй'};
const positions = ['Төслийн менежер','Уурхайн дарга','Уулын сургагч','Уулын мастер','Өргөе буулгагч','Экскаваторын оператор','Бульдозер','Ковшийн оператор','Авто грейдерийн оператор','Усны машин жолооч','Ашиглалтын инженер/геологи','Маркшейдер','Диспетчер','Засварын инженер','Гадаад мэргэжилтэн','Засварын мастер','Клерк','Засварчин','Гагнуурчин','Цахилгаанчин','Дугуйчин','Тосолгоочин','Харуул','ХАБ-ажилтан','БО-ны мэргэжилтэн','Эмч','Түлшний нярав','Сэлбэг АА-н нярав','Кемп менежер','Түлшний жолооч','Үйлчилгээний жолооч','Баяжуулагч инженер','Баяжуулагч мастер','Механик','Усан буучин','Дотоод хяналт','Алт угаагч','Насосчин','Туслах','Цахилгааны инженер','Ахлах цахилгаанчин'];
const field = (key,label,type='text',extra={}) => ({key,label,type,...extra});
const schemas = {
  employees:{title:'Ажилтан',singular:'Ажилтан',fields:[field('lastName','Овог','text',{required:true}),field('firstName','Нэр','text',{required:true}),field('register','Регистр','text',{required:true}),field('phone','Утасны дугаар'),field('bankAccount','Данс'),field('position','Албан тушаал','position',{required:true}),field('campId','Camp','camp'),field('shiftStart','Ээлж эхэлсэн өдөр','date'),field('shiftGroup','Ээлжийн бүлэг','select',{options:['A','B','C','D']}),field('status','Онцгой төлөв','select',{options:['normal','leave','inactive']}),field('notes','Тэмдэглэл')]},
  attendance:{title:'Цаг бүртгэл',singular:'Ирц',fields:[field('date','Өдөр','date',{required:true}),field('employeeId','Ажилтан','employee',{required:true}),field('campId','Camp','camp'),field('status','Төлөв','select',{required:true,options:['day','night','absent','rest','leave']}),field('plannedHours','Төлөвлөсөн цаг','number'),field('actualHours','Ажилласан цаг','number'),field('notes','Тэмдэглэл')]},
  equipment:{title:'Техник',singular:'Техник',fields:[field('parkNo','Парк дугаар','text',{required:true}),field('kind','Төрөл','text',{required:true}),field('brand','Марк'),field('model','Загвар','text',{required:true}),field('vin','Арлын дугаар / VIN'),field('plateNo','Улсын дугаар'),field('year','Үйлдвэрлэсэн он'),field('site','Байршил'),field('warehouseId','Агуулах','warehouse'),field('owner','Эзэмшигч'),field('currentHours','Мото цаг','number'),field('fuelRate','Түлшний норм л/цаг','number'),field('status','Ажлын бэлэн байдал','select',{options:['ready','maintenance','inactive']}),field('availability','Ашиглалтын төлөв','select',{options:['available','assigned','sold','inactive']}),field('sourceStatus','Эх бүртгэлийн төлөв'),field('contractNo','Гэрээний дугаар'),field('contractCompany','Гэрээ хийсэн компани'),field('unitPriceMnt','Нэгж үнэ ₮','number'),field('currency','Валют'),field('warranty','Баталгаат хугацаа'),field('certificate','Гэрчилгээ'),field('customsDocument','Гаалийн бичиг'),field('passport','Техникийн паспорт'),field('notes','Тэмдэглэл')]},
  camps:{title:'Camp',singular:'Camp',fields:[field('name','Camp нэр','text',{required:true}),field('location','Байршил'),field('capacity','Багтаамж','number'),field('workType','Хийгдэх ажил'),field('manager','Хариуцагч'),field('notes','Тэмдэглэл')]},
  warehouses:{title:'Агуулах',singular:'Агуулах',fields:[field('name','Агуулах нэр','text',{required:true}),field('location','Байршил'),field('manager','Хариуцагч'),field('notes','Тэмдэглэл')]},
  plans:{title:'Бүтээл · төлөвлөгөө',singular:'Төлөвлөгөө',fields:[field('name','Ажлын нэр','text',{required:true}),field('startDate','Эхлэх өдөр','date',{required:true}),field('endDate','Дуусах өдөр','date',{required:true}),field('site','Байршил'),field('warehouseId','Техник авах агуулах','warehouse'),field('targetOutput','Зорилтот бүтээл','number',{required:true}),field('outputUnit','Нэгж','select',{options:['м³','тн','рейс','цаг']}),field('unitRevenue','Нэгжийн орлого ₮','number'),field('requiredEquipment','Шаардлагатай техник','number'),field('equipmentNeeds','Төрлөөр хэрэгцээ (Төрөл:тоо, ...)'),field('requiredWorkers','Шаардлагатай ажилтан','number'),field('plannedFuel','Төлөвлөсөн түлш л','number'),field('notes','Тэмдэглэл')]},
  assignments:{title:'Өдрийн ажил',singular:'Даалгавар',fields:[field('date','Өдөр','date',{required:true}),field('title','Ажил','text',{required:true}),field('site','Байршил'),field('shift','Ээлж','select',{required:true,options:['day','night']}),field('employeeId','Ажилтан','employee'),field('equipmentId','Техник','equipment'),field('planId','Төлөвлөгөө','plan'),field('campId','Camp','camp'),field('plannedHours','Төлөвлөсөн цаг','number'),field('plannedFuel','Төлөвлөсөн түлш л','number'),field('plannedOutput','Төлөвлөсөн бүтээл','number'),field('notes','Тэмдэглэл')]},
  fuel:{title:'Түлш',singular:'Түлшний бичилт',fields:[field('date','Өдөр','date',{required:true}),field('kind','Гүйлгээ','select',{required:true,options:['receipt','usage']}),field('equipmentId','Техник','equipment'),field('liters','Литр','number',{required:true}),field('pricePerLiter','Нэг литрийн үнэ ₮','number'),field('supplier','Нийлүүлэгч / олгосон хүн'),field('notes','Тэмдэглэл')]},
  other:{title:'Бусад зардал',singular:'Зардал',fields:[field('date','Өдөр','date',{required:true}),field('name','Нэр','text',{required:true}),field('category','Ангилал','select',{options:['Сэлбэг','Засвар','Camp','Хангамж','Бусад']}),field('amount','Дүн ₮','number',{required:true}),field('notes','Тэмдэглэл')]},
  machineLogs:{title:'Мото цагийн бүртгэл',singular:'Мото цаг',fields:[field('date','Өдөр','date',{required:true}),field('equipmentId','Техник','equipment',{required:true}),field('employeeId','Оператор','employee',{required:true}),field('shiftGroup','Ээлж','select',{required:true,options:['A','B','C','D']}),field('startHours','Эхэлсэн мото цаг','number',{required:true}),field('endHours','Дууссан мото цаг','number',{required:true}),field('startKm','Эхэлсэн км','number'),field('endKm','Дууссан км','number'),field('startTime','Эхэлсэн цаг'),field('endTime','Дууссан цаг'),field('stopMinutes','Зогсолт (мин)','number'),field('stopReason','Зогсолтын шалтгаан','select',{options:['Түлш цэнэглэх','Нүүдэл','Тэсэлгээ','Цаг агаар','Хоолны цаг','Аюулгүй цаг','Ээлж солих','Бэлэн байдал','РМ','Бусад засвар','Дугуй хагарсан','Бусад']}),field('operatorConfirmed','Оператор баталсан','select',{options:['yes','no']}),field('masterConfirmed','Мастер баталсан','select',{options:['yes','no']}),field('dispatcherChecked','Диспетчер шалгасан','select',{options:['yes','no']}),field('fuelUsed','Авсан түлш (л)','number'),field('notes','Тэмдэглэл')]},
};
const labels = {receipt:'Орлого / нөөц',usage:'Зарцуулалт',normal:'Хэвийн'};
const titleMap={dashboard:'Самбар',employees:'Ажилтан',attendance:'Цаг бүртгэл',campCheck:'Шалгах',plans:'Бүтээл',manpower:'Хүн хүч',equipment:'Техник',camps:'Camp',reports:'Тайлан',warehouses:'Агуулах',tasks:'Ажил',machineLogs:'Мото цаг',fuel:'Түлш',other:'Бусад',users:'Хэрэглэгчид'};
async function downloadExcel(columns,rows,filename) {
  const {default:ExcelJS}=await import('exceljs');
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('Бүртгэл');
  sheet.columns=columns.map(label=>({header:label,key:label,width:Math.min(32,Math.max(16,label.length+5))}));
  rows.forEach(row=>sheet.addRow(row));
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF7656D8'}};
  const blob=new Blob([await workbook.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function readExcel(file) {
  const {default:ExcelJS}=await import('exceljs');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await file.arrayBuffer());
  const sheet=workbook.worksheets[0];if (!sheet) throw new Error('Excel sheet олдсонгүй');
  const headers=sheet.getRow(1).values.slice(1).map(String);
  const rows=[];
  for(let index=2;index<=sheet.rowCount;index++) {
    const row=sheet.getRow(index);
    if (!row.hasValues) continue;
    rows.push(Object.fromEntries(headers.map((header,i)=>{const cell=row.getCell(i+1);return [header,cell.value instanceof Date?dayjs(cell.value).format('YYYY-MM-DD'):cell.text]})));
  }
  return rows;
}
async function api(url, options={}) {
  const res=await fetch(`/api${url}`,{...options,headers:{'Content-Type':'application/json',...(options.headers || {})},credentials:'same-origin'});
  const body=await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(body.error || 'Алдаа гарлаа');
  return body;
}
function workState(employee, date, attendance=[]) {
  const actual=attendance.find(row=>Number(row.employeeId)===employee.id&&row.date===date);
  if (actual) return {label:actual.status==='day'?'Өдөр ажилласан':actual.status==='night'?'Шөнө ажилласан':statusLabels[actual.status],code:actual.status,available:['day','night'].includes(actual.status),actualHours:num(actual.actualHours),recorded:true};
  if (employee.status==='leave') return {label:'Чөлөөтэй',code:'leave',available:false};
  if (employee.status==='inactive') return {label:'Идэвхгүй',code:'inactive',available:false};
  if (!employee.shiftStart) return {label:'Ээлж тохируулаагүй',code:'rest',available:false};
  const diff=dayjs(date).startOf('day').diff(dayjs(employee.shiftStart).startOf('day'),'day');
  if (diff<0) return {label:'Ээлж эхлээгүй',code:'rest',available:false};
  const phase=((diff%28)+28)%28;
  const active=phase<14;
  return {label:active ? 'Ажиллаж байна' : 'Амралттай',code:active?'ready':'rest',available:active,daysLeft:active?14-phase:28-phase};
}
function StatusTag({value}) {return <Tag color={statusColors[value] || 'default'}>{statusLabels[value] || labels[value] || value || '—'}</Tag>}

function Login({onLogin}) {
  const [loading,setLoading]=useState(false);
  async function submit(values) { setLoading(true); try { onLogin(await api('/login',{method:'POST',body:JSON.stringify(values)})); } catch(e) {message.error(e.message)} finally {setLoading(false)} }
  return <div className="login-page"><div className="login-art"><div className="brand-symbol">Т</div><div className="login-art-bottom"><span>УУРХАЙН ҮЙЛ АЖИЛЛАГАА</span><h1>Хүн хүч.<br/>Ээлж.<br/>Бүтээл.</h1><p>Өдөр тутмын төлөвлөлт, гүйцэтгэл, тайланг нэг дор.</p></div></div><div className="login-panel"><div className="login-inner w-full max-w-sm"><div className="login-kicker">ТҮР HR · MPC</div><Title level={2}>Тавтай морил</Title><Text type="secondary">Уурхайн цаг бүртгэл, ажлын удирдлагын систем</Text><Form layout="vertical" onFinish={submit} className="login-form"><Form.Item name="username" label="Нэвтрэх нэр" rules={[{required:true,message:'Нэвтрэх нэр оруулна уу'}]}><Input size="large" placeholder="Нэвтрэх нэр"/></Form.Item><Form.Item name="password" label="Нууц үг" rules={[{required:true,message:'Нууц үг оруулна уу'}]}><Input.Password size="large" placeholder="Нууц үг"/></Form.Item><Button type="primary" htmlType="submit" size="large" block loading={loading}>Нэвтрэх</Button></Form><div className="login-foot">MPC · Дотоод хэрэглээ</div></div></div></div>
}

function RecordForm({type,initial,lists,onSaved,onCancel}) {
  const [form]=Form.useForm();
  const schema=schemas[type];
  const optionMap={camp:lists.camps.map(x=>({value:x.id,label:x.name})),warehouse:lists.warehouses.map(x=>({value:x.id,label:x.name})),employee:lists.employees.map(x=>({value:x.id,label:`${x.lastName} ${x.firstName}`})),equipment:lists.equipment.map(x=>({value:x.id,label:`${x.parkNo} · ${x.model}`})),plan:lists.plans.map(x=>({value:x.id,label:x.name}))};
  const prepared=Object.fromEntries(schema.fields.filter(f=>initial?.[f.key]!==undefined&&initial?.[f.key]!==null).map(f=>[f.key,f.type==='date' ? dayjs(initial[f.key]) : initial[f.key]]));
  async function save(values) {
    const body={...Object.fromEntries(schema.fields.map(f=>[f.key,f.type==='date' && values[f.key] ? values[f.key].format('YYYY-MM-DD') : values[f.key]])),...(type==='equipment'&&initial?.sourceData?{sourceData:initial.sourceData,sourceSheet:initial.sourceSheet,sourceRow:initial.sourceRow}:{})};
    try { await api(`/records/${type}${initial ? `/${initial.id}` : ''}`,{method:initial?'PUT':'POST',body:JSON.stringify(body)}); message.success('Бүртгэл хадгалагдлаа'); onSaved(); }
    catch(e) {message.error(e.message)}
  }
  return <Form form={form} layout="vertical" initialValues={{status:type==='equipment'?'ready':type==='employees'?'normal':undefined,availability:type==='equipment'?'available':undefined,shift:'day',kind:type==='fuel'?'usage':undefined,date:dayjs(),...prepared}} onFinish={save} className="record-form"><div className="form-grid">{schema.fields.map(f=><Form.Item key={f.key} name={f.key} label={f.label} rules={f.required?[{required:true,message:`${f.label} оруулна уу`}]:[]} className={f.key==='notes'?'full':''}>{f.type==='number'?<InputNumber min={0} style={{width:'100%'}}/>:f.type==='date'?<DatePicker style={{width:'100%'}} format="YYYY-MM-DD"/>:f.type==='select'?<Select allowClear options={f.options.map(value=>({value,label:statusLabels[value] || labels[value] || value}))}/>:f.type==='position'?<Select showSearch allowClear optionFilterProp="label" options={positions.map(value=>({value,label:value}))}/>:optionMap[f.type]?<Select showSearch allowClear optionFilterProp="label" options={optionMap[f.type]}/>:<Input/>}</Form.Item>)}</div><div className="modal-actions"><Button onClick={onCancel}>Болих</Button><Button type="primary" htmlType="submit">Хадгалах</Button></div></Form>
}

function ImportButton({type,onDone}) {
  const schema=schemas[type];
  const exportTemplate=()=>downloadExcel(schema.fields.map(f=>f.label),[],`${type}-загвар.xlsx`);
  const upload=async file=>{
    try {
      const raw=await readExcel(file);
      if (!raw.length) throw new Error('Excel файл хоосон байна');
      const rows=raw.map(row=>Object.fromEntries(schema.fields.map(f=>{
        const value=row[f.label]!==undefined?row[f.label]:row[f.key];
        return [f.key,value];
      })));
      const result=await api(`/import/${type}`,{method:'POST',body:JSON.stringify({rows})});
      message.success(`${result.count} мөр импортлов`); onDone();
    } catch(e) {message.error(e.message)}
    return false;
  };
  const importAllData=async file=>{
    try {
      const fileBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file)});
      const result=await api('/equipment-all-data/import',{method:'POST',body:JSON.stringify({fileBase64})});
      message.success(`ALL DATA: ${result.added} шинэ, ${result.updated} шинэчилсэн техник`);onDone();
    } catch(e) {message.error(e.message)}
    return false;
  };
  return <Space wrap><Button icon={<DownloadOutlined/>} onClick={exportTemplate}>Excel загвар</Button><Upload accept=".xlsx" showUploadList={false} beforeUpload={upload}><Button icon={<UploadOutlined/>}>Excel импорт</Button></Upload>{type==='equipment'&&<Upload accept=".xlsx" showUploadList={false} beforeUpload={importAllData}><Button icon={<UploadOutlined/>}>ALL DATA импорт</Button></Upload>}</Space>
}

function RecordPage({type,lists,submissions,refresh,user,date,setDate}) {
  const [editing,setEditing]=useState(undefined);
  const [open,setOpen]=useState(false);
  const [sourceRow,setSourceRow]=useState(null);
  const [search,setSearch]=useState('');
  const schema=schemas[type];
  const data=lists[type] || [];
  const employeeName=id=>{const e=lists.employees.find(x=>x.id===Number(id)); return e?`${e.lastName} ${e.firstName}`:'—'};
  const equipmentName=id=>{const e=lists.equipment.find(x=>x.id===Number(id)); return e?`${e.parkNo} · ${e.model}`:'—'};
  const render=(value,f,row)=>{
    if (f.key==='employeeId') return employeeName(value);
    if (f.key==='equipmentId') return equipmentName(value);
    if (f.key==='campId') return lists.camps.find(x=>x.id===Number(value))?.name || '—';
    if (f.key==='planId') return lists.plans.find(x=>x.id===Number(value))?.name || '—';
    if (f.key==='warehouseId') return lists.warehouses.find(x=>x.id===Number(value))?.name || '—';
    if (f.key==='status' || f.key==='shift' || f.key==='availability' || f.key==='kind' && type==='fuel') return <StatusTag value={value}/>;
    if (f.type==='number') return value===undefined || value===''?'—':money(value);
    if (f.key==='bankAccount') return value || '—';
    return value || '—';
  };
  const featured=type==='employees'?['lastName','firstName','position','shiftGroup','campId','status']:type==='attendance'?['date','employeeId','campId','status','plannedHours','actualHours']:type==='equipment'?['parkNo','kind','model','warehouseId','currentHours','availability']:type==='camps'?['name','location','capacity','workType']:type==='warehouses'?['name','location','manager']:type==='plans'?['name','startDate','endDate','warehouseId','targetOutput','requiredEquipment','requiredWorkers','plannedFuel']:type==='assignments'?['date','title','shift','employeeId','equipmentId','plannedFuel']:type==='fuel'?['date','kind','equipmentId','liters','pricePerLiter']:type==='machineLogs'?['date','equipmentId','employeeId','shiftGroup','startHours','endHours','stopReason','dispatcherChecked']:['date','name','category','amount'];
  const columns=featured.map(key=>{const f=schema.fields.find(x=>x.key===key); return {title:f.label,dataIndex:key,key,render:(value,row)=>render(value,f,row),ellipsis:true};});
  if (type==='employees') columns.push({title:'14/14 ээлж',key:'rotation',render:(_,row)=>{const s=workState(row,date,lists.attendance);return <Space><StatusTag value={s.code}/><span>{s.daysLeft?`${s.daysLeft} өдөр үлдсэн`:''}</span></Space>}});
  if (type==='employees') columns.push({title:'Өдрийн төлөв',key:'daily',render:(_,row)=>{const state=workState(row,date,lists.attendance);if(state.recorded)return <Tag color={statusColors[state.code]}>{state.label}</Tag>;if(!state.available)return state.label;const tasks=lists.assignments.filter(a=>a.date===date&&Number(a.employeeId)===row.id);const done=tasks.find(a=>submissions.some(s=>s.assignment_id===a.id&&s.status==='done'));if(done)return <Tag color={done.shift==='night'?'purple':'blue'}>{done.shift==='night'?'Шөнө ажилласан':'Өдөр ажилласан'}</Tag>;if(tasks.length)return <Tag color="gold">Даалгавартай</Tag>;return <Tag>Даалгаваргүй</Tag>}});
  if (type==='camps') columns.push({title:'Ажилтан / ажиллаж буй',key:'headcount',render:(_,row)=>{const staff=lists.employees.filter(e=>Number(e.campId)===row.id);return `${staff.length} / ${staff.filter(e=>workState(e,date,lists.attendance).available).length}`}});
  if (type==='warehouses') columns.push({title:'Бэлэн / нийт техник',key:'availability',render:(_,row)=>{const machines=lists.equipment.filter(e=>Number(e.warehouseId)===row.id);return `${machines.filter(e=>e.status==='ready'&&e.availability==='available').length} / ${machines.length}`}});
  if (type==='machineLogs') columns.push({title:'Мото цагийн зөрүү',key:'motorHours',render:(_,row)=><strong>{Math.max(0,num(row.endHours)-num(row.startHours)).toFixed(1)} цаг</strong>});
  if (type==='equipment'&&user.role==='admin') columns.push({title:'Эх өгөгдөл',key:'source',render:(_,row)=>row.sourceData?<Button type="link" size="small" onClick={()=>setSourceRow(row)}>ALL DATA</Button>:'—'});
  if (type==='plans') columns.push({title:'Нөөцийн үнэлгээ',key:'readiness',render:(_,row)=>{const workers=lists.employees.filter(e=>workState(e,date,lists.attendance).available).length;const equipment=equipmentAvailability(row,lists);const stock=lists.fuel.reduce((n,f)=>n+(f.kind==='receipt'?num(f.liters):-num(f.liters)),0);const ok=workers>=num(row.requiredWorkers)&&equipment.missing===0&&stock>=num(row.plannedFuel);return <Tag color={ok?'green':'orange'}>{ok?'Хүрэлцээтэй':'Дутагдалтай'}</Tag>}});
  if (user.role==='admin'||type==='machineLogs'&&user.role==='dispatcher'||type==='attendance'&&user.role==='hr') columns.push({title:'Үйлдэл',key:'actions',width:110,render:(_,row)=><Space><Button type="text" icon={<EditOutlined/>} onClick={()=>{setEditing(row);setOpen(true)}}/><Popconfirm title="Бүртгэлийг устгах уу?" onConfirm={async()=>{try{await api(`/records/${type}/${row.id}`,{method:'DELETE'});await refresh();message.success('Амжилттай устгалаа')}catch(e){message.error(e.message)}}}><Button type="text" danger icon={<DeleteOutlined/>}/></Popconfirm></Space>});
  const filtered=data.filter(row=>JSON.stringify(row).toLowerCase().includes(search.toLowerCase()));
  return <div className="page-stack flex flex-col gap-5"><div className="page-title-row flex items-end justify-between gap-4"><div><div className="eyebrow">БҮРТГЭЛИЙН САН</div><Title level={2}>{schema.title}</Title><Text type="secondary">Нийт {data.length} бүртгэл</Text></div><div className="toolbar flex flex-wrap items-center gap-2">{user.role==='admin'||type==='machineLogs'&&user.role==='dispatcher'||type==='attendance'&&user.role==='hr'?<><ImportButton type={type} onDone={refresh}/><Button type="primary" icon={<PlusOutlined/>} onClick={()=>{setEditing(undefined);setOpen(true)}}>Шинэ бүртгэл</Button></>:null}</div></div>{type==='employees'&&<Alert type="info" showIcon message="14/14 ээлжийн төлөв" description="Ээлж эхэлсэн өдрөөс 14 өдөр ажиллаж, дараагийн 14 өдөр амарна. А, B, C, D бүлгийг тусад нь тэмдэглэнэ."/>}{type==='employees'&&<ShiftGroupSummary employees={lists.employees} date={date} attendance={lists.attendance}/>}{type==='machineLogs'&&<Alert type="info" showIcon message="Мото цагийн тооцоо" description="Ажилласан мото цаг = төгсгөлийн заалт − эхлэлийн заалт. Зогсолтын минутыг тусад нь бүртгэж, хөдөлгүүр унтраалттай байсан эсэхээс хамаарах тул автоматаар хасахгүй."/>}{type==='plans'&&<Readiness lists={lists} date={date}/>}{type==='warehouses'&&<WarehouseOverview lists={lists}/>}{type==='camps'&&<CampRoster lists={lists} date={date}/>}<Card className="table-card" bordered={false}><div className="table-toolbar"><Input prefix={<SearchOutlined/>} placeholder="Бүртгэлээс хайх" value={search} onChange={e=>setSearch(e.target.value)} style={{width:260}}/>{(type==='employees'||type==='plans'||type==='camps'||type==='machineLogs'||type==='attendance')&&<DatePicker value={dayjs(date)} onChange={v=>v&&setDate(v.format('YYYY-MM-DD'))}/>}</div><Table rowKey="id" columns={columns} dataSource={filtered} pagination={{pageSize:10,showSizeChanger:false}} scroll={{x:950}} locale={{emptyText:<Empty description="Бүртгэл алга. Шинэ бүртгэл нэмнэ үү."/>}}/></Card><Modal title={editing?`${schema.singular} засах`:`${schema.singular} нэмэх`} open={open} footer={null} width={760} onCancel={()=>setOpen(false)} destroyOnHidden><RecordForm type={type} initial={editing} lists={lists} onCancel={()=>setOpen(false)} onSaved={()=>{setOpen(false);refresh()}}/></Modal><Modal title={`ALL DATA · ${sourceRow?.parkNo || ""}`} open={!!sourceRow} onCancel={()=>setSourceRow(null)} footer={null} width={760}><div className="max-h-[65vh] overflow-y-auto"><Table size="small" rowKey="column" pagination={false} dataSource={Object.entries(sourceRow?.sourceData || {}).filter(([,entry])=>String(entry.value || "").trim()).map(([column,entry])=>({column,heading:entry.heading,value:String(entry.value)}))} columns={[{title:"Багана",dataIndex:"column",width:85},{title:"Талбар",dataIndex:"heading"},{title:"Утга",dataIndex:"value"}]}/></div></Modal></div>
}

function equipmentAvailability(plan,lists) {
  const free=lists.equipment.filter(e=>e.status==='ready'&&e.availability==='available'&&(!plan.warehouseId||Number(e.warehouseId)===Number(plan.warehouseId)));
  const needs=String(plan.equipmentNeeds || '').split(',').map(part=>{const [kind,count]=part.split(':');return {kind:String(kind || '').trim(),count:num(count)}}).filter(item=>item.kind&&item.count>0);
  const byKind=needs.map(item=>({...item,available:free.filter(e=>String(e.kind || '').trim().toLowerCase()===item.kind.toLowerCase()).length}));
  const missing=Math.max(Math.max(0,num(plan.requiredEquipment)-free.length),byKind.reduce((n,item)=>n+Math.max(0,item.count-item.available),0));
  return {count:free.length,byKind,missing};
}

function motorHoursFor(lists,task) {
  const rows=lists.machineLogs.filter(log=>log.date===task.date&&Number(log.equipmentId)===Number(task.equipmentId)&&(!task.employeeId||Number(log.employeeId)===Number(task.employeeId)));
  return rows.length ? Number(rows.reduce((sum,log)=>sum+Math.max(0,num(log.endHours)-num(log.startHours)),0).toFixed(1)) : undefined;
}

function ShiftGroupSummary({employees,date,attendance}) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{['A','B','C','D'].map(group=>{const staff=employees.filter(e=>e.shiftGroup===group);const working=staff.filter(e=>workState(e,date,attendance).available).length;return <div key={group} className="rounded-xl bg-white px-5 py-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-bold text-violet-700">{group} ээлж</span><span className="text-[11px] text-slate-400">14/14</span></div><div className="mt-3 flex items-end gap-1"><strong className="text-2xl leading-none text-slate-800">{working}</strong><span className="text-xs text-slate-400">/ {staff.length} ажиллаж байна</span></div></div>})}</div>;
}

function WarehouseOverview({lists}) {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{lists.warehouses.map(warehouse=>{
    const equipment=lists.equipment.filter(item=>Number(item.warehouseId)===warehouse.id&&item.availability==='available'&&item.status==='ready');
    const kinds=Object.entries(equipment.reduce((counts,item)=>({...counts,[item.kind]:(counts[item.kind]||0)+1}),{})).sort((a,b)=>b[1]-a[1]);
    const plans=lists.plans.filter(plan=>Number(plan.warehouseId)===warehouse.id);
    const missing=plans.reduce((sum,plan)=>sum+equipmentAvailability(plan,lists).missing,0);
    return <div key={warehouse.id} className="rounded-xl bg-white px-5 py-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><strong className="text-sm text-slate-800">{warehouse.name}</strong><div className="mt-1 text-xs text-slate-400">{warehouse.location || 'Байршил тодорхойгүй'}</div></div><Tag color={missing?'orange':'green'}>{missing?`${missing} техник дутуу`:'Хүрэлцээтэй'}</Tag></div><div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-600">Бэлэн техник <b className="float-right text-slate-800">{equipment.length}</b></div><div className="mt-2 space-y-1 text-xs text-slate-500">{kinds.map(([kind,count])=><div key={kind} className="flex justify-between gap-2"><span>{kind}</span><strong>{count}</strong></div>)}</div></div>
  })}</div>;
}

function CampRoster({lists,date}) {
  const [campId,setCampId]=useState(lists.camps[0]?.id);
  useEffect(()=>{if(!lists.camps.some(c=>c.id===campId)) setCampId(lists.camps[0]?.id)},[lists.camps,campId]);
  const camp=lists.camps.find(c=>c.id===campId);
  const staff=lists.employees.filter(e=>Number(e.campId)===Number(campId));
  const working=staff.filter(e=>workState(e,date,lists.attendance).available).length;
  return <Card bordered={false} title="Camp-ийн ээлжийн бүрэлдэхүүн" extra={<Select value={campId} onChange={setCampId} options={lists.camps.map(c=>({value:c.id,label:c.name}))} style={{minWidth:180}} placeholder="Camp сонгох"/>}><div className="mb-4 flex flex-wrap gap-3 text-xs"><Tag color="green">Ажиллаж буй {working}</Tag><Tag>Амралттай {staff.filter(e=>workState(e,date,lists.attendance).code==='rest').length}</Tag><Tag color="gold">Чөлөөтэй {staff.filter(e=>e.status==='leave').length}</Tag><span className="text-slate-500">{camp?.workType || ''}</span></div><Table rowKey="id" size="small" dataSource={staff} pagination={{pageSize:6}} columns={[{title:'Ажилтан',render:(_,e)=>`${e.lastName} ${e.firstName}`},{title:'Албан тушаал',dataIndex:'position'},{title:'Ээлж',dataIndex:'shiftGroup'},{title:'Төлөв',render:(_,e)=>{const state=workState(e,date,lists.attendance);return <Tag color={statusColors[state.code]}>{state.label}</Tag>}},{title:'Дараагийн солилт',render:(_,e)=>{const state=workState(e,date,lists.attendance);return state.daysLeft?`${state.daysLeft} өдөр`:'—'}}]}/></Card>;
}

function Readiness({lists,date}) {
  const active=lists.employees.filter(e=>workState(e,date,lists.attendance).available).length;
  const fuel=lists.fuel.reduce((n,f)=>n+(f.kind==='receipt'?num(f.liters):-num(f.liters)),0);
  return <div className="readiness-grid">{lists.plans.map(p=>{const equipment=equipmentAvailability(p,lists);const warehouse=lists.warehouses.find(w=>w.id===Number(p.warehouseId));const workerGap=Math.max(0,num(p.requiredWorkers)-active);const fuelGap=Math.max(0,num(p.plannedFuel)-fuel);return <Card key={p.id} bordered={false} className="readiness-card"><div className="readiness-top"><strong>{p.name}</strong><Tag color={workerGap||equipment.missing||fuelGap?'orange':'green'}>{workerGap||equipment.missing||fuelGap?'Нөөц дутуу':'Бэлэн'}</Tag></div>{warehouse&&<div className="text-[11px] text-violet-700 mb-2">Агуулах: {warehouse.name}</div>}<div className="readiness-row"><span>Хүн хүч</span><b>{active} / {num(p.requiredWorkers)}</b><small>{workerGap?`${workerGap} дутуу`:'Хүрэлцээтэй'}</small></div><div className="readiness-row"><span>Техник</span><b>{equipment.count} / {num(p.requiredEquipment)}</b><small>{equipment.missing?`${equipment.missing} дутуу`:'Хүрэлцээтэй'}</small></div>{equipment.byKind.map(item=><div className="readiness-row" key={item.kind}><span>{item.kind}</span><b>{item.available} / {item.count}</b><small>{item.available<item.count?`${item.count-item.available} дутуу`:'Хүрэлцээтэй'}</small></div>)}<div className="readiness-row"><span>Түлш</span><b>{money(fuel)} / {money(p.plannedFuel)} л</b><small>{fuelGap?`${money(fuelGap)} л дутуу`:'Хүрэлцээтэй'}</small></div></Card>})}</div>
}

function CampCheck({lists,user,date,setDate,refresh}) {
  const staff=useMemo(()=>lists.employees.filter(employee=>Number(employee.campId)===Number(user.campId)),[lists.employees,user.campId]);
  const camp=lists.camps.find(item=>item.id===Number(user.campId));
  const [checks,setChecks]=useState({});
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    setChecks(Object.fromEntries(staff.map(employee=>{
      const record=lists.attendance.find(row=>Number(row.employeeId)===employee.id&&row.date===date);
      return [employee.id,{status:record?.status || null,actualHours:num(record?.actualHours),notes:record?.notes || ''}];
    })));
  },[staff,lists.attendance,date]);
  const checked=staff.filter(employee=>checks[employee.id]?.status).length;
  function update(id,change){setChecks(current=>({...current,[id]:{...current[id],...change}}))}
  async function submit(){
    if(checked!==staff.length)return message.warning('Ажилтан бүрийн төлөвийг сонгоно уу');
    setSaving(true);
    try {
      const rows=staff.map(employee=>({date,employeeId:employee.id,campId:user.campId,...checks[employee.id]}));
      const result=await api('/attendance/submit',{method:'POST',body:JSON.stringify({rows})});
      message.success(`${result.count} ажилтны цаг бүртгэл илгээгдлээ`);refresh();
    } catch(e){message.error(e.message)} finally{setSaving(false)}
  }
  return <div className="page-stack flex flex-col gap-5"><div className="page-title-row flex items-end justify-between gap-4"><div><div className="eyebrow">CAMP АХЛАХЫН ӨДӨР ТУТМЫН БҮРТГЭЛ</div><Title level={2}>Хүмүүсээ шалгах</Title><Text type="secondary">{camp?.name || 'Camp тохируулаагүй'} · ажилласан эсэхийг нэг бүрчлэн тэмдэглэнэ</Text></div><DatePicker value={dayjs(date)} onChange={v=>v&&setDate(v.format('YYYY-MM-DD'))}/></div><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-5 py-4 shadow-sm"><div><strong className="text-base text-slate-800">{checked} / {staff.length} шалгасан</strong><p className="mb-0 mt-1 text-xs text-slate-500">Өдөр, шөнө, ажиллаагүй, амралт эсвэл чөлөөний төлөв сонгоно</p></div><Button type="primary" size="large" loading={saving} disabled={!staff.length||checked!==staff.length} onClick={submit}>Бүртгэл илгээх</Button></div>{!camp&&<Alert type="warning" showIcon message="Энэ хэрэглэгчид camp оноогоогүй байна. Админ Хэрэглэгчид хэсгээс camp сонгоно уу."/>}{staff.length?<div className="grid gap-3">{staff.map(employee=>{const choice=checks[employee.id]||{};const rotation=workState(employee,date);return <div key={employee.id} className="rounded-xl bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div><strong className="text-sm text-slate-800">{employee.lastName} {employee.firstName}</strong><div className="mt-1 text-xs text-slate-500">{employee.position} · {employee.shiftGroup || '—'} ээлж</div></div><Tag color={rotation.available?'green':'default'}>{rotation.label}</Tag></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">{[['day','Өдөр ажилласан'],['night','Шөнө ажилласан'],['absent','Ажиллаагүй'],['rest','Амралттай'],['leave','Чөлөөтэй']].map(([status,label])=><button key={status} type="button" onClick={()=>update(employee.id,{status,actualHours:['day','night'].includes(status)?choice.actualHours:0})} className={`min-h-10 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${choice.status===status?'border-violet-500 bg-violet-50 text-violet-700':'border-slate-200 bg-white text-slate-600 hover:border-violet-300'}`}>{label}</button>)}</div><div className="mt-3 grid gap-2 sm:grid-cols-[160px_1fr]">{['day','night'].includes(choice.status)&&<InputNumber min={0} max={24} value={choice.actualHours} onChange={value=>update(employee.id,{actualHours:value||0})} addonAfter="цаг" style={{width:'100%'}}/>}<Input placeholder="Тайлбар (сонголтоор)" value={choice.notes} onChange={event=>update(employee.id,{notes:event.target.value})}/></div></div>})}</div>:<Card bordered={false}><Empty description="Энэ camp-д ажилтан бүртгээгүй байна"/></Card>}</div>;
}

function TasksPage({lists,submissions,refresh,user,date,setDate}) {
  const [editing,setEditing]=useState(null);
  const [form]=Form.useForm();
  const employeeName=id=>{const e=lists.employees.find(x=>x.id===Number(id));return e?`${e.lastName} ${e.firstName}`:'—'};
  const equipmentName=id=>{const e=lists.equipment.find(x=>x.id===Number(id));return e?`${e.parkNo} · ${e.model}`:'—'};
  const tasks=lists.assignments.filter(t=>t.date===date);
  const latest=id=>submissions.find(s=>s.assignment_id===id&&s.work_date===date);
  const submit=async values=>{try{await api('/submissions',{method:'POST',body:JSON.stringify({assignmentId:editing.id,...values})});message.success('Гүйцэтгэл илгээгдлээ');setEditing(null);refresh()}catch(e){message.error(e.message)}};
  return <div className="page-stack flex flex-col gap-5"><div className="page-title-row flex items-end justify-between gap-4"><div><div className="eyebrow">ӨДӨР ТУТМЫН ГҮЙЦЭТГЭЛ</div><Title level={2}>Миний ажлууд</Title><Text type="secondary">Ажилтан болон техникийн даалгаврын биелэлтийг баталгаажуулна</Text></div><DatePicker value={dayjs(date)} onChange={v=>v&&setDate(v.format('YYYY-MM-DD'))}/></div><div className="task-summary"><div><span>Нийт даалгавар</span><strong>{tasks.length}</strong></div><div><span>Хийсэн</span><strong>{tasks.filter(t=>latest(t.id)?.status==='done').length}</strong></div><div><span>Хүлээгдэж буй</span><strong>{tasks.filter(t=>!latest(t.id)).length}</strong></div></div>{tasks.length?<div className="task-list grid gap-4">{tasks.map(task=>{const sub=latest(task.id);const employee=lists.employees.find(e=>e.id===Number(task.employeeId));const shift=employee?workState(employee,date,lists.attendance):null;return <Card key={task.id} bordered={false} className="task-card"><div className="task-head"><div><span className="task-date">{task.date} · {task.shift==='night'?'Шөнийн ээлж':'Өдрийн ээлж'}</span><h3>{task.title}</h3><p>{task.site || 'Байршил тодорхойгүй'}</p></div><StatusTag value={sub?.status || 'pending'}/></div><div className="task-meta"><div><TeamOutlined/> {employeeName(task.employeeId)} {employee?.shiftGroup&&<Tag color="purple">{employee.shiftGroup} ээлж</Tag>} {shift&&<Tag color={shift.available?'green':'orange'}>{shift.label}</Tag>}</div><div><ToolOutlined/> {equipmentName(task.equipmentId)}</div><div><FireOutlined/> {num(task.plannedFuel)} л төлөвлөгөө</div><div><BarChartOutlined/> {num(task.plannedOutput)} бүтээл</div></div>{sub&&<div className="task-result">Бодит: {num(sub.actual_hours)} цаг · {num(sub.actual_fuel)} л · {num(sub.actual_output)} бүтээл <span>Илгээсэн: {sub.submittedByName}</span></div>}<div className="task-actions"><Button type="primary" ghost onClick={()=>{setEditing(task);form.setFieldsValue({status:sub?.status || 'done',actualHours:sub?.actual_hours ?? motorHoursFor(lists,task) ?? task.plannedHours ?? 0,actualFuel:sub?.actual_fuel ?? 0,actualOutput:sub?.actual_output ?? 0,note:sub?.note || ''})}}>{sub?'Гүйцэтгэл засах':'Гүйцэтгэл илгээх'}</Button></div></Card>})}</div>:<Card bordered={false}><Empty description="Сонгосон өдөрт даалгавар алга"/></Card>}<Modal title={editing?.title} open={!!editing} footer={null} onCancel={()=>setEditing(null)}><Form form={form} layout="vertical" onFinish={submit}><Form.Item name="status" label="Гүйцэтгэл" rules={[{required:true}]}><Select options={[{value:'done',label:'Хийсэн'},{value:'not_done',label:'Хийгээгүй'}]}/></Form.Item><Row gutter={12}><Col span={8}><Form.Item name="actualHours" label="Бодит цаг"><InputNumber min={0} style={{width:'100%'}}/></Form.Item></Col><Col span={8}><Form.Item name="actualFuel" label="Түлш (л)"><InputNumber min={0} style={{width:'100%'}}/></Form.Item></Col><Col span={8}><Form.Item name="actualOutput" label="Бүтээл"><InputNumber min={0} style={{width:'100%'}}/></Form.Item></Col></Row><Form.Item name="note" label="Тайлбар"><Input.TextArea rows={3}/></Form.Item><div className="modal-actions"><Button onClick={()=>setEditing(null)}>Болих</Button><Button type="primary" htmlType="submit">Submit · Илгээх</Button></div></Form></Modal></div>
}

function calculate(lists,submissions) {
  const completed=submissions.filter(s=>s.status==='done');
  const assignmentMap=new Map(lists.assignments.map(a=>[a.id,a]));
  const planMap=new Map(lists.plans.map(p=>[p.id,p]));
  const revenue=completed.reduce((sum,s)=>sum+num(s.actual_output)*num(planMap.get(Number(assignmentMap.get(s.assignment_id)?.planId))?.unitRevenue),0);
  const fuelPrice=lists.fuel.filter(f=>f.kind==='receipt'&&num(f.pricePerLiter)>0).at(0)?.pricePerLiter || 0;
  const fuelExpense=completed.reduce((sum,s)=>sum+num(s.actual_fuel)*num(fuelPrice),0);
  const otherExpense=lists.other.reduce((sum,o)=>sum+num(o.amount),0);
  const fuelStock=lists.fuel.reduce((sum,f)=>sum+(f.kind==='receipt'?num(f.liters):-num(f.liters)),0);
  const plannedFuel=lists.assignments.reduce((sum,a)=>sum+num(a.plannedFuel),0);
  const usedFuel=completed.reduce((sum,s)=>sum+num(s.actual_fuel),0);
  return {completed,revenue,fuelExpense,otherExpense,totalExpense:fuelExpense+otherExpense,profit:revenue-fuelExpense-otherExpense,fuelStock,plannedFuel,usedFuel,fuelVariance:plannedFuel-usedFuel};
}

function Dashboard({lists,submissions,date,setDate,onNavigate}) {
  const metrics=calculate(lists,submissions);
  const active=lists.employees.filter(e=>workState(e,date,lists.attendance).available).length;
  const ready=lists.equipment.filter(e=>e.status==='ready'&&e.availability==='available').length;
  const lastDays=Array.from({length:7},(_,i)=>dayjs(date).subtract(6-i,'day').format('YYYY-MM-DD'));
  const graph=lastDays.map(d=>{const entries=submissions.filter(s=>s.work_date===d&&s.status==='done');return {name:dayjs(d).format('MM.DD'),Бүтээл:entries.reduce((n,s)=>n+num(s.actual_output),0),Түлш:entries.reduce((n,s)=>n+num(s.actual_fuel),0)}});
  const recent=submissions.slice(0,5);
  return <div className="page-stack flex flex-col gap-5"><div className="page-title-row flex items-end justify-between gap-4"><div><div className="eyebrow">УУРХАЙН УДИРДЛАГА</div><Title level={2}>Хяналтын самбар</Title><Text type="secondary">{dayjs(date).format('YYYY оны MM сарын DD')} · Өдрийн нөхцөл байдал</Text></div><DatePicker value={dayjs(date)} onChange={v=>v&&setDate(v.format('YYYY-MM-DD'))}/></div><div className="metric-grid grid gap-4"><Card bordered={false} className="metric-card"><div className="metric-icon green"><TeamOutlined/></div><span>Ажиллах боломжтой</span><strong>{active}<small> / {lists.employees.length}</small></strong><p>14/14 ээлжийн тооцоолол</p></Card><Card bordered={false} className="metric-card"><div className="metric-icon blue"><ToolOutlined/></div><span>Бэлэн техник</span><strong>{ready}<small> / {lists.equipment.length}</small></strong><p>Засварт байгаа {lists.equipment.filter(e=>e.status==='maintenance').length}</p></Card><Card bordered={false} className="metric-card"><div className="metric-icon violet"><CheckCircleOutlined/></div><span>Гүйцэтгэсэн ажил</span><strong>{metrics.completed.length}<small> / {lists.assignments.length}</small></strong><p>Нийт даалгаврын биелэлт</p></Card><Card bordered={false} className="metric-card"><div className="metric-icon orange"><FireOutlined/></div><span>Түлшний үлдэгдэл</span><strong>{money(metrics.fuelStock)}<small> л</small></strong><p>Орлого ба зарцуулалтын зөрүү</p></Card></div><Row gutter={[18,18]}><Col xs={24} xl={16}><Card bordered={false} className="chart-card" title="Сүүлийн 7 өдрийн гүйцэтгэл" extra={<span className="chart-extra">Бүтээл / түлш</span>}><ResponsiveContainer width="100%" height={290}><LineChart data={graph} margin={{top:12,right:14,left:-20,bottom:0}}><CartesianGrid stroke="#edf0f4" vertical={false}/><XAxis dataKey="name" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Legend/><Line type="monotone" dataKey="Бүтээл" stroke="#7257d9" strokeWidth={3} dot={false}/><Line type="monotone" dataKey="Түлш" stroke="#2bbf83" strokeWidth={3} dot={false}/></LineChart></ResponsiveContainer></Card></Col><Col xs={24} xl={8}><Card bordered={false} className="overview-card" title="Тайлангийн тойм"><div className="overview-row"><span>Бүтээлийн орлого</span><b>{money(metrics.revenue)} ₮</b></div><div className="overview-row"><span>Нийт зарлага</span><b>{money(metrics.totalExpense)} ₮</b></div><div className="overview-row total"><span>Үр дүн</span><b>{money(metrics.profit)} ₮</b></div><Button type="link" onClick={()=>onNavigate('reports')}>Дэлгэрэнгүй тайлан →</Button></Card></Col></Row><Row gutter={[18,18]}><Col xs={24} xl={14}><Card bordered={false} title="Төлөвлөгөөний нөөц" extra={<Button type="link" onClick={()=>onNavigate('plans')}>Бүгдийг харах</Button>}><Readiness lists={{...lists,plans:lists.plans.slice(0,2)}} date={date}/>{!lists.plans.length&&<Empty description="Төлөвлөгөө бүртгээгүй"/>}</Card></Col><Col xs={24} xl={10}><Card bordered={false} title="Сүүлийн гүйцэтгэл">{recent.length?<div className="activity-list">{recent.map(s=><div className="activity-item" key={s.id}><div className="activity-dot"><FileDoneOutlined/></div><div><strong>{lists.assignments.find(a=>a.id===s.assignment_id)?.title || 'Даалгавар'}</strong><span>{s.submittedByName} · {dayjs(s.submitted_at).format('MM.DD HH:mm')}</span></div><StatusTag value={s.status}/></div>)}</div>:<Empty description="Илгээсэн гүйцэтгэл алга"/>}</Card></Col></Row></div>
}

function AttendanceReport({lists,date,scope}) {
  const rows=lists.attendance.filter(row=>scope==='all'||row.date===date);
  const count=status=>rows.filter(row=>row.status===status).length;
  return <Card bordered={false} title="Camp-ийн ирцийн тайлан" className="table-card" extra={<Space wrap><Tag color="blue">Өдөр {count('day')}</Tag><Tag color="purple">Шөнө {count('night')}</Tag><Tag color="red">Ажиллаагүй {count('absent')}</Tag><Tag>Амралт {count('rest')}</Tag><Tag color="gold">Чөлөө {count('leave')}</Tag></Space>}><Table rowKey="id" dataSource={rows} scroll={{x:800}} pagination={{pageSize:8}} columns={[{title:'Өдөр',dataIndex:'date'},{title:'Ажилтан',render:(_,row)=>{const e=lists.employees.find(item=>item.id===Number(row.employeeId));return e?`${e.lastName} ${e.firstName}`:'—'}},{title:'Camp',render:(_,row)=>lists.camps.find(item=>item.id===Number(row.campId))?.name || '—'},{title:'Төлөв',dataIndex:'status',render:value=><StatusTag value={value}/>},{title:'Ажилласан цаг',dataIndex:'actualHours',render:value=>num(value)},{title:'Тайлбар',dataIndex:'notes'}]}/></Card>;
}

function MotorHoursReport({lists,date,scope}) {
  const rows=lists.machineLogs.filter(log=>scope==='all'||log.date===date).map(log=>({
    ...log,
    employee:lists.employees.find(e=>e.id===Number(log.employeeId)),
    equipment:lists.equipment.find(e=>e.id===Number(log.equipmentId)),
    motorHours:Math.max(0,num(log.endHours)-num(log.startHours)),
  }));
  const total=rows.reduce((sum,row)=>sum+row.motorHours,0);
  return <Card bordered={false} title="Диспетчерийн мото цаг" extra={<Tag color="purple">Нийт {total.toFixed(1)} цаг</Tag>} className="table-card"><Table rowKey="id" dataSource={rows} scroll={{x:900}} pagination={{pageSize:8}} columns={[{title:'Өдөр',dataIndex:'date'},{title:'Ээлж',dataIndex:'shiftGroup'},{title:'Оператор',render:(_,r)=>r.employee?`${r.employee.lastName} ${r.employee.firstName}`:'—'},{title:'Техник',render:(_,r)=>r.equipment?.parkNo || '—'},{title:'Эхлэл',dataIndex:'startHours'},{title:'Төгсгөл',dataIndex:'endHours'},{title:'Мото цаг',dataIndex:'motorHours',render:v=>v.toFixed(1)},{title:'Зогсолт',dataIndex:'stopReason'},{title:'Шалгасан',dataIndex:'dispatcherChecked',render:v=><Tag color={v==='yes'?'green':'orange'}>{v==='yes'?'Тийм':'Үгүй'}</Tag>}]}/></Card>
}

function Reports({lists,submissions,date,setDate}) {
  const [scope,setScope]=useState('all');
  const reportSubs=scope==='day'?submissions.filter(s=>s.work_date===date):submissions;
  const reportLists=scope==='day'?{...lists,assignments:lists.assignments.filter(a=>a.date===date),other:lists.other.filter(o=>o.date===date)}:lists;
  const m=calculate(reportLists,reportSubs);
  const planMap=new Map(lists.plans.map(p=>[p.id,p]));
  const assignmentMap=new Map(lists.assignments.map(a=>[a.id,a]));
  const rows=reportSubs.map(s=>{const a=assignmentMap.get(s.assignment_id);const p=planMap.get(Number(a?.planId));return {...s,title:a?.title || 'Устгасан даалгавар',employee:lists.employees.find(e=>e.id===Number(a?.employeeId)),equipment:lists.equipment.find(e=>e.id===Number(a?.equipmentId)),income:s.status==='done'?num(s.actual_output)*num(p?.unitRevenue):0}});
  const exportReport=()=>{const columns=['Өдөр','Ажил','Ажилтан','Техник','Төлөв','Бодит цаг','Бүтээл','Түлш л','Орлого ₮','Илгээсэн'];const data=rows.map(r=>({'Өдөр':r.work_date,'Ажил':r.title,'Ажилтан':r.employee?`${r.employee.lastName} ${r.employee.firstName}`:'','Техник':r.equipment?.parkNo || '','Төлөв':statusLabels[r.status],'Бодит цаг':r.actual_hours,'Бүтээл':r.actual_output,'Түлш л':r.actual_fuel,'Орлого ₮':r.income,'Илгээсэн':r.submittedByName}));downloadExcel(columns,data,'mpc-hr-тайлан.xlsx')};
  return <div className="page-stack flex flex-col gap-5"><div className="page-title-row flex items-end justify-between gap-4"><div><div className="eyebrow">ДҮН ШИНЖИЛГЭЭ</div><Title level={2}>Тайлан</Title><Text type="secondary">Баталгаажуулсан ажлын бүтээл ба бүртгэсэн зарлага</Text></div><Space><Segmented value={scope} onChange={setScope} options={[{value:'all',label:'Бүх хугацаа'},{value:'day',label:'Өдөр'}]}/><DatePicker value={dayjs(date)} onChange={v=>v&&setDate(v.format('YYYY-MM-DD'))}/><Button icon={<DownloadOutlined/>} onClick={exportReport}>Excel татах</Button></Space></div><Alert showIcon type="info" message="Тооцооллын зарчим" description="Орлого = гүйцэтгэсэн бүтээл × төлөвлөгөөний нэгжийн орлого. Зарлага = бодит түлш × бүртгэсэн түлшний хамгийн сүүлийн нэгжийн үнэ + бусад зардал. Цалин, элэгдэл болон татвар ороогүй."/><div className="report-grid grid gap-4"><Card bordered={false}><Statistic title="Бүтээлийн орлого" value={m.revenue} formatter={money} suffix="₮" valueStyle={{color:'#2aaf77'}}/></Card><Card bordered={false}><Statistic title="Түлшний зарлага" value={m.fuelExpense} formatter={money} suffix="₮"/></Card><Card bordered={false}><Statistic title="Бусад зарлага" value={m.otherExpense} formatter={money} suffix="₮"/></Card><Card bordered={false}><Statistic title="Үр дүн" value={m.profit} formatter={money} suffix="₮" valueStyle={{color:m.profit<0?'#d94b58':'#392b75'}}/></Card></div><Row gutter={[18,18]}><Col xs={24} md={12}><Card bordered={false} title="Түлшний төлөвлөгөө"><div className="fuel-large">{money(m.usedFuel)} <small>/ {money(m.plannedFuel)} л</small></div><Progress percent={m.plannedFuel?Math.min(100,Math.round(m.usedFuel/m.plannedFuel*100)):0} strokeColor="#7956d8"/><div className="overview-row"><span>Зөрүү</span><b>{m.fuelVariance>=0?`${money(m.fuelVariance)} л хэмнэсэн`:`${money(-m.fuelVariance)} л илүү`}</b></div></Card></Col><Col xs={24} md={12}><Card bordered={false} title="Ажлын биелэлт"><div className="fuel-large">{m.completed.length} <small>/ {reportLists.assignments.length} ажил</small></div><Progress percent={reportLists.assignments.length?Math.round(m.completed.length/reportLists.assignments.length*100):0} strokeColor="#2bbf83"/><div className="overview-row"><span>Хийгээгүй</span><b>{reportSubs.filter(s=>s.status==='not_done').length} ажил</b></div></Card></Col></Row><AttendanceReport lists={lists} date={date} scope={scope}/><MotorHoursReport lists={lists} date={date} scope={scope}/><Card bordered={false} title="Илгээсэн гүйцэтгэл" className="table-card"><Table rowKey="id" dataSource={rows} scroll={{x:1000}} pagination={{pageSize:10}} columns={[{title:'Өдөр',dataIndex:'work_date'},{title:'Ажил',dataIndex:'title'},{title:'Ажилтан',render:(_,r)=>r.employee?`${r.employee.lastName} ${r.employee.firstName}`:'—'},{title:'Техник',render:(_,r)=>r.equipment?.parkNo || '—'},{title:'Төлөв',dataIndex:'status',render:v=><StatusTag value={v}/>},{title:'Цаг',dataIndex:'actual_hours'},{title:'Түлш л',dataIndex:'actual_fuel'},{title:'Бүтээл',dataIndex:'actual_output'},{title:'Орлого ₮',dataIndex:'income',render:money},{title:'Илгээсэн',dataIndex:'submittedByName'}]}/></Card></div>
}

function Users({users,camps,refresh}) {
  const [open,setOpen]=useState(false);
  const [editing,setEditing]=useState(null);
  const [form]=Form.useForm();
  const selectedRole=Form.useWatch('role',form);
  async function save(values){try{await api(editing?`/users/${editing.id}`:'/users',{method:editing?'PATCH':'POST',body:JSON.stringify(values)});message.success('Хэрэглэгч хадгалагдлаа');setOpen(false);setEditing(null);form.resetFields();refresh()}catch(e){message.error(e.message)}}
  async function toggle(row){try{await api(`/users/${row.id}`,{method:'PATCH',body:JSON.stringify({active:!row.active})});await refresh();message.success(row.active?'Хэрэглэгчийг амжилттай идэвхгүй болголоо':'Хэрэглэгчийг амжилттай идэвхжүүллээ')}catch(e){message.error(e.message)}}
  function edit(row){setEditing(row);form.setFieldsValue({username:row.username,name:row.name,role:row.role,campId:row.campId,password:''});setOpen(true)}
  function add(){setEditing(null);form.resetFields();setOpen(true)}
  return <div className="page-stack flex flex-col gap-5"><div className="page-title-row flex items-end justify-between gap-4"><div><div className="eyebrow">ХАНДАХ ЭРХ</div><Title level={2}>Хэрэглэгчид</Title><Text type="secondary">Админ болон хээрийн бүртгэлийн эрхүүд</Text></div><Button type="primary" icon={<PlusOutlined/>} onClick={add}>Хэрэглэгч нэмэх</Button></div><Card bordered={false} className="table-card"><Table rowKey="id" dataSource={users} scroll={{x:650}} columns={[{title:'Нэвтрэх нэр',dataIndex:'username'},{title:'Нэр',dataIndex:'name'},{title:'Эрх',dataIndex:'role',render:v=><Tag color="purple">{roleNames[v]}</Tag>},{title:'Camp',dataIndex:'campId',render:id=>camps.find(c=>c.id===Number(id))?.name || '—'},{title:'Төлөв',dataIndex:'active',render:v=><Tag color={v?'green':'default'}>{v?'Идэвхтэй':'Идэвхгүй'}</Tag>},{title:'Үйлдэл',render:(_,r)=><Space><Button size="small" onClick={()=>edit(r)}>Засах</Button><Button size="small" onClick={()=>toggle(r)}>{r.active?'Идэвхгүй болгох':'Идэвхжүүлэх'}</Button></Space>}]}/></Card><Modal title={editing?'Хэрэглэгч засах':'Хэрэглэгч нэмэх'} open={open} footer={null} onCancel={()=>setOpen(false)}><Form form={form} layout="vertical" onFinish={save}><Form.Item name="username" label="Нэвтрэх нэр" rules={editing?[]:[{required:true}]}><Input disabled={!!editing}/></Form.Item><Form.Item name="name" label="Нэр" rules={[{required:true}]}><Input/></Form.Item><Form.Item name="role" label="Эрх" rules={[{required:true}]}><Select options={Object.entries(roleNames).map(([value,label])=>({value,label}))}/></Form.Item>{selectedRole==='camp'&&<Form.Item name="campId" label="Хариуцах camp" rules={[{required:true,message:'Camp сонгоно уу'}]}><Select options={camps.map(c=>({value:c.id,label:c.name}))}/></Form.Item>}<Form.Item name="password" label={editing?'Шинэ нууц үг (хоосон бол хэвээр)':'Нууц үг'} rules={editing?[{min:8}]:[{required:true,min:8}]}><Input.Password/></Form.Item><div className="modal-actions"><Button onClick={()=>setOpen(false)}>Болих</Button><Button type="primary" htmlType="submit">Хадгалах</Button></div></Form></Modal></div>
}

function Shell({user,onLogout}) {
  const [page,setPage]=useState(user.role==='admin'?'dashboard':user.role==='camp'?'campCheck':'tasks');
  const [collapsed,setCollapsed]=useState(false);
  const [mobileOpen,setMobileOpen]=useState(false);
  const [isMobile,setIsMobile]=useState(()=>window.matchMedia('(max-width: 760px)').matches);
  const [date,setDate]=useState(today());
  const [lists,setLists]=useState(Object.fromEntries(Object.keys(schemas).map(k=>[k,[]])));
  const [submissions,setSubmissions]=useState([]);
  const [users,setUsers]=useState([]);
  const [loading,setLoading]=useState(true);
  async function refresh(){try{const [records,subs,people]=await Promise.all([Promise.all(Object.keys(schemas).map(k=>api(`/records/${k}`))),api('/submissions'),user.role==='admin'?api('/users'):Promise.resolve([])]);setLists(Object.fromEntries(Object.keys(schemas).map((k,i)=>[k,records[i]])));setSubmissions(subs);setUsers(people)}catch(e){message.error(e.message)}finally{setLoading(false)}}
  useEffect(()=>{refresh()},[]);
  useEffect(()=>{const query=window.matchMedia('(max-width: 760px)');const sync=()=>setIsMobile(query.matches);query.addEventListener('change',sync);return()=>query.removeEventListener('change',sync)},[]);
  const items=[...(user.role==='admin'?[{key:'dashboard',icon:<DashboardOutlined/>,label:'Хяналтын самбар'}]:[]),{key:'employees',icon:<TeamOutlined/>,label:'Ажилтан'},...(['admin','hr'].includes(user.role)?[{key:'attendance',icon:<CalendarOutlined/>,label:'Цаг бүртгэл'}]:[]),...(user.role==='camp'?[{key:'campCheck',icon:<CheckCircleOutlined/>,label:'Хүмүүсээ шалгах'}]:[]),{key:'mountain',icon:<ApartmentOutlined/>,label:'Уул',children:[{key:'plans',label:'Бүтээл'},{key:'manpower',label:'Хүн хүч'},{key:'equipment',label:'Техник'},{key:'camps',label:'Camp'},...(user.role==='admin'?[{key:'reports',label:'Тайлан'}]:[])]},{key:'warehouses',icon:<HomeOutlined/>,label:'Агуулах'},{key:'tasks',icon:<FileDoneOutlined/>,label:'Өдрийн ажил'},{key:'machineLogs',icon:<ToolOutlined/>,label:'Мото цаг'},...(user.role==='admin'?[{key:'fuel',icon:<FireOutlined/>,label:'Түлш'},{key:'other',icon:<MoreOutlined/>,label:'Бусад'},{key:'users',icon:<SettingOutlined/>,label:'Хэрэглэгчид'}]:[])];
  const title={dashboard:'Хяналтын самбар',employees:'Ажилтан',attendance:'Цаг бүртгэл',campCheck:'Хүмүүсээ шалгах',plans:'Бүтээл',manpower:'Хүн хүч',equipment:'Техник',camps:'Camp',reports:'Тайлан',warehouses:'Агуулах',tasks:'Өдрийн ажил',machineLogs:'Мото цаг',fuel:'Түлш',other:'Бусад',users:'Хэрэглэгчид'}[page];
  const mobileKeys=user.role==='camp'?['campCheck','tasks','employees','camps']:user.role==='admin'?['dashboard','employees','attendance','tasks']:user.role==='hr'?['attendance','employees','tasks','camps']:user.role==='dispatcher'?['tasks','machineLogs','equipment','employees']:['tasks','employees','equipment','camps'];
  const mobileIcons={dashboard:<DashboardOutlined/>,employees:<TeamOutlined/>,attendance:<CalendarOutlined/>,campCheck:<CheckCircleOutlined/>,tasks:<FileDoneOutlined/>,camps:<HomeOutlined/>,machineLogs:<ToolOutlined/>,equipment:<ToolOutlined/>};
  let content=null;
  if (page==='dashboard') content=<Dashboard lists={lists} submissions={submissions} date={date} setDate={setDate} onNavigate={setPage}/>;
  else if (page==='tasks') content=<TasksPage lists={lists} submissions={submissions} refresh={refresh} user={user} date={date} setDate={setDate}/>;
  else if (page==='campCheck') content=<CampCheck lists={lists} user={user} date={date} setDate={setDate} refresh={refresh}/>;
  else if (page==='reports') content=<Reports lists={lists} submissions={submissions} date={date} setDate={setDate}/>;
  else if (page==='manpower') content=<RecordPage type="employees" lists={lists} submissions={submissions} refresh={refresh} user={user} date={date} setDate={setDate}/>;
  else if (page==='users') content=<Users users={users} camps={lists.camps} refresh={refresh}/>;
  else if (schemas[page]) content=<RecordPage type={page} lists={lists} submissions={submissions} refresh={refresh} user={user} date={date} setDate={setDate}/>;
  return <Layout className="app-layout">
    <Sider width={232} collapsedWidth={72} collapsible collapsed={collapsed} trigger={null} className="sidebar"><div className="sidebar-brand"><div className="brand-symbol">Т</div>{!collapsed&&<div><strong>ТҮР HR</strong><span>Mining workforce</span></div>}</div><Menu mode="inline" selectedKeys={[page]} defaultOpenKeys={['mountain']} items={items} onClick={({key})=>setPage(key)} className="side-menu"/><div className="sidebar-bottom">{!collapsed&&<span>ДОТООД УДИРДЛАГА · 2026</span>}</div></Sider>
    <Layout><Header className="topbar"><div className="topbar-left"><Button type="text" aria-label="Цэс" icon={isMobile?<MenuUnfoldOutlined/>:collapsed?<MenuUnfoldOutlined/>:<MenuFoldOutlined/>} onClick={()=>isMobile?setMobileOpen(true):setCollapsed(!collapsed)}/><span className="topbar-title">{title}</span></div><div className="topbar-right"><span className="topbar-date"><CalendarOutlined/> {dayjs().format('YYYY.MM.DD')}</span><div className="user-avatar"><UserOutlined/></div><div className="user-copy"><strong>{user.name}</strong><small>{roleNames[user.role]}</small></div><Button type="text" icon={<LogoutOutlined/>} title="Гарах" onClick={onLogout}/></div></Header><Content className="main-content">{loading?<div className="loading-screen">Ачаалж байна...</div>:content}</Content></Layout>
    {isMobile&&<><nav className="mobile-nav" aria-label="Үндсэн навигаци">{mobileKeys.map(key=><button key={key} type="button" className={page===key?'active':''} onClick={()=>setPage(key)}><span>{mobileIcons[key]}</span><small>{titleMap[key]}</small></button>)}<button type="button" onClick={()=>setMobileOpen(true)}><span><MoreOutlined/></span><small>Бүх цэс</small></button></nav><Drawer title="ТҮР HR · Цэс" placement="left" width={280} open={mobileOpen} onClose={()=>setMobileOpen(false)}><Menu mode="inline" selectedKeys={[page]} defaultOpenKeys={['mountain']} items={items} onClick={({key})=>{setPage(key);setMobileOpen(false)}} className="side-menu"/></Drawer></>}
  </Layout>
}

function OfflinePage(){return <main className="offline-page"><div className="offline-card"><div className="offline-icon"><DisconnectOutlined/></div><span className="offline-kicker">ТҮР HR · ХОЛБОЛТ</span><h1>Интернет холболтгүй байна</h1><p>Сүлжээний холболтоо шалгаад дахин оролдоно уу. Холболт сэргэхэд бүртгэлүүдээ үргэлжлүүлж болно.</p><Button type="primary" size="large" icon={<ReloadOutlined/>} onClick={()=>window.location.reload()}>Дахин оролдох</Button></div></main>}

export default function App(){const [user,setUser]=useState(null);const [checking,setChecking]=useState(true);const [online,setOnline]=useState(()=>navigator.onLine);useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update)}},[]);useEffect(()=>{if(!online)return;api('/me').then(setUser).catch(()=>{}).finally(()=>setChecking(false))},[online]);async function logout(){try{await api('/logout',{method:'POST'})}finally{setUser(null)}}return <ConfigProvider theme={{token:{colorPrimary:'#7656d8',borderRadius:10,colorBgLayout:'#f7f8fb',fontFamily:'Inter, Arial, sans-serif'},components:{Menu:{itemSelectedBg:'#f3efff',itemSelectedColor:'#6845d1'}}}}><AntApp>{!online?<OfflinePage/>:checking?<div className="loading-screen">Ачаалж байна...</div>:user?<Shell user={user} onLogout={logout}/>:<Login onLogin={setUser}/>}</AntApp></ConfigProvider>}
