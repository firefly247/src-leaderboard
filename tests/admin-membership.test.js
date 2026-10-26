const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('Administrator navigation follows the verified account role and clears private content on logout',()=>{
 const source=fs.readFileSync('static/leaderboard.js','utf8'),nodes=new Map(),events=[];
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:false,innerHTML:'',classList:{toggle(){}},remove(){}});return nodes.get(selector);};
 const context=vm.createContext({document:{querySelector:node,querySelectorAll:()=>[],dispatchEvent:event=>events.push(event)},sessionStorage:{getItem:()=> 'old-admin-token'},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},location:{hash:''}});
 vm.runInContext(source.slice(0,source.indexOf('document.querySelectorAll(".tab-button")')),context);
 assert.equal(vm.runInContext('state.adminUserId',context),'');
 context.syncMemberAdministrator({detail:{member:{userId:'member',role:'member'}}});assert.equal(node('[data-tab="admin"]').hidden,true);
 context.syncMemberAdministrator({detail:{member:{userId:'admin-id',role:'admin'}}});assert.equal(node('[data-tab="admin"]').hidden,false);assert.equal(node('#adminConsole').hidden,false);
 node('#adminContent').innerHTML='private';context.syncMemberAdministrator({detail:{member:null}});
 assert.equal(node('[data-tab="admin"]').hidden,true);assert.equal(node('#adminConsole').hidden,true);assert.equal(node('#adminContent').innerHTML,'');assert.equal(events.at(-1).detail.enabled,false);
 const html=fs.readFileSync('index.html','utf8');assert.doesNotMatch(html,/id="adminLoginForm"|id="adminLogout"|>기록 관리</);assert.match(html,/>이력 관리</);assert.match(html,/data-admin-view="member-accounts">회원 관리/);
});
