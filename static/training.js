/* Weekend training: server-owned openings, joining-year seniority, button controls. */
(() => {
  'use strict';
  const panel=document.createElement('section');panel.className='tab-panel';panel.dataset.panel='training';
  panel.innerHTML=`<section class="competition-hero"><div><p class="eyebrow">WEEKEND ROWING</p><h1>주말 훈련 <small>Beta</small></h1><p>참가 신청부터 크루 확인, 당일 출석까지</p></div></section><div class="training-shell">
    <section id="trainingOpening" class="panel" hidden><h2>이번 주 훈련 개설</h2><div class="training-week-nav"><button type="button" data-action="previousWeek">← 이전 주</button><strong id="trainingWeekLabel"></strong><button type="button" data-action="nextWeek">다음 주 →</button></div><div id="trainingOpenDates" class="training-day-buttons"></div><button type="button" class="primary-button" data-action="open" aria-describedby="trainingOpenHint">선택한 날짜 개설</button><p id="trainingOpenHint" class="form-description" role="status"></p><p class="form-description">개설한 날짜만 회원에게 표시됩니다. 기존 날짜의 신청과 편성은 유지됩니다.</p></section>
    <div id="trainingBrowseDates"><div class="training-date-heading"><h2>개설된 훈련</h2><button type="button" class="secondary-button" data-action="reload">새로고침</button></div><div id="trainingDates" class="training-day-buttons" aria-label="개설된 훈련 날짜"></div><p id="trainingNoDates" class="form-description">아직 개설된 훈련이 없습니다.</p></div>
    <div class="training-tabs" aria-label="훈련 메뉴"><button type="button" data-view="join" class="is-active">참가 신청</button><button type="button" data-view="list">참가 명단</button><button type="button" data-view="crew">크루 편성</button></div><p id="trainingMessage" role="status" aria-live="polite"></p>
    <section data-screen="join" class="panel"><div id="trainingMemberGate"><p>참가 신청은 카카오 로그인 후 이용할 수 있습니다.</p><button type="button" class="primary-button" data-member-login>카카오 로그인</button><button type="button" data-member-link hidden>선수 연결 확인</button></div><form id="trainingJoinForm"><fieldset id="trainingFormFields" disabled><label>이름<input name="name" maxlength="30" autocomplete="off" required placeholder="회원 이름"></label>
    <fieldset class="training-choice"><legend>참가 여부</legend><div id="trainingParticipation" class="training-buttons" aria-label="이번 주 참가 여부"></div><p id="trainingSignupHint" class="form-description"></p></fieldset>
    <label>코멘트<textarea name="comment" maxlength="1000" rows="4" placeholder="전달할 내용을 자유롭게 입력해 주세요."></textarea></label><button type="submit" class="primary-button">참가 신청</button></fieldset></form></section>
    <section data-screen="list" hidden><div class="panel"><div class="section-heading"><h2>참가 명단</h2><strong id="trainingListCount"></strong></div><div id="trainingRoster"></div><div id="trainingOperator" hidden><p class="form-description">추천 조합을 수정한 뒤 편성 공개 버튼을 누르세요.</p></div><p id="trainingAdminHint" class="form-description">추천 편성은 관리자 로그인 후 사용할 수 있습니다.</p></div></section>
    <section data-screen="crew" hidden><div class="panel"><div class="section-heading"><h2>크루 편성</h2><span id="trainingPublished"></span></div><p id="trainingCheckSummary"></p><p id="trainingPlanNotice" class="form-description"></p><div id="trainingBoats"></div><div id="trainingWait"></div></div></section></div>`;
  document.querySelector('main').appendChild(panel);
  const el=s=>panel.querySelector(s),all=s=>panel.querySelectorAll(s),form=el('#trainingJoinForm');
  let data=null,sessions=[],selectedDate='',view='join',busy=false,sequence=0,catalogLoaded=false,catalogError='';
  const openSelection=new Set(),draftDates=new Set();let draftStatus='',weekData=[],participationKey=null,rosterData=[],rosterColumns=[],editTarget=null,pressTimer=null,longPressed=false,pressOrigin=null;
  const localDrafts=new Map();
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`,week=new Date(today+'T00:00:00Z');
  week.setUTCDate(week.getUTCDate()+5-(week.getUTCDay()+6)%7);
  const signupWeek=week.toISOString().slice(0,10),signupSunday=new Date(week.getTime()+86400000).toISOString().slice(0,10);
  const signupSessions=()=>sessions.filter(s=>s.date===signupWeek||s.date===signupSunday);
  const weekDates=()=>[week.toISOString().slice(0,10),new Date(week.getTime()+86400000).toISOString().slice(0,10)];
  const dayLabel=date=>`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}(${new Date(date+'T00:00:00Z').getUTCDay()===6?'토':'일'})`;
  function trainingRosterHtml(members,trainingDate,presetColumns=[]){
    if(!members.length&&!presetColumns.length)return '<p class="form-description">아직 참가 신청이 없습니다.</p>';
    const trainingYear=Number(String(trainingDate).slice(0,4));
    const groups=new Map(presetColumns.map(year=>[year,[]]));members.forEach(m=>{const key=Number.isInteger(m.tenure)&&m.tenure>0?trainingYear-m.tenure+1:null;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);});
    const years=[...groups.keys()].sort((a,b)=>a===null?1:b===null?-1:a-b),height=Math.max(1,...[...groups.values()].map(group=>group.length));groups.forEach(group=>group.sort((a,b)=>a.name.localeCompare(b.name,'ko')));
    const statusClass=status=>status==='참석'?'training-status-attending':status==='불참'?'training-status-absent':'training-status-tentative';
    const cell=m=>!m?'':`<div class="training-roster-entry"><span class="${statusClass(m.status)}" aria-label="${esc(m.name)}, ${esc(m.status)}">${esc(m.name)}</span>${m.comment?`<p class="training-comment">${esc(m.comment)}</p>`:''}</div>`;
    return `<p class="player-summary-total">총 ${members.length}명</p><div class="table-wrap"><table class="player-join-table training-roster-table" aria-label="가입연도별 참가 명단"><thead><tr>${years.map(year=>`<th scope="col">${year===null?'미입력':year+'년'}<small>${groups.get(year).length}명</small></th>`).join('')}</tr></thead><tbody>${Array.from({length:height},(_,i)=>`<tr>${years.map(year=>`<td>${cell(groups.get(year)[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function trainingRosterWeek(trainings,referenceDate){
    const opened=trainings.filter(t=>t.opened).sort((a,b)=>a.date.localeCompare(b.date));if(!opened.length)return [];
    const saturday=date=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+5-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
    const thisWeek=saturday(referenceDate),anchor=opened.some(t=>saturday(t.date)===thisWeek)?thisWeek:saturday(opened.find(t=>t.date>=referenceDate)?.date||opened.at(-1).date);
    return opened.filter(t=>saturday(t.date)===anchor);
  }
  function trainingRosterPeople(trainings){
    const people=new Map();trainings.forEach(t=>t.participants.forEach(m=>{const saved=people.get(m.name);if(!saved||m.status==='참석'||saved.status!=='참석'&&m.status==='미정')people.set(m.name,m);}));return [...people.values()];
  }
  function trainingRosterSectionsHtml(trainings,presetColumns,admin,busy){
    if(!trainings.length)return '<p class="form-description">아직 개설된 훈련이 없습니다.</p>';
    const columns=[...new Set([...presetColumns,...trainings.flatMap(t=>t.participants.map(m=>Number.isInteger(m.tenure)&&m.tenure>0?Number(t.date.slice(0,4))-m.tenure+1:null))])].sort((a,b)=>a===null?1:b===null?-1:a-b);
    const dates=trainings.map(t=>`<section class="training-roster-section"><h3>${esc(dayLabel(t.date))}</h3>${trainingRosterHtml(t.participants.filter(m=>m.status==='참석'),t.date,columns)}${admin?`<button type="button" class="primary-button" data-recommend-date="${esc(t.date)}" ${busy?'disabled':''}>추천 조합</button><div data-draft-date="${esc(t.date)}"></div>`:''}</section>`).join('');
    const other=trainingRosterPeople(trainings).filter(m=>m.status!=='참석');
    return dates+`<section class="training-roster-section"><h3>불참/미정</h3>${trainingRosterHtml(other,trainings[0].date,columns)}</section>`;
  }
  function trainingDraftHtml(t){
    const draft=t.draft;if(!draft)return '';
    const attr=(boat,seat)=>`data-draft-date-action="${esc(t.date)}" data-boat="${esc(boat)}" data-seat="${esc(seat)}"`;
    const disabled=busy?'disabled':'';
    const seats=draft.boats.flatMap(b=>b.seats),locked=new Set(seats.filter(m=>m.locked).map(m=>m.id));
    const target=editTarget?.date===t.date?editTarget:null;
    const current=target?draft.boats.find(b=>b.name===target.boat)?.seats.find(m=>m.seat===target.seat):null;
    const picker=current?`<div class="training-member-picker" role="group" aria-label="교체할 멤버 선택"><div class="training-buttons">${current.id?`<button type="button" class="secondary-button" data-draft-operation="lock" ${attr(target.boat,target.seat)} ${disabled}>${current.locked?'고정 해제':'고정'}</button>`:''}${t.participants.filter(m=>m.status==='참석'&&!isDormantMember(m.name)).sort((a,b)=>a.name.localeCompare(b.name,'ko')).map(m=>`<button type="button" class="secondary-button" data-replace-member="${esc(m.id)}" ${attr(target.boat,target.seat)} ${busy||current.locked||locked.has(m.id)||m.id===current.id?'disabled':''}>${esc(m.name)}${locked.has(m.id)?' 🔒':''}</button>`).join('')}<button type="button" class="secondary-button" data-cancel-member ${disabled}>닫기</button></div></div>`:'';
    const boats=draft.boats.map(b=>`<section class="training-boat-compact"><h4>${esc(b.name)}</h4><div class="training-boat-row"><div class="training-slots" style="--seat-count:${b.seats.length}">${b.seats.map(m=>`<button type="button" class="training-member ${m.changed?'is-changed':''}" data-edit-member ${attr(b.name,m.seat)} aria-label="${esc(m.name||'미배정')}, ${esc(m.seat)}, ${m.locked?'고정됨':'멤버 변경. 길게 누르면 고정'}" ${disabled}><small>${esc(m.seat)}</small><span>${esc(m.name||'빈 슬롯')}</span>${m.locked?'<i aria-hidden="true">🔒</i>':''}</button>`).join('')}</div><div class="training-boat-tools"><button type="button" class="secondary-button" data-draft-operation="random" ${attr(b.name,'')} ${disabled}>랜덤 배정</button><button type="button" class="secondary-button" data-draft-operation="removeBoat" ${attr(b.name,'')} ${disabled}>삭제</button></div></div>${target?.boat===b.name?picker:''}</section>`).join('');
    const local=localDrafts.get(t.date),conflict=local&&local.revision!==t.revision;
    return `<div class="training-draft"><div class="section-heading"><h3>추천 조합 <small>비공개 초안</small></h3><small role="status">${local?'미저장':'임시저장됨'}</small></div><div class="training-buttons training-add-boats">${[['4X+','쿼드'],['2X','더블'],['1X','싱글']].map(([type,label])=>`<button type="button" class="secondary-button" data-draft-operation="addBoat" data-type="${type}" data-draft-date-action="${t.date}" ${disabled}>${label} 추가</button>`).join('')}</div>${conflict?`<p class="training-draft-hint">명단이 변경되었습니다. <button type="button" class="secondary-button" data-refresh-draft="${t.date}" ${disabled}>최신 명단 반영</button></p>`:''}${boats}${!draft.boats.length?'<p class="training-draft-hint">배를 추가해 주세요.</p>':''}<p class="training-draft-hint">길게 눌러 고정/해제 · 파란 테두리: 변경됨</p>${draft.wait.length?`<p class="training-draft-hint">대기 ${draft.wait.length}명: ${draft.wait.map(m=>esc(m.name)).join(', ')}</p>`:''}<div class="training-buttons training-draft-actions"><button type="button" class="secondary-button" data-recommend-date="${t.date}" ${disabled}>추천 배정</button><button type="button" class="secondary-button" data-save-draft="${t.date}" ${busy||!local||conflict?'disabled':''}>임시저장</button><button type="button" class="primary-button" data-publish-date="${t.date}" ${busy||conflict||!seats.length||seats.some(m=>!m.id)?'disabled':''}>편성 공개</button></div></div>`;
  }
  function message(text,error=false){el('#trainingMessage').textContent=text;el('#trainingMessage').classList.toggle('is-error',error);}
  function setView(v){view=v;if(v!=='list')editTarget=null;const dates=el('#trainingBrowseDates');dates.hidden=v!=='crew';if(v==='crew')el('[data-screen="crew"] .panel').prepend(dates);all('[data-screen]').forEach(e=>e.hidden=e.dataset.screen!==v);all('[data-view]').forEach(e=>{e.classList.toggle('is-active',e.dataset.view===v);e.setAttribute('aria-pressed',String(e.dataset.view===v));});}
  function syncChoices(){
    const key=signupSessions().map(s=>s.date).join(',');
    if(participationKey!==key){el('#trainingParticipation').innerHTML=signupSessions().map(s=>`<button type="button" data-participation-date="${esc(s.date)}" aria-pressed="false">${esc(dayLabel(s.date))}</button>`).join('')+['불참','미정'].map(v=>`<button type="button" data-participation-status="${v}" aria-pressed="false">${v}</button>`).join('');participationKey=key;}
    const exclusive=draftStatus==='불참'||draftStatus==='미정';
    all('[data-participation-date]').forEach(b=>{b.setAttribute('aria-pressed',String(draftStatus==='참석'&&draftDates.has(b.dataset.participationDate)));b.disabled=busy||exclusive;});all('[data-participation-status]').forEach(b=>{b.setAttribute('aria-pressed',String(draftStatus===b.dataset.participationStatus));b.disabled=busy||exclusive&&draftStatus!==b.dataset.participationStatus;});
    el('#trainingSignupHint').textContent=!signupSessions().length?'이번 주에 개설된 훈련이 없습니다.':exclusive?'선택한 항목을 다시 누르면 다른 항목을 선택할 수 있습니다.':'참가 날짜는 복수 선택할 수 있습니다.';
    form.querySelector('[type="submit"]').disabled=busy||!signupSessions().length||!draftStatus||!form.elements.name.value.trim();
  }
  function hydrateDraft(){const name=form.elements.name.value.trim(),entries=weekData.map(t=>({date:t.date,member:t.participants.find(m=>m.name===name)})).filter(e=>e.member);draftDates.clear();entries.filter(e=>e.member.status==='참석').forEach(e=>draftDates.add(e.date));draftStatus=draftDates.size?'참석':entries.some(e=>e.member.status==='미정')?'미정':entries.length?'불참':'';form.elements.comment.value=entries[0]?.member.comment||'';syncChoices();}
  function render(){
    const member=window.ClubMembership?.member;
    const gate=el('#trainingMemberGate');
    gate.hidden=Boolean(member?.playerName);
    gate.querySelector('p').textContent=member?(member.requestedPlayerName?'운영진이 선수 연결을 확인하고 있습니다. 확인이 끝나면 참가 신청할 수 있습니다.':'본인 선수 정보를 연결한 뒤 참가 신청할 수 있습니다.'):'참가 신청은 카카오 로그인 후 이용할 수 있습니다.';
    gate.querySelector('[data-member-login]').hidden=Boolean(member);
    gate.querySelector('[data-member-link]').hidden=!member;
    if(window.ClubApi?.ready){form.elements.name.value=member?.playerName||'';form.elements.name.readOnly=true;}

    const admin=!!state.adminToken,opened=!!data?.opened;
    el('#trainingOpening').hidden=!admin;el('#trainingOperator').hidden=!admin;el('#trainingAdminHint').hidden=admin;el('#trainingFormFields').disabled=busy||!catalogLoaded||!signupSessions().length;
    const days=weekDates();el('#trainingWeekLabel').textContent=`${dayLabel(days[0])} – ${dayLabel(days[1])}`;
    el('#trainingOpenDates').innerHTML=days.map(date=>{const exists=sessions.some(s=>s.date===date);return `<button type="button" data-open-date="${date}" aria-pressed="${openSelection.has(date)}" ${busy||exists?'disabled':''}>${dayLabel(date)}<small>${exists?'개설됨':'개설할 날짜 선택'}</small></button>`;}).join('');
    el('#trainingDates').innerHTML=sessions.map(s=>`<button type="button" data-date="${esc(s.date)}" aria-pressed="${selectedDate===s.date}" ${busy?'disabled':''}>${esc(dayLabel(s.date))}<small>OPEN</small></button>`).join('');el('#trainingNoDates').hidden=sessions.length>0;
    all('[data-action]').forEach(b=>b.disabled=busy||(b.dataset.action==='open'&&(!catalogLoaded||!openSelection.size))||(b.dataset.action==='recommend'&&!opened));syncChoices();
    el('#trainingOpenHint').textContent=busy?'저장 중입니다.':!catalogLoaded?(catalogError||'서버 연결을 확인하고 있습니다.') :!openSelection.size?'위의 토·일 날짜 버튼을 먼저 선택해 주세요.':'날짜 선택 완료 · 개설 버튼을 누르면 회원에게 공개됩니다.';
    const rosterWeek=trainingRosterWeek(rosterData,today).map(t=>({...t,...(admin&&localDrafts.has(t.date)?{draft:localDrafts.get(t.date).draft}:{}),participants:t.participants.filter(m=>!isDormantMember(m.name))})),members=trainingRosterPeople(rosterWeek);
    el('#trainingListCount').innerHTML=`<span class="training-status-attending">참석 ${members.filter(m=>m.status==='참석').length}</span> · <span class="training-status-absent">불참 ${members.filter(m=>m.status==='불참').length}</span> · <span class="training-status-tentative">미정 ${members.filter(m=>m.status==='미정').length}</span>`;
    el('#trainingRoster').innerHTML=trainingRosterSectionsHtml(rosterWeek,rosterColumns,admin,busy);
    if(admin)all('[data-draft-date]').forEach(node=>{const t=rosterWeek.find(t=>t.date===node.dataset.draftDate);node.innerHTML=trainingDraftHtml(t);});
    const plan=data?.plan?{...data.plan,boats:data.plan.boats.map(b=>({...b,seats:b.seats.filter(m=>!isDormantMember(m.name))})),wait:data.plan.wait.filter(m=>!isDormantMember(m.name))}:null;
    el('#trainingPublished').innerHTML=plan?`회원 공개 중${admin?` <button type="button" class="secondary-button" data-edit-plan="${esc(selectedDate)}" ${busy?'disabled':''}>편성 수정</button>`:''}`:'';el('#trainingPlanNotice').textContent=!plan?'아직 공개된 편성이 없습니다.':plan.registrationRevision!==data.registrationRevision?'편성 후 신청 변경이 있습니다. 운영진이 참가 명단을 확인해 주세요.':admin?'배별로 출석·불참 버튼을 누르세요. 출석 체크는 편성을 변경하지 않습니다.':'운영진이 공개한 편성 및 출석 현황입니다.';
    const seats=plan?plan.boats.flatMap(b=>b.seats):[],statuses=seats.map(m=>plan.checks[m.id]||'미확인');el('#trainingCheckSummary').textContent=plan?`편성 ${seats.length}명 · 출석 ${statuses.filter(s=>s==='출석').length} · 불참 ${statuses.filter(s=>s==='불참').length} · 미확인 ${statuses.filter(s=>s==='미확인').length}`:'';
    el('#trainingBoats').innerHTML=plan?plan.boats.map(b=>`<section class="training-boat"><h3>${esc(b.name)} <small>${esc(b.type)}</small></h3>${b.seats.map(m=>{const status=plan.checks[m.id]||'미확인';return `<div class="training-person"><div><strong class="training-member ${m.changed?'is-changed':''}">${esc(m.name)}</strong><small>${esc(m.seat)}</small></div>${admin?`<div class="training-buttons training-attendance" role="group" aria-label="${esc(m.name)} 출석 확인">${['미확인','출석','불참'].map(v=>`<button type="button" data-check="${esc(m.id)}" data-value="${v}" aria-pressed="${status===v}" ${busy?'disabled':''}>${v}</button>`).join('')}</div>`:`<span class="${status==='불참'?'training-absent':''}">${esc(status)}</span>`}</div>`;}).join('')}</section>`).join(''):'';
    el('#trainingWait').innerHTML=plan&&plan.wait.length?`<h3>운영진 확인 필요 · ${plan.wait.length}명</h3>${plan.wait.map(m=>`<p><strong>${esc(m.name)}</strong> · ${esc(m.reason)}</p>`).join('')}`:'';
  }
  async function load(quiet=false){
    if(busy||pressTimer||editTarget)return;const current=++sequence;
    try{if(!quiet)message('훈련 정보를 불러오는 중입니다.');const result=state.adminToken?await api('trainingDraftGet',{},true):await api('trainingRoster');if(current!==sequence)return;if(!Array.isArray(result.sessions)||!Array.isArray(result.trainings)||!Array.isArray(result.rosterColumns))throw new Error('지원하지 않는 요청입니다.');sessions=result.sessions;rosterData=result.trainings;rosterColumns=result.rosterColumns;catalogLoaded=true;catalogError='';
      if(!sessions.some(s=>s.date===selectedDate))selectedDate=sessions.find(s=>s.date>=today)?.date||sessions.at(-1)?.date||'';
      data=rosterData.find(t=>t.date===selectedDate)||null;weekData=rosterData.filter(t=>t.date===signupWeek||t.date===signupSunday);render();if(!quiet)message('');
    }catch(error){if(current!==sequence)return;const reason=/지원하지 않는 요청|관리자 인증/.test(error.message)?'훈련 서버 업데이트가 필요합니다. 운영진이 서버를 업데이트한 후 새로고침해 주세요.':error.message;if(!catalogLoaded)catalogError='서버 연결 실패로 개설할 수 없습니다. '+reason;render();message(reason,true);}
  }
  async function mutate(action,payload={},admin=false){
    if(busy||action==='trainingWeekJoin'&&!signupSessions().length||!['trainingOpen','trainingWeekJoin'].includes(action)&&!data?.opened)return;busy=true;sequence++;render();message('저장 중입니다.');
    try{const result=await api(action,{...payload,date:selectedDate,revision:payload.revision??data?.revision},admin);
      if(action==='trainingOpen'){selectedDate=payload.dates[0];openSelection.clear();const snapshot=await api('trainingRoster');sessions=snapshot.sessions;rosterData=snapshot.trainings;rosterColumns=snapshot.rosterColumns;data=rosterData.find(t=>t.date===selectedDate);weekData=rosterData.filter(t=>t.date===signupWeek||t.date===signupSunday);message('훈련을 개설했습니다. 회원이 토·일 날짜를 선택할 수 있습니다.');}
      else if(action==='trainingWeekJoin'){weekData=result.trainings;rosterData=rosterData.map(t=>weekData.find(updated=>updated.date===t.date)||t);data=weekData.find(t=>t.date===selectedDate)||data;message('');alert('참가 신청이 완료되었습니다.');}
      else{data={...data,...result.training};if(action==='trainingDraftSave'||action==='trainingPublish')localDrafts.delete(selectedDate);weekData=weekData.map(t=>t.date===data.date?data:t);rosterData=rosterData.map(t=>t.date===data.date?data:t);if(action==='trainingPublish')setView('crew');if(action==='trainingDraftSave')setView('list');message(action==='trainingPublish'?'회원들에게 편성을 공개했습니다.':action==='trainingDraftSave'?'조합을 임시저장했습니다.':action==='trainingCheck'?'출석 상태를 저장했습니다.':'탑승 조건을 저장했습니다.');}
    }catch(error){message(error.message,true);if(/다른 사용자|참가 여부/.test(error.message))setTimeout(()=>load(true),0);}finally{busy=false;render();}
  }
  function editKey(name){let keys;try{keys=JSON.parse(localStorage.getItem('srcTrainingEditKeys')||'{}');}catch{keys={};}if(!keys||typeof keys!=='object'||Array.isArray(keys))keys={};if(!Object.hasOwn(keys,name)){Object.defineProperty(keys,name,{value:crypto.randomUUID(),enumerable:true,writable:true});localStorage.setItem('srcTrainingEditKeys',JSON.stringify(keys));}return keys[name];}
  form.addEventListener('submit',e=>{e.preventDefault();if(!draftStatus)return;const payload={name:form.elements.name.value.trim(),comment:form.elements.comment.value,status:draftStatus,dates:[...draftDates].sort(),week:signupWeek};try{payload.editKey=editKey(payload.name);mutate('trainingWeekJoin',payload);}catch{message('신청 수정키를 저장할 수 없습니다. 브라우저 저장소를 허용해 주세요.',true);}});
  form.elements.name.addEventListener('change',hydrateDraft);form.elements.name.addEventListener('input',syncChoices);
  function draftAction(date,action,payload={}){
    if(!state.adminToken||busy)return;
    const t=rosterData.find(t=>t.date===date);if(!t)return;selectedDate=date;data=t;editTarget=null;
    const local=localDrafts.get(date),previous=local?.draft||t.draft||t.plan;
    if(action==='trainingDraftSave'||action==='trainingPublish'){
      mutate(action,{draft:previous,revision:local?.revision??t.revision},true);return;
    }
    try{
      const people=t.participants.filter(m=>!isDormantMember(m.name));
      let draft;
      if(action==='trainingRecommend')draft=TrainingPlan.recommend(people,previous);
      else if(payload.operation==='start')draft=JSON.parse(JSON.stringify(previous||TrainingPlan.recommend(people)));
      else draft=TrainingPlan.edit(previous||{boats:[],wait:[]},people,payload);
      draft.registrationRevision=t.registrationRevision;
      localDrafts.set(date,{draft,revision:local?.revision??t.revision});setView('list');render();message('');
    }catch(error){message(error.message,true);}
  }
  function refreshLocalDraft(date){
    const t=rosterData.find(t=>t.date===date),local=localDrafts.get(date);if(!t||!local)return;
    const people=t.participants.filter(m=>m.status==='참석'&&!isDormantMember(m.name)),ids=new Set(people.map(m=>m.id));
    local.draft.boats.forEach(b=>b.seats.forEach(m=>{if(m.id&&!ids.has(m.id))Object.assign(m,{id:'',name:'',locked:false,changed:false});}));
    TrainingPlan.wait(local.draft,people);local.draft.registrationRevision=t.registrationRevision;local.revision=t.revision;editTarget=null;render();message('최신 명단을 반영했습니다. 조합을 확인한 뒤 저장해 주세요.');
  }
  function cancelPress(){clearTimeout(pressTimer);pressTimer=null;pressOrigin=null;}
  panel.addEventListener('pointerdown',e=>{longPressed=false;const b=e.target.closest('[data-edit-member]');if(!b||b.disabled||!state.adminToken||e.button!==0)return;pressOrigin={x:e.clientX,y:e.clientY};pressTimer=setTimeout(()=>{pressTimer=null;longPressed=true;draftAction(b.dataset.draftDateAction,'trainingDraftEdit',{operation:'lock',boat:b.dataset.boat,seat:b.dataset.seat});},650);});
  panel.addEventListener('pointermove',e=>{if(pressOrigin&&Math.hypot(e.clientX-pressOrigin.x,e.clientY-pressOrigin.y)>10)cancelPress();});
  ['pointerup','pointercancel','pointerleave'].forEach(type=>panel.addEventListener(type,cancelPress));
  panel.addEventListener('contextmenu',e=>{if(e.target.closest('[data-edit-member]'))e.preventDefault();});
  panel.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;
    if(longPressed&&e.detail!==0){longPressed=false;e.preventDefault();return;}longPressed=false;
    if(b.hasAttribute('data-edit-member')){editTarget={date:b.dataset.draftDateAction,boat:b.dataset.boat,seat:b.dataset.seat};render();return;}
    if(b.hasAttribute('data-cancel-member')){editTarget=null;render();return;}
    if(b.dataset.replaceMember){draftAction(b.dataset.draftDateAction,'trainingDraftEdit',{operation:'replace',boat:b.dataset.boat,seat:b.dataset.seat,id:b.dataset.replaceMember});return;}
    if(b.dataset.draftOperation){draftAction(b.dataset.draftDateAction,'trainingDraftEdit',{operation:b.dataset.draftOperation,type:b.dataset.type,boat:b.dataset.boat,seat:b.dataset.seat});return;}
    if(b.dataset.publishDate){draftAction(b.dataset.publishDate,'trainingPublish',{});return;}
    if(b.dataset.saveDraft){draftAction(b.dataset.saveDraft,'trainingDraftSave',{});return;}
    if(b.dataset.refreshDraft){refreshLocalDraft(b.dataset.refreshDraft);return;}
    if(b.dataset.editPlan){draftAction(b.dataset.editPlan,'trainingDraftEdit',{operation:'start'});return;}
    if(b.dataset.view){setView(b.dataset.view);render();return;}
    if(b.dataset.recommendDate&&state.adminToken){draftAction(b.dataset.recommendDate,'trainingRecommend',{});return;}
    if(b.dataset.participationDate){if(draftStatus!=='참석')draftDates.clear();if(draftDates.has(b.dataset.participationDate))draftDates.delete(b.dataset.participationDate);else draftDates.add(b.dataset.participationDate);draftStatus=draftDates.size?'참석':'';syncChoices();return;}
    if(b.dataset.participationStatus){draftDates.clear();draftStatus=draftStatus===b.dataset.participationStatus?'':b.dataset.participationStatus;syncChoices();return;}
    if(b.dataset.date){selectedDate=b.dataset.date;data=null;render();load();return;}
    if(b.dataset.openDate){if(openSelection.has(b.dataset.openDate))openSelection.delete(b.dataset.openDate);else openSelection.add(b.dataset.openDate);render();return;}
    if(b.dataset.check&&state.adminToken){mutate('trainingCheck',{id:b.dataset.check,status:b.dataset.value},true);return;}
    switch(b.dataset.action){case 'reload':load();break;case 'previousWeek':case 'nextWeek':week.setUTCDate(week.getUTCDate()+(b.dataset.action==='nextWeek'?7:-7));openSelection.clear();render();break;case 'open':if(state.adminToken)mutate('trainingOpen',{dates:[...openSelection].sort()},true);break;case 'recommend':draftAction(selectedDate,'trainingRecommend');break;}
  });
  document.addEventListener('club-auth-changed',render);
  window.addEventListener('beforeunload',e=>{if(localDrafts.size){e.preventDefault();e.returnValue='';}});
  document.addEventListener('member-visibility-changed',render);document.querySelector('[data-tab="training"]').addEventListener('click',()=>{panel.classList.add('is-active');render();load();});document.addEventListener('click',e=>{if(e.target.closest('#adminLogout'))setTimeout(()=>{editTarget=null;localDrafts.clear();rosterData.forEach(t=>delete t.draft);render();},0);});
  setInterval(()=>{if(panel.classList.contains('is-active')&&!document.hidden)load(true);},30000);setView('join');render();if(location.hash==='#training')document.querySelector('[data-tab="training"]').click();
})();
