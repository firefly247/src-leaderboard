const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const hash=v=>crypto.createHash('sha256').update(v).digest();
const layout=JSON.parse(fs.readFileSync('apps-script/StorageLayout.gs','utf8').match(/var StorageLayout = ([\s\S]*);/)[1]);
const blank=()=>Object.fromEntries(Object.keys(layout).map(k=>[k,[]]));
async function fixture(){
 const {createHandler}=await import('../supabase/functions/club-api/handler.mjs');
 let snapshot={revision:1,tables:blank()},reads=0,conflict=null;const writes=[],uploads=[],roleWrites=[],coaches=new Set();
 snapshot.tables.events=[{event_id:'e1',event_name:'2000m'}];snapshot.tables.player_birth_years=[{member_name:'김선수',birth_year:'1980',join_year:'2023',updated_at:''}];
 const account={user_id:'00000000-0000-0000-0000-000000000001',player_name:'김선수',requested_player_name:null,role:'member'};
 const response=v=>new Response(v===undefined?'':JSON.stringify(v),{status:200});
 const fetcher=async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return options.headers.Authorization==='Bearer verified'?response({id:account.user_id,identities:[{provider:'kakao'}],user_metadata:{name:'회원',role:'admin'}}):new Response('{}',{status:401});
  if(url.includes('/storage/v1/object/')){uploads.push(url);return response({});}
  const path=url.split('/rest/v1/')[1],p=options.body?JSON.parse(options.body):{};
  if(path==='club_accounts')return response();if(path.startsWith('club_accounts?')){if(options.method==='PATCH')Object.assign(account,p);return response([account]);}
  if(path.split('?')[0]==='club_coaches'){
   if(options.method==='POST'){coaches.add(p.member_name);return response();}
   if(options.method==='DELETE'){coaches.delete(decodeURIComponent(path.split('member_name=eq.')[1]));return response();}
   return response([...coaches].map(member_name=>({member_name})));
  }
  const table=path.split('?')[0];if(['club_player_birth_years','club_records','club_competition_records','club_dormant_members'].includes(table)){
   const exact=path.match(/member_name=eq\.([^&]+)/)?.[1];return response(snapshot.tables[table.slice(5)].filter(r=>!exact||r.member_name===decodeURIComponent(exact)).map(r=>({member_name:r.member_name})));
  }
  if(path==='rpc/club_account_set_role'){roleWrites.push(p);return response(true);}
  if(path==='rpc/club_api_limit')return response(true);
  if(path==='rpc/club_public_read')return response({revision:snapshot.revision,tables:Object.fromEntries(Object.keys(layout).filter(k=>layout[k].path).map(k=>[k,snapshot.tables[k]]))});
  if(path==='rpc/club_store_read'){reads++;return response(snapshot);}
  if(path==='rpc/club_store_commit'){
   if(conflict){const fn=conflict;conflict=null;fn(snapshot);snapshot.revision++;return new Response(JSON.stringify({message:'storage_revision_conflict'}),{status:409});}
   assert.equal(p.p_expected_revision,snapshot.revision);writes.push(p);
   for(const [name,delta] of Object.entries(p.p_changes)){const key=r=>JSON.stringify(layout[name].key.map(k=>r[k]));const rows=new Map(snapshot.tables[name].map(r=>[key(r),r]));delta.remove.forEach(r=>rows.delete(key(r)));delta.upsert.forEach(r=>rows.set(key(r),r));snapshot.tables[name]=[...rows.values()];}
   snapshot.revision++;return response({revision:snapshot.revision});
  }
  throw new Error('Unexpected request '+path);
 };
 const handler=createHandler({url:'https://example.supabase.co',key:'server-secret',hash,fetcher});
 const call=async(action,payload={},adminToken='',accessToken='')=>{
  const res=await handler(new Request('https://example.supabase.co/functions/v1/club-api',{method:'POST',headers:{'Content-Type':'application/json',...(accessToken?{Authorization:'Bearer '+accessToken}:{})},body:JSON.stringify({action,payload,adminToken})}));return res.json();
 };
 const adminCall=async(action,payload={})=>{const previous=account.role;account.role='admin';try{return await call(action,payload,'','verified');}finally{account.role=previous;}};
 return {call,adminCall,account,writes,uploads,roleWrites,conflictOnNextCommit(fn){conflict=fn;},get snapshot(){return snapshot;},get reads(){return reads;}};
}
test('Public landing data uses only the eight-table projection without private snapshot reads',async()=>{
 const f=await fixture(),out=await f.call('publicData');assert.equal(out.ok,true);assert.equal(Object.keys(out.files).length,8);assert.equal(f.reads,0);assert.ok(!JSON.stringify(out).includes('1980'));assert.ok(!JSON.stringify(out).includes('request_log'));
});
test('Anonymous training writes and forged administrator claims fail before reading private data',async()=>{
 const f=await fixture();assert.equal((await f.call('trainingWeekJoin',{})).ok,false);assert.equal((await f.call('trainingOpen',{dates:['2026-10-24'],role:'admin'},'forged','verified')).ok,false);assert.equal(f.reads,0);assert.equal(f.writes.length,0);
});
test('Verified linked member owns signup, can replace a legacy browser key, and cannot use another name',async()=>{
 const f=await fixture();assert.equal((await f.adminCall('trainingOpen',{dates:['2026-10-24']})).ok,true);
 f.snapshot.tables.weekend_training[0].session_json.participants=[{id:'old',name:'김선수',status:'참석',editHash:'old-browser-secret'}];
 const out=await f.call('trainingWeekJoin',{week:'2026-10-24',name:'김선수',dates:['2026-10-24'],status:'참석',comment:'변경'},'','verified');
 assert.equal(out.ok,true, out.message);assert.equal(out.trainings[0].participants[0].comment,'변경');assert.equal(out.trainings[0].participants[0].editHash,undefined);
 assert.notEqual(f.snapshot.tables.weekend_training[0].session_json.participants[0].editHash,'old-browser-secret');
 assert.equal((await f.call('trainingWeekJoin',{week:'2026-10-24',name:'다른선수',dates:['2026-10-24'],status:'참석'},'','verified')).ok,false);
});
test('Record submission and approval preserve compact audit fields and commit related tables together',async()=>{
 const f=await fixture(),req=await f.call('requestAdd',{memberName:'김선수',eventId:'e1',timeDisplay:'7:30.0',competitionDate:'2026-10-24',competition:'클럽',note:''},'','verified');
 assert.equal(req.ok,true,req.message);assert.equal(Object.keys(f.snapshot.tables.request_log[0]).length,8);
 const approved=await f.adminCall('processAddRequests',{requestIds:[req.requestId]});assert.equal(approved.ok,true,approved.message);assert.equal(f.snapshot.tables.records.length,1);assert.equal(f.snapshot.tables.request_log[0].status,'approved');
 assert.deepEqual(Object.keys(f.writes.at(-1).p_changes).sort(),['records','request_log']);
});
test('Accounts awaiting operator verification cannot sign up, and reads cannot upload files',async()=>{
 const f=await fixture();f.account.player_name=null;assert.equal((await f.call('trainingJoin',{},'','verified')).ok,false);assert.equal(f.reads,0);
 const photo={mimeType:'image/jpeg',base64:Buffer.from([255,216,255,217]).toString('base64')};assert.equal((await f.call('trainingList',{photo})).ok,false);assert.equal(f.uploads.length,0);
});
test('Independent engine contains no Google service calls or source-server credentials',()=>{
 const engine=fs.readFileSync('supabase/functions/club-api/engine.mjs','utf8');assert.doesNotMatch(engine,/UrlFetchApp|SpreadsheetApp|PropertiesService|CacheService|LockService|ContentService|script\.google\.com/);
});
test('Membership selection includes legacy record-only athletes, deduplicates names, and excludes dormant members without exposing years',async()=>{
 const f=await fixture();f.snapshot.tables.records.push({record_id:'legacy',member_name:'기록선수'});f.snapshot.tables.competition_records.push({member_name:'기록선수'},{member_name:'휴면선수'});f.snapshot.tables.dormant_members.push({member_name:'휴면선수'});
 const out=await f.call('memberLinkOptions',{},'','verified');assert.equal(out.ok,true);assert.deepEqual(new Set(out.names),new Set(['김선수','기록선수']));assert.ok(!JSON.stringify(out).includes('1980'));
 f.account.player_name=null;const linked=await f.call('memberLinkRequest',{name:'기록선수'},'','verified');assert.equal(linked.ok,true);assert.equal(f.account.requested_player_name,'기록선수');assert.equal(f.account.role,'member');
 assert.equal((await f.call('memberLinkRequest',{name:'휴면선수'},'','verified')).ok,false);
});
test('Only a verified Kakao administrator can list accounts or change roles; legacy passwords/tokens do not authorize',async()=>{
 const f=await fixture(),target='00000000-0000-0000-0000-000000000002';
 assert.equal((await f.call('adminLogin',{password:'old-password'})).ok,false);
 for(const action of ['memberAccountList','memberAccountRole','trainingOpen']){
  assert.equal((await f.call(action,{userId:target,role:'admin'},'valid-admin')).ok,false);
  assert.equal((await f.call(action,{userId:target,role:'admin'},'valid-admin','verified')).ok,false);
 }
 assert.equal(f.roleWrites.length,0);assert.equal(f.reads,0);
 assert.equal((await f.adminCall('memberAccountList')).accounts.length,1);
 assert.equal((await f.adminCall('memberAccountRole',{userId:target,role:'admin',actorId:'forged'})).ok,true);
 assert.deepEqual(f.roleWrites,[{p_actor_id:f.account.user_id,p_user_id:target,p_role:'admin'}]);
 assert.equal((await f.adminCall('memberAccountRole',{userId:target,role:'owner'})).ok,false);
 assert.equal((await f.call('memberSession',{},'','verified')).member.userId,f.account.user_id);
});
test('Record requester comes from the verified member, survives approval, and stays out of public records',async()=>{
 for(const kind of ['ergo','competition']){
  const f=await fixture();f.account.player_name='등록회원';
  const payload=kind==='ergo'?{memberName:'김선수',eventId:'e1',timeDisplay:'7:30.0',competitionDate:'2026-10-24',competition:'클럽'}:{memberName:'김선수',competitionName:'클럽대회',competitionEventName:'4X+',competitionDivisionName:'200미만',year:2026,competitionType:'water',gold:0,silver:0,bronze:0};
  payload.__club_requester={user_id:'forged',name:'위조 요청자'};
  const created=await f.call(kind==='ergo'?'requestAdd':'requestCompetitionAdd',payload,'','verified');assert.equal(created.ok,true,created.message);
  const audit=()=>JSON.parse(f.snapshot.tables.request_log.find(r=>r.request_id===created.requestId).source_json).__club_requester;
  assert.deepEqual(audit(),{user_id:f.account.user_id,name:'등록회원'});
  const view=kind==='ergo'?'add':'competition-add',pending=await f.adminCall('adminList',{view});
  assert.equal(pending.requests[0].requester_name,'등록회원');assert.equal(pending.requests[0].member_name,'김선수');
  assert.equal((await f.call('adminList',{view},'','verified')).ok,false);
  const approved=await f.adminCall(kind==='ergo'?'processAddRequests':'processCompetitionAddRequests',{requestIds:[created.requestId]});assert.equal(approved.ok,true,approved.message);
  assert.equal(audit().name,'등록회원');assert.equal((await f.adminCall('adminList',{view:'history'})).requests[0].requester_name,'등록회원');
  const publicData=await f.call('publicData');assert.doesNotMatch(JSON.stringify(publicData),/__club_requester|등록회원|requester_name/);
  const row=f.snapshot.tables.request_log[0],legacy=JSON.parse(row.source_json);delete legacy.__club_requester;row.source_json=JSON.stringify(legacy);
  assert.equal((await f.adminCall('adminList',{view:'history'})).requests[0].requester_name,'');
 }
});
test('Seat API is private, owns reservations, publishes through admin confirmation, and redacts legacy public views',async()=>{
 const f=await fixture();assert.equal((await f.call('trainingSeats')).ok,false);assert.equal(f.reads,0);
 await f.adminCall('trainingOpen',{dates:['2026-10-31']});
 const claim={date:'2026-10-31',boatId:'1X-1',index:0};
 assert.equal((await f.call('trainingBoatAdd',{date:claim.date,type:'1X'},'','verified')).ok,true);
 const selected=await f.call('trainingSeatSelect',claim,'','verified');assert.equal(selected.ok,true,selected.message);assert.equal(selected.training.boats[0].seats[0].mine,true);assert.deepEqual(selected.training.attendees,['김선수']);assert.doesNotMatch(JSON.stringify(selected.training.boats),/김선수|editHash|player_name/);
 assert.equal((await f.call('trainingSeatConfirm',{date:claim.date},'','verified')).ok,false);
 const confirmed=await f.adminCall('trainingSeatConfirm',{date:claim.date});assert.equal(confirmed.ok,true,confirmed.message);assert.equal(confirmed.training.boats[0].seats[0].name,'김선수');
 assert.equal((await f.call('trainingSeatSelect',claim,'','verified')).ok,false);
 for(const action of ['trainingRoster','trainingGet']){const read=await f.call(action,{date:claim.date});assert.equal(read.ok,true,read.message);assert.doesNotMatch(JSON.stringify(read),/김선수|editHash|seatBooking/);}
 assert.equal((await f.call('trainingWeekJoin',{week:claim.date,dates:[claim.date],status:'참석'},'','verified')).ok,false);
});
test('Concurrent seat claims retry against fresh data and never overwrite the winning reservation',async()=>{
 const f=await fixture();await f.adminCall('trainingOpen',{dates:['2026-10-31']});await f.call('trainingBoatAdd',{date:'2026-10-31',type:'1X'},'','verified');
 f.conflictOnNextCommit(snapshot=>{const t=snapshot.tables.weekend_training[0].session_json;t.participants.push({id:'winner',name:'먼저신청',status:'참석'});t.seatBooking.boats[0].seats[0].memberId='winner';});
 const result=await f.call('trainingSeatSelect',{date:'2026-10-31',boatId:'1X-1',index:0},'','verified');assert.equal(result.ok,false);assert.match(result.message,/먼저 선택/);
 const t=f.snapshot.tables.weekend_training[0].session_json;assert.equal(t.seatBooking.boats[0].seats[0].memberId,'winner');assert.equal(t.participants.length,1);
});

test('Only administrators create members; one-row commits feed signup options and reject duplicates',async()=>{
 const f=await fixture(),payload={memberName:' 새회원 ',birthYear:'1995',joinYear:'2026'};
 assert.equal((await f.call('memberCreate',payload)).ok,false);
 assert.equal((await f.call('memberCreate',payload,'','verified')).ok,false);assert.equal(f.writes.length,0);
 const out=await f.adminCall('memberCreate',payload);assert.equal(out.ok,true,out.message);assert.deepEqual(out.player,{memberName:'새회원',birthYear:'1995',joinYear:'2026'});
 assert.deepEqual(Object.keys(f.writes[0].p_changes),['player_birth_years']);assert.equal(f.writes[0].p_changes.player_birth_years.upsert.length,1);
 assert.equal((await f.call('memberLinkOptions',{},'','verified')).names.includes('새회원'),true);
 const listed=await f.adminCall('adminList',{view:'player-birth-years'});assert.equal(listed.players.some(p=>p.memberName==='새회원'),true);
 assert.equal((await f.adminCall('memberCreate',payload)).ok,false);assert.equal(f.writes.length,1);
});
test('Member creation allows missing years, rejects invalid values and preserves concurrent data',async()=>{
 const f=await fixture();
 for(const payload of [{memberName:''},{memberName:'x'.repeat(31)},{memberName:'a\nb'},{memberName:'새회원',birthYear:'1899'},{memberName:'새회원',joinYear:'9999'},{memberName:'새회원',birthYear:'1990.5'},{memberName:'김선수'}])assert.equal((await f.adminCall('memberCreate',payload)).ok,false);
 assert.equal(f.writes.length,0);
 assert.equal((await f.adminCall('memberCreate',{memberName:'연도미입력'})).ok,true);
 assert.equal(f.snapshot.tables.player_birth_years.find(p=>p.member_name==='연도미입력').birth_year,'');
 f.conflictOnNextCommit(snapshot=>snapshot.tables.player_birth_years.push({member_name:'동시등록',birth_year:'1991',join_year:'2026',updated_at:''}));
 assert.equal((await f.adminCall('memberCreate',{memberName:'동시등록'})).ok,false);
 assert.equal(f.snapshot.tables.player_birth_years.filter(p=>p.member_name==='동시등록').length,1);
});

test('New applicants submit private birth/join years without entering the member catalog before approval',async()=>{
 const f=await fixture();f.account.player_name=null;
 const request=await f.call('memberLinkRequest',{name:' 신규회원 ',birthYear:'1984',joinYear:'2013'},'','verified');
 assert.equal(request.ok,true,request.message);assert.equal(f.account.requested_player_name,'신규회원');assert.equal(f.account.requested_birth_year,1984);assert.equal(f.account.requested_join_year,2013);
 assert.equal(f.snapshot.tables.player_birth_years.some(p=>p.member_name==='신규회원'),false);assert.equal(f.writes.length,0);
 assert.equal((await f.call('trainingJoin',{},'','verified')).ok,false);
 assert.equal((await f.call('memberAccountList',{},'','verified')).ok,false);
 await f.adminCall('memberLinkReject',{userId:f.account.user_id,name:'신규회원'});assert.equal(f.account.requested_player_name,null);assert.equal(f.account.requested_birth_year,null);assert.equal(f.account.requested_join_year,null);
});
test('New signup validates names and both years, while existing members never overwrite catalog years',async()=>{
 const f=await fixture();f.account.player_name=null;
 for(const payload of [{name:''},{name:'x'.repeat(31)},{name:'a\nb',birthYear:1984,joinYear:2013},{name:'신규회원'},{name:'신규회원',birthYear:'1899',joinYear:'2013'},{name:'신규회원',birthYear:'1984',joinYear:'9999'},{name:'신규회원',birthYear:'2013',joinYear:'1984'}])assert.equal((await f.call('memberLinkRequest',payload,'','verified')).ok,false);
 assert.equal(f.account.requested_player_name,null);
 const existing=await f.call('memberLinkRequest',{name:'김선수',birthYear:1900,joinYear:1901},'','verified');assert.equal(existing.ok,true);assert.equal(f.account.requested_birth_year,null);assert.equal(f.account.requested_join_year,null);assert.equal(f.snapshot.tables.player_birth_years[0].birth_year,'1980');
});

test('Coach flags are administrator-only, persist separately from year edits, and can be removed',async()=>{
 const f=await fixture();
 assert.equal((await f.call('memberCoachSet',{memberName:'김선수',isCoach:true})).ok,false);
 assert.equal((await f.call('memberCoachSet',{memberName:'김선수',isCoach:true},'','verified')).ok,false);
 for(const payload of [{memberName:'없는회원',isCoach:true},{memberName:'김선수',isCoach:'true'},{memberName:'',isCoach:false}])assert.equal((await f.adminCall('memberCoachSet',payload)).ok,false);
 const saved=await f.adminCall('memberCoachSet',{memberName:'김선수',isCoach:true});assert.equal(saved.ok,true,saved.message);assert.equal(saved.isCoach,true);
 let list=await f.adminCall('adminList',{view:'player-birth-years'});assert.equal(list.players.find(p=>p.memberName==='김선수').isCoach,true);
 await f.adminCall('savePlayerBirthYears',{players:[{memberName:'김선수',joinYear:'2024'}]});
 list=await f.adminCall('adminList',{view:'player-birth-years'});assert.equal(list.players.find(p=>p.memberName==='김선수').isCoach,true);assert.equal(list.players.find(p=>p.memberName==='김선수').joinYear,'2024');
 assert.equal((await f.adminCall('memberCoachSet',{memberName:'김선수',isCoach:false})).ok,true);
 list=await f.adminCall('adminList',{view:'player-birth-years'});assert.equal(list.players.find(p=>p.memberName==='김선수').isCoach,false);
 const published=await f.call('publicData');assert.ok(!JSON.stringify(published).includes('isCoach'));
});
