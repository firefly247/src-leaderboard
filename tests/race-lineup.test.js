'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),plan=require('../static/race-lineup-plan.js');
const events=[{competition_event_id:'quad',competition_event_name:'4X+'},{competition_event_id:'double',competition_event_name:'2X'},{competition_event_id:'eight',competition_event_name:'8+'},{competition_event_id:'single',competition_event_name:'1X'}];
const divisions=[{competition_division_id:'u160',competition_division_name:'남자 160미만'},{competition_division_id:'range',competition_division_name:'남자 160~200'},{competition_division_id:'open',competition_division_name:'혼성 일반부'},{competition_division_id:'over200',competition_division_name:'남자 200이상'}];
const players=ages=>ages.map((a,i)=>({memberName:`선수${i}`,birthYear:String(2026-a),joinYear:'2023'}));
const group=(id='group-001',eventId='quad',divisionId='u160',teamName='A팀')=>plan.group({id,eventId,divisionId,teamName},events,divisions);
function server(){
  const sheets=new Map();let held=false,sequence=0,profiles=players([40,41,42,43,99,20,21,22,23,80,81]);
  const ss={getSheetByName:n=>sheets.get(n),insertSheet(n){const rows=[];const s={rows,appendRow:r=>rows.push(r),setFrozenRows(){},getLastRow:()=>rows.length,getDataRange:()=>({getDisplayValues:()=>rows.map(r=>r.map(String))}),getRange(row){return {setNumberFormat(){return this;},setValues(values){assert.ok(held);values.forEach((r,i)=>rows[row-1+i]=r);return this;}};}};sheets.set(n,s);return s;}};
  const context=vm.createContext({Date,PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'private'})},SpreadsheetApp:{openById:()=>ss,flush(){assert.ok(held);}},CacheService:{getScriptCache:()=>({get:k=>k==='admin:valid'?'1':null})},LockService:{getScriptLock:()=>({waitLock(){assert.ok(!held);held=true;},releaseLock(){held=false;}})},Utilities:{getUuid:()=>`race-id-${++sequence}`}});
  for(const file of ['Code.gs','RaceLineupPlan.gs','RaceLineup.gs'])vm.runInContext(fs.readFileSync(`${__dirname}/../apps-script/${file}`,'utf8'),context);
  context.playerBirthYears_=()=>profiles;context.competitionEvents_=()=>events;context.competitionDivisions_=()=>divisions;context.competitions_=()=>[{competition_id:'race-one',competition_name:'테스트 대회'}];
  const call=(action,p={},token='')=>JSON.parse(JSON.stringify(context.dispatch_(action,p,token)));
  return {call,sheets,setPlayers:p=>profiles=p};
}
test('browser and Apps Script share identical planner rules; ages use competition year',()=>{
  assert.equal(fs.readFileSync(`${__dirname}/../static/race-lineup-plan.js`,'utf8').replace(/\r\n/g,'\n'),fs.readFileSync(`${__dirname}/../apps-script/RaceLineupPlan.gs`,'utf8').replace(/\r\n/g,'\n'));
  assert.equal(plan.age({birthYear:'1985'},2026),41);assert.equal(plan.age({birthYear:'1985'},2027),42);assert.equal(plan.age({},2026),null);assert.equal(plan.age({birthYear:'2027'},2026),null);
  assert.equal(group().slots.length,7);assert.equal(group('group-002','eight').slots.length,11);assert.equal(group('group-003','single').slots.length,3);
  assert.equal(plan.ageRange('범위 미정'),null);assert.deepEqual(plan.ageRange('남자 160미만'),{min:0,max:159});assert.deepEqual(plan.ageRange('남자 200이상'),{min:200,max:null});
  assert.deepEqual(plan.ageRange('남자 160~200'),{min:160,max:199});
});
test('cox and optional reserves are excluded from rower total, and invalid ages cannot finalize',()=>{
  const p=players([40,41,42,43,99,80,81]),g=group('group-001','quad','range');g.slots.forEach((s,i)=>s.name=i===0?p[4].memberName:i<5?p[i-1].memberName:p[i].memberName);
  assert.equal(plan.status(g,p,2026).sum,166);assert.ok(plan.validate([g],p,2026,true));
  g.slots[5].name='';g.slots[6].name='';assert.ok(plan.validate([g],p,2026,true));
  const bad=JSON.parse(JSON.stringify(g));bad.slots[1].name=p[5].memberName;assert.throws(()=>plan.validate([bad],p,2026,true),/나이/);
  p[0].birthYear='';assert.throws(()=>plan.validate([g],p,2026,true),/생년/);
});
test('adjacent age bands accept 160 but reserve 200 for the 200-and-over category',()=>{
  const g=group('group-001','quad','range'),at160=players([40,40,40,40,90]);g.slots[0].name='선수4';for(let i=1;i<=4;i++)g.slots[i].name='선수'+(i-1);
  assert.ok(plan.validate([g],at160,2026,true));
  assert.throws(()=>plan.validate([g],players([50,50,50,50,90]),2026,true),/나이/);
  assert.throws(()=>plan.validate([g],players([39,40,40,40,90]),2026,true),/나이/);
});
test('recommendation fills only configured groups and excludes every selected reserve from automatic starts',()=>{
  const p=players(Array.from({length:12},(_,i)=>30+i)),a=group(),b=group('group-002','quad','u160','B팀');
  a.slots[0]={...a.slots[0],name:p[0].memberName,locked:true};b.slots[1]={...b.slots[1],name:p[1].memberName,locked:true};a.slots[5].name=p[10].memberName;a.slots[6].name=p[11].memberName;
  const result=plan.recommend([a,b],p,2026,()=>0.4),main=result.flatMap(g=>g.slots.filter(s=>s.kind!=='reserve'));
  assert.equal(result.length,2);assert.equal(main.length,10);assert.equal(new Set(main.map(s=>s.name)).size,10);assert.ok(main.every(s=>![p[10].memberName,p[11].memberName].includes(s.name)));
  assert.equal(result[0].slots[0].name,p[0].memberName);assert.equal(result[1].slots[1].name,p[1].memberName);assert.ok(result.every(g=>plan.status(g,p,2026).valid));
  assert.throws(()=>plan.recommend([],p,2026),/먼저 추가/);
});
test('random assignment respects age bounds and other teams, and failure leaves original untouched',()=>{
  const p=players([20,21,22,23,24,25,26,27,28,29]),a=group(),b=group('group-002','quad','u160','B팀');
  let result=plan.randomGroup([a,b],a.id,p,2026,()=>0.2),first=JSON.stringify(result[0]);result=plan.randomGroup(result,b.id,p,2026,()=>0.7);
  assert.equal(JSON.stringify(result[0]),first);assert.equal(new Set(result.flatMap(g=>g.slots.filter(s=>s.kind!=='reserve').map(s=>s.name))).size,10);
  const impossible=group('group-003','quad','over200'),before=JSON.stringify(impossible);assert.throws(()=>plan.randomGroup([impossible],impossible.id,players([20,20,20,20,20]),2026),/찾지/);
  assert.equal(JSON.stringify(impossible),before);
});
test('manual assignment rejects same-event duplicates and completed out-of-range crews, while different events can reuse athletes',()=>{
  const p=players([50,50,50,50,30,30,30]),a=group(),b=group('group-002','double','open','B팀');let list=[a,b];
  list=plan.setSlot(list,a.id,0,p[0].memberName,p,2026);list=plan.setSlot(list,b.id,0,p[0].memberName,p,2026);
  assert.throws(()=>plan.setSlot(list,a.id,1,p[0].memberName,p,2026),/이미/);
  for(let i=1;i<=3;i++)list=plan.setSlot(list,a.id,i,p[i].memberName,p,2026);
  assert.throws(()=>plan.setSlot(list,a.id,4,p[4].memberName,p,2026),/합계/);
});
test('private participant selection, draft saving and finalization are versioned; public endpoints reveal only final snapshots',()=>{
  const s=server();assert.deepEqual(s.call('raceLineupList'),{races:[]});assert.equal(s.sheets.size,0);
  for(const action of ['raceLineupAdminData','raceLineupCreate','raceLineupGetAdmin','raceLineupParticipants','raceLineupSave','raceLineupFinalize'])assert.throws(()=>s.call(action),/관리자 인증/);
  let r=s.call('raceLineupCreate',{year:2026,competitionId:'race-one'},'valid').race;
  assert.equal(s.call('raceLineupCreate',{year:2026,competitionId:'race-one'},'valid').race.id,r.id);
  const p=players([40,41,42,43,99,20,21,22,23,80,81]);
  r=s.call('raceLineupParticipants',{id:r.id,revision:r.revision,names:p.map(p=>p.memberName)},'valid').race;
  const g=group('group-001','quad','range');g.slots[0].name=p[4].memberName;for(let i=1;i<=4;i++)g.slots[i].name=p[i-1].memberName;
  r=s.call('raceLineupSave',{id:r.id,revision:r.revision,groups:[g]},'valid').race;
  const pub=s.call('raceLineupGet',{id:r.id}).race;assert.equal(pub.finalized,null);assert.equal(pub.groups,undefined);assert.equal(pub.participants,undefined);assert.ok(!JSON.stringify(pub).includes('birthYear'));
  assert.throws(()=>s.call('raceLineupFinalize',{id:r.id,revision:0,groups:[g]},'valid'),/다른 운영진/);
  r=s.call('raceLineupFinalize',{id:r.id,revision:r.revision,groups:[g]},'valid').race;
  const snapshot=s.call('raceLineupGet',{id:r.id}).race.finalized;assert.equal(snapshot.groups[0].slots[0].age,99);assert.equal(snapshot.groups[0].slots[1].age,40);assert.ok(!JSON.stringify(snapshot).includes('birthYear'));
  g.slots[1].name='';r=s.call('raceLineupSave',{id:r.id,revision:r.revision,groups:[g]},'valid').race;
  assert.deepEqual(s.call('raceLineupGet',{id:r.id}).race.finalized,snapshot);assert.throws(()=>s.call('raceLineupFinalize',{id:r.id,revision:r.revision,groups:[g]},'valid'),/슬롯/);
});
test('server rejects forged seats/ranges, unconfirmed athletes and changed birth years before finalization',()=>{
  const s=server();let r=s.call('raceLineupCreate',{year:2026,name:'새 대회'},'valid').race;
  assert.throws(()=>s.call('raceLineupSave',{id:r.id,revision:r.revision,groups:[]},'valid'),/참가자/);
  assert.throws(()=>s.call('raceLineupParticipants',{id:r.id,revision:r.revision,names:['미등록']},'valid'),/활동 선수/);
  r=s.call('raceLineupParticipants',{id:r.id,revision:r.revision,names:['선수0','선수1','선수2','선수3','선수4']},'valid').race;
  const g=group('group-001','quad','u160');g.min=0;g.max=999;g.slots[0].name='선수4';for(let i=1;i<=4;i++)g.slots[i].name='선수'+(i-1);
  assert.throws(()=>s.call('raceLineupFinalize',{id:r.id,revision:r.revision,groups:[g]},'valid'),/나이/);
  const valid=group('group-002','quad','range');valid.slots=g.slots;
  s.setPlayers(players([10,10,10,10,99]));assert.throws(()=>s.call('raceLineupFinalize',{id:r.id,revision:r.revision,groups:[valid]},'valid'),/나이/);
});
