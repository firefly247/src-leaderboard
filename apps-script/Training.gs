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
function trainingPublic_(s,admin) {
  return {training:{date:s.date,opened:s.opened===true,revision:s.revision,registrationRevision:s.registrationRevision,
    participants:s.opened?trainingTenures_(s.participants,s.date).map(p=>({id:p.id,name:p.name,status:p.status,comment:p.comment||'',canCox:p.canCox,canSmallBoat:p.canSmallBoat,tenure:p.tenure})):[],plan:s.opened?s.plan:null,...(admin?{draft:s.draft||null}:{})}};
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
function trainingRoster_(admin) {
  const players=playerBirthYears_(),columns=[...new Set(players.map(p=>/^\d{4}$/.test(String(p.joinYear||''))?Number(p.joinYear):null))].sort((a,b)=>a===null?1:b===null?-1:a-b);
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    const sheet=trainingSheet_(),catalog=trainingListFromSheet_(sheet),dates=new Set(catalog.sessions.map(s=>s.date));
    const trainings=sheet.getDataRange().getDisplayValues().slice(1).filter(row=>dates.has(row[0])).map(row=>trainingPublic_(JSON.parse(row[1]),admin).training).sort((a,b)=>a.date.localeCompare(b.date));
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
function trainingLocked_(p,fn,admin) {
  const date=trainingDate_(p.date), lock=LockService.getScriptLock();lock.waitLock(30000);
  try { const sheet=trainingSheet_(),entry=trainingRead_(sheet,date);const result=fn(entry.session);if(result!==false)trainingWrite_(sheet,entry);return trainingPublic_(entry.session,admin); }
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
/** Recommend a draft while preserving the exact boat/seat of locked members. */
function trainingBoat_(type,index) {
  const seats=type==='4X+'?['COX','1번','2번','3번','4번']:type==='2X'?['1번','2번']:['1번'];
  return {name:type==='4X+'?'유타쿼드 '+String.fromCharCode(65+index):type==='2X'?'더블스컬 '+String.fromCharCode(65+index):'싱글스컬',type,seats:seats.map(seat=>({seat,id:'',name:''}))};
}
function trainingBuildPlan_(participants,previous) {
  const people=participants.filter(p=>p.status==='참석');
  const pinned=(previous?.boats||[]).flatMap(b=>b.seats.filter(m=>m.locked).map(m=>({boat:b.name,...m})));
  if(pinned.some(m=>!people.some(p=>p.id===m.id)))throw new Error('고정된 멤버의 참가 여부가 변경되었습니다. 고정을 해제해 주세요.');
  let best=null;
  for(let q=0;q<=4;q++)for(let d=0;d<=2;d++)for(let single=0;single<=1;single++){
    const seated=q*5+d*2+single;if(seated>people.length)continue;
    const boats=[];
    for(let i=0;i<q;i++)boats.push(trainingBoat_('4X+',i));
    if(single)boats.push(trainingBoat_('1X',0));
    for(let i=0;i<d;i++)boats.push(trainingBoat_('2X',i));
    const usedIds=new Set();let valid=true;
    pinned.forEach(m=>{const seat=boats.find(b=>b.name===m.boat)?.seats.find(s=>s.seat===m.seat);if(!seat||usedIds.has(m.id)){valid=false;return;}Object.assign(seat,{id:m.id,name:m.name,locked:true,changed:!!m.changed});usedIds.add(m.id);});
    if(!valid)continue;
    const fill=(seat,filter,sort)=>{if(seat.id)return;const member=people.filter(p=>!usedIds.has(p.id)&&filter(p)).sort(sort)[0];if(!member){valid=false;return;}Object.assign(seat,{id:member.id,name:member.name});usedIds.add(member.id);};
    boats.filter(b=>b.type==='4X+').forEach(b=>fill(b.seats[0],p=>p.canCox,(a,b)=>Number(a.canSmallBoat)-Number(b.canSmallBoat)||a.name.localeCompare(b.name,'ko')));
    boats.filter(b=>b.type!=='4X+').forEach(b=>b.seats.forEach(seat=>fill(seat,p=>p.canSmallBoat,(a,b)=>a.name.localeCompare(b.name,'ko'))));
    for(let seat=1;seat<=4;seat++)boats.filter(b=>b.type==='4X+').forEach(b=>fill(b.seats[seat],()=>true,(a,b)=>(b.tenure||0)-(a.tenure||0)||a.name.localeCompare(b.name,'ko')));
    if(!valid)continue;
    const score=seated*1000+q;
    if(!best||score>best.score)best={score,boats,wait:people.filter(p=>!usedIds.has(p.id)).map(p=>({id:p.id,name:p.name,reason:'좌석 또는 탑승 가능 조건 확인 필요'}))};
  }
  if(!best)throw new Error('고정된 좌석을 유지하는 조합이 없습니다. 고정을 조정하거나 직접 배정해 주세요.');
  return {boats:best.boats,wait:best.wait};
}
function trainingDraftGet_(p) {return p.date?trainingLocked_(p,()=>false,true):trainingRoster_(true);}
function trainingRecommend_(p) {
  return trainingLocked_(p,s=>{
    trainingRequireOpen_(s);trainingExpected_(s,p);
    const built=trainingBuildPlan_(trainingTenures_(s.participants,s.date),s.draft||s.plan);
    s.draft={...built,registrationRevision:s.registrationRevision};s.revision++;
  },true);
}
function trainingDraftWait_(s) {
  const ids=new Set(s.draft.boats.flatMap(b=>b.seats.map(m=>m.id)));
  s.draft.wait=s.participants.filter(m=>m.status==='참석'&&!ids.has(m.id)).map(m=>({id:m.id,name:m.name,reason:'배정 대기'}));
}
function trainingDraftEdit_(p) {
  return trainingLocked_(p,s=>{
    trainingRequireOpen_(s);trainingExpected_(s,p);
    if(!s.draft)s.draft=s.plan?JSON.parse(JSON.stringify(s.plan)):{boats:[],wait:[],registrationRevision:s.registrationRevision};
    const draft=s.draft;
    if(p.operation==='start'){trainingDraftWait_(s);s.revision++;return;}
    if(p.operation==='addBoat'){
      if(!['4X+','2X','1X'].includes(p.type))throw new Error('보트를 확인해 주세요.');
      const limit=p.type==='4X+'?4:p.type==='2X'?2:1;
      const index=Array.from({length:limit},(_,i)=>i).find(i=>!draft.boats.some(b=>b.name===trainingBoat_(p.type,i).name));
      if(index==null)throw new Error('보유한 보트 수를 초과했습니다.');
      draft.boats.push(trainingBoat_(p.type,index));
    }else{
      const boat=draft.boats.find(b=>b.name===p.boat);if(!boat)throw new Error('보트를 찾을 수 없습니다.');
      if(p.operation==='removeBoat'){
        if(boat.seats.some(m=>m.locked))throw new Error('멤버 고정을 먼저 해제해 주세요.');
        draft.boats=draft.boats.filter(b=>b!==boat);
      }else{
        const seat=boat.seats.find(m=>m.seat===p.seat);if(!seat)throw new Error('좌석을 찾을 수 없습니다.');
        if(p.operation==='lock'){
          if(!seat.id)throw new Error('멤버를 먼저 배정해 주세요.');
          seat.locked=!seat.locked;
        }else if(p.operation==='replace'){
          if(seat.locked)throw new Error('고정을 해제한 뒤 변경해 주세요.');
          const member=s.participants.find(m=>m.id===p.id&&m.status==='참석');if(!member)throw new Error('참석 신청자를 선택해 주세요.');
          const other=draft.boats.flatMap(b=>b.seats).find(m=>m.id===member.id);
          if(other===seat)return false;
          if(other?.locked)throw new Error('선택한 멤버의 고정을 먼저 해제해 주세요.');
          if(other)Object.assign(other,{id:seat.id,name:seat.name,changed:true});
          Object.assign(seat,{id:member.id,name:member.name,changed:true});
        }else throw new Error('변경 작업을 확인해 주세요.');
      }
    }
    trainingDraftWait_(s);draft.registrationRevision=s.registrationRevision;s.revision++;
  },true);
}
/** Validate a whole UI draft; never trust client names, seat counts or waiting lists. */
function trainingValidateDraft_(input,s) {
  if(!input||!Array.isArray(input.boats)||input.boats.length>7)throw new Error('편성 초안을 확인해 주세요.');
  const used=new Set(),names=new Set(),people=new Map(s.participants.filter(m=>m.status==='참석').map(m=>[m.id,m]));
  const boats=input.boats.map(b=>{
    const limit=b.type==='4X+'?4:b.type==='2X'?2:b.type==='1X'?1:0;
    const template=Array.from({length:limit},(_,i)=>trainingBoat_(b.type,i)).find(v=>v.name===b.name);
    if(!template||names.has(b.name)||!Array.isArray(b.seats)||b.seats.length!==template.seats.length)throw new Error('배 종류와 좌석 수를 확인해 주세요.');
    names.add(b.name);
    template.seats=template.seats.map((seat,i)=>{
      const m=b.seats[i];if(!m||m.seat!==seat.seat||typeof m.id!=='string')throw new Error('좌석 정보를 확인해 주세요.');
      if(!m.id)return seat;
      const person=people.get(m.id);if(!person)throw new Error('참가 여부가 변경되었습니다. 최신 명단을 반영해 주세요.');
      if(used.has(m.id))throw new Error('같은 멤버를 중복 배정할 수 없습니다.');used.add(m.id);
      return {...seat,id:person.id,name:person.name,locked:m.locked===true,changed:m.changed===true};
    });return template;
  });
  return {boats,wait:s.participants.filter(m=>m.status==='참석'&&!used.has(m.id)).map(m=>({id:m.id,name:m.name,reason:'배정 대기'})),registrationRevision:s.registrationRevision};
}
function trainingDraftSave_(p) {
  return trainingLocked_(p,s=>{
    trainingRequireOpen_(s);trainingExpected_(s,p);
    s.draft=trainingValidateDraft_(p.draft,s);s.revision++;
  },true);
}
function trainingPublish_(p) {
  return trainingLocked_(p,s=>{
    trainingRequireOpen_(s);trainingExpected_(s,p);
    if(p.draft)s.draft=trainingValidateDraft_(p.draft,s);
    if(!s.draft||!s.draft.boats.length)throw new Error('배별 조합을 먼저 만들어 주세요.');
    const seats=s.draft.boats.flatMap(b=>b.seats),ids=seats.map(m=>m.id);
    if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw new Error('모든 좌석에 서로 다른 멤버를 배정해 주세요.');
    if(ids.some(id=>!s.participants.some(m=>m.id===id&&m.status==='참석')))throw new Error('참가 여부가 변경되었습니다. 명단을 확인해 주세요.');
    trainingDraftWait_(s);
    const checks={};ids.forEach(id=>checks[id]=s.plan?.checks?.[id]||'미확인');
    s.plan={...JSON.parse(JSON.stringify(s.draft)),checks,registrationRevision:s.registrationRevision,publishedAt:new Date().toISOString()};
    s.draft=null;s.revision++;
  },true);
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
