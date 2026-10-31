const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('static/supabase-member-auth.js','utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(member={nickname:'카카오 별명',playerName:null,requestedPlayerName:null}){
  const calls=[],events=[],elements=new Map();let dialog,request=async()=>{};
  class Element {
    constructor(){this.value='';this.textContent='';this.open=false;this.nodes=new Map();this.buttons=[];}
    set innerHTML(value){this.html=value;this.nodes.clear();}
    get innerHTML(){return this.html;}
    querySelector(selector){
      if(selector==='[data-signup-submit]'&&!this.html?.includes('data-signup-submit'))return null;
      if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector);
    }
    querySelectorAll(){return this.buttons;}
    setAttribute(){}
    showModal(){this.open=true;}
    close(){this.open=false;this.onclose?.();}
  }
  const ctx={window:{ClubApi:{ready:true,client:{auth:{getSession:async()=>({data:{session:{access_token:'token'}}}),onAuthStateChange(){},signInWithOAuth:async options=>{calls.push({action:typeof options.provider==='string'?'oauth':'invalid',options});return {};},signOut:async()=>({})}},call:async(action,data)=>{calls.push({action,data});if(action==='memberSession')return {member:{...member}};if(action==='memberLinkOptions')return {names:['김기현','이찬희']};if(action==='memberLinkRequest'){await request(data);member.requestedPlayerName=data.name;return {ok:true};}throw new Error('Unexpected action');}}},document:{querySelector:selector=>{if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);},createElement:()=>dialog=new Element(),body:{appendChild(){}},dispatchEvent(event){events.push(event);},addEventListener(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},setTimeout,URL,location:{href:'https://club.example/'}};
  ctx.window.setupCompetitionMemberInput=(input,names)=>{input._memberAutocompleteNames=names;};
  ctx.window.closeCompetitionMemberMenu=()=>{};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,calls,events,elements,get dialog(){return dialog;},set request(handler){request=handler;},select(name){const input=dialog.querySelector('[data-link-search]');if(input.disabled)return;input.value=name;input.oninput();},submit(){return dialog.querySelector('[data-signup-form]').onsubmit({preventDefault(){}});}};
}
test('First Kakao login opens signup; selecting a name does not save until explicit submission',async()=>{
  const f=fixture();await settle();assert.equal(f.dialog.open,true);assert.match(f.dialog.innerHTML,/회원 가입/);
  f.select('김기현');assert.equal(f.calls.filter(c=>c.action==='memberLinkRequest').length,0);
  assert.equal(f.dialog.querySelector('[data-link-search]').value,'김기현');
  await f.submit();assert.equal(f.calls.filter(c=>c.action==='memberLinkRequest').length,1);
  assert.equal(f.ctx.window.ClubMembership.member.requestedPlayerName,'김기현');
  assert.match(f.dialog.innerHTML,/가입 승인 대기/);assert.doesNotMatch(f.dialog.innerHTML,/data-signup-form/);
});
test('Signup shows one empty autocomplete input and accepts only complete registered names',async()=>{
  const f=fixture();await settle();
  assert.doesNotMatch(f.dialog.innerHTML,/data-link-names|data-link-selection|김기현|이찬희/);
  const input=f.dialog.querySelector('[data-link-search]'),submit=f.dialog.querySelector('[data-signup-submit]');
  assert.equal(input.value,'');assert.deepEqual(Array.from(input._memberAutocompleteNames),['김기현','이찬희']);
  f.select('김');assert.equal(submit.disabled,true);await f.submit();assert.equal(f.calls.some(c=>c.action==='memberLinkRequest'),false);
  f.select('미등록');await f.submit();assert.equal(f.calls.some(c=>c.action==='memberLinkRequest'),false);
  f.select(' 김기현 ');assert.equal(submit.disabled,false);
  f.select('');assert.equal(submit.disabled,true);
});
test('Signup blocks duplicate submission and selection changes while saving',async()=>{
  const f=fixture();await settle();let finish;f.request=()=>new Promise(resolve=>finish=resolve);
  f.select('김기현');const saving=f.submit();f.select('이찬희');await f.submit();
  assert.equal(f.calls.filter(c=>c.action==='memberLinkRequest').length,1);
  finish();await saving;assert.equal(f.ctx.window.ClubMembership.member.requestedPlayerName,'김기현');
});
test('Failed signup keeps selected name and permits retry',async()=>{
  const f=fixture();await settle();f.select('이찬희');f.request=async()=>{throw new Error('연결 실패');};
  await f.submit();assert.equal(f.dialog.querySelector('[data-link-message]').textContent,'연결 실패');
  assert.equal(f.dialog.querySelector('[data-signup-submit]').disabled,false);
  f.request=async()=>{};await f.submit();assert.equal(f.ctx.window.ClubMembership.member.requestedPlayerName,'이찬희');
});
test('Linked members bypass signup; pending applicants see approval status on their next visit',async()=>{
  const linked=fixture({playerName:'김기현'}),pending=fixture({requestedPlayerName:'이찬희'});await settle();
  assert.equal(linked.dialog.open,false);assert.equal(linked.calls.some(c=>c.action==='memberLinkOptions'),false);
  assert.equal(pending.dialog.open,true);assert.match(pending.dialog.innerHTML,/이찬희님, 가입 신청이 완료/);
  assert.equal(pending.calls.some(c=>c.action==='memberLinkOptions'),false);
});
test('Logging out closes the unfinished signup dialog',async()=>{
  const f=fixture();await settle();await f.elements.get('#memberLogout').onclick();
  assert.equal(f.dialog.open,false);assert.equal(f.ctx.window.ClubMembership.member,null);
});
test('Kakao login overrides default email/photo scopes while preserving the fixed callback',async()=>{
  const f=fixture();await settle();await f.ctx.window.ClubMembership.login();
  const {options}=f.calls.find(c=>c.action==='oauth');
  assert.equal(options.provider,'kakao');
  assert.equal(options.options.queryParams.scope,'profile_nickname');
  assert.equal(options.options.scopes,undefined);
  assert.equal(options.options.redirectTo,'https://club.example/static/auth-callback.html');
});
test('Administrator checkboxes grant and revoke roles; failed saves restore the confirmed checked state',async()=>{
  const f=fixture({userId:'actor',role:'admin',playerName:'장진구'});await settle();
  const accounts=[{user_id:'actor',player_name:'장진구',role:'admin'},{user_id:'target',player_name:'선수',role:'member'}],writes=[],alerts=[];
  let fail=false;f.ctx.alert=message=>alerts.push(message);
  f.ctx.window.api=async(action,payload)=>{if(action==='memberAccountList')return {accounts};if(fail)throw new Error('저장 실패');writes.push(payload);accounts.find(a=>a.user_id===payload.userId).role=payload.role;return {ok:true};};
  const listeners={},container={addEventListener(type,fn){listeners[type]=fn;},removeEventListener(type){delete listeners[type];}};let refreshed=0;
  f.ctx.window.ClubMembership.bindMemberAccounts(container,()=>true,async()=>refreshed++);
  const checkbox={checked:true,disabled:false,dataset:{accountUser:'target',accountRole:'member'}};
  const event={target:{closest:()=>checkbox}};
  await listeners.change(event);assert.equal(writes[0].role,'admin');assert.equal(checkbox.dataset.accountRole,'admin');
  checkbox.disabled=false;checkbox.checked=false;await listeners.change(event);assert.equal(writes[1].role,'member');assert.equal(refreshed,2);
  fail=true;checkbox.disabled=false;checkbox.checked=true;await listeners.change(event);assert.equal(checkbox.checked,false);assert.equal(checkbox.disabled,false);assert.deepEqual(alerts,['저장 실패']);
});

test('Approving a signup updates account cells without refreshing the admin session',async()=>{
  const f=fixture({userId:'actor',role:'admin',playerName:'장진구'});await settle();
  const before=f.calls.filter(call=>call.action==='memberSession').length,writes=[],listeners={};let updates=0;
  f.ctx.window.api=async(action,payload)=>{writes.push({action,payload});return {ok:true};};
  const container={addEventListener(type,fn){listeners[type]=fn;},removeEventListener(){}};
  f.ctx.window.ClubMembership.bindMemberAccounts(container,()=>true,async()=>updates++);
  const selected={disabled:false,dataset:{approveUser:'target',playerName:'김기현'}};
  await listeners.click({target:{closest:()=>selected}});
  assert.equal(writes[0].action,'memberLinkApprove');assert.equal(updates,1);
  assert.equal(f.calls.filter(call=>call.action==='memberSession').length,before);
});
test('Account refresh replaces only the three account cells and leaves member inputs intact',async()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../static/leaderboard.js'),'utf8');
  const fn=source.match(/async function refreshMemberAccountCells\([^\n]*\)\{[\s\S]*?\n\}/)[0];
  const input={value:'1990'},cells=[input,{},{},{}],row={get lastElementChild(){return {remove(){cells.pop();}};},insertAdjacentHTML(position,html){cells.push(html);}};
  const cell={dataset:{memberAccount:'target'},parentElement:row};
  const context=vm.createContext({api:async()=>({accounts:[{user_id:'target',player_name:'김기현',role:'member'}]}),state:{adminUserId:'actor'},memberAccountCellsHtml:account=>account.player_name});
  vm.runInContext(fn,context);
  await context.refreshMemberAccountCells({querySelectorAll:()=>[cell]},()=>true);
  assert.equal(cells[0],input);assert.equal(input.value,'1990');assert.equal(cells[1],'김기현');
});

test('A Kakao session without a submitted member name cannot enter member menus or dismiss signup',async()=>{
 const f=fixture({userId:'new-user',role:'member',playerName:null,requestedPlayerName:null});await settle();
 assert.equal(f.ctx.window.ClubMembership.member,null);assert.equal(f.events.at(-1).detail.member,null);
 assert.doesNotMatch(f.dialog.innerHTML,/data-close-link/);assert.match(f.dialog.innerHTML,/data-cancel-signup/);
 let prevented=false;f.dialog.oncancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);
 f.dialog.close();assert.equal(f.dialog.open,true);
 f.select('');await f.submit();assert.equal(f.calls.some(call=>call.action==='memberLinkRequest'),false);
 f.select('김기현');assert.equal(f.ctx.window.ClubMembership.member,null);
 await f.submit();assert.equal(f.events.at(-1).detail.member.requestedPlayerName,'김기현');
 f.dialog.close();assert.equal(f.dialog.open,false);
});
test('Cancelling unfinished signup signs out, and a failed signout keeps signup required',async()=>{
 const f=fixture();await settle();let signouts=0;
 f.ctx.window.ClubApi.client.auth.signOut=async()=>{signouts++;return {error:new Error('offline')};};
 await f.dialog.querySelector('[data-cancel-signup]').onclick();assert.equal(signouts,1);assert.equal(f.dialog.open,true);assert.equal(f.ctx.window.ClubMembership.member,null);assert.match(f.dialog.querySelector('[data-link-message]').textContent,/로그아웃하지 못했습니다/);
 f.ctx.window.ClubApi.client.auth.signOut=async()=>{signouts++;return {};};
 await f.dialog.querySelector('[data-cancel-signup]').onclick();assert.equal(signouts,2);assert.equal(f.dialog.open,false);assert.equal(f.ctx.window.ClubMembership.member,null);assert.equal(f.events.at(-1).detail.member,null);
});
