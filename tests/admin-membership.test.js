const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('Administrator navigation follows the verified account role and clears private content on logout',()=>{
 const source=fs.readFileSync('static/leaderboard.js','utf8'),nodes=new Map(),events=[],clicks=[],memberMenus=[{},{}];
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:false,innerHTML:'',classList:{toggle(){},contains(){return false;}},click(){clicks.push(selector);},remove(){}});return nodes.get(selector);};
 const context=vm.createContext({document:{querySelector:node,querySelectorAll:s=>s==='[data-member-menu]'?memberMenus:[],dispatchEvent:event=>events.push(event)},sessionStorage:{getItem:()=> 'old-admin-token'},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},location:{hash:''}});
 vm.runInContext(source.slice(0,source.indexOf('document.querySelectorAll(".tab-button")')),context);
 assert.equal(vm.runInContext('state.adminUserId',context),'');
 assert.equal(context.canOpenClubTab('home'),true);assert.equal(context.canOpenClubTab('ergo'),false);
 context.location.hash='#training';context.syncClubRoute();assert.equal(clicks.at(-1),'[data-tab="home"]');
 context.syncMemberAdministrator({detail:{member:{userId:'member',role:'member'}}});assert.equal(node('[data-tab="admin"]').hidden,true);
 assert.ok(memberMenus.every(m=>m.hidden===false));assert.equal(node('#memberTools').hidden,false);assert.equal(context.canOpenClubTab('competition'),true);assert.equal(context.canOpenClubTab('admin'),false);assert.equal(clicks.at(-1),'[data-tab="training"]');
 context.syncMemberAdministrator({detail:{member:{userId:'admin-id',role:'admin'}}});assert.equal(node('[data-tab="admin"]').hidden,false);assert.equal(node('#adminConsole').hidden,false);
 node('#adminContent').innerHTML='private';context.syncMemberAdministrator({detail:{member:null}});
 assert.equal(node('[data-tab="admin"]').hidden,true);assert.equal(node('#adminConsole').hidden,true);assert.equal(node('#adminContent').innerHTML,'');assert.equal(events.at(-1).detail.enabled,false);
 assert.ok(memberMenus.every(m=>m.hidden===true));assert.equal(node('#memberTools').hidden,true);assert.equal(context.canOpenClubTab('training'),false);assert.equal(clicks.at(-1),'[data-tab="home"]');
 const html=fs.readFileSync('index.html','utf8');assert.doesNotMatch(html,/id="adminLoginForm"|id="adminLogout"|>기록 관리</);assert.match(html,/>이력 관리</);assert.match(html,/data-admin-view="member-info">회원 정보/);
});
