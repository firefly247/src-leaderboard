'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function server(){
  const sheets=new Map();let held=false,id=0;
  const spreadsheet={getSheetByName:n=>sheets.get(n),insertSheet(n){const rows=[];const sheet={rows,appendRow:r=>rows.push(r),setFrozenRows(){},getLastRow:()=>rows.length,getDataRange:()=>({getDisplayValues:()=>rows.map(r=>r.map(String))}),getRange(row,col){return {setNumberFormat(){return this;},setValues(values){assert.ok(held);values.forEach((r,i)=>{rows[row-1+i]||=[];r.forEach((v,j)=>rows[row-1+i][col-1+j]=v);});return this;}};}};sheets.set(n,sheet);return sheet;}};
  const context=vm.createContext({Date,Set,PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'private-sheet'})},SpreadsheetApp:{openById:()=>spreadsheet,flush(){assert.ok(held);}},LockService:{getScriptLock:()=>({waitLock(){held=true;},releaseLock(){held=false;}})},CacheService:{getScriptCache:()=>({get:k=>k==='admin:valid'?'1':null})},Utilities:{getUuid:()=>`id-${++id}`,base64Encode:v=>Buffer.from(v).toString('base64'),computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),DigestAlgorithm:{SHA_256:'sha'},Charset:{UTF_8:'utf8'}}});
  for(const file of ['Code.gs','Training.gs'])vm.runInContext(fs.readFileSync(`${__dirname}/../apps-script/${file}`,'utf8'),context);
  return {call:(a,p={},token='')=>JSON.parse(JSON.stringify(context.dispatch_(a,{date:'2026-10-24',...p},token))),build:p=>JSON.parse(JSON.stringify(context.trainingBuildPlan_(p))),sheets};
}
const entry=(name,extra={})=>({name,editKey:'a'.repeat(32),status:'참석',arrival:'정시',preference:'무관',experience:'초급',canCox:false,canSmallBoat:false,...extra});
test('registration privately persists and protects same-name updates without exposing edit keys',()=>{
  const s=server();let result=s.call('trainingJoin',entry('김선수'));
  assert.equal(result.training.participants.length,1);assert.equal(result.training.participants[0].editHash,undefined);assert.ok(!JSON.stringify(result).includes('aaaa'));
  assert.throws(()=>s.call('trainingJoin',entry('김선수',{editKey:'b'.repeat(32)})),/처음 신청한 브라우저/);
  result=s.call('trainingJoin',entry('김선수',{status:'불참'}));assert.equal(result.training.participants[0].status,'불참');assert.equal(result.training.participants.length,1);
  assert.deepEqual([...s.sheets.keys()],['WEEKEND_TRAINING']);
});
test('admin authorization, revision conflicts, and attendance-only updates',()=>{
  const s=server();s.call('trainingJoin',entry('김선수',{canSmallBoat:true}));
  assert.throws(()=>s.call('trainingRecommend',{revision:1}),/관리자 인증/);
  assert.throws(()=>s.call('trainingCheck',{id:'id-1',status:'불참',revision:1}),/관리자 인증/);
  let {training:t}=s.call('trainingRecommend',{revision:1},'valid');assert.equal(t.plan.boats[0].type,'1X');const boats=JSON.stringify(t.plan.boats);
  assert.throws(()=>s.call('trainingCheck',{id:'id-1',status:'불참',revision:1},'valid'),/다른 사용자가 변경/);
  t=s.call('trainingCheck',{id:'id-1',status:'불참',revision:t.revision},'valid').training;
  assert.equal(t.plan.checks['id-1'],'불참');assert.equal(JSON.stringify(t.plan.boats),boats);assert.equal(s.call('trainingGet').training.plan.checks['id-1'],'불참');
  assert.throws(()=>s.call('trainingCheck',{id:'unknown',status:'출석',revision:t.revision},'valid'),/편성된 멤버/);
});
test('fleet capacity, cox and small boat eligibility, late arrivals',()=>{
  const s=server(),p=Array.from({length:32},(_,i)=>({id:`p${i}`,name:`선수${i}`,status:'참석',arrival:'정시',preference:'무관',experience:'중급',canCox:i<4,canSmallBoat:true}));
  const result=s.build(p),seats=result.boats.flatMap(b=>b.seats);assert.equal(seats.length,25);assert.equal(new Set(seats.map(m=>m.id)).size,25);assert.equal(result.wait.length,7);
  assert.equal(result.boats.filter(b=>b.type==='4X+').length,4);assert.equal(result.boats.filter(b=>b.type==='2X').length,2);assert.equal(result.boats.filter(b=>b.type==='1X').length,1);
  result.boats.filter(b=>b.type==='4X+').forEach(b=>assert.ok(p.find(m=>m.id===b.seats[0].id).canCox));
  p.forEach(m=>{m.canCox=false;m.canSmallBoat=false;});assert.equal(s.build(p).boats.length,0);
  p[0].canCox=true;const beginners=s.build(p);assert.equal(beginners.boats.length,1);assert.equal(beginners.boats[0].seats.length,5);
  p[0].arrival='늦참';assert.equal(s.build(p).boats.length,0);assert.equal(s.build(p).wait.length,32);
});
test('registration changes preserve published plan and flag a stale snapshot; dates are isolated',()=>{
  const s=server();s.call('trainingJoin',entry('김선수',{canSmallBoat:true}));let t=s.call('trainingRecommend',{revision:1},'valid').training;const plan=JSON.stringify(t.plan);
  t=s.call('trainingJoin',entry('김선수',{status:'불참',canSmallBoat:true})).training;
  assert.equal(JSON.stringify(t.plan),plan);assert.notEqual(t.plan.registrationRevision,t.registrationRevision);
  assert.equal(s.call('trainingGet',{date:'2026-10-25'}).training.participants.length,0);
});
test('malformed dates and payloads rejected without persisting',()=>{
  const s=server();for(const date of ['2026-10-23','2026-02-30','bad'])assert.throws(()=>s.call('trainingGet',{date}),/날짜|토요일/);
  assert.throws(()=>s.call('trainingJoin',entry('<script>')),/이름/);assert.throws(()=>s.call('trainingJoin',entry('김',{status:'bad'})),/신청 항목/);assert.equal(s.sheets.size,0);
});
