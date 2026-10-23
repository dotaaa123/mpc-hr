import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { documentKinds } from './documentKinds.js';

const blank='________________________';
const text=value=>String(value??'').trim()||blank;
const paragraph=(value,{bold=false,size=22,align=AlignmentType.LEFT,spaceAfter=150}={})=>new Paragraph({alignment:align,spacing:{after:spaceAfter,line:320},children:[new TextRun({text:String(value),bold,size,font:'Arial'})]});
const title=value=>paragraph(value,{bold:true,size:30,align:AlignmentType.CENTER,spaceAfter:260});
const label=(name,value)=>paragraph(`${name}: ${text(value)}`);
const pageBreak=()=>paragraph('');
const signature=fields=>[
  pageBreak(),label('ГҮЙЦЭТГЭХ ЗАХИРАЛ',fields.executiveName),
  label('Боловсруулсан',fields.preparedBy),label('Хянасан',fields.reviewedBy),
];
const cell=value=>new TableCell({children:[paragraph(value,{size:18,spaceAfter:50})],margins:{top:80,bottom:80,left:80,right:80}});

export async function createEmployeeDocx({kind,employee,fields={},approvers=[]}){
  if(!documentKinds[kind])throw new Error('Баримтын төрөл буруу байна');
  const date=fields.date||new Date().toISOString().slice(0,10);
  const company=text(fields.companyName||'Мажор Бласт Трейдинг ХХК');
  const fullName=`${employee.lastName||''} ${employee.firstName||''}`.trim();
  const children=[];
  const add=(...items)=>children.push(...items);
  if(kind==='hiring'||kind==='termination'){
    add(title('ГҮЙЦЭТГЭХ ЗАХИРЛЫН ТУШААЛ'));
    add(paragraph(`${date}     Дугаар № ${fields.orderNumber||'______'}     ${fields.city||'Улаанбаатар хот'}`,{align:AlignmentType.CENTER}));
    const trialMonths=Number(fields.trialMonths||0);
    add(title(kind==='hiring'?(trialMonths?'ТУРШИЛТЫН ХУГАЦААГААР АЖИЛД ТОМИЛОХ ТУХАЙ':'АЖИЛД ТОМИЛОХ ТУХАЙ'):'АЖЛААС ЧӨЛӨӨЛӨХ ТУХАЙ'));
    add(label('Үндэслэл',fields.legalBasis),paragraph('ТУШААХ нь:',{bold:true}));
    if(kind==='hiring'){
      add(paragraph(`Нэг. ${company}-ийн ${fields.projectName||'Ууцар'} төслийн ${employee.branch||blank} салбарт ${fullName} (РД: ${employee.register||'________'})-ыг ${employee.position||blank} албан тушаалд ${fields.effectiveDate||employee.hireDate||date}-ны өдрөөс ${trialMonths?`${trialMonths} сарын туршилтын хугацаагаар `:''}томилсугай.`));
      const salary=Number(fields.salaryAmount||employee.baseSalary||0);
      add(paragraph(`Хоёр. Үндсэн цалин: ${salary?salary.toLocaleString('mn-MN'):blank} төгрөг. Цалингийн нөхцөлийг хөдөлмөрийн гэрээ болон батлагдсан журмын дагуу хэрэгжүүлсүгэй.`));
      add(paragraph('Гурав. Хөдөлмөрийн гэрээ, ажлын байрны тодорхойлолт болон дотоод журмыг ажилтанд танилцуулж баталгаажуулахыг Хүний нөөцөд даалгасугай.'));
    }else{
      add(paragraph(`Нэг. ${company}-ийн ${employee.branch||blank} салбарын ${employee.position||blank} албан тушаалтай ${fullName} (РД: ${employee.register||'________'})-ын хөдөлмөр эрхлэлтийн харилцааг ${fields.effectiveDate||employee.terminationDate||date}-ны өдрөөр дуусгавар болгосугай.`));
      add(label('Санаачилга',fields.initiator||employee.terminationInitiator),label('Шалтгаан',fields.reason||employee.terminationReason));
      add(paragraph('Хоёр. Ажилласан хугацааны тооцоог хуулийн болон компанийн батлагдсан журмын дагуу хийсүгэй.'));
      add(paragraph('Гурав. Ажилтны тойрох хуудсыг бүрдүүлж, холбогдох баримтыг хүлээлцсүгэй.'));
    }
    add(...signature(fields));
  }else if(kind==='clearance'){
    add(paragraph(`${company}-ийн захирлын тушаалын хавсралт`,{align:AlignmentType.CENTER}),title('ТОЙРОХ ХУУДАС'));
    add(label('Ажилтны овог, нэр',fullName),label('Алба, хэлтэс',employee.branch),label('Албан тушаал',employee.position),label('Огноо',date));
    const signers=approvers.length?approvers:[{position:'Уурхайн дарга'},{position:'Зөвлөх'},{position:'Хүний нөөцийн мэргэжилтэн'},{position:'Нягтлан бодогч'},{position:'Бараа материалын нярав'}];
    const rows=[['№','Тооцоог нягтлах албан тушаал','Овог нэр','Тооцоотой эсэх','Гарын үсэг'],...signers.slice(0,8).map((person,index)=>[index+1,person.position,person.name,'',''])];
    add(new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:rows.map(row=>new TableRow({children:row.map(cell)})),borders:{top:{style:BorderStyle.SINGLE,size:6},bottom:{style:BorderStyle.SINGLE,size:6},left:{style:BorderStyle.SINGLE,size:6},right:{style:BorderStyle.SINGLE,size:6},insideHorizontal:{style:BorderStyle.SINGLE,size:4},insideVertical:{style:BorderStyle.SINGLE,size:4}}}));
    add(paragraph('Тайлбар: Дээрх албан тушаалтнуудтай тооцоо хийсний дараа Хүний нөөц холбогдох бичиг баримтыг хүлээлгэн өгнө.'));
  }else if(kind==='extension'){
    add(title('СУНАЖ АЖИЛЛАХ АЖИЛТНЫ ХУУДАС'));
    add(label('Огноо',date),label('Нэр',fullName),label('Хэлтэс',employee.branch),label('Албан тушаал',employee.position),label('Байршил',fields.location),label('Ажиллах болсон шалтгаан',fields.reason),label('Эхлэх',fields.startDate),label('Дуусах',fields.endDate));
    add(paragraph(`Зөвшөөрсөн: ${fields.approvalDecision==='approved'?'☒':'☐'}     Зөвшөөрөөгүй: ${fields.approvalDecision==='rejected'?'☒':'☐'}`));
    add(paragraph(`Цалинтай 1.5: ${fields.payMode==='paid_1_5'?'☒':'☐'}     Цалингүй: ${fields.payMode==='unpaid'?'☒':'☐'}`));
    add(label('Цалингийн нөхцөл',fields.payCondition));
    if(approvers.length)add(...approvers.slice(0,8).map(person=>label(person.position,person.name)));
    else add(...['Ажилтны гарын үсэг','Бүртгэсэн / Засварын клерк','Хянасан / Засварын мастер','Зөвшөөрсөн / Техник ашиглалтын албаны дарга','Баталсан / Ерөнхий менежер'].map(name=>label(name,'')));
  }else if(kind==='certificate'){
    add(title(company),paragraph(fields.companyAddress||'Улаанбаатар хот, Сүхбаатар дүүрэг, 1 дүгээр хороо, Олимпийн гудамж 7/3 байр',{align:AlignmentType.CENTER}),paragraph(`Утас: ${fields.companyPhone||'(976) 88338768'}    И-мэйл: ${fields.companyEmail||'majorbalancetradellc@gmail.com'}`,{align:AlignmentType.CENTER}));
    add(paragraph(`Огноо: ${date}     Дугаар: ${fields.orderNumber||'______'}`),title('АЖИЛТНЫ ТОДОРХОЙЛОЛТ'));
    add(paragraph(`${fullName} (РД: ${employee.register||'________'}) нь ${company}-ийн ${employee.branch||blank} салбарт ${employee.position||blank} албан тушаалд ${employee.hireDate||'________'}-ны өдрөөс ${employee.terminationDate?`${employee.terminationDate}-ны өдөр хүртэл ажиллаж байсан`:'өнөөдрийг хүртэл ажиллаж байгаа'} нь үнэн болно.`));
    if(fields.contractType)add(label('Гэрээний төрөл',fields.contractType));
    const salary=Number(fields.salaryAmount||employee.baseSalary||0);
    if(salary)add(label('Үндсэн цалин',`${salary.toLocaleString('mn-MN')} ₮`));
    if(fields.purpose)add(label('Тодорхойлолтын зорилго',fields.purpose));
    add(...signature(fields));
  }
  const doc=new Document({sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1000,bottom:1000,left:1000,right:1000}}},children}],styles:{default:{document:{run:{font:'Arial',size:22},paragraph:{spacing:{after:150,line:320}}}}}});
  return Buffer.from(await Packer.toBuffer(doc));
}
