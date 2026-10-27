'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function server(open=true){
  const sheets=new Map();let held=false,id=0;
  const spreadsheet={getSheetByName:n=>sheets.get(n),insertSheet(n){const rows=[];const sheet={rows,appendRow:r=>rows.push(r),setFrozenRows(){},getLastRow:()=>rows.length,getDataRange:()=>({getDisplayValues:()=>rows.map(r=>r.map(String))}),getRange(row,col){return {setNumberFormat(){return this;},setValues(values){assert.ok(held);values.forEach((r,i)=>{rows[row-1+i]||=[];r.forEach((v,j)=>rows[row-1+i][col-1+j]=v);});return this;}};}};sheets.set(n,sheet);return sheet;}};
  const context=vm.createContext({Date,Set,PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'private-sheet'})},SpreadsheetApp:{openById:()=>spreadsheet,flush(){assert.ok(held);}},LockService:{getScriptLock:()=>({waitLock(){held=true;},releaseLock(){held=false;}})},CacheService:{getScriptCache:()=>({get:k=>k==='admin:valid'?'1':null})},Utilities:{getUuid:()=>`id-${++id}`,base64Encode:v=>Buffer.from(v).toString('base64'),computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),DigestAlgorithm:{SHA_256:'sha'},Charset:{UTF_8:'utf8'}}});
  for(const file of ['Code.gs','Training.gs'])vm.runInContext(fs.readFileSync(`${__dirname}/../apps-script/${file}`,'utf8'),context);
  context.playerBirthYears_=()=>{const sheet=sheets.get('PLAYER_BIRTH_YEARS');return sheet?sheet.rows.slice(1).map(row=>({memberName:row[0],birthYear:row[1],joinYear:row[3]})):[];};
  const call=(a,p={},token='')=>JSON.parse(JSON.stringify(context.dispatch_(a,{date:'2026-10-24',...p},token)));
  if(open)call('trainingOpen',{dates:['2026-10-24']},'valid');
  return {call,build:p=>JSON.parse(JSON.stringify(context.trainingBuildPlan_(p))),sheets,setYears(rows){const sheet=spreadsheet.getSheetByName('PLAYER_BIRTH_YEARS')||spreadsheet.insertSheet('PLAYER_BIRTH_YEARS');sheet.rows.splice(0,sheet.rows.length,['name','birth','updated','join'],...rows.map(([name,year])=>[name,'1985','',year]));}};
}
const entry=(name,extra={})=>({name,editKey:'a'.repeat(32),status:'참석',arrival:'정시',preference:'무관',experience:'초급',canCox:false,canSmallBoat:false,...extra});
test('whole draft saves validate shape and identity, stay private and publish atomically',()=>{
  const s=server();['가','나','다'].forEach(name=>s.call('trainingJoin',entry(name)));
  const draft={boats:[{name:'더블스컬 A',type:'2X',seats:[{seat:'1번',id:'id-1',name:'위조 이름',changed:true},{seat:'2번',id:'',name:''}]}]};
  assert.throws(()=>s.call('trainingDraftSave',{draft,revision:4}),/관리자 인증/);
  let t=s.call('trainingDraftSave',{draft,revision:4},'valid').training;
  assert.equal(t.draft.boats[0].seats[0].name,'가');assert.ok(t.draft.boats[0].seats[0].changed);assert.equal(t.plan,null);
  assert.equal(s.call('trainingRoster').trainings[0].draft,undefined);
  assert.throws(()=>s.call('trainingPublish',{draft,revision:t.revision},'valid'),/모든 좌석/);
  const invalid=JSON.parse(JSON.stringify(draft));invalid.boats[0].seats[1]={seat:'2번',id:'id-1'};
  assert.throws(()=>s.call('trainingDraftSave',{draft:invalid,revision:t.revision},'valid'),/중복/);
  invalid.boats.push({...invalid.boats[0],name:'더블스컬 C'});
  assert.throws(()=>s.call('trainingDraftSave',{draft:invalid,revision:t.revision},'valid'),/중복|배 종류/);
  assert.throws(()=>s.call('trainingDraftSave',{draft,revision:0},'valid'),/다른 사용자/);
  draft.boats[0].seats[1]={seat:'2번',id:'id-2',name:'위조',locked:true};
  t=s.call('trainingPublish',{draft,revision:t.revision},'valid').training;
  assert.equal(t.plan.boats[0].seats[1].name,'나');assert.ok(t.plan.boats[0].seats[1].locked);assert.equal(t.draft,null);assert.equal(t.plan.wait[0].id,'id-3');
});
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
  let {training:t}=s.call('trainingRecommend',{revision:2},'valid');assert.equal(t.draft.boats[0].type,'1X');assert.equal(t.plan,null);
  t=s.call('trainingPublish',{revision:t.revision},'valid').training;const boats=JSON.stringify(t.plan.boats);
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
test('draft edits, swaps, locks and reassignment stay private until explicit publication',()=>{
  const s=server();['가','나','다','라','마','바'].forEach((name,i)=>s.call('trainingJoin',entry(name,{canCox:i===0,canSmallBoat:true})));
  let t=s.call('trainingRecommend',{revision:7},'valid').training;
  const edit=p=>{t=s.call('trainingDraftEdit',{revision:t.revision,...p},'valid').training;};
  assert.equal(t.plan,null);assert.equal(t.draft.boats.length,2);
  for(const action of ['trainingDraftGet','trainingDraftEdit','trainingPublish'])assert.throws(()=>s.call(action),/관리자 인증/);
  assert.equal(s.call('trainingGet').training.draft,undefined);assert.equal(s.call('trainingRoster').trainings[0].draft,undefined);
  const single=t.draft.boats.find(b=>b.type==='1X'),quad=t.draft.boats.find(b=>b.type==='4X+'),a=single.seats[0],b=quad.seats[1];
  edit({operation:'replace',boat:single.name,seat:a.seat,id:b.id});
  assert.equal(t.draft.boats.find(v=>v.type==='1X').seats[0].id,b.id);
  assert.equal(t.draft.boats.find(v=>v.type==='4X+').seats[1].id,a.id);
  assert.ok(t.draft.boats.find(v=>v.type==='1X').seats[0].changed);
  edit({operation:'lock',boat:single.name,seat:a.seat});
  assert.throws(()=>s.call('trainingDraftEdit',{operation:'replace',boat:single.name,seat:a.seat,id:a.id,revision:t.revision},'valid'),/고정/);
  t=s.call('trainingRecommend',{revision:t.revision},'valid').training;
  assert.equal(t.draft.boats.find(v=>v.type==='1X').seats[0].id,b.id);assert.ok(t.draft.boats.find(v=>v.type==='1X').seats[0].locked);
  assert.equal(s.call('trainingGet').training.plan,null);
  t=s.call('trainingPublish',{revision:t.revision},'valid').training;
  const published=JSON.stringify(s.call('trainingGet').training.plan);assert.ok(t.plan.boats.length);assert.equal(t.draft,null);
  edit({operation:'start'});edit({operation:'lock',boat:single.name,seat:a.seat});edit({operation:'replace',boat:single.name,seat:a.seat,id:a.id});
  assert.equal(JSON.stringify(s.call('trainingGet').training.plan),published);
  t=s.call('trainingPublish',{revision:t.revision},'valid').training;
  assert.equal(t.plan.boats.find(v=>v.type==='1X').seats[0].id,a.id);
});
test('manual drafts support unqualified applicants, fleet limits, stale changes and incomplete seats',()=>{
  const s=server();s.call('trainingJoin',entry('가'));s.call('trainingJoin',entry('나'));
  let t=s.call('trainingRecommend',{revision:3},'valid').training;
  const edit=p=>{t=s.call('trainingDraftEdit',{revision:t.revision,...p},'valid').training;};
  assert.equal(t.draft.boats.length,0);edit({operation:'addBoat',type:'1X'});
  assert.throws(()=>s.call('trainingPublish',{revision:t.revision},'valid'),/모든 좌석/);
  assert.throws(()=>s.call('trainingDraftEdit',{operation:'addBoat',type:'1X',revision:t.revision},'valid'),/보유한/);
  edit({operation:'replace',boat:'싱글스컬',seat:'1번',id:'id-1'});edit({operation:'lock',boat:'싱글스컬',seat:'1번'});
  assert.throws(()=>s.call('trainingDraftEdit',{operation:'removeBoat',boat:'싱글스컬',revision:t.revision},'valid'),/고정/);
  assert.throws(()=>s.call('trainingDraftEdit',{operation:'lock',boat:'싱글스컬',seat:'1번',revision:0},'valid'),/다른 사용자가/);
  s.call('trainingJoin',entry('가',{status:'불참'}));t=s.call('trainingDraftGet',{},'valid').training;
  assert.throws(()=>s.call('trainingRecommend',{revision:t.revision},'valid'),/참가 여부/);
  assert.throws(()=>s.call('trainingPublish',{revision:t.revision},'valid'),/참가 여부/);
});
test('registration changes preserve published plan and flag a stale snapshot; dates are isolated',()=>{
  const s=server();s.call('trainingJoin',entry('김선수',{canSmallBoat:true}));let t=s.call('trainingRecommend',{revision:2},'valid').training;t=s.call('trainingPublish',{revision:t.revision},'valid').training;const plan=JSON.stringify(t.plan);
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
  assert.match(source,/data-open-date/);assert.match(source,/api\('trainingRoster'\)/);assert.match(source,/data-check=/);assert.match(source,/aria-pressed/);
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
  const context=vm.createContext({canVote:()=>true,form,busy:false,draftStatus:'',draftDates:new Set(),participationKey:null,signupSessions:()=>[{date:'2026-10-24'},{date:'2026-10-25'}],dayLabel:v=>v,esc:v=>v,el:s=>s==='#trainingParticipation'?container:hint,all:s=>buttons.filter(b=>s.includes('date')?b.dataset.participationDate:b.dataset.participationStatus)});
  vm.runInContext(fn,context);context.syncChoices();const first=buttons[0];form.elements.name.value='김선수';context.syncChoices();assert.equal(buttons[0],first);
  context.draftStatus='참석';context.draftDates.add('2026-10-24');context.syncChoices();assert.equal(buttons[0],first);assert.equal(first['aria-pressed'],'true');assert.equal(submit.disabled,false);
  context.draftDates.add('2026-10-25');context.syncChoices();assert.equal(buttons[1]['aria-pressed'],'true');assert.equal(buttons[0].disabled,false);assert.equal(buttons[1].disabled,false);
  for(const status of ['불참','미정']){context.draftStatus=status;context.draftDates.clear();context.syncChoices();assert.ok(buttons.filter(b=>b.dataset.participationDate).every(b=>b.disabled));for(const b of buttons.filter(b=>b.dataset.participationStatus))assert.equal(b.disabled,b.dataset.participationStatus!==status);}
  context.draftStatus='';context.syncChoices();assert.ok(buttons.every(b=>!b.disabled));assert.equal(submit.disabled,true);
  context.canVote=()=>false;context.draftStatus='참석';context.syncChoices();assert.ok(buttons.every(b=>b.disabled));assert.equal(submit.disabled,true);
});

test('Training vote requires a signed-in linked member even if submission is triggered directly',async()=>{
  const source=fs.readFileSync(`${__dirname}/../static/training.js`,'utf8');
  const gate=source.match(/function canVote\(\)\{[^\n]+/)[0],mutation=source.match(/async function mutate\(action,payload=\{\},admin=false\)\{[\s\S]*?\n  \}/)[0];
  const calls=[],messages=[],context=vm.createContext({window:{ClubMembership:{member:null}},busy:false,sequence:0,rosterData:[],data:{opened:true,revision:1},selectedDate:'2026-10-24',signupSessions:()=>[{date:'2026-10-24'}],render(){},message:t=>messages.push(t),api:async(action)=>{calls.push(action);return {trainings:[]};},alert(){}});
  vm.runInContext(gate+'\n'+mutation,context);
  await context.mutate('trainingWeekJoin',{});assert.equal(calls.length,0);assert.match(messages.at(-1),/로그인/);
  context.window.ClubMembership.member={requestedPlayerName:'김선수'};await context.mutate('trainingWeekJoin',{});assert.equal(calls.length,0);
  context.window.ClubMembership.member={playerName:'김선수'};await context.mutate('trainingWeekJoin',{});assert.deepEqual(calls,['trainingWeekJoin']);
  context.window.ClubMembership.member=null;await context.mutate('trainingWeekJoin',{});assert.equal(calls.length,1);
});
test('signup completion opens one popup after success and none after a failed save',async()=>{
  const source=fs.readFileSync(`${__dirname}/../static/training.js`,'utf8'),fn=source.match(/async function mutate\(action,payload=\{\},admin=false\)\{[\s\S]*?\n  \}/)[0],popups=[],messages=[];
  const context=vm.createContext({canVote:()=>true,busy:false,sequence:0,rosterData:[],data:{opened:true,revision:1},selectedDate:'2026-10-24',signupSessions:()=>[{date:'2026-10-24'}],render(){},message:t=>messages.push(t),api:async()=>({trainings:[{date:'2026-10-24',revision:2}]}),alert:t=>popups.push(t)});
  vm.runInContext(fn,context);await context.mutate('trainingWeekJoin',{});assert.deepEqual(popups,['참가 신청이 완료되었습니다.']);assert.equal(context.busy,false);assert.equal(messages.at(-1),'');
  context.api=async()=>{throw new Error('저장 실패');};await context.mutate('trainingWeekJoin',{});assert.equal(popups.length,1);assert.equal(messages.at(-1),'저장 실패');assert.equal(context.busy,false);
});
test('signup labels omit the removed title, disclosures, save wording and training date suffix',()=>{
  const source=fs.readFileSync(`${__dirname}/../static/training.js`,'utf8');
  for(const text of ['나의 참가 신청','신청 이름','참가 신청 저장','${esc(dayLabel(s.date))} 훈련'])assert.ok(!source.includes(text),text);
  assert.match(source,/type="submit" class="primary-button">참가 신청<\/button>/);
});
test('participation roster follows player-info year columns, alphabetized names, counts and status colors',()=>{
  const source=fs.readFileSync(`${__dirname}/../static/training.js`,'utf8'),fn=source.match(/function trainingRosterHtml\(members,trainingDate,presetColumns=\[\]\)\{[\s\S]*?\n  \}/)[0];
  const context=vm.createContext({esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});vm.runInContext(fn,context);
  const members=[{id:'a',name:'박선수',tenure:7,status:'미정',comment:'확인 중'},{id:'b',name:'김선수',tenure:7,status:'참석'},{id:'c',name:'이선수',tenure:1,status:'불참'},{id:'d',name:'<미등록>',tenure:null,status:'미정',comment:'<script>내용</script>'}];
  const html=context.trainingRosterHtml(members,'2026-10-24');
  assert.match(html,/player-join-table training-roster-table/);assert.ok(html.indexOf('2020년')<html.indexOf('2026년'));assert.ok(html.indexOf('2026년')<html.indexOf('미입력'));
  assert.match(html,/2020년<small>2명/);assert.match(html,/2026년/);assert.match(html,/총 4명/);assert.ok(html.indexOf('김선수')<html.indexOf('박선수'));
  assert.match(html,/class="training-status-attending" aria-label="김선수, 참석"/);assert.match(html,/class="training-status-absent" aria-label="이선수, 불참"/);assert.match(html,/class="training-status-tentative" aria-label="박선수, 미정"/);
  assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;내용/);assert.ok(!html.includes('data-qualification='));
  assert.doesNotMatch(html,/탑승 조건|data-qualification|<details/);
  assert.match(context.trainingRosterHtml([{name:'사년차',tenure:4,status:'참석'}],'2026-10-24'),/2023년/);
  assert.match(context.trainingRosterHtml([{name:'사년차',tenure:4,status:'참석'}],'2027-10-24'),/2024년/);
  assert.match(context.trainingRosterHtml([],'2026-10-24'),/아직 참가 신청이 없습니다/);
  const css=fs.readFileSync(`${__dirname}/../static/training.css`,'utf8');for(const [status,color] of [['attending','#000'],['absent','#dc2626'],['tentative','#6b7280']])assert.ok(css.includes(`.training-status-${status} { color:${color}; }`));
});
test('public roster snapshot includes preset player-info columns and only opened sanitized sessions',()=>{
  const s=server();s.setYears([['김선수','2023'],['등록만된회원','2020'],['다른연차','2024'],['미입력','']]);
  s.call('trainingJoin',entry('김선수'));const result=s.call('trainingRoster');assert.deepEqual(result.rosterColumns,[2020,2023,2024,null]);assert.equal(result.trainings.length,1);assert.equal(result.trainings[0].date,'2026-10-24');
  assert.ok(!JSON.stringify(result).includes('1985'));assert.ok(!JSON.stringify(result).includes('editHash'));assert.ok(!JSON.stringify(result).includes('등록만된회원'));assert.ok(!JSON.stringify(result).includes('aaaa'));
});
test('roster stacks date tables and one deduplicated absence table with identical preset columns',()=>{
  const source=fs.readFileSync(`${__dirname}/../static/training.js`,'utf8'),context=vm.createContext({esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),dayLabel:d=>d==='2026-10-24'?'10/24(토)':'10/25(일)'});
  for(const name of ['trainingRosterHtml','trainingRosterWeek','trainingRosterPeople','trainingRosterSectionsHtml'])vm.runInContext(source.match(new RegExp('function '+name+'\\([^\\n]*\\)\\{[\\s\\S]*?\\n  \\}'))[0],context);
  const person=(name,status,tenure=4)=>({name,status,tenure});const trainings=[{date:'2026-10-24',opened:true,participants:[person('토참석','참석'),person('양일참석','참석',7),person('불참회원','불참'),person('미정회원','미정')]},{date:'2026-10-25',opened:true,participants:[person('토참석','불참'),person('양일참석','참석',7),person('불참회원','불참'),person('미정회원','미정')]}];
  const html=context.trainingRosterSectionsHtml(trainings,[2020,2023,2024,null],false,false);
  assert.ok(html.indexOf('<h3>10/24(토)</h3>')<html.indexOf('<h3>10/25(일)</h3>'));assert.ok(html.indexOf('<h3>10/25(일)</h3>')<html.indexOf('<h3>불참/미정</h3>'));
  assert.equal((html.match(/training-roster-table/g)||[]).length,3);assert.equal((html.match(/>토참석<\/span>/g)||[]).length,1);assert.equal((html.match(/>양일참석<\/span>/g)||[]).length,2);assert.equal((html.match(/>불참회원<\/span>/g)||[]).length,1);
  assert.equal((html.match(/2024년<small>0명/g)||[]).length,3);assert.doesNotMatch(html,/년차|<strong|--training-roster-columns/);
  assert.ok(!html.includes('data-recommend-date'));const admin=context.trainingRosterSectionsHtml(trainings,[2020,2023],true,false);assert.match(admin,/data-recommend-date="2026-10-24"/);assert.match(admin,/data-recommend-date="2026-10-25"/);
  assert.equal(context.trainingRosterWeek([...trainings,{date:'2026-10-31',opened:true,participants:[]}],'2026-10-25').length,2);
});
test('Published crew uses compact seat rows and cycles attendance without changing assignments',()=>{
 const source=fs.readFileSync(`${__dirname}/../static/training.js`,'utf8'),context=vm.createContext({esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
 for(const name of ['nextTrainingCheck','trainingCrewHtml'])vm.runInContext(source.match(new RegExp('function '+name+'\\([^\\n]*\\)\\{[\\s\\S]*?'+(name==='nextTrainingCheck'?'\\}':'\\n  \\}')))[0],context);
 const plan={boats:[{name:'유타쿼드 A',seats:['COX','1번','2번','3번','4번'].map((seat,i)=>({id:'p'+i,name:i===0?'<회원>':'회원'+i,seat}))}],checks:{}};
 const boats=JSON.stringify(plan.boats);let status;
 for(const expected of ['출석','불참','미확인','출석']){status=context.nextTrainingCheck(status);assert.equal(status,expected);plan.checks.p0=status;const html=context.trainingCrewHtml(plan,true);assert.match(html,/--seat-count:5/);assert.equal((html.match(/data-check=/g)||[]).length,5);assert.match(html,/&lt;회원>/);if(status==='출석')assert.match(html,/is-present/);if(status==='불참')assert.match(html,/is-absent/);}
 assert.equal(JSON.stringify(plan.boats),boats);assert.doesNotMatch(context.trainingCrewHtml(plan,false),/<button|data-check=/);assert.match(context.trainingCrewHtml(plan,true,true),/disabled/);
});
test('Attendance cycles only in memory, independently by date and without any API call',()=>{
 const source=fs.readFileSync(`${__dirname}/../static/training.js`,'utf8');let renders=0;
 const context=vm.createContext({state:{adminUserId:'admin'},data:{plan:{boats:[{seats:[{id:'one'}]}]}},selectedDate:'2026-10-31',localAttendance:new Map(),render:()=>renders++,api:()=>{throw new Error('Attendance must never call the server');}});
 for(const name of ['nextTrainingCheck','cycleLocalAttendance'])vm.runInContext(source.match(new RegExp('function '+name+'\\([^\\n]*\\)\\{[\\s\\S]*?'+(name==='nextTrainingCheck'?'\\}':'\\n  \\}')))[0],context);
 for(const expected of ['출석','불참','미확인']){context.cycleLocalAttendance('one');assert.equal(context.localAttendance.get('2026-10-31').one,expected);}
 context.selectedDate='2026-11-01';context.cycleLocalAttendance('one');assert.equal(context.localAttendance.get('2026-11-01').one,'출석');assert.equal(context.localAttendance.get('2026-10-31').one,'미확인');
 context.cycleLocalAttendance('unknown');context.state.adminUserId='';context.cycleLocalAttendance('one');assert.equal(renders,4);assert.equal(context.localAttendance.get('2026-11-01').one,'출석');
 assert.doesNotMatch(source,/mutate\('trainingCheck'/);assert.match(source,/checks:localAttendance\.get\(selectedDate\)\|\|\{\}/);
});
