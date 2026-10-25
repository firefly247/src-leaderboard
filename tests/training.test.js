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
test('fleet capacity and qualifications without a removed arrival-time restriction',()=>{
  const s=server(),p=Array.from({length:32},(_,i)=>({id:`p${i}`,name:`선수${i}`,status:'참석',arrival:'정시',preference:'무관',experience:'중급',canCox:i<4,canSmallBoat:true}));
  const result=s.build(p),seats=result.boats.flatMap(b=>b.seats);assert.equal(seats.length,25);assert.equal(new Set(seats.map(m=>m.id)).size,25);assert.equal(result.wait.length,7);
  assert.equal(result.boats.filter(b=>b.type==='4X+').length,4);assert.equal(result.boats.filter(b=>b.type==='2X').length,2);assert.equal(result.boats.filter(b=>b.type==='1X').length,1);
  result.boats.filter(b=>b.type==='4X+').forEach(b=>assert.ok(p.find(m=>m.id===b.seats[0].id).canCox));
  p.forEach(m=>{m.canCox=false;m.canSmallBoat=false;});assert.equal(s.build(p).boats.length,0);
  p[0].canCox=true;const beginners=s.build(p);assert.equal(beginners.boats.length,1);assert.equal(beginners.boats[0].seats.length,5);
  p[0].arrival='늦참';assert.equal(s.build(p).boats.length,1);assert.equal(s.build(p).wait.length,27);
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
test('weekly answers support both dates, single date, absence and tentative with comments',()=>{
  const s=server();s.call('trainingOpen',{dates:['2026-10-25']},'valid');
  const apply=(status,dates,comment='전달 내용\n두 번째 줄')=>s.call('trainingWeekJoin',{...entry('김선수'),week:'2026-10-24',status,dates,comment}).trainings;
  let result=apply('참석',['2026-10-24','2026-10-25']);assert.deepEqual(result.map(t=>t.participants[0].status),['참석','참석']);assert.equal(result[1].participants[0].comment,'전달 내용\n두 번째 줄');
  result=apply('참석',['2026-10-24']);assert.deepEqual(result.map(t=>t.participants[0].status),['참석','불참']);
  result=apply('불참',[]);assert.deepEqual(result.map(t=>t.participants[0].status),['불참','불참']);
  result=apply('미정',[],'');assert.deepEqual(result.map(t=>t.participants[0].status),['미정','미정']);assert.equal(result[0].participants[0].comment,'');
  assert.equal(result[0].participants[0].arrival,undefined);assert.equal(result[0].participants[0].preference,undefined);
});
test('weekly validation and edit-key conflicts leave both days unchanged',()=>{
  const s=server(),base={...entry('김선수'),week:'2026-10-24',dates:['2026-10-24'],comment:'처음'};
  assert.throws(()=>s.call('trainingWeekJoin',{...base,dates:['2026-10-25']}),/개설하지 않은/);
  s.call('trainingOpen',{dates:['2026-10-25']},'valid');s.call('trainingWeekJoin',base);
  const before=()=>JSON.stringify(s.call('trainingGet').training)+JSON.stringify(s.call('trainingGet',{date:'2026-10-25'}).training),saved=before();
  for(const patch of [{comment:'x'.repeat(1001)},{status:'참석',dates:[]},{status:'불참',dates:['2026-10-24']},{dates:['2026-10-31']},{week:'2026-10-25'},{editKey:'b'.repeat(32)}]){assert.throws(()=>s.call('trainingWeekJoin',{...base,...patch}));assert.equal(before(),saved);}
  assert.throws(()=>s.call('trainingWeekJoin',{...base,comment:42}),/코멘트/);
});
test('operators can manage boarding qualifications removed from the simplified signup',()=>{
  const s=server();s.call('trainingWeekJoin',{...entry('김선수'),week:'2026-10-24',dates:['2026-10-24'],comment:'<script>표시할 텍스트</script>'});
  let t=s.call('trainingGet').training;const p={id:t.participants[0].id,field:'canCox',value:true,revision:t.revision};
  assert.throws(()=>s.call('trainingQualifications',p),/관리자 인증/);
  t=s.call('trainingQualifications',p,'valid').training;assert.equal(t.participants[0].canCox,true);
  t=s.call('trainingWeekJoin',{...entry('김선수'),canCox:undefined,week:'2026-10-24',dates:['2026-10-24'],comment:'수정'}).trainings[0];assert.equal(t.participants[0].canCox,true);
});
test('signup is name, opened weekend dates/absence/tentative and comment, without removed fields',()=>{
  const source=fs.readFileSync(`${__dirname}/../static/training.js`,'utf8');
  for(const text of ['trainingTenure','자동 계산합니다','참가 시간','희망 보트','data-flag','data-choice'])assert.ok(!source.includes(text),text);
  assert.match(source,/name="comment"/);assert.match(source,/data-participation-date/);assert.match(source,/data-participation-status/);assert.match(source,/esc\(m.comment\)/);
  assert.ok(source.indexOf('이름<input')<source.indexOf('<legend>참가 여부'));assert.ok(source.indexOf('<legend>참가 여부')<source.indexOf('name="comment"'));
});
test('typing or blurring a name preserves date button nodes so the first date click is not lost',()=>{
  const source=fs.readFileSync(`${__dirname}/../static/training.js`,'utf8'),fn=source.match(/function syncChoices\(\)\{[\s\S]*?\n  \}/)[0];let buttons=[];
  const container={set innerHTML(html){buttons=[...html.matchAll(/data-participation-(date|status)="([^"]+)"/g)].map(([,kind,value])=>({dataset:kind==='date'?{participationDate:value}:{participationStatus:value},setAttribute(k,v){this[k]=v;}}));}};
  const hint={},submit={},form={elements:{name:{value:''}},querySelector:()=>submit};
  const context=vm.createContext({form,busy:false,draftStatus:'',draftDates:new Set(),participationKey:null,signupSessions:()=>[{date:'2026-10-24'},{date:'2026-10-25'}],dayLabel:v=>v,esc:v=>v,el:s=>s==='#trainingParticipation'?container:hint,all:s=>buttons.filter(b=>s.includes('date')?b.dataset.participationDate:b.dataset.participationStatus)});
  vm.runInContext(fn,context);context.syncChoices();const first=buttons[0];form.elements.name.value='김선수';context.syncChoices();assert.equal(buttons[0],first);
  context.draftStatus='참석';context.draftDates.add('2026-10-24');context.syncChoices();assert.equal(buttons[0],first);assert.equal(first['aria-pressed'],'true');assert.equal(submit.disabled,false);
});
