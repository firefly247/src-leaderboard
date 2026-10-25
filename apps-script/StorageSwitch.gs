/** Storage is changed only by the explicit owner-run activation function below. */
var StorageContext_ = null;
var StorageLockDepth_ = 0;
function storageLock_() {
  var held=false, native=LockService.getScriptLock();
  return {waitLock:function(ms){if(!held){if(!StorageLockDepth_)native.waitLock(ms);StorageLockDepth_++;held=true;}},
    releaseLock:function(){if(held){held=false;StorageLockDepth_--;if(!StorageLockDepth_)native.releaseLock();}}};
}
function storageProvider_() {
  var value=properties_().getProperty('CLUB_STORAGE_PROVIDER')||'sheets-and-csv';
  if(!['sheets-and-csv','supabase'].includes(value))throw new Error('저장소 설정을 확인해 주세요.');
  return value;
}
function storageDispatch_(action,p,token) {
  // Authentication has its own one-time state lock and never reads club records.
  if(action==='adminLogin'||/^kakao/.test(action))return dispatchCore_(action,p,token);
  var lock=storageLock_();lock.waitLock(30000);
  try {
    var provider=storageProvider_();
    if(action==='storageSource')return {provider:provider,version:1};
    if(provider==='supabase'){StorageContext_=Object.assign(storageRead_(),{dirty:false,sheets:{}});StorageContext_.originalTables=JSON.parse(JSON.stringify(StorageContext_.tables));}
    var result=action==='publicData'?storagePublicData_():dispatchCore_(action,p,token);
    if(StorageContext_&&StorageContext_.dirty)storageCommit_(StorageContext_.revision,StorageContext_.tables,StorageContext_.originalTables);
    return result;
  } finally {StorageContext_=null;lock.releaseLock();}
}
function storageRead_(){var snapshot=supabaseRequest_('rpc/club_store_read','post',{});snapshot.tables.request_log=snapshot.tables.request_log.map(storageUnpackRequest_);return snapshot;}
function storageCommit_(revision,tables,before){storageValidate_(tables);if(!before)before=storageRead_().tables;return supabaseRequest_('rpc/club_store_commit','post',{p_expected_revision:revision,p_changes:storageChanges_(before,tables)});}
function storageRequestSummary_(source,type){
  var race=type==='competition_add',kind=source.competitionType==='indoor'?'실내대회':source.competitionType==='beach'?'비치대회':'수상대회';
  return {member_name:String(source.memberName||''),event_id:String(race?source.competitionId||'':source.eventId||''),event_name:String(race?source.competitionName||'':source.eventName||''),
    time_display:race?kind+((source.isCox===true||String(source.isCox)==='1')?' · COX':'')+' · '+source.competitionEventName+' · '+source.competitionDivisionName+' · 금 '+Number(source.gold||0)+' · 은 '+Number(source.silver||0)+' · 동 '+Number(source.bronze||0):String(source.timeDisplay||''),
    competition_date:race?String(Number(source.year)):String(source.competitionDate||''),competition:race?'대회':String(source.competition||''),note:String(source.note||''),proof_photo_url:String(source.proof_photo_url||''),delete_reason:String(source.reason||'')};
}
function storagePackRequest_(row){
  var source=JSON.parse(row.source_json),summary=storageRequestSummary_(source,row.request_type),extra={};
  if(Object.prototype.hasOwnProperty.call(source,'__club_summary'))throw new Error('예약된 신청 필드가 있습니다.');
  Object.keys(summary).forEach(function(k){if(String(row[k]||'')!==summary[k])extra[k]=String(row[k]||'');});
  if(Object.keys(extra).length)source.__club_summary=extra;
  var packed={};['request_id','request_type','requested_at','source_json','status','processed_at','result','record_id'].forEach(function(k){packed[k]=k==='source_json'?JSON.stringify(source):row[k];});return packed;
}
function storageUnpackRequest_(row){
  var source=JSON.parse(row.source_json),extra=source.__club_summary||{};delete source.__club_summary;
  return Object.assign({},row,storageRequestSummary_(source,row.request_type),extra,{source_json:JSON.stringify(source)});
}
function storageChanges_(before,after){
  var changes={};Object.keys(StorageLayout).forEach(function(name){var spec=StorageLayout[name],key=function(r){return JSON.stringify(spec.key.map(function(k){return r[k];}));},pack=function(r){return name==='request_log'?storagePackRequest_(r):r;};
    var previous=new Map(before[name].map(function(r){return [key(r),pack(r)];})),next=new Map(after[name].map(function(r){return [key(r),pack(r)];})),upsert=[],remove=[];
    next.forEach(function(r,k){if(!previous.has(k)||JSON.stringify(storageNormal_(previous.get(k)))!==JSON.stringify(storageNormal_(r)))upsert.push(r);});
    previous.forEach(function(r,k){if(!next.has(k)){var id={};spec.key.forEach(function(c){id[c]=r[c];});remove.push(id);}});
    if(upsert.length||remove.length)changes[name]={upsert:upsert,remove:remove};
  });return changes;
}
function storageNormal_(value){
  if(Array.isArray(value))return value.map(storageNormal_);
  if(value&&typeof value==='object')return Object.keys(value).sort().reduce(function(o,k){o[k]=storageNormal_(value[k]);return o;},{});
  return value;
}
function storageDigest_(tables){
  var ordered={};Object.keys(StorageLayout).sort().forEach(function(name){var spec=StorageLayout[name];ordered[name]=tables[name].map(storageNormal_).sort(function(a,b){var ka=JSON.stringify(spec.key.map(function(k){return a[k];})),kb=JSON.stringify(spec.key.map(function(k){return b[k];}));return ka<kb?-1:ka>kb?1:0;});});
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(ordered),Utilities.Charset.UTF_8).map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');
}
function storageValidate_(tables){
  if(!tables||Object.keys(tables).sort().join()!==Object.keys(StorageLayout).sort().join())throw new Error('이전 데이터의 테이블 구성이 일치하지 않습니다.');
  Object.keys(StorageLayout).forEach(function(name){var spec=StorageLayout[name],seen=new Set();if(!Array.isArray(tables[name]))throw new Error('이전 데이터 형식 오류: '+name);
    tables[name].forEach(function(row){if(Object.keys(row).sort().join()!==spec.columns.slice().sort().join())throw new Error('원본 열 구성이 변경되었습니다: '+name);
      var key=JSON.stringify(spec.key.map(function(k){return row[k];}));if(spec.key.some(function(k){return !row[k];})||seen.has(key))throw new Error('원본 키가 없거나 중복되었습니다: '+name);seen.add(key);
      spec.columns.forEach(function(c){if(c==='session_json'){if(!row[c]||typeof row[c]!=='object'||Array.isArray(row[c]))throw new Error('편성 JSON 오류');}else if(typeof row[c]!=='string')throw new Error('원본 문자열 형식 오류: '+name);});});});
}
function storageCsvText_(name,rows){var cols=StorageLayout[name].columns;return [cols.join(',')].concat(rows.map(function(row){return cols.map(function(c){return csvValue_(row[c]);}).join(',');})).join('\n')+'\n';}
function storageCsvName_(path){return Object.keys(StorageLayout).find(function(n){return StorageLayout[n].path===path;});}
function storageCsvGet_(path){var name=storageCsvName_(path);if(!name)throw new Error('지원하지 않는 데이터 경로입니다.');var tables={};Object.keys(StorageLayout).forEach(function(n){tables[n]=n===name?StorageContext_.tables[n]:[];});return {content:storageCsvText_(name,StorageContext_.tables[name]),sha:storageDigest_(tables)};}
function storageCsvPut_(path,content,expectedSha){var name=storageCsvName_(path);if(expectedSha&&storageCsvGet_(path).sha!==expectedSha)throw new Error('기록이 변경되었습니다. 새로 조회한 뒤 수정해 주세요.');StorageContext_.tables[name]=parseCsvObjects_(content);StorageContext_.dirty=true;}
function storagePublicData_(){var files={};Object.keys(StorageLayout).forEach(function(n){var spec=StorageLayout[n];if(spec.path)files[spec.path.slice(5)]=StorageContext_?storageCsvText_(n,StorageContext_.tables[n]):githubGet_(spec.path).content;});return {provider:storageProvider_(),files:files};}
/** Spreadsheet-compatible in-memory view; persisted once after the whole action succeeds. */
function storageSheet_(sheetName){
  if(!StorageContext_)return null;
  var name=Object.keys(StorageLayout).find(function(n){return StorageLayout[n].sheet===sheetName;}),spec=StorageLayout[name];
  if(!spec)throw new Error('지원하지 않는 시트입니다.');
  if(StorageContext_.sheets[name])return StorageContext_.sheets[name];
  var grid=[spec.columns.slice()].concat(StorageContext_.tables[name].map(function(row){return spec.columns.map(function(c){return c==='session_json'?JSON.stringify(row[c]):row[c];});}));
  function sync(){StorageContext_.tables[name]=grid.slice(1).filter(function(row){return row.some(Boolean);}).map(function(row){var item={};spec.columns.forEach(function(c,i){item[c]=c==='session_json'?JSON.parse(row[i]||'null'):String(row[i]||'');});return item;});StorageContext_.dirty=true;}
  function range(r,c,n,m){n=n||1;m=m||1;var result={setNumberFormat:function(){return result;},getDisplayValues:function(){return Array.from({length:n},function(_,i){return Array.from({length:m},function(_,j){return String((grid[r+i-1]||[])[c+j-1]||'');});});},getValues:function(){return result.getDisplayValues();},setValue:function(v){return result.setValues([[v]]);},setValues:function(values){if(values.length!==n||values.some(function(row){return row.length!==m;}))throw new Error('시트 범위 오류');values.forEach(function(row,i){while(grid.length<r+i)grid.push([]);row.forEach(function(v,j){if(r+i===1&&String(v)!==spec.columns[c+j-1])throw new Error('시트 헤더 변경은 지원하지 않습니다.');grid[r+i-1][c+j-1]=String(v==null?'':v);});});sync();return result;}};return result;}
  var sheet={getDataRange:function(){return range(1,1,grid.length,spec.columns.length);},getLastRow:function(){return grid.length;},getLastColumn:function(){return spec.columns.length;},getRange:range,
    appendRow:function(row){if(row.length!==spec.columns.length)throw new Error('시트 열 구성 오류');grid.push(row.map(function(v){return String(v==null?'':v);}));sync();return sheet;},setFrozenRows:function(){return sheet;}};
  StorageContext_.sheets[name]=sheet;return sheet;
}
/** Fetch one pinned Git commit and all private sheets. Never returns the actual cells to callers. */
function storageLegacySnapshot_(){
  var head=UrlFetchApp.fetch('https://api.github.com/repos/'+prop_('GITHUB_OWNER')+'/'+prop_('GITHUB_REPO')+'/commits/'+encodeURIComponent(properties_().getProperty('GITHUB_BRANCH')||'main'),{headers:githubHeaders_(),muteHttpExceptions:true});
  if(head.getResponseCode()!==200)throw new Error('원본 GitHub 버전을 확인하지 못했습니다.');var commit=JSON.parse(head.getContentText()).sha;
  if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('원본 GitHub 버전 오류');
  var tables={},ss=SpreadsheetApp.openById(prop_('REQUEST_SHEET_ID'));
  Object.keys(StorageLayout).forEach(function(name){var spec=StorageLayout[name],rows,headers;
    if(spec.path){var res=UrlFetchApp.fetch(githubUrl_(spec.path)+'?ref='+commit,{headers:githubHeaders_(),muteHttpExceptions:true});if(res.getResponseCode()!==200)throw new Error('원본 CSV를 읽지 못했습니다: '+name);var body=JSON.parse(res.getContentText());rows=Utilities.parseCsv(Utilities.newBlob(Utilities.base64Decode(body.content.replace(/\n/g,''))).getDataAsString('UTF-8'));}
    else{var sheet=ss.getSheetByName(spec.sheet);rows=sheet?sheet.getDataRange().getDisplayValues():[spec.columns.slice()];}
    headers=rows.shift()||[];if(headers.slice(0,spec.columns.length).join()!==spec.columns.join()||headers.slice(spec.columns.length).some(Boolean))throw new Error('원본 열 구성이 변경되었습니다: '+name);
    tables[name]=rows.filter(function(r){return r.some(Boolean);}).map(function(row){var item={};spec.columns.forEach(function(c,i){item[c]=c==='session_json'?JSON.parse(row[i]||'null'):String(row[i]||'');});if(row.slice(spec.columns.length).some(Boolean))throw new Error('알 수 없는 원본 열: '+name);return item;});
  });storageValidate_(tables);return {tables:tables,sourceCommit:commit,digest:storageDigest_(tables)};
}
function storageMigrate_(activate){
  var lock=storageLock_();lock.waitLock(30000);
  try{
    if(storageProvider_()!=='sheets-and-csv')throw new Error('이미 Supabase가 운영 저장소입니다. 원본으로 덮어쓸 수 없습니다.');
    if(activate===true)storageRequireFrontend_();
    var source=storageLegacySnapshot_(),before=storageRead_(),written=storageCommit_(before.revision,source.tables,before.tables),verified=storageRead_();
    if(written.revision!==verified.revision||storageDigest_(verified.tables)!==source.digest)throw new Error('이전 데이터 대조에 실패했습니다. 기존 DB를 유지합니다.');
    var current=storageLegacySnapshot_();if(current.digest!==source.digest)throw new Error('원본이 변경되어 전환하지 않았습니다. 다시 실행해 주세요.');
    var report={copiedAt:new Date().toISOString(),sourceCommit:source.sourceCommit,revision:verified.revision,digest:source.digest,verified:true,counts:written.counts,activeStorage:'sheets-and-csv'};
    properties_().setProperty('CLUB_MIGRATION_REPORT',JSON.stringify(report));
    if(activate===true){properties_().setProperty('CLUB_STORAGE_PROVIDER','supabase');report.activeStorage='supabase';report.activatedAt=new Date().toISOString();properties_().setProperty('CLUB_MIGRATION_REPORT',JSON.stringify(report));}
    return report;
  }finally{lock.releaseLock();}
}
function storageRequireFrontend_(){
  var base='https://firefly247.github.io/src-leaderboard/',index=UrlFetchApp.fetch(base+'?_storage_check='+Date.now(),{muteHttpExceptions:true});
  if(index.getResponseCode()!==200||!index.getContentText().includes('leaderboard.js?v=20261026-02'))throw new Error('저장소 전환을 지원하는 화면이 아직 배포되지 않았습니다.');
  var script=UrlFetchApp.fetch(base+'static/leaderboard.js?v=20261026-02&_storage_check='+Date.now(),{muteHttpExceptions:true});
  if(script.getResponseCode()!==200||!script.getContentText().includes('async function loadRecordFiles()')||!script.getContentText().includes('api("storageSource")'))throw new Error('화면 저장소 연결 코드를 확인하지 못했습니다.');
}
/** Safe to rerun while the existing DB remains active. Does NOT switch production. */
function migrateClubDataToSupabase(){console.log(JSON.stringify(storageMigrate_(false)));}
/** Run ONLY after a separate explicit user instruction to switch the production DB. */
function activateSupabaseStorage(){console.log(JSON.stringify(storageMigrate_(true)));}
function clubStorageStatus(){var report=properties_().getProperty('CLUB_MIGRATION_REPORT');console.log(JSON.stringify({activeStorage:storageProvider_(),migration:report?JSON.parse(report):null}));}
