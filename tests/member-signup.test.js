const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('static/supabase-member-auth.js','utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(member={nickname:'카카오 별명',playerName:null,requestedPlayerName:null}){
  const calls=[],elements=new Map();let dialog,request=async()=>{};
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
    close(){this.open=false;}
  }
  const ctx={window:{ClubApi:{ready:true,client:{auth:{getSession:async()=>({data:{session:{access_token:'token'}}}),onAuthStateChange(){},signInWithOAuth:async options=>{calls.push({action:typeof options.provider==='string'?'oauth':'invalid',options});return {};},signOut:async()=>({})}},call:async(action,data)=>{calls.push({action,data});if(action==='memberSession')return {member:{...member}};if(action==='memberLinkOptions')return {names:['김기현','이찬희']};if(action==='memberLinkRequest'){await request(data);member.requestedPlayerName=data.name;return {ok:true};}throw new Error('Unexpected action');}}},document:{querySelector:selector=>{if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);},createElement:()=>dialog=new Element(),body:{appendChild(){}},dispatchEvent(){},addEventListener(){}},CustomEvent:class{},setTimeout,URL,location:{href:'https://club.example/'}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,calls,elements,get dialog(){return dialog;},set request(handler){request=handler;},select(name){dialog.querySelector('[data-link-names]').onclick({target:{closest:()=>({dataset:{linkName:name}})}});},submit(){return dialog.querySelector('[data-signup-form]').onsubmit({preventDefault(){}});}};
}
test('First Kakao login opens signup; selecting a name does not save until explicit submission',async()=>{
  const f=fixture();await settle();assert.equal(f.dialog.open,true);assert.match(f.dialog.innerHTML,/회원 가입/);
  f.select('김기현');assert.equal(f.calls.filter(c=>c.action==='memberLinkRequest').length,0);
  assert.equal(f.dialog.querySelector('[data-link-selection]').textContent,'선택한 이름: 김기현');
  await f.submit();assert.equal(f.calls.filter(c=>c.action==='memberLinkRequest').length,1);
  assert.equal(f.ctx.window.ClubMembership.member.requestedPlayerName,'김기현');
  assert.match(f.dialog.innerHTML,/가입 승인 대기/);assert.doesNotMatch(f.dialog.innerHTML,/data-signup-form/);
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
