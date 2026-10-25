/** Weekend training is stored only in the private spreadsheet. */
function trainingDate_(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('훈련 날짜를 선택해 주세요.');
  const parsed = new Date(date + 'T00:00:00Z');
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date || ![0,6].includes(parsed.getUTCDay())) throw new Error('토요일 또는 일요일을 선택해 주세요.');
  return date;
}
function trainingSheet_() {
  const ss = SpreadsheetApp.openById(prop_('REQUEST_SHEET_ID'));
  let sheet = ss.getSheetByName('WEEKEND_TRAINING');
  if (!sheet) { sheet = ss.insertSheet('WEEKEND_TRAINING'); sheet.appendRow(['date','session_json']); sheet.setFrozenRows(1); }
  return sheet;
}
function trainingRead_(sheet,date) {
  const rows = sheet.getDataRange().getDisplayValues();
  for (let i=1;i<rows.length;i++) if(rows[i][0]===date) return {row:i+1, session:JSON.parse(rows[i][1])};
  return {row:sheet.getLastRow()+1, session:{date,opened:false,revision:0,registrationRevision:0,participants:[],plan:null}};
}
function trainingWrite_(sheet,entry) {
  const json=JSON.stringify(entry.session);
  if(json.length>45000)throw new Error('훈련 저장 용량을 초과했습니다. 운영진에게 문의해 주세요.');
  sheet.getRange(entry.row,1,1,2).setNumberFormat('@').setValues([[entry.session.date,json]]);
  SpreadsheetApp.flush();
}
function trainingPublic_(s) {
  return {training:{date:s.date,opened:s.opened===true,revision:s.revision,registrationRevision:s.registrationRevision,
    participants:s.opened?trainingTenures_(s.participants,s.date).map(p=>({id:p.id,name:p.name,status:p.status,comment:p.comment||'',canCox:p.canCox,canSmallBoat:p.canSmallBoat,tenure:p.tenure})):[],plan:s.opened?s.plan:null}};
}
/** Derive seniority from the private joining-year column; never return birth/joining years. */
function trainingTenures_(participants,date) {
  const sheet=birthYearSheet_(false),rows=sheet?sheet.getDataRange().getDisplayValues().slice(1):[];
  const years=new Map(rows.map(row=>[String(row[0]).trim(),String(row[3]||'').trim()]));
  const trainingYear=Number(date.slice(0,4));
  return participants.map(p=>{const year=years.get(p.name);return {...p,tenure:year&&/^\d{4}$/.test(year)&&Number(year)>=1900&&Number(year)<=trainingYear?trainingYear-Number(year)+1:null};});
}
function trainingListFromSheet_(sheet) {
  return {sessions:sheet.getDataRange().getDisplayValues().slice(1).filter(row=>row[1]).map(row=>JSON.parse(row[1])).filter(s=>s.opened===true).map(s=>({date:s.date,openedAt:s.openedAt})).sort((a,b)=>a.date.localeCompare(b.date)).slice(-40)};
}
function trainingList_() {
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{return trainingListFromSheet_(trainingSheet_());}finally{lock.releaseLock();}
}
/** Reuse the player-info column catalog without publishing the private player profiles. */
function trainingRoster_() {
  const players=playerBirthYears_(),columns=[...new Set(players.map(p=>/^\d{4}$/.test(String(p.joinYear||''))?Number(p.joinYear):null))].sort((a,b)=>a===null?1:b===null?-1:a-b);
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    const sheet=trainingSheet_(),catalog=trainingListFromSheet_(sheet),dates=new Set(catalog.sessions.map(s=>s.date));
    const trainings=sheet.getDataRange().getDisplayValues().slice(1).filter(row=>dates.has(row[0])).map(row=>trainingPublic_(JSON.parse(row[1])).training).sort((a,b)=>a.date.localeCompare(b.date));
    return {...catalog,rosterColumns:columns,trainings};
  }finally{lock.releaseLock();}
}
function trainingOpen_(p) {
  if(!Array.isArray(p.dates)||p.dates.length<1||p.dates.length>2)throw new Error('개설할 토·일 날짜를 선택해 주세요.');
  const dates=[...new Set(p.dates.map(trainingDate_))].sort();
  if(dates.length===2&&new Date(dates[1]+'T00:00:00Z')-new Date(dates[0]+'T00:00:00Z')!==86400000)throw new Error('같은 주의 토·일을 선택해 주세요.');
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    const sheet=trainingSheet_();
    dates.forEach(date=>{const entry=trainingRead_(sheet,date);if(entry.session.opened)return;entry.session.opened=true;entry.session.openedAt=new Date().toISOString();entry.session.revision++;trainingWrite_(sheet,entry);});
    return trainingListFromSheet_(sheet);
  }finally{lock.releaseLock();}
}
function trainingRequireOpen_(s) {if(s.opened!==true)throw new Error('운영진이 아직 개설하지 않은 훈련입니다.');}
function trainingLocked_(p,fn) {
  const date=trainingDate_(p.date), lock=LockService.getScriptLock();lock.waitLock(30000);
  try { const sheet=trainingSheet_(),entry=trainingRead_(sheet,date);const result=fn(entry.session);if(result!==false)trainingWrite_(sheet,entry);return trainingPublic_(entry.session); }
  finally {lock.releaseLock();}
}
function trainingGet_(p) {return trainingLocked_(p,()=>false);}
function trainingJoinInput_(p) {
  const name=String(p.name||'').trim(),key=String(p.editKey||'');
  if(!name||name.length>30||/[\x00-\x1f<>]/.test(name))throw new Error('이름을 30자 이내로 입력해 주세요.');
  if(!/^[a-zA-Z0-9-]{32,80}$/.test(key))throw new Error('신청 수정키가 올바르지 않습니다. 다시 신청해 주세요.');
  if(!['참석','불참','미정'].includes(p.status))throw new Error('참가 신청 항목을 확인해 주세요.');
  if(p.comment!=null&&(typeof p.comment!=='string'||p.comment.length>1000))throw new Error('코멘트는 1000자 이내로 입력해 주세요.');
  const digest=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,key,Utilities.Charset.UTF_8));
  return {name,digest,comment:p.comment||''};
}
function trainingApplyJoin_(s,p,input) {
    trainingRequireOpen_(s);
    let member=s.participants.find(m=>m.name===input.name);
    if(member&&member.editHash!==input.digest)throw new Error('이미 신청된 이름입니다. 처음 신청한 브라우저에서 수정하거나 운영진에게 문의해 주세요.');
    if(!member){if(s.participants.length>=60)throw new Error('신청 인원이 최대 60명입니다.');member={id:Utilities.getUuid(),name:input.name,editHash:input.digest};s.participants.push(member);}
    Object.assign(member,{status:p.status,comment:input.comment,canCox:p.canCox==null?member.canCox===true:p.canCox===true,canSmallBoat:p.canSmallBoat==null?member.canSmallBoat===true:p.canSmallBoat===true});
    delete member.experience;delete member.arrival;delete member.preference;
    s.revision++;s.registrationRevision++;
}
function trainingJoin_(p) {
  const input=trainingJoinInput_(p);
  return trainingLocked_(p,s=>trainingApplyJoin_(s,p,input));
}
/** Save both weekend answers under one lock; validate every record before writing. */
function trainingWeekJoin_(p) {
  const input=trainingJoinInput_(p),saturday=trainingDate_(p.week);
  if(new Date(saturday+'T00:00:00Z').getUTCDay()!==6)throw new Error('훈련 주를 확인해 주세요.');
  const sunday=new Date(new Date(saturday+'T00:00:00Z').getTime()+86400000).toISOString().slice(0,10);
  if(!Array.isArray(p.dates)||p.dates.length>2)throw new Error('참가할 훈련을 선택해 주세요.');
  const dates=[...new Set(p.dates)];
  if(dates.some(d=>d!==saturday&&d!==sunday)||p.status==='참석'&&!dates.length||p.status!=='참석'&&dates.length)throw new Error('참가 여부를 다시 선택해 주세요.');
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    const sheet=trainingSheet_(),entries=[saturday,sunday].map(d=>trainingRead_(sheet,d)).filter(e=>e.session.opened===true);
    if(!entries.length||dates.some(d=>!entries.some(e=>e.session.date===d)))throw new Error('운영진이 아직 개설하지 않은 훈련입니다.');
    entries.forEach(e=>trainingApplyJoin_(e.session,{status:p.status==='참석'?(dates.includes(e.session.date)?'참석':'불참'):p.status},input));
    if(entries.some(e=>JSON.stringify(e.session).length>45000))throw new Error('훈련 저장 용량을 초과했습니다. 운영진에게 문의해 주세요.');
    entries.forEach(e=>trainingWrite_(sheet,e));
    return {trainings:entries.map(e=>trainingPublic_(e.session).training)};
  }finally{lock.releaseLock();}
}
function trainingExpected_(s,p) {if(Number(p.revision)!==s.revision)throw new Error('다른 사용자가 변경했습니다. 새로고침 후 다시 시도해 주세요.');}
/** Enumerate this club's fleet; require a cox for every quad and small-boat eligibility. */
function trainingBuildPlan_(participants) {
  const people=participants.filter(p=>p.status==='참석');
  const coxes=people.filter(p=>p.canCox).sort((a,b)=>Number(a.canSmallBoat)-Number(b.canSmallBoat)||a.name.localeCompare(b.name,'ko'));
  let best=null;
  for(let q=0;q<=Math.min(4,coxes.length);q++)for(let d=0;d<=2;d++)for(let single=0;single<=1;single++){
    const seated=q*5+d*2+single;if(seated>people.length)continue;
    const usedCox=coxes.slice(0,q),usedIds=new Set(usedCox.map(p=>p.id));
    const small=people.filter(p=>!usedIds.has(p.id)&&p.canSmallBoat);
    if(small.length<d*2+single)continue;
    const boats=usedCox.map((p,i)=>({name:'유타쿼드 '+String.fromCharCode(65+i),type:'4X+',seats:[{seat:'COX',id:p.id,name:p.name}]}));
    const takeSmall=()=>{small.sort((a,b)=>a.name.localeCompare(b.name,'ko'));const p=small.shift();usedIds.add(p.id);return p;};
    if(single){const p=takeSmall('싱글스컬');boats.push({name:'싱글스컬',type:'1X',seats:[{seat:'1번',id:p.id,name:p.name}]});}
    for(let i=0;i<d;i++){const seats=[];for(let j=0;j<2;j++){const p=takeSmall('더블스컬');seats.push({seat:(j+1)+'번',id:p.id,name:p.name});}boats.push({name:'더블스컬 '+String.fromCharCode(65+i),type:'2X',seats});}
    const remaining=people.filter(p=>!usedIds.has(p.id)).sort((a,b)=>(b.tenure||0)-(a.tenure||0)||a.name.localeCompare(b.name,'ko'));
    for(let seat=1;seat<=4;seat++)for(let i=0;i<q;i++){const p=remaining.shift();boats[i].seats.push({seat:seat+'번',id:p.id,name:p.name});usedIds.add(p.id);}
    const score=seated*1000+q;
    if(!best||score>best.score)best={score,boats,wait:participants.filter(p=>p.status==='참석'&&!usedIds.has(p.id)).map(p=>({id:p.id,name:p.name,reason:'좌석 또는 탑승 가능 조건 확인 필요'}))};
  }
  return {boats:best.boats,wait:best.wait};
}
function trainingRecommend_(p) {
  return trainingLocked_(p,s=>{
    trainingRequireOpen_(s);
    trainingExpected_(s,p);
    const built=trainingBuildPlan_(trainingTenures_(s.participants,s.date)),oldChecks=s.plan?s.plan.checks:{};
    const checks={};built.boats.forEach(b=>b.seats.forEach(m=>{checks[m.id]=oldChecks[m.id]||'미확인';}));
    s.plan={boats:built.boats,wait:built.wait,checks,registrationRevision:s.registrationRevision,publishedAt:new Date().toISOString()};s.revision++;
  });
}
function trainingCheck_(p) {
  if(!['미확인','출석','불참'].includes(p.status))throw new Error('출석 상태를 확인해 주세요.');
  return trainingLocked_(p,s=>{
    trainingRequireOpen_(s);
    trainingExpected_(s,p);
    if(!s.plan||!s.plan.boats.some(b=>b.seats.some(m=>m.id===p.id)))throw new Error('편성된 멤버를 찾을 수 없습니다.');
    s.plan.checks[p.id]=p.status;s.revision++;
  });
}
function trainingQualifications_(p) {
  if(!['canCox','canSmallBoat'].includes(p.field)||typeof p.value!=='boolean')throw new Error('탑승 조건을 확인해 주세요.');
  return trainingLocked_(p,s=>{trainingRequireOpen_(s);trainingExpected_(s,p);const member=s.participants.find(m=>m.id===p.id);if(!member)throw new Error('참가자를 찾을 수 없습니다.');member[p.field]=p.value;s.revision++;s.registrationRevision++;});
}
