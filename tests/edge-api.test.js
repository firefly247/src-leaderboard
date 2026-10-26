const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const hash=v=>crypto.createHash('sha256').update(v).digest();
const layout=JSON.parse(fs.readFileSync('apps-script/StorageLayout.gs','utf8').match(/var StorageLayout = ([\s\S]*);/)[1]);
const blank=()=>Object.fromEntries(Object.keys(layout).map(k=>[k,[]]));
async function fixture(){
 const {createHandler}=await import('../supabase/functions/club-api/handler.mjs');
 let snapshot={revision:1,tables:blank()},reads=0;const writes=[],uploads=[],roleWrites=[];
 snapshot.tables.events=[{event_id:'e1',event_name:'2000m'}];snapshot.tables.player_birth_years=[{member_name:'김선수',birth_year:'1980',join_year:'2023',updated_at:''}];
 const account={user_id:'00000000-0000-0000-0000-000000000001',player_name:'김선수',requested_player_name:null,role:'member'};
 const response=v=>new Response(v===undefined?'':JSON.stringify(v),{status:200});
 const fetcher=async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return options.headers.Authorization==='Bearer verified'?response({id:account.user_id,identities:[{provider:'kakao'}],user_metadata:{name:'회원',role:'admin'}}):new Response('{}',{status:401});
  if(url.includes('/storage/v1/object/')){uploads.push(url);return response({});}
  const path=url.split('/rest/v1/')[1],p=options.body?JSON.parse(options.body):{};
  if(path==='club_accounts')return response();if(path.startsWith('club_accounts?')){if(options.method==='PATCH')Object.assign(account,p);return response([account]);}
  const table=path.split('?')[0];if(['club_player_birth_years','club_records','club_competition_records','club_dormant_members'].includes(table)){
   const exact=path.match(/member_name=eq\.([^&]+)/)?.[1];return response(snapshot.tables[table.slice(5)].filter(r=>!exact||r.member_name===decodeURIComponent(exact)).map(r=>({member_name:r.member_name})));
  }
  if(path==='rpc/club_account_set_role'){roleWrites.push(p);return response(true);}
  if(path==='rpc/club_api_limit')return response(true);
  if(path==='rpc/club_public_read')return response({revision:snapshot.revision,tables:Object.fromEntries(Object.keys(layout).filter(k=>layout[k].path).map(k=>[k,snapshot.tables[k]]))});
  if(path==='rpc/club_store_read'){reads++;return response(snapshot);}
  if(path==='rpc/club_store_commit'){
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
 return {call,adminCall,account,writes,uploads,roleWrites,get snapshot(){return snapshot;},get reads(){return reads;}};
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
