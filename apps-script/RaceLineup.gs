/** Competition drafts and participant selections stay in the private spreadsheet. */
function raceLineupSheet_(create){
  if(typeof StorageContext_!=='undefined'&&StorageContext_)return storageSheet_('COMPETITION_LINEUPS');
  const ss=SpreadsheetApp.openById(prop_('REQUEST_SHEET_ID'));let sheet=ss.getSheetByName('COMPETITION_LINEUPS');
  if(!sheet&&create){sheet=ss.insertSheet('COMPETITION_LINEUPS');sheet.appendRow(['id','session_json']);sheet.setFrozenRows(1);}return sheet;
}
function raceLineupRows_(sheet){return sheet?sheet.getDataRange().getDisplayValues().slice(1).map((r,i)=>({row:i+2,value:r[1]})).filter(e=>e.value).map(e=>({row:e.row,race:JSON.parse(e.value)})):[];}
function raceLineupWrite_(sheet,entry){
  const json=JSON.stringify(entry.race);if(json.length>45000)throw new Error('편성 저장 용량을 초과했습니다. 조 수를 줄여 주세요.');
  sheet.getRange(entry.row,1,1,2).setNumberFormat('@').setValues([[entry.race.id,json]]);SpreadsheetApp.flush();
}
function raceLineupSummary_(r){return {id:r.id,year:r.year,name:r.name,finalizedAt:r.finalized?.finalizedAt||''};}
function raceLineupPublic_(r){return {...raceLineupSummary_(r),finalized:r.finalized||null};}
function raceLineupList_(){
  const lock=(typeof storageLock_ === 'function' ? storageLock_() : LockService.getScriptLock());lock.waitLock(30000);try{return {races:raceLineupRows_(raceLineupSheet_(false)).map(e=>raceLineupSummary_(e.race)).sort((a,b)=>b.year-a.year||a.name.localeCompare(b.name,'ko'))};}finally{lock.releaseLock();}
}
function raceLineupAdminData_(){
  return {...raceLineupList_(),players:playerBirthYears_().filter(p=>!p.isDormant),events:competitionEvents_(),divisions:competitionDivisions_(),competitions:competitions_()};
}
function raceLineupLocked_(p,fn,admin){
  const lock=(typeof storageLock_ === 'function' ? storageLock_() : LockService.getScriptLock());lock.waitLock(30000);
  try{const sheet=raceLineupSheet_(false),entry=raceLineupRows_(sheet).find(e=>e.race.id===p.id);if(!entry)throw new Error('대회 편성을 찾을 수 없습니다.');
    if(fn){if(Number(p.revision)!==entry.race.revision)throw new Error('다른 운영진이 변경했습니다. 최신 정보를 불러온 뒤 다시 확인해 주세요.');fn(entry.race);entry.race.revision++;raceLineupWrite_(sheet,entry);}
    return {race:admin?entry.race:raceLineupPublic_(entry.race)};
  }finally{lock.releaseLock();}
}
function raceLineupGet_(p){return raceLineupLocked_(p,null,false);}
function raceLineupGetAdmin_(p){return raceLineupLocked_(p,null,true);}
function raceLineupCreate_(p){
  const year=Number(p.year);if(!Number.isInteger(year)||year<1900||year>2100)throw new Error('연도를 확인해 주세요.');
  const catalog=p.competitionId?competitions_().find(c=>c.competition_id===p.competitionId):null;
  if(p.competitionId&&!catalog)throw new Error('대회를 확인해 주세요.');
  const name=catalog?catalog.competition_name:String(p.name||'').trim();if(!name||name.length>100||/[<>\x00-\x1f]/.test(name))throw new Error('대회명을 100자 이내로 입력해 주세요.');
  const lock=(typeof storageLock_ === 'function' ? storageLock_() : LockService.getScriptLock());lock.waitLock(30000);
  try{const sheet=raceLineupSheet_(true),rows=raceLineupRows_(sheet),existing=rows.find(e=>e.race.year===year&&e.race.name===name);if(existing)return {race:existing.race};
    const race={id:Utilities.getUuid(),year,name,competitionId:catalog?.competition_id||'',revision:1,participants:[],participantsConfirmed:false,groups:[],finalized:null};raceLineupWrite_(sheet,{row:sheet.getLastRow()+1,race});return {race};
  }finally{lock.releaseLock();}
}
function raceLineupPlayers_(race){
  const players=playerBirthYears_().filter(p=>!p.isDormant),names=new Set(race.participants);return players.filter(p=>names.has(p.memberName));
}
function raceLineupParticipants_(p){
  if(!Array.isArray(p.names)||p.names.length>500||p.names.some(n=>typeof n!=='string'))throw new Error('참가자를 확인해 주세요.');
  const available=new Set(playerBirthYears_().filter(v=>!v.isDormant).map(v=>v.memberName));
  if(p.names.some(n=>!available.has(n)))throw new Error('선수 정보에 등록된 활동 선수를 선택해 주세요.');
  return raceLineupLocked_(p,r=>{
    r.participants=[...new Set(p.names)].sort((a,b)=>a.localeCompare(b,'ko'));r.participantsConfirmed=true;
    const names=new Set(r.participants);r.groups.forEach(g=>g.slots.forEach(s=>{if(s.name&&!names.has(s.name))Object.assign(s,{name:'',locked:false,changed:true});}));
  },true);
}
function raceLineupSave_(p,finalize){
  return raceLineupLocked_(p,r=>{
    if(!r.participantsConfirmed||!r.participants.length)throw new Error('참가자를 먼저 선택하고 저장해 주세요.');
    const players=raceLineupPlayers_(r),groups=RaceLineupPlan.normalise(p.groups,players,r.year,competitionEvents_(),competitionDivisions_(),finalize);
    r.groups=groups;r.savedAt=new Date().toISOString();
    if(finalize)r.finalized={finalizedAt:r.savedAt,groups:groups.map(g=>({...g,slots:g.slots.map(s=>({...s,age:s.name?RaceLineupPlan.age(players.find(p=>p.memberName===s.name),r.year):null}))}))};
  },true);
}
