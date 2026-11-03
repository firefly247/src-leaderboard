const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const hash=v=>createHash('sha256').update(v).digest();
function browserFixture({admin=true,permission='granted'}={}){
 const elements={},events={},calls=[],order=[];let sub=null;
 const element=id=>elements[id]??={hidden:false,disabled:false,textContent:'',addEventListener:(name,handler)=>elements[id][name]=handler};
 const registration={pushManager:{getSubscription:async()=>sub,subscribe:async options=>{order.push('subscribe');assert.equal(options.userVisibleOnly,true);sub={endpoint:'https://fcm.googleapis.com/a',unsubscribe:async()=>{sub=null;return true;}};return sub;}}};
 const window={isSecureContext:true,PushManager:{},ClubMembership:{member:admin?{role:'admin',userId:'a'}:null},ClubApi:{call:async(action,payload)=>{calls.push({action,payload});return action==='adminPushConfig'?{publicKey:Buffer.alloc(65).toString('base64url')}:{subscribed:true};}}};
 const Notification={permission:'default',requestPermission:async()=>{order.push('permission');return permission;}};window.Notification=Notification;
 vm.runInNewContext(fs.readFileSync('static/admin-push.js','utf8'),{window,document:{querySelector:element,addEventListener:(name,handler)=>events[name]=handler},navigator:{userAgent:'Android',serviceWorker:{register:async()=>registration,getRegistration:async()=>null,ready:Promise.resolve(registration)}},Notification,location:{href:'https://example.com/club/#home'},matchMedia:()=>({matches:false}),URL,Uint8Array,atob});
 return {elements,calls,events,order,window};
}
test('Admin enables notifications by an explicit click before testing their own device; logout unsubscribes',async()=>{
 const f=browserFixture();await new Promise(setImmediate);assert.equal(f.calls.length,0);assert.equal(f.elements['#adminPushTest'].disabled,true);
 await f.elements['#adminPushEnable'].click();assert.deepEqual(f.order,['permission','subscribe']);assert.equal(f.elements['#adminPushTest'].disabled,false);
 await f.elements['#adminPushTest'].click();assert.equal(f.calls.at(-1).action,'adminPushTest');assert.equal(f.calls.at(-1).payload.endpoint,'https://fcm.googleapis.com/a');
 await f.window.ClubPush.disable();assert.equal(f.calls.at(-1).action,'adminPushDisable');
});
test('Non-admins never prompt for notification permission or register a device; denied permission makes no API writes',async()=>{
 const member=browserFixture({admin:false});await member.elements['#adminPushEnable'].click();assert.equal(member.elements['#adminPushSettings'].hidden,true);assert.equal(member.calls.length,0);assert.equal(member.order.length,0);
 const denied=browserFixture({permission:'denied'});await denied.elements['#adminPushEnable'].click();assert.deepEqual(denied.order,['permission']);assert.equal(denied.calls.length,0);assert.equal(denied.elements['#adminPushTest'].disabled,true);
});
test('Push endpoint validation rejects SSRF, non-HTTPS, ports, credentials and redirects',async()=>{
 const {pushEndpoint,sendWebPush,generatePushKeys}=await import('../supabase/functions/club-api/push.mjs');
 for(const value of ['http://fcm.googleapis.com/a','https://localhost/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/a','https://user:pass@web.push.apple.com/a','https://web.push.apple.com:444/a','https://web.push.apple.com/a#fragment'])assert.throws(()=>pushEndpoint(value));
 assert.equal(pushEndpoint('https://web.push.apple.com/test'),'https://web.push.apple.com/test');
 let captured;const keys=await generatePushKeys();await sendWebPush('https://fcm.googleapis.com/test',keys,{fetcher:async(u,o)=>{captured=o;return new Response('',{status:201});}});assert.equal(captured.redirect,'error');assert.equal(captured.body,undefined);
});
test('Web Push VAPID JWT has a verifiable signature, correct audience and no private key in request',async()=>{
 const {generatePushKeys,sendWebPush}=await import('../supabase/functions/club-api/push.mjs'),keys=await generatePushKeys();let header;
 const result=await sendWebPush('https://web.push.apple.com/test',keys,{fetcher:async(u,o)=>{header=o.headers.Authorization;assert.equal(o.headers.TTL,'300');return new Response('',{status:201});}});
 assert.equal(result.sent,true);const match=header.match(/^vapid t=([^,]+), k=(.+)$/),parts=match[1].split('.'),body=JSON.parse(Buffer.from(parts[1],'base64url'));
 assert.equal(body.aud,'https://web.push.apple.com');assert.ok(body.exp>Date.now()/1000&&body.exp<Date.now()/1000+86400);assert.equal(match[2],keys.public_key);assert.ok(!header.includes(keys.private_jwk.d));
 const key=await crypto.subtle.importKey('raw',Buffer.from(keys.public_key,'base64url'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,Buffer.from(parts[2],'base64url'),new TextEncoder().encode(parts.slice(0,2).join('.'))),true);
});
test('Self-test selects only the current admin device and removes expired subscriptions',async()=>{
 const {createPush}=await import('../supabase/functions/club-api/push.mjs');let expired=false;const calls=[],sent=[];
 const rest=async(path,p,method)=>{calls.push({path,p,method});if(path.startsWith('club_push_keys?'))return [{public_key:'public',private_jwk:{}}];if(method==='GET'&&path.includes('user_id=eq.admin-a'))return [{endpoint_hash:'hash',endpoint:'https://fcm.googleapis.com/a'}];if(method==='GET')return [];};
 const push=createPush({rest,hash,send:async(endpoint)=>{sent.push(endpoint);return {sent:!expired,expired};}});
 await assert.rejects(()=>push.dispatch('adminPushTest',{endpoint:'https://fcm.googleapis.com/a'},{user_id:'admin-b'}),/먼저 알림/);assert.equal(sent.length,0);
 assert.equal((await push.dispatch('adminPushTest',{endpoint:'https://fcm.googleapis.com/a'},{user_id:'admin-a'})).sent,true);assert.equal(sent.length,1);
 expired=true;await assert.rejects(()=>push.dispatch('adminPushTest',{endpoint:'https://fcm.googleapis.com/a'},{user_id:'admin-a'}),/만료/);assert.ok(calls.some(c=>c.method==='DELETE'));
});
test('Broadcasts recheck admin roles and notification failures do not fail membership operations',async()=>{
 const {createPush}=await import('../supabase/functions/club-api/push.mjs');const sent=[];let fail=false;
 const push=createPush({hash,rest:async(path)=>{if(fail)throw new Error('outage');if(path.startsWith('club_push_keys?'))return [{public_key:'p',private_jwk:{}}];assert.match(path,/club_accounts!inner\(role\).*club_accounts.role=eq.admin/);return [{endpoint_hash:'a',endpoint:'https://fcm.googleapis.com/a'}];},send:async endpoint=>{sent.push(endpoint);return {sent:true};}});
 await push.notifyAdmins();assert.equal(sent.length,1);fail=true;await assert.doesNotReject(()=>push.notifyAdmins());
});
test('Push service worker always shows a generic notification and opens only the club admin page',async()=>{
 const listeners={},shown=[];let opened;const self={registration:{scope:'https://example.com/club/',showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>{opened=url;}},addEventListener:(name,fn)=>listeners[name]=fn};
 vm.runInNewContext(fs.readFileSync('push-worker.js','utf8'),{self,URL});let pending;listeners.push({data:{text:()=>'<private member name>'},waitUntil:p=>pending=p});await pending;
 assert.equal(shown.length,1);assert.ok(!JSON.stringify(shown).includes('private member'));
 listeners.notificationclick({notification:{close(){},data:{url:'https://evil.test/'}},waitUntil:p=>pending=p});await pending;assert.equal(opened,'https://example.com/club/#admin');
});
