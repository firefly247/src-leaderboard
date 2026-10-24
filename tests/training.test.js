'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function server(open=true){
  const sheets=new Map();let held=false,id=0;
  const spreadsheet={getSheetByName:n=>sheets.get(n),insertSheet(n){const rows=[];const sheet={rows,appendRow:r=>rows.push(r),setFrozenRows(){},getLastRow:()=>rows.length,getDataRange:()=>({getDisplayValues:()=>rows.map(r=>r.map(String))}),getRange(row,col){return {setNumberFormat(){return this;},setValues(values){assert.ok(held);values.forEach((r,i)=>{rows[row-1+i]||=[];r.forEach((v,j)=>rows[row-1+i][col-1+j]=v);});return this;}};}};sheets.set(n,sheet);return sheet;}};
  const context=vm.createContext({Date,Set,PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'private-sheet'})},SpreadsheetApp:{openById:()=>spreadsheet,flush(){assert.ok(held);}},LockService:{getScriptLock:()=>({waitLock(){held=true;},releaseLock(){held=false;}})},CacheService:{getScriptCache:()=>({get:k=>k==='admin:valid'?'1':null})},Utilities:{getUuid:()=>`id-${++id}`,base64Encode:v=>Buffer.from(v).toString('base64'),computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),DigestAlgorithm:{SHA_256:'sha'},Charset:{UTF_8:'utf8'}}});
  for(const file of ['Code.gs','Training.gs'])vm.runInContext(fs.readFileSync(`${__dirname}/../apps-script/${file}`,'utf8'),context);
  const call=(a,p={},token='')=>JSON.parse(JSON.stringify(context.dispatch_(a,{date:'2026-10-24',...p},token)));
  if(open)call('trainingOpen',{dates:['2026-10-24']},'valid');
  return {call,build:p=>JSON.parse(JSON.stringify(context.trainingBuildPlan_(p))),sheets,setYears(rows){const sheet=spreadsheet.getSheetByName('PLAYER_BIRTH_YEARS')||spreadsheet.insertSheet('PLAYER_BIRTH_YEARS');sheet.rows.splice(0,sheet.rows.length,['name','birth','updated','join'],...rows.map(([name,year])=>[name,'1985','',year]));}};
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
  let {training:t}=s.call('trainingRecommend',{revision:2},'valid');assert.equal(t.plan.boats[0].type,'1X');const boats=JSON.stringify(t.plan.boats);
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
  const s=server();s.call('trainingJoin',entry('김선수',{canSmallBoat:true}));let t=s.call('trainingRecommend',{revision:2},'valid').training;const plan=JSON.stringify(t.plan);
  t=s.call('trainingJoin',entry('김선수',{status:'불참',canSmallBoat:true})).training;
  assert.equal(JSON.stringify(t.plan),plan);assert.notEqual(t.plan.registrationRevision,t.registrationRevision);
  assert.equal(s.call('trainingGet',{date:'2026-10-25'}).training.participants.length,0);
});
test('malformed dates and payloads rejected without persisting',()=>{
  const s=server(false);for(const date of ['2026-10-23','2026-02-30','bad'])assert.throws(()=>s.call('trainingGet',{date}),/날짜|토요일/);
  assert.throws(()=>s.call('trainingJoin',entry('<script>')),/이름/);assert.throws(()=>s.call('trainingJoin',entry('김',{status:'bad'})),/신청 항목/);assert.equal(s.sheets.size,0);
});
test('only administrators open training; closed dates cannot accept or publish registrations',()=>{
  const s=server(false);assert.deepEqual(s.call('trainingList').sessions,[]);
  assert.throws(()=>s.call('trainingOpen',{dates:['2026-10-24']}),/관리자 인증/);
  assert.throws(()=>s.call('trainingJoin',entry('김선수')),/개설하지 않은/);
  assert.throws(()=>s.call('trainingRecommend',{revision:0},'valid'),/개설하지 않은/);
  assert.throws(()=>s.call('trainingCheck',{revision:0,id:'x',status:'출석'},'valid'),/개설하지 않은/);
  assert.equal(s.call('trainingGet').training.opened,false);
  assert.throws(()=>s.call('trainingOpen',{dates:['2026-10-24','2026-11-01']},'valid'),/같은 주/);
  assert.deepEqual(s.call('trainingList').sessions,[]);
  s.call('trainingOpen',{dates:['2026-10-24','2026-10-25']},'valid');
  assert.deepEqual(s.call('trainingList').sessions.map(s=>s.date),['2026-10-24','2026-10-25']);
  s.call('trainingJoin',entry('김선수'));const before=s.call('trainingGet').training;
  s.call('trainingOpen',{dates:['2026-10-24']},'valid');assert.deepEqual(s.call('trainingGet').training,before);
});
test('seniority comes from stored joining years, ignores self ratings, and hides source private fields',()=>{
  const s=server();s.setYears([['김선수','2020'],['새회원','2026'],['미래회원','2027']]);
  let t=s.call('trainingJoin',entry('김선수',{experience:'초급'})).training;
  assert.equal(t.participants[0].tenure,7);assert.equal(t.participants[0].experience,undefined);
  assert.equal(t.participants[0].joinYear,undefined);assert.equal(t.participants[0].birthYear,undefined);
  s.call('trainingJoin',entry('새회원',{experience:'숙련'}));assert.equal(s.call('trainingGet').training.participants[1].tenure,1);
  s.call('trainingJoin',entry('미등록'));assert.equal(s.call('trainingGet').training.participants[2].tenure,null);
  s.call('trainingJoin',entry('미래회원'));assert.equal(s.call('trainingGet').training.participants[3].tenure,null);
  s.setYears([['김선수','2025']]);assert.equal(s.call('trainingGet').training.participants[0].tenure,2);
});
test('quad distribution uses numeric seniority rather than a submitted skill label',()=>{
  const s=server(),p=Array.from({length:10},(_,i)=>({id:String(i),name:String(i),status:'참석',arrival:'정시',preference:'무관',canCox:i<2,canSmallBoat:false,tenure:i<2?1:12-i,experience:'숙련'}));
  const result=s.build(p);assert.equal(result.boats.length,2);assert.equal(result.boats[0].seats[1].id,'2');assert.equal(result.boats[1].seats[1].id,'3');assert.equal(result.boats[0].seats[2].id,'4');
});
test('training UI uses buttons throughout and displays only opened dates',()=>{
  const source=fs.readFileSync(`${__dirname}/../static/training.js`,'utf8');
  assert.ok(!source.includes('<select'));assert.ok(!source.includes('type="date"'));assert.ok(!source.includes('name="experience"'));
  assert.match(source,/data-open-date/);assert.match(source,/api\('trainingList'\)/);assert.match(source,/data-check=/);assert.match(source,/aria-pressed/);
});
