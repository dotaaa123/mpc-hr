import React, { useEffect, useState } from 'react';
import { Alert, Button, Input, InputNumber, Modal, Select, Space, Table, Tag } from 'antd';

const display = value => value === undefined || value === null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const fieldHints=[[/ээлж|shift/i,['shift','workShift','shiftGroup']],[/багтаамж/i,['capacity','haulCapacity','tankCapacityLiters']],[/бүтээл|хэмжээ|amount/i,['amount','targetOutput']],[/рейс/i,['race']],[/парк|техник/i,['parkNo','haulParkNo','excavatorParkNo','equipmentId']],[/vin|арлын|серийн/i,['vin']],[/регистр/i,['register']],[/материал/i,['material','materialType']],[/огноо|өдөр|date/i,['date','startDate','endDate']],[/цалин|salary/i,['salary','baseSalary']],[/ндш|хувь/i,['insuredShare']],[/хоног/i,['plannedDays','payrollPlannedDays']],[/ажилтан|оператор/i,['employeeId','operatorCode','operatorId']]];

export default function ExcelImportReview({open,title='Excel импортын мөрүүд',filename,rows=[],fields=[],issues=[],checking=false,saving=false,onChange,onRemove,onCheck,onImport,onClose,extra}) {
  const [selected,setSelected]=useState(null);
  useEffect(()=>{if(!open)setSelected(null)},[open]);
  const issueMap=new Map();
  for(const issue of issues){const key=Number(issue.row);if(!issueMap.has(key))issueMap.set(key,[]);issueMap.get(key).push(issue.message)}
  const active=rows.find(row=>Number(row.__excelRow)===selected);
  const activeIssues=issueMap.get(selected)||[];
  const issueText=activeIssues.join(' ').toLowerCase();
  const highlighted=new Set(fields.filter(field=>issueText.includes(field.key.toLowerCase())||issueText.includes(field.label.toLowerCase())).map(field=>field.key));
  for(const [pattern,keys] of fieldHints)if(pattern.test(issueText))for(const key of keys)highlighted.add(key);
  const orderedFields=[...fields].sort((left,right)=>Number(highlighted.has(right.key))-Number(highlighted.has(left.key)));
  const columns=[
    {title:'Excel мөр',dataIndex:'__excelRow',width:100,render:(value,row)=>`${row.__sheet?`${row.__sheet}!`:''}${value}`},
    {title:'Төлөв',width:105,render:(_,row)=>issueMap.has(Number(row.__excelRow))?<Tag color="red">Алдаатай</Tag>:<Tag color="green">Шалгасан</Tag>},
    {title:'Алдаа / мэдээлэл',render:(_,row)=>issueMap.get(Number(row.__excelRow))?.join('; ')||fields.slice(0,3).map(field=>display(row[field.key])).join(' · '),ellipsis:true},
    {title:'',width:85,render:(_,row)=><Button size="small" onClick={()=>setSelected(Number(row.__excelRow))}>Засах</Button>},
  ];
  const inputFor=(field,value)=>{
    if(field.options?.length)return <Select allowClear showSearch optionFilterProp="label" value={value||undefined} options={field.options.map(option=>typeof option==='object'?option:{value:option,label:String(option)})} onChange={next=>onChange(selected,field.key,next)} className="w-full"/>;
    if(field.type==='number')return <InputNumber className="w-full" value={typeof value==='number'?value:value===''||value==null?null:Number(value)||null} onChange={next=>onChange(selected,field.key,next)}/>;
    return <Input value={value===undefined||value===null?'':String(value)} onChange={event=>onChange(selected,field.key,event.target.value)} placeholder={field.type==='date'?'YYYY-MM-DD':undefined}/>;
  };
  return <Modal title={title} open={open} width={920} onCancel={onClose} destroyOnHidden footer={<Space><Button onClick={onClose}>Хаах</Button><Button loading={checking} onClick={onCheck}>Мөрүүдийг шалгах</Button>{onImport&&<Button type="primary" loading={saving} disabled={!rows.length||issues.length>0||checking} onClick={onImport}>{rows.length} мөр импортлох</Button>}</Space>}>
    <div className="mb-3 flex flex-wrap items-center gap-2"><Tag>{filename}</Tag><Tag color="blue">Нийт {rows.length} мөр</Tag><Tag color={issues.length?'red':'green'}>Алдаа {issues.length}</Tag></div>
    {extra}
    {issues.length>0&&<Alert showIcon type="error" className="mb-3" message="Алдаатай мөр дээр дарж, утгыг энд засна уу" description={issues.slice(0,5).map((issue,index)=><div key={index}><Button type="link" size="small" className="!px-0" onClick={()=>setSelected(Number(issue.row))}>{issue.sheet?`${issue.sheet}!`:''}${issue.row}-р мөр</Button> · {issue.message}</div>)}/>}
    <Table size="small" rowKey={row=>`${row.__sheet||''}:${row.__excelRow}`} columns={columns} dataSource={rows} pagination={{pageSize:8,showSizeChanger:false}} scroll={{y:300,x:680}} onRow={row=>({onClick:()=>setSelected(Number(row.__excelRow)),style:{cursor:'pointer',background:selected===Number(row.__excelRow)?'#f5f3ff':undefined}})}/>
    {active&&<div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="mb-3 font-semibold">{active.__sheet?`${active.__sheet}!`:''}${selected}-р мөрийг засах</div>{activeIssues.map((error,index)=><Alert key={index} type="error" showIcon className="mb-2" message={error}/>)}<div className="grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">{orderedFields.map(field=><label key={field.key} className={`block rounded-md p-1 text-sm ${highlighted.has(field.key)?'bg-red-50':''}`}><span className="mb-1 block font-medium">{field.label}{highlighted.has(field.key)&&<Tag color="red" className="ml-2">Шалгах</Tag>}</span>{inputFor(field,active[field.key])}</label>)}</div><div className="mt-3 flex items-center justify-between"><p className="mb-0 text-xs text-slate-500">Засвар энэ импортын мөрөнд үйлчилнэ. Excel эх файл өөрчлөгдөхгүй.</p>{onRemove&&<Button danger size="small" onClick={()=>{onRemove(selected);setSelected(null)}}>Энэ мөрийг импортлохгүй</Button>}</div></div>}
  </Modal>;
}
