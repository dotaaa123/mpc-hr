import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const fontPath = fileURLToPath(new URL('./fonts/NotoSans-Regular.ttf', import.meta.url));
const kinds = {
  hiring:'Ажилд томилох тушаал',
  termination:'Ажлаас чөлөөлөх тушаал',
  clearance:'Тойрох хуудас',
  extension:'Сунаж ажиллах хуудас',
  certificate:'Ажилтны тодорхойлолт',
};
export const documentKinds = kinds;

function wrap(text, font, size, width) {
  const result=[];
  for (const paragraph of String(text || '').split('\n')) {
    const words=paragraph.split(/\s+/).filter(Boolean);
    let line='';
    for (const word of words) {
      const trial=line?`${line} ${word}`:word;
      if (font.widthOfTextAtSize(trial,size)>width && line) {result.push(line);line=word}
      else line=trial;
    }
    result.push(line);
  }
  return result;
}

export async function createEmployeePdf({kind,employee,fields={},approvers=[]}) {
  if (!kinds[kind]) throw new Error('Баримтын төрөл буруу байна');
  const pdf=await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(await readFile(fontPath),{subset:true});
  const page=pdf.addPage([595.28,841.89]);
  const black=rgb(.13,.15,.19),muted=rgb(.37,.41,.47),line=rgb(.76,.8,.85);
  const margin=52,width=page.getWidth()-margin*2;
  let y=page.getHeight()-54;
  const draw=(value,size=11,opts={})=>{
    const spacing=opts.spacing||size*1.7;
    for(const part of wrap(value,font,size,width)){
      if(y<55)throw new Error('Баримтын агуулга нэг хуудсанд багтсангүй');
      const text=part||' ';
      const measured=font.widthOfTextAtSize(text,size);
      page.drawText(text,{x:opts.center?margin+(width-measured)/2:margin,y,size,font,color:opts.color||black});
      y-=spacing;
    }
    y-=opts.after||0;
  };
  const rule=()=>{page.drawLine({start:{x:margin,y},end:{x:margin+width,y},thickness:.7,color:line});y-=17};
  const label=(name,value)=>draw(`${name}: ${value || '________________________'}`,10,{after:3});
  const date=fields.date || new Date().toISOString().slice(0,10);
  const company=String(fields.companyName || 'Мажор Бласт Трейдинг ХХК');
  const fullName=`${employee.lastName || ''} ${employee.firstName || ''}`.trim();
  const signature=()=>{y-=20;rule();label('ГҮЙЦЭТГЭХ ЗАХИРАЛ',fields.executiveName);label('Боловсруулсан',fields.preparedBy);label('Хянасан',fields.reviewedBy)};

  if (kind==='hiring' || kind==='termination') {
    draw('ГҮЙЦЭТГЭХ ЗАХИРЛЫН ТУШААЛ',15,{center:true,after:10});
    draw(`${date}                         Дугаар № ${fields.orderNumber || '______'}                         ${fields.city || 'Улаанбаатар хот'}`,9,{after:8});
    rule();
    const trialMonths=Number(fields.trialMonths||0);
    draw(kind==='hiring'&&trialMonths>0?'ТУРШИЛТЫН ХУГАЦААГААР АЖИЛД ТОМИЛОХ ТУХАЙ':kind==='hiring'?'АЖИЛД ТОМИЛОХ ТУХАЙ':'АЖЛААС ЧӨЛӨӨЛӨХ ТУХАЙ',13,{center:true,after:10});
    label('Үндэслэл',fields.legalBasis);
    draw('ТУШААХ нь:',11,{after:8});
    if(kind==='hiring'){
      draw(`Нэг. ${company}-ийн ${fields.projectName || 'Ууцар'} төслийн ${employee.branch || '________________'} салбарт ${fullName} (РД: ${employee.register || '________'})-ыг ${employee.position || '________________'} албан тушаалд ${fields.effectiveDate || employee.hireDate || date}-ны өдрөөс ${trialMonths>0?`${trialMonths} сарын туршилтын хугацаагаар `:''}томилсугай.`,10,{after:8});
      const salary=Number(fields.salaryAmount || employee.baseSalary || 0);
      draw(`Хоёр. Үндсэн цалин: ${salary>0?salary.toLocaleString('mn-MN'):'________________'} төгрөг. Цалингийн нөхцөлийг хөдөлмөрийн гэрээ болон батлагдсан журмын дагуу хэрэгжүүлсүгэй.`,10,{after:8});
      draw('Гурав. Хөдөлмөрийн гэрээ, ажлын байрны тодорхойлолт болон дотоод журмыг ажилтанд танилцуулж баталгаажуулахыг Хүний нөөцөд даалгасугай.',10,{after:8});
    }else{
      draw(`Нэг. ${company}-ийн ${employee.branch || '________________'} салбарын ${employee.position || '________________'} албан тушаалтай ${fullName} (РД: ${employee.register || '________'})-ын хөдөлмөр эрхлэлтийн харилцааг ${fields.effectiveDate || employee.terminationDate || date}-ны өдрөөр дуусгавар болгосугай.`,10,{after:8});
      label('Санаачилга',fields.initiator || employee.terminationInitiator);
      label('Шалтгаан',fields.reason || employee.terminationReason);
      draw('Хоёр. Ажилласан хугацааны тооцоог хуулийн болон компанийн батлагдсан журмын дагуу хийсүгэй.',10,{after:8});
      draw('Гурав. Ажилтны тойрох хуудсыг бүрдүүлж, холбогдох баримтыг хүлээлцсүгэй.',10,{after:8});
    }
    signature();
  } else if(kind==='clearance') {
    draw(`${company}-ийн захирлын тушаалын хавсралт`,9,{center:true,after:8});
    draw('ТОЙРОХ ХУУДАС',16,{center:true,after:14});
    label('Ажилтны овог, нэр',fullName);
    label('Алба, хэлтэс',employee.branch);
    label('Албан тушаал',employee.position);
    label('Огноо',date);
    y-=8;rule();
    const headers=['№','Тооцоог нягтлах албан тушаал','Овог нэр','Тооцоотой эсэх','Гарын үсэг'];
    const widths=[24,170,110,110,76],x=[margin];
    for(let i=1;i<widths.length;i++)x.push(x[i-1]+widths[i-1]);
    const row=(cells,bold=false)=>{for(let i=0;i<cells.length;i++){const cell=String(cells[i]||'');const lines=wrap(cell,font,bold?8:9,widths[i]-6).slice(0,2);lines.forEach((part,j)=>page.drawText(part||' ',{x:x[i]+2,y:y-j*12,size:bold?8:9,font,color:black}))}y-=35;page.drawLine({start:{x:margin,y:y+11},end:{x:margin+width,y:y+11},thickness:.5,color:line})};
    row(headers,true);
    const signers=approvers.length?approvers:[{position:'Уурхайн дарга'},{position:'Зөвлөх'},{position:'Хүний нөөцийн мэргэжилтэн'},{position:'Нягтлан бодогч'},{position:'Бараа материалын нярав'}];
    signers.slice(0,8).forEach((person,index)=>row([index+1,person.position,person.name,'','']));
    y-=12;draw('Тайлбар: Дээрх албан тушаалтнуудтай тооцоо хийсний дараа Хүний нөөц холбогдох бичиг баримтыг хүлээлгэн өгнө.',9);
  } else if(kind==='extension') {
    draw('СУНАЖ АЖИЛЛАХ АЖИЛТНЫ ХУУДАС',15,{center:true,after:14});
    label('Огноо',date);label('Нэр',fullName);label('Хэлтэс',employee.branch);label('Албан тушаал',employee.position);
    label('Байршил',fields.location);label('Ажиллах болсон шалтгаан',fields.reason);
    label('Эхлэх',fields.startDate);label('Дуусах',fields.endDate);
    draw(`Зөвшөөрсөн: ${fields.approvalDecision==='approved'?'[X]':'[ ]'}     Зөвшөөрөөгүй: ${fields.approvalDecision==='rejected'?'[X]':'[ ]'}`,10,{after:4});
    draw(`Цалинтай 1.5: ${fields.payMode==='paid_1_5'?'[X]':'[ ]'}     Цалингүй: ${fields.payMode==='unpaid'?'[X]':'[ ]'}`,10,{after:4});
    label('Цалингийн нөхцөл',fields.payCondition);
    y-=18;rule();
    for(const person of approvers.slice(0,8)) label(person.position,person.name);
    if(!approvers.length){label('Ажилтны гарын үсэг','');label('Бүртгэсэн / Засварын клерк','');label('Хянасан / Засварын мастер','');label('Зөвшөөрсөн / Техник ашиглалтын албаны дарга','');label('Баталсан / Ерөнхий менежер','')}
  } else if(kind==='certificate') {
    draw(company,14,{center:true,after:8});
    draw(fields.companyAddress || 'Улаанбаатар хот, Сүхбаатар дүүрэг, 1 дүгээр хороо, Олимпийн гудамж 7/3 байр',9,{center:true,after:3});
    draw(`Утас: ${fields.companyPhone || '(976) 88338768'}    И-мэйл: ${fields.companyEmail || 'majorbalancetradellc@gmail.com'}`,9,{center:true,after:10});
    rule();
    draw(`Огноо: ${date}                                      Дугаар: ${fields.orderNumber || '______'}`,9,{after:18});
    draw('АЖИЛТНЫ ТОДОРХОЙЛОЛТ',15,{center:true,after:18});
    draw(`${fullName} (РД: ${employee.register || '________'}) нь ${company}-ийн ${employee.branch || '________________'} салбарт ${employee.position || '________________'} албан тушаалд ${employee.hireDate || '________'}-ны өдрөөс ${employee.terminationDate ? `${employee.terminationDate}-ны өдөр хүртэл ажиллаж байсан` : 'өнөөдрийг хүртэл ажиллаж байгаа'} нь үнэн болно.`,11,{after:10});
    if(fields.contractType)label('Гэрээний төрөл',fields.contractType);
    const salary=Number(fields.salaryAmount || employee.baseSalary || 0);
    if(salary>0)label('Үндсэн цалин',`${salary.toLocaleString('mn-MN')} ₮`);
    if(fields.purpose) label('Тодорхойлолтын зорилго',fields.purpose);
    signature();
  }
  page.drawText('ТҮР HR · MPC',{x:margin,y:25,size:8,font,color:muted});
  page.drawText('ТӨСӨЛ · гарын үсгээр баталгаажуулна',{x:page.getWidth()-margin-205,y:25,size:8,font,color:muted});
  return Buffer.from(await pdf.save());
}
