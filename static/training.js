/* Weekend training: server-owned openings, joining-year seniority, button controls. */
(() => {
  'use strict';
  const panel=document.createElement('section');panel.className='tab-panel';panel.dataset.panel='training';
  panel.innerHTML=`<section class="competition-hero"><div><p class="eyebrow">WEEKEND ROWING</p><h1>주말 훈련 <small>Beta</small></h1><p>참가 신청부터 크루 확인, 당일 출석까지</p></div></section><div class="training-shell">
    <section id="trainingOpening" class="panel" hidden><h2>이번 주 훈련 개설</h2><div class="training-week-nav"><button type="button" data-action="previousWeek">← 이전 주</button><strong id="trainingWeekLabel"></strong><button type="button" data-action="nextWeek">다음 주 →</button></div><div id="trainingOpenDates" class="training-day-buttons"></div><button type="button" class="primary-button" data-action="open" aria-describedby="trainingOpenHint">선택한 날짜 개설</button><p id="trainingOpenHint" class="form-description" role="status"></p><p class="form-description">개설한 날짜만 회원에게 표시됩니다. 기존 날짜의 신청과 편성은 유지됩니다.</p></section>
    <div id="trainingBrowseDates"><div class="training-date-heading"><h2>개설된 훈련</h2><button type="button" class="secondary-button" data-action="reload">새로고침</button></div><div id="trainingDates" class="training-day-buttons" aria-label="개설된 훈련 날짜"></div><p id="trainingNoDates" class="form-description">아직 개설된 훈련이 없습니다.</p></div>
    <div class="training-tabs" aria-label="훈련 메뉴"><button type="button" data-view="join" class="is-active">참가 신청</button><button type="button" data-view="list">참가 명단</button><button type="button" data-view="crew">크루 편성</button></div><p id="trainingMessage" role="status" aria-live="polite"></p>
    <section data-screen="join" class="panel"><form id="trainingJoinForm"><fieldset id="trainingFormFields" disabled><label>이름<input name="name" maxlength="30" autocomplete="off" required placeholder="회원 이름"></label>
    <fieldset class="training-choice"><legend>참가 여부</legend><div id="trainingParticipation" class="training-buttons" aria-label="이번 주 참가 여부"></div><p id="trainingSignupHint" class="form-description"></p></fieldset>
    <label>코멘트<textarea name="comment" maxlength="1000" rows="4" placeholder="전달할 내용을 자유롭게 입력해 주세요."></textarea></label><button type="submit" class="primary-button">참가 신청</button></fieldset></form></section>
    <section data-screen="list" hidden><div class="panel"><div class="section-heading"><h2>참가 명단</h2><strong id="trainingListCount"></strong></div><div id="trainingRoster"></div><div id="trainingOperator" hidden><p class="form-description">가입연도 기준 연차를 배별로 분산하고 COX·탑승 가능 조건을 반영합니다. 추천 조합을 누르면 회원에게 공개됩니다.</p><button type="button" class="primary-button" data-action="recommend">추천 조합 · 크루 편성 공개</button></div><p id="trainingAdminHint" class="form-description">추천 편성은 관리자 로그인 후 사용할 수 있습니다.</p></div></section>
    <section data-screen="crew" hidden><div class="panel"><div class="section-heading"><h2>크루 편성</h2><span id="trainingPublished"></span></div><p id="trainingCheckSummary"></p><p id="trainingPlanNotice" class="form-description"></p><div id="trainingBoats"></div><div id="trainingWait"></div></div></section></div>`;
  document.querySelector('main').appendChild(panel);
  const el=s=>panel.querySelector(s),all=s=>panel.querySelectorAll(s),form=el('#trainingJoinForm');
  let data=null,sessions=[],selectedDate='',view='join',busy=false,sequence=0,catalogLoaded=false,catalogError='';
  const openSelection=new Set(),draftDates=new Set();let draftStatus='',weekData=[],participationKey=null;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`,week=new Date(today+'T00:00:00Z');
  week.setUTCDate(week.getUTCDate()+5-(week.getUTCDay()+6)%7);
  const signupWeek=week.toISOString().slice(0,10),signupSunday=new Date(week.getTime()+86400000).toISOString().slice(0,10);
  const signupSessions=()=>sessions.filter(s=>s.date===signupWeek||s.date===signupSunday);
  const weekDates=()=>[week.toISOString().slice(0,10),new Date(week.getTime()+86400000).toISOString().slice(0,10)];
  const dayLabel=date=>`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}(${new Date(date+'T00:00:00Z').getUTCDay()===6?'토':'일'})`;
  function trainingRosterHtml(members,trainingDate){
    if(!members.length)return '<p class="form-description">아직 참가 신청이 없습니다.</p>';
    const trainingYear=Number(String(trainingDate).slice(0,4));
    const groups=new Map();members.forEach(m=>{const key=Number.isInteger(m.tenure)&&m.tenure>0?m.tenure:null;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);});
    const tenures=[...groups.keys()].sort((a,b)=>a===null?1:b===null?-1:b-a),height=Math.max(...[...groups.values()].map(group=>group.length));groups.forEach(group=>group.sort((a,b)=>a.name.localeCompare(b.name,'ko')));
    const statusClass=status=>status==='참석'?'training-status-attending':status==='불참'?'training-status-absent':'training-status-tentative';
    const cell=m=>!m?'':`<div class="training-roster-entry"><strong class="${statusClass(m.status)}" aria-label="${esc(m.name)}, ${esc(m.status)}">${esc(m.name)}</strong>${m.comment?`<p class="training-comment">${esc(m.comment)}</p>`:''}</div>`;
    return `<p class="player-summary-total">총 ${members.length}명</p><div class="table-wrap"><table class="player-join-table training-roster-table" aria-label="연차별 참가 명단"><thead><tr>${tenures.map(tenure=>`<th scope="col">${tenure===null?'미입력':(trainingYear-tenure+1)+' ('+tenure+'년차)'}<small>${groups.get(tenure).length}명</small></th>`).join('')}</tr></thead><tbody>${Array.from({length:height},(_,i)=>`<tr>${tenures.map(tenure=>`<td>${cell(groups.get(tenure)[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function message(text,error=false){el('#trainingMessage').textContent=text;el('#trainingMessage').classList.toggle('is-error',error);}
  function setView(v){view=v;const dates=el('#trainingBrowseDates');dates.hidden=v==='join';if(v==='list'||v==='crew')el(`[data-screen="${v}"] .panel`).prepend(dates);all('[data-screen]').forEach(e=>e.hidden=e.dataset.screen!==v);all('[data-view]').forEach(e=>{e.classList.toggle('is-active',e.dataset.view===v);e.setAttribute('aria-pressed',String(e.dataset.view===v));});}
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
    const admin=!!state.adminToken,opened=!!data?.opened;
    el('#trainingOpening').hidden=!admin;el('#trainingOperator').hidden=!admin;el('#trainingAdminHint').hidden=admin;el('#trainingFormFields').disabled=busy||!catalogLoaded||!signupSessions().length;
    const days=weekDates();el('#trainingWeekLabel').textContent=`${dayLabel(days[0])} – ${dayLabel(days[1])}`;
    el('#trainingOpenDates').innerHTML=days.map(date=>{const exists=sessions.some(s=>s.date===date);return `<button type="button" data-open-date="${date}" aria-pressed="${openSelection.has(date)}" ${busy||exists?'disabled':''}>${dayLabel(date)}<small>${exists?'개설됨':'개설할 날짜 선택'}</small></button>`;}).join('');
    el('#trainingDates').innerHTML=sessions.map(s=>`<button type="button" data-date="${esc(s.date)}" aria-pressed="${selectedDate===s.date}" ${busy?'disabled':''}>${esc(dayLabel(s.date))}<small>OPEN</small></button>`).join('');el('#trainingNoDates').hidden=sessions.length>0;
    all('[data-action]').forEach(b=>b.disabled=busy||(b.dataset.action==='open'&&(!catalogLoaded||!openSelection.size))||(b.dataset.action==='recommend'&&!opened));syncChoices();
    el('#trainingOpenHint').textContent=busy?'저장 중입니다.':!catalogLoaded?(catalogError||'서버 연결을 확인하고 있습니다.') :!openSelection.size?'위의 토·일 날짜 버튼을 먼저 선택해 주세요.':'날짜 선택 완료 · 개설 버튼을 누르면 회원에게 공개됩니다.';
    const members=(data?.participants||[]).filter(m=>!isDormantMember(m.name));
    el('#trainingListCount').innerHTML=`<span class="training-status-attending">참석 ${members.filter(m=>m.status==='참석').length}</span> · <span class="training-status-absent">불참 ${members.filter(m=>m.status==='불참').length}</span> · <span class="training-status-tentative">미정 ${members.filter(m=>m.status==='미정').length}</span>`;
    el('#trainingRoster').innerHTML=trainingRosterHtml(members,data?.date||selectedDate);
    const plan=data?.plan?{...data.plan,boats:data.plan.boats.map(b=>({...b,seats:b.seats.filter(m=>!isDormantMember(m.name))})),wait:data.plan.wait.filter(m=>!isDormantMember(m.name))}:null;
    el('#trainingPublished').textContent=plan?'회원 공개 중':'';el('#trainingPlanNotice').textContent=!plan?'운영진이 참가 명단에서 추천 조합을 누르면 편성이 공개됩니다.':plan.registrationRevision!==data.registrationRevision?'편성 후 신청 변경이 있습니다. 운영진이 참가 명단을 확인해 주세요.':admin?'배별로 출석·불참 버튼을 누르세요. 출석 체크는 편성을 변경하지 않습니다.':'운영진이 공개한 편성 및 출석 현황입니다.';
    const seats=plan?plan.boats.flatMap(b=>b.seats):[],statuses=seats.map(m=>plan.checks[m.id]||'미확인');el('#trainingCheckSummary').textContent=plan?`편성 ${seats.length}명 · 출석 ${statuses.filter(s=>s==='출석').length} · 불참 ${statuses.filter(s=>s==='불참').length} · 미확인 ${statuses.filter(s=>s==='미확인').length}`:'';
    el('#trainingBoats').innerHTML=plan?plan.boats.map(b=>`<section class="training-boat"><h3>${esc(b.name)} <small>${esc(b.type)}</small></h3>${b.seats.map(m=>{const status=plan.checks[m.id]||'미확인';return `<div class="training-person"><div><strong>${esc(m.name)}</strong><small>${esc(m.seat)}</small></div>${admin?`<div class="training-buttons training-attendance" role="group" aria-label="${esc(m.name)} 출석 확인">${['미확인','출석','불참'].map(v=>`<button type="button" data-check="${esc(m.id)}" data-value="${v}" aria-pressed="${status===v}" ${busy?'disabled':''}>${v}</button>`).join('')}</div>`:`<span class="${status==='불참'?'training-absent':''}">${esc(status)}</span>`}</div>`;}).join('')}</section>`).join(''):'';
    el('#trainingWait').innerHTML=plan&&plan.wait.length?`<h3>운영진 확인 필요 · ${plan.wait.length}명</h3>${plan.wait.map(m=>`<p><strong>${esc(m.name)}</strong> · ${esc(m.reason)}</p>`).join('')}`:'';
  }
  async function load(quiet=false){
    if(busy)return;const current=++sequence;
    try{if(!quiet)message('훈련 정보를 불러오는 중입니다.');const result=await api('trainingList');if(current!==sequence)return;if(!Array.isArray(result.sessions))throw new Error('지원하지 않는 요청입니다.');sessions=result.sessions;catalogLoaded=true;catalogError='';
      if(!sessions.some(s=>s.date===selectedDate))selectedDate=sessions.find(s=>s.date>=today)?.date||sessions.at(-1)?.date||'';
      const date=selectedDate,dates=[...new Set([date,...signupSessions().map(s=>s.date)].filter(Boolean))],loaded=await Promise.all(dates.map(date=>api('trainingGet',{date}).then(r=>r.training)));if(current!==sequence||date!==selectedDate)return;data=loaded.find(t=>t.date===date)||null;weekData=loaded.filter(t=>t.date===signupWeek||t.date===signupSunday);render();if(!quiet)message('');
    }catch(error){if(current!==sequence)return;const reason=/지원하지 않는 요청|관리자 인증/.test(error.message)?'훈련 서버 업데이트가 필요합니다. 운영진이 서버를 업데이트한 후 새로고침해 주세요.':error.message;if(!catalogLoaded)catalogError='서버 연결 실패로 개설할 수 없습니다. '+reason;render();message(reason,true);}
  }
  async function mutate(action,payload={},admin=false){
    if(busy||action==='trainingWeekJoin'&&!signupSessions().length||!['trainingOpen','trainingWeekJoin'].includes(action)&&!data?.opened)return;busy=true;sequence++;render();message('저장 중입니다.');
    try{const result=await api(action,{...payload,date:selectedDate,revision:data?.revision},admin);
      if(action==='trainingOpen'){sessions=result.sessions;selectedDate=payload.dates[0];openSelection.clear();const loaded=await Promise.all([...new Set([selectedDate,...signupSessions().map(s=>s.date)])].map(date=>api('trainingGet',{date}).then(r=>r.training)));data=loaded.find(t=>t.date===selectedDate);weekData=loaded.filter(t=>t.date===signupWeek||t.date===signupSunday);message('훈련을 개설했습니다. 회원이 토·일 날짜를 선택할 수 있습니다.');}
      else if(action==='trainingWeekJoin'){weekData=result.trainings;data=weekData.find(t=>t.date===selectedDate)||data;message('');alert('참가 신청이 완료되었습니다.');}
      else{data=result.training;weekData=weekData.map(t=>t.date===data.date?data:t);if(action==='trainingRecommend')setView('crew');message(action==='trainingRecommend'?'크루 편성을 공개했습니다.':action==='trainingCheck'?'출석 상태를 저장했습니다.':'탑승 조건을 저장했습니다.');}
    }catch(error){message(error.message,true);}finally{busy=false;render();}
  }
  function editKey(name){let keys;try{keys=JSON.parse(localStorage.getItem('srcTrainingEditKeys')||'{}');}catch{keys={};}if(!keys||typeof keys!=='object'||Array.isArray(keys))keys={};if(!Object.hasOwn(keys,name)){Object.defineProperty(keys,name,{value:crypto.randomUUID(),enumerable:true,writable:true});localStorage.setItem('srcTrainingEditKeys',JSON.stringify(keys));}return keys[name];}
  form.addEventListener('submit',e=>{e.preventDefault();if(!draftStatus)return;const payload={name:form.elements.name.value.trim(),comment:form.elements.comment.value,status:draftStatus,dates:[...draftDates].sort(),week:signupWeek};try{payload.editKey=editKey(payload.name);mutate('trainingWeekJoin',payload);}catch{message('신청 수정키를 저장할 수 없습니다. 브라우저 저장소를 허용해 주세요.',true);}});
  form.elements.name.addEventListener('change',hydrateDraft);form.elements.name.addEventListener('input',syncChoices);
  panel.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;
    if(b.dataset.view){setView(b.dataset.view);render();return;}
    if(b.dataset.participationDate){if(draftStatus!=='참석')draftDates.clear();if(draftDates.has(b.dataset.participationDate))draftDates.delete(b.dataset.participationDate);else draftDates.add(b.dataset.participationDate);draftStatus=draftDates.size?'참석':'';syncChoices();return;}
    if(b.dataset.participationStatus){draftDates.clear();draftStatus=draftStatus===b.dataset.participationStatus?'':b.dataset.participationStatus;syncChoices();return;}
    if(b.dataset.date){selectedDate=b.dataset.date;data=null;render();load();return;}
    if(b.dataset.openDate){if(openSelection.has(b.dataset.openDate))openSelection.delete(b.dataset.openDate);else openSelection.add(b.dataset.openDate);render();return;}
    if(b.dataset.check&&state.adminToken){mutate('trainingCheck',{id:b.dataset.check,status:b.dataset.value},true);return;}
    switch(b.dataset.action){case 'reload':load();break;case 'previousWeek':case 'nextWeek':week.setUTCDate(week.getUTCDate()+(b.dataset.action==='nextWeek'?7:-7));openSelection.clear();render();break;case 'open':if(state.adminToken)mutate('trainingOpen',{dates:[...openSelection].sort()},true);break;case 'recommend':if(state.adminToken)mutate('trainingRecommend',{},true);break;}
  });
  document.addEventListener('member-visibility-changed',render);document.querySelector('[data-tab="training"]').addEventListener('click',()=>{panel.classList.add('is-active');render();load();});document.addEventListener('click',e=>{if(e.target.closest('#adminLogout'))setTimeout(render,0);});
  setInterval(()=>{if(panel.classList.contains('is-active')&&!document.hidden)load(true);},30000);setView('join');render();if(location.hash==='#training')document.querySelector('[data-tab="training"]').click();
})();
