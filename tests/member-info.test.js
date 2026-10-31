const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('static/leaderboard.js','utf8');
function client(document={querySelector:()=>({}),querySelectorAll:()=>[]}){const ctx=vm.createContext({document,sessionStorage:{getItem:()=>''}});vm.runInContext(source.slice(0,source.indexOf('document.querySelectorAll(".tab-button")')),ctx);return ctx;}
test('Member info combines reference years and every Kakao account without duplicating editable members',()=>{
 const ctx=client(),container={},players=[{memberName:'김회원',birthYear:'1980',joinYear:'2023'},{memberName:'기존회원',birthYear:'',joinYear:''}],accounts=[{user_id:'pending',requested_player_name:'김회원',display_name:'신청자',role:'member'},{user_id:'admin',player_name:'김회원',display_name:'<관리자>',role:'admin'},{user_id:'unnamed',display_name:'새 계정',role:'member'}];
 ctx.renderBirthYearAdmin(container,players,true,true,accounts);
 const table=container.innerHTML.slice(container.innerHTML.indexOf('class="admin-table birth-year-table'));
 const headers=[...table.matchAll(/<th>([\s\S]*?)<\/th>/g)].map(m=>m[1].replace(/<br\s*\/?>/g,' '));assert.deepEqual(headers,['회원 이름','출생연도','가입연도','휴면회원','코치','카카오 닉네임','가입 상태','관리자']);
 assert.equal((table.match(/data-birth-year-name="김회원"/g)||[]).length,1);
 assert.match(table,/&lt;관리자&gt;/);assert.doesNotMatch(table,/<관리자>/);assert.match(table,/data-account-user="admin"[^>]*checked[^>]*disabled/);
 assert.match(container.innerHTML,/data-approve-user="pending"/);assert.doesNotMatch(table,/data-approve-user|data-reject-user/);assert.match(table,/data-account-only-name="이름 미입력"/);assert.match(table,/미가입/);
 assert.equal((table.match(/data-account-user=/g)||[]).length,2);
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

test('Adding a member inserts only the new row and keeps the current editable table',async()=>{
 const ctx=client(),existing={dataset:{birthYearName:'기존회원',savedJoinYear:'2023'},input:{value:'1991'}},added={dataset:{birthYearName:'새회원',savedJoinYear:'2026'}},rows=[existing];
 const body={querySelector:()=>null,prepend:row=>rows.unshift(row),querySelectorAll:()=>rows},summary={innerHTML:''},search={value:''},button={disabled:false},message={classList:{remove(){},add(){}},textContent:''};
 const form={isConnected:true,reportValidity:()=>true,querySelector:s=>s==='button[type="submit"]'?button:message,reset(){this.resetCalled=true;}};
 ctx.FormData=class{*[Symbol.iterator](){yield ['memberName','새회원'];yield ['birthYear','1995'];yield ['joinYear','2026'];}};
 ctx.document={querySelector:s=>({'#birthYearBatchForm tbody':body,'#playerJoinYearSummary':summary,'#birthYearSearch':search}[s]),createElement:()=>({querySelector:()=>added})};
 ctx.renderBirthYearAdmin=()=>{};ctx.filterMemberInfo=()=>{};ctx.api=async(action,payload)=>{assert.equal(action,'memberCreate');assert.equal(payload.memberName,'새회원');return {player:{memberName:'새회원',birthYear:'1995',joinYear:'2026'}};};
 vm.runInContext("state.adminUserId='actor'",ctx);await ctx.addClubMember(form);
 assert.equal(rows[0],added);assert.equal(rows[1],existing);assert.equal(existing.input.value,'1991');assert.equal(button.disabled,false);assert.equal(form.resetCalled,true);assert.match(message.textContent,/새회원/);
});

test('New membership requests display submitted years for administrator review',()=>{
 const ctx=client(),container={};ctx.renderBirthYearAdmin(container,[],true,true,[{user_id:'new',requested_player_name:'신규회원',requested_birth_year:1984,requested_join_year:2013,display_name:'닉네임',role:'member'}]);
 assert.match(container.innerHTML,/<td>신규회원<\/td><td>1984<\/td><td>2013<\/td>/);assert.match(container.innerHTML,/data-approve-user="new"/);
});

test('Approving a new applicant appends editable fields and removes the pending request without reloading',async()=>{
 const ctx=client(),player={memberName:'신규회원',birthYear:'1984',joinYear:'2013'},account={user_id:'new',player_name:'신규회원',role:'member'},editable={dataset:{birthYearName:'신규회원',savedJoinYear:'2013'}},requests={innerHTML:'old request'};let appended=false,summaryUpdates=0;
 const body={querySelector:()=>null,append(value){assert.equal(value,editable);appended=true;},querySelectorAll:()=>[]};
 ctx.api=async action=>action==='memberAccountList'?{accounts:[account]}:{players:[player]};ctx.renderBirthYearAdmin=()=>{};ctx.document.createElement=()=>({querySelector:()=>editable});ctx.updateMemberJoinSummary=()=>summaryUpdates++;
 const container={querySelector:selector=>selector==='#birthYearBatchForm tbody'?body:selector==='#memberJoinRequests'?requests:null,querySelectorAll:()=>[]};
 await ctx.refreshMemberAccountCells(container,()=>true);assert.equal(appended,true);assert.equal(summaryUpdates,1);assert.match(requests.innerHTML,/대기 중인 가입 요청이 없습니다/);
});

test('Coach members stay editable but are excluded from join-year columns and totals',()=>{
 const ctx=client(),container={},players=[{memberName:'코치회원',birthYear:'1980',joinYear:'2013',isCoach:true},{memberName:'일반회원',birthYear:'1990',joinYear:'2026'}];
 const summary=ctx.playerJoinYearSummaryHtml(players);assert.match(summary,/총 1명/);assert.match(summary,/일반회원/);assert.doesNotMatch(summary,/코치회원|2013년/);
 ctx.renderBirthYearAdmin(container,players,true,true);assert.match(container.innerHTML,/aria-label="코치회원 코치" checked/);assert.match(container.innerHTML,/data-birth-year-name="코치회원"/);
});
test('Coach checkbox updates the summary without reloading, persists, and rolls back failed saves',async()=>{
 const ctx=client(),row={dataset:{birthYearName:'회원',savedCoach:'false'}},input={dataset:{},checked:true,disabled:false,closest:()=>row};let summaries=0;
 vm.runInContext("state.adminUserId='actor'",ctx);ctx.updateMemberJoinSummary=()=>summaries++;ctx.api=async(action,payload)=>{assert.equal(action,'memberCoachSet');return {memberName:payload.memberName,isCoach:payload.isCoach};};
 await ctx.saveMemberCoach(input);assert.equal(row.dataset.savedCoach,'true');assert.equal(input.disabled,false);assert.equal(summaries,2);
 const alerts=[];ctx.alert=message=>alerts.push(message);ctx.api=async()=>{throw new Error('연결 실패');};input.checked=false;
 await ctx.saveMemberCoach(input);assert.equal(input.checked,true);assert.equal(row.dataset.savedCoach,'true');assert.equal(input.disabled,false);assert.deepEqual(alerts,['연결 실패']);
});

test('Pending applicants appear above the cohort summary and outside the editable roster',()=>{
 const ctx=client(),container={};ctx.renderBirthYearAdmin(container,[{memberName:'기존회원',birthYear:'1984',joinYear:'2013'}],true,true,[{user_id:'new',requested_player_name:'신규회원',requested_birth_year:1994,requested_join_year:2026,display_name:'새별명',role:'member'},{user_id:'existing',requested_player_name:'기존회원',display_name:'기존별명',role:'member'}]);
 const html=container.innerHTML,requestHtml=html.slice(html.indexOf('id="memberJoinRequests"'),html.indexOf('class="player-join-summary"'));
 assert.match(requestHtml,/<td>신규회원<\/td><td>1994<\/td><td>2026<\/td>/);assert.match(requestHtml,/<td>기존회원<\/td><td>1984<\/td><td>2013<\/td>/);assert.equal((html.match(/data-approve-user=/g)||[]).length,2);
 assert.doesNotMatch(html.slice(html.indexOf('class="admin-table birth-year-table')),/data-account-only-name="신규회원"|data-approve-user/);
});
test('Member information is a top-level admin tab with no reference submenu',()=>{
 const html=fs.readFileSync('index.html','utf8'),tabs=html.match(/<div class="admin-group-tabs"[\s\S]*?<\/div>/)[0],reference=html.match(/data-admin-group-panel="references"[\s\S]*?<\/div>/)[0];
 assert.match(tabs,/data-admin-group="members" data-admin-view="member-info">회원 정보/);assert.doesNotMatch(reference,/member-info/);
 const buttons=['records','references','members'].map(group=>({dataset:{adminGroup:group},classList:{toggle(name,value){this.active=value;}}})),panels=['records','references'].map(group=>({dataset:{adminGroupPanel:group}}));
 const ctx=client({querySelector:()=>({classList:{toggle(){}}}),querySelectorAll:selector=>selector==='[data-admin-group]'?buttons:panels});ctx.showAdminGroup('member-info');assert.equal(buttons[2].classList.active,true);assert.equal(buttons[0].classList.active,false);assert.equal(panels.every(panel=>panel.hidden),true);
});
