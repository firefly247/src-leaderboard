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
  return {row:sheet.getLastRow()+1, session:{date,revision:0,registrationRevision:0,participants:[],plan:null}};
}
function trainingWrite_(sheet,entry) {
  const json=JSON.stringify(entry.session);
  if(json.length>45000)throw new Error('훈련 저장 용량을 초과했습니다. 운영진에게 문의해 주세요.');
  sheet.getRange(entry.row,1,1,2).setNumberFormat('@').setValues([[entry.session.date,json]]);
  SpreadsheetApp.flush();
}
function trainingPublic_(s) {
  return {training:{date:s.date,revision:s.revision,registrationRevision:s.registrationRevision,
    participants:s.participants.map(p=>({id:p.id,name:p.name,status:p.status,arrival:p.arrival,preference:p.preference,canCox:p.canCox,canSmallBoat:p.canSmallBoat,experience:p.experience})),plan:s.plan}};
}
function trainingLocked_(p,fn) {
  const date=trainingDate_(p.date), lock=LockService.getScriptLock();lock.waitLock(30000);
  try { const sheet=trainingSheet_(),entry=trainingRead_(sheet,date);const result=fn(entry.session);if(result!==false)trainingWrite_(sheet,entry);return trainingPublic_(entry.session); }
  finally {lock.releaseLock();}
}
function trainingGet_(p) {return trainingLocked_(p,()=>false);}
function trainingJoin_(p) {
  const name=String(p.name||'').trim(),key=String(p.editKey||'');
  if(!name||name.length>30||/[\x00-\x1f<>]/.test(name))throw new Error('이름을 30자 이내로 입력해 주세요.');
  if(!/^[a-zA-Z0-9-]{32,80}$/.test(key))throw new Error('신청 수정키가 올바르지 않습니다. 다시 신청해 주세요.');
  if(!['참석','불참','미정'].includes(p.status)||!['정시','늦참','조기 귀가'].includes(p.arrival)||!['무관','유타쿼드','더블스컬','싱글스컬'].includes(p.preference)||!['초급','중급','숙련'].includes(p.experience))throw new Error('참가 신청 항목을 확인해 주세요.');
  const digest=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,key,Utilities.Charset.UTF_8));
  return trainingLocked_(p,s=>{
    let member=s.participants.find(m=>m.name===name);
    if(member&&member.editHash!==digest)throw new Error('이미 신청된 이름입니다. 처음 신청한 브라우저에서 수정하거나 운영진에게 문의해 주세요.');
    if(!member){if(s.participants.length>=60)throw new Error('신청 인원이 최대 60명입니다.');member={id:Utilities.getUuid(),name,editHash:digest};s.participants.push(member);}
    Object.assign(member,{status:p.status,arrival:p.arrival,preference:p.preference,experience:p.experience,canCox:p.canCox===true,canSmallBoat:p.canSmallBoat===true});
    s.revision++;s.registrationRevision++;
  });
}
function trainingExpected_(s,p) {if(Number(p.revision)!==s.revision)throw new Error('다른 사용자가 변경했습니다. 새로고침 후 다시 시도해 주세요.');}
/** Enumerate this club's fleet; require a cox for every quad and small-boat eligibility. */
function trainingBuildPlan_(participants) {
  const people=participants.filter(p=>p.status==='참석'&&p.arrival==='정시');
  const coxes=people.filter(p=>p.canCox).sort((a,b)=>Number(a.canSmallBoat)-Number(b.canSmallBoat)||a.name.localeCompare(b.name,'ko'));
  let best=null;
  for(let q=0;q<=Math.min(4,coxes.length);q++)for(let d=0;d<=2;d++)for(let single=0;single<=1;single++){
    const seated=q*5+d*2+single;if(seated>people.length)continue;
    const usedCox=coxes.slice(0,q),usedIds=new Set(usedCox.map(p=>p.id));
    const small=people.filter(p=>!usedIds.has(p.id)&&p.canSmallBoat);
    if(small.length<d*2+single)continue;
    const boats=usedCox.map((p,i)=>({name:'유타쿼드 '+String.fromCharCode(65+i),type:'4X+',seats:[{seat:'COX',id:p.id,name:p.name}]}));
    let preferenceScore=0;
    const takeSmall=preference=>{small.sort((a,b)=>Number(b.preference===preference)-Number(a.preference===preference)||a.name.localeCompare(b.name,'ko'));const p=small.shift();usedIds.add(p.id);if(p.preference===preference)preferenceScore++;return p;};
    if(single){const p=takeSmall('싱글스컬');boats.push({name:'싱글스컬',type:'1X',seats:[{seat:'1번',id:p.id,name:p.name}]});}
    for(let i=0;i<d;i++){const seats=[];for(let j=0;j<2;j++){const p=takeSmall('더블스컬');seats.push({seat:(j+1)+'번',id:p.id,name:p.name});}boats.push({name:'더블스컬 '+String.fromCharCode(65+i),type:'2X',seats});}
    const remaining=people.filter(p=>!usedIds.has(p.id)).sort((a,b)=>['숙련','중급','초급'].indexOf(a.experience)-['숙련','중급','초급'].indexOf(b.experience)||a.name.localeCompare(b.name,'ko'));
    for(let seat=1;seat<=4;seat++)for(let i=0;i<q;i++){const p=remaining.shift();boats[i].seats.push({seat:seat+'번',id:p.id,name:p.name});usedIds.add(p.id);if(p.preference==='유타쿼드')preferenceScore++;}
    const score=seated*1000+preferenceScore*10+q;
    if(!best||score>best.score)best={score,boats,wait:participants.filter(p=>p.status==='참석'&&!usedIds.has(p.id)).map(p=>({id:p.id,name:p.name,reason:p.arrival!=='정시'?'참가 시간 확인 필요':'좌석 또는 탑승 가능 조건 확인 필요'}))};
  }
  return {boats:best.boats,wait:best.wait};
}
function trainingRecommend_(p) {
  return trainingLocked_(p,s=>{
    trainingExpected_(s,p);
    const built=trainingBuildPlan_(s.participants),oldChecks=s.plan?s.plan.checks:{};
    const checks={};built.boats.forEach(b=>b.seats.forEach(m=>{checks[m.id]=oldChecks[m.id]||'미확인';}));
    s.plan={boats:built.boats,wait:built.wait,checks,registrationRevision:s.registrationRevision,publishedAt:new Date().toISOString()};s.revision++;
  });
}
function trainingCheck_(p) {
  if(!['미확인','출석','불참'].includes(p.status))throw new Error('출석 상태를 확인해 주세요.');
  return trainingLocked_(p,s=>{
    trainingExpected_(s,p);
    if(!s.plan||!s.plan.boats.some(b=>b.seats.some(m=>m.id===p.id)))throw new Error('편성된 멤버를 찾을 수 없습니다.');
    s.plan.checks[p.id]=p.status;s.revision++;
  });
}
