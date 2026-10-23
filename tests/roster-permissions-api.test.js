import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const serverPath=fileURLToPath(new URL('../server/index.js',import.meta.url));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function freePort(){
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}

test('custom role can save permissions and create, update, delete roster records', {timeout:45000}, async()=>{
  const cwd=mkdtempSync(join(tmpdir(),'mpchr-api-test-'));
  const port=await freePort();
  const child=spawn(process.execPath,[serverPath],{cwd,env:{...process.env,PORT:String(port),ADMIN_PASSWORD:'TestPassword123!'},stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',chunk=>output+=chunk);
  child.stderr.on('data',chunk=>output+=chunk);
  const base=`http://127.0.0.1:${port}`;
  try{
    let ready=false;
    for(let attempt=0;attempt<250;attempt++){
      if(child.exitCode!==null)throw new Error(output);
      if(output.includes('MPC HR API')){ready=true;break}
      await sleep(100);
    }
    assert.ok(ready,`server did not start: ${output}`);
    const login=async(username,password)=>{
      const response=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
      assert.equal(response.status,200,await response.text());
      return response.headers.get('set-cookie').split(';')[0];
    };
    const adminCookie=await login('admin','TestPassword123!');
    const request=async(cookie,method,url,body)=>{
      const response=await fetch(base+url,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
      const data=await response.json();
      assert.ok(response.ok,`${method} ${url}: ${JSON.stringify(data)}`);
      return data;
    };
    const first=await request(adminCookie,'POST','/api/records/employees',{lastName:'Тест',firstName:'Нэг',register:'AA12345678',position:'Механик',bankAccount:'secret'});
    const second=await request(adminCookie,'POST','/api/records/employees',{lastName:'Тест',firstName:'Хоёр',register:'BB12345678',position:'Механик'});
    const role=await request(adminCookie,'POST','/api/roles',{name:'Ростерын тест'});
    const actions=['read','create','update','delete'];
    const saved=await request(adminCookie,'PUT',`/api/permissions/${role.key}`,{permissions:{rosterEntries:actions,positions:actions,rosterSketch:[],employees:[]}});
    assert.deepEqual(saved.permissions.rosterEntries,actions);
    await request(adminCookie,'POST','/api/users',{username:'roster_test',name:'Ростерын тест',role:role.key,password:'RolePassword123!',employeeId:first.id});
    const cookie=await login('roster_test','RolePassword123!');
    const bootstrap=await request(cookie,'GET','/api/bootstrap');
    assert.deepEqual(bootstrap.permissions.rosterSketch,['read']);
    assert.equal(bootstrap.records.employees.length,2);
    assert.equal(bootstrap.records.employees[0].bankAccount,undefined);
    const range=await request(cookie,'POST','/api/roster-entries/range',{employeeId:first.id,startDate:'2026-10-23',endDate:'2026-10-30',code:'d'});
    assert.equal(range.created,7);
    const sequence=await request(cookie,'POST','/api/roster-entries/sequence',{employeeIds:[first.id,second.id],startDate:'2026-10-23',pattern:'in-1, d-3, rr-2, out-1',repeatCount:2,notes:'Ээлж'});
    assert.equal(sequence.count,28);
    assert.equal(sequence.updated,7);
    const recent=await request(cookie,'GET','/api/roster-entries?startDate=2026-10-23&endDate=2026-10-30');
    assert.equal(recent.length,14);
    assert.ok(recent.every(row=>row.date<'2026-10-30'));
    const slimBootstrap=await request(cookie,'GET','/api/bootstrap');
    assert.deepEqual(slimBootstrap.records.rosterEntries,[]);
    let roster=await request(cookie,'GET','/api/records/rosterEntries');
    assert.equal(roster.length,28);
    const firstDay=roster.find(row=>row.employeeId===first.id&&row.date==='2026-10-23');
    assert.equal(firstDay.code,'in');
    await request(cookie,'DELETE',`/api/records/rosterEntries/${firstDay.id}`);
    roster=await request(cookie,'GET','/api/records/rosterEntries');
    assert.equal(roster.length,27);
    const position=await request(cookie,'POST','/api/records/positions',{name:'Ростер тест байр'});
    await request(cookie,'PUT',`/api/records/positions/${position.id}`,{name:'Ростер тест байр шинэ'});
    await request(cookie,'DELETE',`/api/records/positions/${position.id}`);
  }finally{
    child.kill();
    rmSync(cwd,{recursive:true,force:true});
  }
});
