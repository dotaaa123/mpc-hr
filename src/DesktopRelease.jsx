import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Progress, Space, Typography, message } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';

const CHUNK = 1024 * 1024;
const releaseRequest = async (path, options={}) => {
  const projectId=sessionStorage.getItem('mpc-project-id');
  const response=await fetch('/api/desktop-release'+path,{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...(projectId?{'X-Project-ID':projectId}:{}),...options.headers}});
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(body?.error||'Серверийн алдаа');
  return body;
};
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const encode=bytes=>{let value='';for(let i=0;i<bytes.length;i+=16384)value+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(value)};
const decode=value=>{const raw=atob(value),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes};

export async function downloadDesktopRelease(release,onProgress=()=>{}) {
  const parts=[];
  for(let index=0;index<release.chunkCount;index++){
    const body=await releaseRequest('/'+release.id+'/chunks/'+index);
    parts.push(decode(body.data));
    onProgress(Math.round((index+1)/release.chunkCount*100));
  }
  const blob=new Blob(parts,{type:'application/zip'});
  if(blob.size!==release.size)throw new Error('Татсан файлын хэмжээ зөрсөн байна');
  const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())));
  if(digest!==release.sha256)throw new Error('Татсан файлын шалгах дүн зөрсөн байна');
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=release.filename;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

export function DesktopDownload({compact=false}) {
  const [release,setRelease]=useState(null),[loading,setLoading]=useState(false),[progress,setProgress]=useState(0);
  useEffect(()=>{releaseRequest('/latest').then(setRelease).catch(()=>{})},[]);
  if(!release)return null;
  const start=async()=>{setLoading(true);setProgress(0);try{await downloadDesktopRelease(release,setProgress)}catch(error){message.error(error.message)}finally{setLoading(false)}};
  return <div className={compact?'desktop-download compact':'desktop-download'}>
    <Button icon={<DownloadOutlined/>} loading={loading} onClick={start}>Windows програм татах</Button>
    <div className="desktop-download-note">Хувилбар {release.version} · ZIP файлыг задалж, доторх суулгагчийг ажиллуулна уу.</div>
    {loading&&<Progress percent={progress} size="small"/>}
  </div>;
}

export function DesktopReleasePage() {
  const [release,setRelease]=useState(null),[file,setFile]=useState(null),[version,setVersion]=useState('1.0.0'),[progress,setProgress]=useState(0),[busy,setBusy]=useState(false);
  const refresh=()=>releaseRequest('/latest').then(setRelease).catch(error=>message.error(error.message));
  useEffect(()=>{refresh()},[]);
  const upload=async()=>{
    if(!file||!file.name.toLowerCase().endsWith('.zip'))return message.error('ZIP файл сонгоно уу');
    if(file.size>250*1024*1024)return message.error('Файл 250 MB-аас их байна');
    setBusy(true);setProgress(0);
    try{
      const bytes=new Uint8Array(await file.arrayBuffer());
      const sha256=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
      const created=await releaseRequest('',{method:'POST',body:JSON.stringify({filename:file.name,version,size:file.size,sha256})});
      for(let index=0;index<created.chunkCount;index++){
        const data=encode(bytes.subarray(index*CHUNK,Math.min(bytes.length,(index+1)*CHUNK)));
        await releaseRequest('/'+created.id+'/chunks/'+index,{method:'PUT',body:JSON.stringify({data})});
        setProgress(Math.round((index+1)/created.chunkCount*95));
      }
      await releaseRequest('/'+created.id+'/publish',{method:'POST'});
      setProgress(100);setFile(null);await refresh();message.success('Шинэ хувилбар нийтлэгдлээ');
    }catch(error){message.error(error.message)}finally{setBusy(false)}
  };
  return <div className="page-stack"><div className="page-title-row"><div><span className="eyebrow">ТОХИРГОО</span><Typography.Title level={2}>Windows програм</Typography.Title><Typography.Text type="secondary">Админ ZIP хувилбарыг оруулсны дараа нэвтрэх хуудсанд татах товч гарна.</Typography.Text></div></div>
    <Card title="Нийтлэгдсэн хувилбар">{release?<Space direction="vertical"><Typography.Text strong>{release.filename} · {release.version}</Typography.Text><Typography.Text type="secondary">{(release.size/1024/1024).toFixed(1)} MB · {new Date(release.createdAt).toLocaleString('mn-MN')}</Typography.Text><DesktopDownload/></Space>:<Alert type="info" showIcon message="Хувилбар хараахан нийтлээгүй байна"/>}</Card>
    <Card title="Шинэ хувилбар оруулах"><Space direction="vertical" style={{width:'100%'}} size="middle"><Alert type="info" showIcon message="ZIP дотор Windows суулгагч (Setup.exe) байх ёстой. Энгийн Flutter Release хавтас дангаараа shortcut үүсгэхгүй."/><Input placeholder="Хувилбар, жишээ нь 1.0.0" value={version} onChange={event=>setVersion(event.target.value)} style={{maxWidth:240}}/><input aria-label="Windows програмын ZIP" type="file" accept=".zip,application/zip" onChange={event=>setFile(event.target.files?.[0]||null)}/><Button type="primary" icon={<UploadOutlined/>} loading={busy} disabled={!file} onClick={upload}>ZIP оруулах, нийтлэх</Button>{busy&&<Progress percent={progress}/>}</Space></Card>
  </div>;
}
