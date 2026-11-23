const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('static/supabase-backend.js','utf8');
function fixture(session=null){const calls=[],ctx={window:{CLUB_BACKEND:{url:'https://test.supabase.co',publishableKey:'public-key',ready:true}},SupabaseSDK:{createClient:()=>({auth:{getSession:async()=>({data:{session}})},rpc:async name=>{calls.push({rpc:name});return {data:{tables:Object.fromEntries(['events','records','competitions','competition_events','competition_divisions','competition_records','competition_dates','dormant_members'].map(n=>[n,[]]))}};}})},fetch:async(url,options)=>{calls.push({url,...options});return {ok:true,json:async()=>({ok:true,value:1})};}};vm.createContext(ctx);vm.runInContext(source,ctx);return {ctx,calls,api:ctx.window.ClubApi};}
test('Browser API uses the Kakao session and never transmits legacy administrator tokens',async()=>{const f=fixture({access_token:'verified-user-token'});await f.api.call('trainingCheck',{id:'member'},'admin-session');const call=f.calls[0];assert.ok(call.url.endsWith('/functions/v1/club-api'));assert.equal(call.headers.Authorization,'Bearer verified-user-token');assert.equal(JSON.parse(call.body).adminToken,undefined);assert.doesNotMatch(JSON.stringify(call),/script.google/);});
test('Landing page uses a single public RPC and fails closed without legacy fallback',async()=>{const f=fixture();assert.equal((await f.api.publicFiles()).length,8);assert.deepEqual(f.calls,[{rpc:'club_public_read'}]);f.ctx.SupabaseSDK.createClient=()=>{};f.ctx.fetch=async()=>{throw new Error('offline');};await assert.rejects(()=>f.api.call('trainingList'),/offline/);assert.equal(f.calls.length,1);});
test('OAuth callback returns to the home page for signup without navigating to training or an untrusted return URL',async()=>{const exchanges=[],redirects=[],cleaned=[];const ctx={URL,URLSearchParams,window:{ClubApi:{client:{auth:{exchangeCodeForSession:async code=>{exchanges.push(code);return {};}}}}},document:{querySelector:()=>({textContent:''})},history:{replaceState:(_,__,url)=>cleaned.push(url)},location:{search:'?code=one-time&return=https://attacker.example',pathname:'/src-leaderboard/static/auth-callback.html',href:'https://firefly247.github.io/src-leaderboard/static/auth-callback.html?code=one-time',replace:url=>redirects.push(url)}};ctx.ClubApi=ctx.window.ClubApi;vm.createContext(ctx);await vm.runInContext(fs.readFileSync('static/auth-callback.js','utf8'),ctx);assert.deepEqual(exchanges,['one-time']);assert.deepEqual(redirects,['https://firefly247.github.io/src-leaderboard/']);assert.equal(cleaned.length,1);});
test('Production entry loads the independent auth module and pinned SDK, without legacy callback code',()=>{const html=fs.readFileSync('index.html','utf8');assert.match(html,/vendor\/supabase-2\.118\.0\.js/);assert.match(html,/supabase-member-auth\.js/);assert.doesNotMatch(html,/src="static\/member-auth\.js/);assert.doesNotMatch(fs.readFileSync('static/leaderboard.js','utf8'),/script\.google\.com/);});
test('Kakao login resumes the shared operations post using its UUID on the same site',async()=>{
 const id='12345678-1234-1234-1234-123456789012',home='https://firefly247.github.io/src-leaderboard/';
 const saved=new Map(),redirects=[];
 const ctx={URL,URLSearchParams,window:{ClubApi:{client:{auth:{exchangeCodeForSession:async()=>({})}}}},
  sessionStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
  document:{querySelector:()=>({})},history:{replaceState(){}},location:{search:'?operationsPost='+id,hash:''}};
 ctx.ClubApi=ctx.window.ClubApi;
 vm.createContext(ctx);
 vm.runInContext(fs.readFileSync('static/operations-link.js','utf8'),ctx);
 ctx.window.ClubOperationsLink.remember();
 ctx.location={search:'?code=one-time',href:home+'static/auth-callback.html?code=one-time',replace:url=>redirects.push(url)};
 await vm.runInContext(fs.readFileSync('static/auth-callback.js','utf8'),ctx);
 assert.deepEqual(redirects,[home+'?operationsPost='+id]);
 assert.equal(saved.size,0);
});
