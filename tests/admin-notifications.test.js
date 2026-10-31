const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {collectNotifications,createNotificationStore}=require('../static/admin-notifications.js');
test('Notifications count pending registration and signup requests, excluding deletions and processed requests',()=>{
 const rows=[{request_id:'a',request_type:'add',status:'pending',member_name:'김회원',event_name:'2000m',requested_at:'2026-11-01T01:00:00Z'},{request_id:'b',request_type:'competition_add',status:'pending',member_name:'박회원',competition_name:'대회',requested_at:'2026-11-01T02:00:00Z'},{request_id:'c',request_type:'delete',status:'pending'},{request_id:'d',request_type:'add',status:'approved'}];
 const links=[{user_id:'new',requested_player_name:'신규회원'},{user_id:'linked',requested_player_name:'기존회원',player_name:'기존회원'},{user_id:'empty'}];
 const items=collectNotifications(rows,links);assert.equal(items.length,3);assert.deepEqual(items.map(i=>i.view),['member-info','competition-add','add']);assert.equal(items[0].name,'신규회원');assert.equal(items[1].detail,'대회');
 assert.deepEqual(collectNotifications(),[]);
});
test('Only verified admin UI sessions fetch notifications, and refreshed counts follow processed requests',async()=>{
 const calls=[];let pending=true;
 const store=createNotificationStore({call:async(action,p)=>{calls.push([action,p]);return action==='adminList'?{requests:pending?[{request_id:'r',request_type:'add',status:'pending'}]:[]}:{links:[]};}});
 await store.setMember(null);await store.setMember({userId:'member',role:'member'});assert.equal(calls.length,0);assert.equal(store.value.enabled,false);
 await store.setMember({userId:'admin',role:'admin'});assert.equal(store.value.enabled,true);assert.equal(store.value.items.length,1);assert.deepEqual(calls.map(c=>c[0]),['adminList','memberLinkList']);assert.equal(calls[0][1].view,'pending');
 pending=false;await store.refresh();assert.equal(store.value.items.length,0);
 await store.setMember(null);assert.equal(store.value.enabled,false);assert.deepEqual(store.value.items,[]);
});
test('Logout or role loss discards delayed private notification responses',async()=>{
 const resolvers=[];const store=createNotificationStore({call:()=>new Promise(resolve=>resolvers.push(resolve))});
 const fetch=store.setMember({userId:'admin',role:'admin'});assert.equal(store.value.loading,true);
 await store.setMember({userId:'admin',role:'member'});
 resolvers[0]({requests:[{request_id:'secret',request_type:'add',status:'pending',member_name:'비공개회원'}]});resolvers[1]({links:[]});await fetch;
 assert.equal(store.value.enabled,false);assert.equal(store.value.loading,false);assert.equal(store.value.items.length,0);
});
test('Notification errors can be retried without retaining a loading lock',async()=>{
 let failed=true;const store=createNotificationStore({call:async action=>{if(failed)throw new Error('연결 실패');return action==='adminList'?{requests:[]}:{links:[]};}});
 await store.setMember({userId:'admin',role:'admin'});assert.equal(store.value.error,'연결 실패');assert.equal(store.value.loading,false);
 failed=false;await store.refresh();assert.equal(store.value.error,'');assert.equal(store.value.loading,false);
});
test('Notification destinations open the matching admin group directly and protected markup starts hidden',()=>{
 const source=fs.readFileSync('static/leaderboard.js','utf8'),html=fs.readFileSync('index.html','utf8'),opened=[];
 const context=vm.createContext({canOpenClubTab:()=>true,setHeaderMenuOpen(){},document:{querySelectorAll:()=>[]},history:{replaceState(){}},loadAdmin:view=>opened.push(view)});
 vm.runInContext(source.match(/function openClubTab\([^\n]*\)\{[\s\S]*?\n\}/)[0],context);
 context.openClubTab('admin','member-info');context.openClubTab('admin','competition-add');context.openClubTab('admin');assert.deepEqual(opened,['member-info','competition-add','add']);
 assert.match(html,/id="adminNotifications"[^>]*hidden/);assert.match(html,/id="adminNotificationPanel"[^>]*hidden/);
});
