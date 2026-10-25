const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(provider='sheets-and-csv'){
 const props={CLUB_STORAGE_PROVIDER:provider},calls=[],locks={held:0,acquired:0};let snapshot;
 const ctx={properties_:()=>({getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v}),LockService:{getScriptLock:()=>({waitLock:()=>{locks.held++;locks.acquired++;},releaseLock:()=>{locks.held--;}})},Utilities:{DigestAlgorithm:{SHA_256:'SHA256'},Charset:{UTF_8:'UTF8'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]},csvValue_:v=>/[",\n\r]/.test(String(v))?'"'+String(v).replace(/"/g,'""')+'"':String(v??''),parseCsvObjects_:()=>[],console};
 vm.createContext(ctx);for(const file of ['StorageLayout.gs','StorageSwitch.gs'])vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),ctx);
 const blank=()=>Object.fromEntries(Object.keys(ctx.StorageLayout).map(n=>[n,[]]));snapshot={revision:0,tables:blank()};
 ctx.supabaseRequest_=(path,method,p)=>{calls.push(path);if(path==='rpc/club_store_read')return clone(snapshot);assert.equal(path,'rpc/club_store_commit');if(p.p_expected_revision!==snapshot.revision)throw new Error('conflict');snapshot={revision:snapshot.revision+1,tables:clone(p.p_tables)};return {revision:snapshot.revision,counts:Object.fromEntries(Object.entries(snapshot.tables).map(([k,v])=>[k,v.length]))};};
 return {ctx,props,calls,locks,blank,get snapshot(){return snapshot;},set snapshot(v){snapshot=v;}};
}
test('Legacy dispatch stays on existing storage and nested locks release only at the boundary',()=>{
 const f=fixture();f.ctx.dispatchCore_=()=>{const lock=f.ctx.storageLock_();lock.waitLock(1);assert.equal(f.locks.held,1);lock.releaseLock();assert.equal(f.locks.held,1);return {okay:true};};
 assert.equal(f.ctx.storageDispatch_('trainingGet',{},'').okay,true);assert.equal(f.locks.held,0);assert.equal(f.locks.acquired,1);assert.deepEqual(f.calls,[]);
});
test('Supabase actions commit once and an action failure persists nothing; no silent legacy fallback',()=>{
 const f=fixture('supabase');f.ctx.dispatchCore_=()=>{const sheet=f.ctx.storageSheet_('PLAYER_BIRTH_YEARS');sheet.appendRow(['김선수','1980','','2023']);sheet.getRange(2,4).setValue('2024');return {okay:true};};
 f.ctx.storageDispatch_('save',{},'');assert.equal(f.snapshot.revision,1);assert.equal(f.snapshot.tables.player_birth_years[0].join_year,'2024');assert.equal(f.calls.filter(x=>x.includes('commit')).length,1);
 f.ctx.dispatchCore_=()=>{f.ctx.storageSheet_('PLAYER_BIRTH_YEARS').getRange(2,2).setValue('1981');throw new Error('invalid');};
 assert.throws(()=>f.ctx.storageDispatch_('save',{},''),/invalid/);assert.equal(f.snapshot.revision,1);assert.equal(f.snapshot.tables.player_birth_years[0].birth_year,'1980');assert.equal(f.ctx.StorageContext_,null);assert.equal(f.locks.held,0);
 f.ctx.supabaseRequest_=()=>{throw new Error('offline');};assert.throws(()=>f.ctx.storageDispatch_('read',{},''),/offline/);assert.equal(f.props.CLUB_STORAGE_PROVIDER,'supabase');
});
test('JSON sessions, row deletions and display range reads preserve the original sheet contract',()=>{
 const f=fixture();f.ctx.StorageContext_={tables:f.blank(),sheets:{},dirty:false};
 const sheet=f.ctx.storageSheet_('WEEKEND_TRAINING'),session={participants:[{name:'김선수',editHash:'private-hash'}],draft:{boats:[]},plan:null};
 sheet.getRange(2,1,1,2).setNumberFormat('@').setValues([['2026-10-24',JSON.stringify(session)]]);
 assert.deepEqual(clone(f.ctx.StorageContext_.tables.weekend_training[0].session_json),session);assert.equal(sheet.getLastRow(),2);assert.equal(JSON.parse(sheet.getDataRange().getDisplayValues()[1][1]).participants[0].editHash,'private-hash');
 sheet.getRange(2,1,1,2).setValues([['','']]);assert.equal(f.ctx.StorageContext_.tables.weekend_training.length,0);
});
test('Public datasets exclude all private sheets, drafts, years and edit hashes',()=>{
 const f=fixture('supabase');f.snapshot.tables.player_birth_years=[{member_name:'private-person',birth_year:'1980',join_year:'2023',updated_at:''}];
 const result=f.ctx.storageDispatch_('publicData',{},'');assert.equal(Object.keys(result.files).length,8);assert.ok(!JSON.stringify(result).includes('private-person'));assert.equal(f.calls.filter(x=>x.includes('commit')).length,0);
});
test('Canonical digest ignores row/key ordering but detects private field changes',()=>{
 const f=fixture(),a=f.blank();a.weekend_training=[{date:'2026-10-24',session_json:{b:2,a:1}}];a.player_birth_years=[{member_name:'나',birth_year:'1980',join_year:'2023',updated_at:''},{member_name:'가',birth_year:'1981',join_year:'2024',updated_at:''}];
 const b=clone(a);b.player_birth_years.reverse();b.weekend_training[0].session_json={a:1,b:2};assert.equal(f.ctx.storageDigest_(a),f.ctx.storageDigest_(b));b.player_birth_years[0].birth_year='1982';assert.notEqual(f.ctx.storageDigest_(a),f.ctx.storageDigest_(b));
});
test('Migration verifies destination/source; only explicit activation changes provider',()=>{
 const f=fixture(),source={tables:f.blank(),digest:null,sourceCommit:'a'.repeat(40)};source.tables.player_birth_years=[{member_name:'김선수',birth_year:'1980',updated_at:'',join_year:'2023'}];source.digest=f.ctx.storageDigest_(source.tables);f.ctx.storageLegacySnapshot_=()=>clone(source);f.ctx.storageRequireFrontend_=()=>{};
 const report=f.ctx.storageMigrate_(false);assert.equal(report.verified,true);assert.equal(f.props.CLUB_STORAGE_PROVIDER,'sheets-and-csv');
 f.ctx.storageMigrate_(true);assert.equal(f.props.CLUB_STORAGE_PROVIDER,'supabase');assert.throws(()=>f.ctx.storageMigrate_(false),/운영 저장소/);
});
test('Mismatched readback and changed sources prevent activation',()=>{
 for(const mismatch of ['destination','source']){const f=fixture(),source={tables:f.blank(),digest:null,sourceCommit:'a'.repeat(40)};source.digest=f.ctx.storageDigest_(source.tables);let reads=0;
  f.ctx.storageLegacySnapshot_=()=>({...clone(source),digest:mismatch==='source'&&reads++?'changed':source.digest});f.ctx.storageRequireFrontend_=()=>{};
  if(mismatch==='destination'){const original=f.ctx.storageRead_;let n=0;f.ctx.storageRead_=()=>{const r=original();if(n++)r.tables.events=[{event_id:'extra',event_name:'wrong'}];return r;};}
  assert.throws(()=>f.ctx.storageMigrate_(true),/대조|원본이 변경/);assert.equal(f.props.CLUB_STORAGE_PROVIDER,'sheets-and-csv');
 }
});
test('Front-end source selection fails closed and preserves original CSV path while legacy is active',async()=>{
 const source=fs.readFileSync('static/leaderboard.js','utf8'),body=source.slice(source.indexOf('async function loadRecordFiles()'),source.indexOf('async function refresh(manual=false)'));
 const calls=[],ctx={location:{hostname:'example.com'},latestRevision:async()=> 'sha',fetchCsv:async n=>{calls.push(n);return n;},api:async()=>({provider:'sheets-and-csv'})};vm.createContext(ctx);vm.runInContext(body,ctx);
 assert.equal((await ctx.loadRecordFiles()).length,8);assert.equal(calls.length,8);calls.length=0;ctx.api=async action=>action==='storageSource'?{provider:'supabase'}:Promise.reject(new Error('offline'));
 await assert.rejects(()=>ctx.loadRecordFiles(),/offline/);assert.equal(calls.length,0);
});
test('Real training, player-year edits, requests and race drafts persist using Supabase exclusively',()=>{
 const f=fixture('supabase');let sequence=0;
 Object.assign(f.ctx,{CacheService:{getScriptCache:()=>({get:k=>k==='admin:valid'?'1':null})},SpreadsheetApp:{openById:()=>assert.fail('must not open legacy sheet'),flush(){}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>f.props[k]})}});
 f.ctx.Utilities.getUuid=()=>`id-${++sequence}`;
 f.ctx.Utilities.base64Encode=value=>Buffer.from(value).toString('base64');
 f.ctx.Utilities.base64EncodeWebSafe=value=>Buffer.from(value).toString('base64url');
 f.ctx.Utilities.formatDate=()=> '2026';
 f.ctx.Utilities.parseCsv=text=>text.trim().split(/\r?\n/).map(line=>line.split(',').map(v=>v.replace(/^"|"$/g,'')));
 for(const file of ['Code.gs','Training.gs','RaceLineupPlan.gs','RaceLineup.gs'])vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),f.ctx);
 f.snapshot.tables.player_birth_years=[{member_name:'김선수',birth_year:'1980',join_year:'2023',updated_at:''}];
 f.snapshot.tables.events=[{event_id:'e1',event_name:'2000m'}];
 f.snapshot.tables.competitions=[{competition_id:'c1',competition_name:'클럽대회'}];
 f.snapshot.tables.competition_events=[{competition_event_id:'single',competition_event_name:'1X'}];
 f.snapshot.tables.competition_divisions=[{competition_division_id:'open',competition_division_name:'남자 일반부'}];
 const call=(a,p={},token='')=>clone(f.ctx.dispatch_(a,p,token));
 call('trainingOpen',{dates:['2026-10-24']},'valid');
 let t=call('trainingWeekJoin',{week:'2026-10-24',name:'김선수',editKey:'a'.repeat(32),dates:['2026-10-24'],status:'참석',comment:'연습'}).trainings;
 // Direct per-date endpoint reads the same persisted registration.
 const read=call('trainingGet',{date:'2026-10-24'}).training;
 assert.equal(read.participants[0].name,'김선수');assert.equal(read.participants[0].editHash,undefined);
 assert.ok(f.snapshot.tables.weekend_training[0].session_json.participants[0].editHash);
 call('savePlayerBirthYears',{players:[{memberName:'김선수',birthYear:'1981',joinYear:'2024'}]},'valid');
 assert.equal(f.snapshot.tables.player_birth_years[0].birth_year,'1981');
 const request=call('requestAdd',{memberName:'김선수',eventId:'e1',timeDisplay:'7:30.0',competitionDate:'2026-10-24',competition:'클럽',note:''});
 assert.ok(request.requestId);assert.equal(f.snapshot.tables.request_log.length,1);
 assert.equal(call('adminList',{view:'add'},'valid').requests[0].request_id,request.requestId);
 const beforeApprove=f.snapshot.revision;
 assert.equal(call('processAddRequests',{requestIds:[request.requestId]},'valid').processedCount,1);
 assert.equal(f.snapshot.revision,beforeApprove+1);assert.equal(f.snapshot.tables.records.length,1);assert.equal(f.snapshot.tables.request_log[0].status,'approved');
 const created=call('raceLineupCreate',{year:2026,competitionId:'c1'},'valid').race;
 const selected=call('raceLineupParticipants',{id:created.id,revision:created.revision,names:['김선수']},'valid').race;
 assert.equal(selected.participantsConfirmed,true);assert.equal(f.snapshot.tables.competition_lineups.length,1);
 assert.equal(call('raceLineupGet',{id:created.id}).race.participants,undefined);
 assert.equal(f.locks.held,0);
});
