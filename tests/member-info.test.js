const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('static/leaderboard.js','utf8');
function client(document={querySelector:()=>({}),querySelectorAll:()=>[]}){const ctx=vm.createContext({document,sessionStorage:{getItem:()=>''}});vm.runInContext(source.slice(0,source.indexOf('document.querySelectorAll(".tab-button")')),ctx);return ctx;}
test('Member info combines reference years and every Kakao account without duplicating editable members',()=>{
 const ctx=client(),container={},players=[{memberName:'김회원',birthYear:'1980',joinYear:'2023'},{memberName:'기존회원',birthYear:'',joinYear:''}],accounts=[{user_id:'pending',requested_player_name:'김회원',display_name:'신청자',role:'member'},{user_id:'admin',player_name:'김회원',display_name:'<관리자>',role:'admin'},{user_id:'unnamed',display_name:'새 계정',role:'member'}];
 ctx.renderBirthYearAdmin(container,players,true,true,accounts);
 const table=container.innerHTML.slice(container.innerHTML.indexOf('class="admin-table birth-year-table'));
 const headers=[...table.matchAll(/<th>([^<]+)<\/th>/g)].map(m=>m[1]);assert.deepEqual(headers,['회원 이름','출생연도','가입연도','휴면회원','카카오 닉네임','가입 상태','관리자']);
 assert.equal((table.match(/data-birth-year-name="김회원"/g)||[]).length,1);
 assert.match(table,/&lt;관리자&gt;/);assert.doesNotMatch(table,/<관리자>/);assert.match(table,/data-account-user="admin"[^>]*checked[^>]*disabled/);
 assert.match(table,/data-approve-user="pending"/);assert.match(table,/data-account-only-name="이름 미입력"/);assert.match(table,/미가입/);
 assert.equal((table.match(/data-account-user=/g)||[]).length,3);
 const html=fs.readFileSync('index.html','utf8');assert.match(html,/data-admin-view="member-info">회원 정보/);assert.doesNotMatch(html,/data-admin-view="member-accounts"|data-admin-view="player-birth-years"/);assert.doesNotMatch(html.slice(html.indexOf('data-panel="ergo"')),/선수/);
});
test('Member account reload restores only unsaved year/dormancy changes and search without changing baselines',()=>{
 const makeRow=()=>({dataset:{birthYearName:'김회원',savedBirthYear:'1980',savedJoinYear:'2023',savedDormant:'false'},fields:{'.birth-year-input':{value:'1980'},'.join-year-input':{value:'2023'},'.player-dormant-input':{checked:false}},querySelector(s){return this.fields[s];}});
 let row=makeRow();const search={value:'김'},form={querySelectorAll:()=>[row]};
 const ctx=client({querySelector:s=>s==='#birthYearBatchForm'?form:s==='#birthYearSearch'?search:{},querySelectorAll:()=>[row]});
 row.fields['.birth-year-input'].value='1981';row.fields['.join-year-input'].value='';row.fields['.player-dormant-input'].checked=true;
 const draft=ctx.captureMemberInfoDraft();row=makeRow();search.value='';ctx.updatePlayerYearDirtyState=r=>r.dirty=true;ctx.updatePlayerYearSaveState=()=>{};ctx.restoreMemberInfoDraft(draft);
 assert.equal(row.fields['.birth-year-input'].value,'1981');assert.equal(row.fields['.join-year-input'].value,'');assert.equal(row.fields['.player-dormant-input'].checked,true);assert.equal(row.dataset.savedBirthYear,'1980');assert.equal(row.dataset.savedJoinYear,'2023');assert.equal(row.dirty,true);assert.equal(search.value,'김');assert.equal(row.hidden,false);
});
