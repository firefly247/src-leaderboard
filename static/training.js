/* Shared weekend training; authorization is enforced again by Apps Script. */
(() => {
  'use strict';
  const panel=document.createElement('section');panel.className='tab-panel';panel.dataset.panel='training';
  panel.innerHTML=`<section class="competition-hero"><div><p class="eyebrow">WEEKEND ROWING</p><h1>주말 훈련 <small>Beta</small></h1><p>참가 신청부터 크루 확인, 당일 출석까지</p></div></section>
  <div class="training-shell">
    <div class="training-dates"><label>훈련 날짜<input id="trainingDate" type="date" required></label><button type="button" class="secondary-button" data-training-action="reload">새로고침</button></div>
    <div class="training-tabs" aria-label="훈련 메뉴"><button type="button" data-training-view="join" class="is-active">참가 신청</button><button type="button" data-training-view="list">참가 명단</button><button type="button" data-training-view="crew">크루 편성</button></div>
    <p id="trainingMessage" role="status" aria-live="polite"></p>
    <section data-training-screen="join" class="panel"><h2>나의 참가 신청</h2>
    <form id="trainingJoinForm"><label>이름<input name="name" maxlength="30" list="trainingMemberNames" autocomplete="name" required placeholder="회원 이름"><datalist id="trainingMemberNames"></datalist></label>
    <div class="form-grid"><label>참가 여부<select name="status"><option>참석</option><option>불참</option><option>미정</option></select></label><label>참가 시간<select name="arrival"><option>정시</option><option>늦참</option><option>조기 귀가</option></select></label></div>
    <div class="form-grid"><label>희망 보트<select name="preference"><option>무관</option><option>유타쿼드</option><option>더블스컬</option><option>싱글스컬</option></select></label><label>숙련도<select name="experience"><option>초급</option><option>중급</option><option>숙련</option></select></label></div>
    <label class="training-check"><input type="checkbox" name="canCox">COX 가능</label><label class="training-check"><input type="checkbox" name="canSmallBoat">클럽에서 더블·싱글 탑승 가능 확인을 받았습니다</label>
    <p class="form-description">희망 보트는 참고 사항입니다. 늦참·조기 귀가는 운영진 확인 대상으로 표시됩니다. 신청 이름과 편성·출석 현황은 이 페이지에 공개됩니다.</p>
    <button type="submit" class="primary-button">참가 신청 저장</button><p class="form-description">수정은 처음 신청한 브라우저에서 같은 이름으로 저장하세요. 기기 변경 시 운영진에게 문의해 주세요.</p></form></section>
    <section data-training-screen="list" hidden><div class="panel"><div class="section-heading"><h2>참가 명단</h2><strong id="trainingListCount"></strong></div><div id="trainingRoster"></div>
    <div id="trainingOperator" hidden><p class="form-description">COX·탑승 가능 조건과 보유 보트를 기준으로 추천합니다. 추천 조합을 누르면 회원에게 바로 공개됩니다.</p><button type="button" class="primary-button" data-training-action="recommend">추천 조합 · 크루 편성 공개</button></div><p id="trainingAdminHint" class="form-description">추천 편성은 관리자 로그인 후 사용할 수 있습니다.</p></div></section>
    <section data-training-screen="crew" hidden><div class="panel"><div class="section-heading"><h2>크루 편성</h2><span id="trainingPublished"></span></div><p id="trainingCheckSummary"></p><p id="trainingPlanNotice" class="form-description"></p><div id="trainingBoats"></div><div id="trainingWait"></div></div></section>
  </div>`;
  document.querySelector('main').appendChild(panel);
  const el=s=>panel.querySelector(s), all=s=>panel.querySelectorAll(s);
  let data=null,view='join',busy=false,loadSequence=0,controller=null;
  const dateField=el('#trainingDate'),form=el('#trainingJoinForm');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const date=new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`),day=date.getUTCDay();
  if(day!==0&&day!==6)date.setUTCDate(date.getUTCDate()+6-day);
  dateField.value=date.toISOString().slice(0,10);
  function message(text,error=false){el('#trainingMessage').textContent=text;el('#trainingMessage').classList.toggle('is-error',error);}
  function setView(value){view=value;all('[data-training-screen]').forEach(e=>e.hidden=e.dataset.trainingScreen!==view);all('[data-training-view]').forEach(e=>{e.classList.toggle('is-active',e.dataset.trainingView===view);e.setAttribute('aria-pressed',String(e.dataset.trainingView===view));});}
  function render(){
    const admin=!!state.adminToken;
    el('#trainingOperator').hidden=!admin;el('#trainingAdminHint').hidden=admin;
    all('[data-training-action]').forEach(b=>b.disabled=busy||!data);
    el('[data-training-action="reload"]').disabled=busy;
    form.querySelector('button').disabled=busy||!data;dateField.disabled=busy;
    el('#trainingMemberNames').innerHTML=state.members.map(m=>`<option value="${esc(m.memberName)}"></option>`).join('');
    if(!data)return;
    const members=data.participants,attendees=members.filter(m=>m.status==='참석');
    el('#trainingListCount').textContent=`참석 ${attendees.length} · 불참 ${members.filter(m=>m.status==='불참').length} · 미정 ${members.filter(m=>m.status==='미정').length}`;
    el('#trainingRoster').innerHTML=members.map(m=>`<div class="training-person"><div><strong>${esc(m.name)}</strong><small>${esc(m.arrival)} · ${esc(m.preference)} · ${esc(m.experience)}${m.canCox?' · COX 가능':''}${m.canSmallBoat?' · 더블/싱글 가능':''}</small></div><span>${esc(m.status)}</span></div>`).join('')||'<p class="form-description">아직 참가 신청이 없습니다.</p>';
    const plan=data.plan;
    el('#trainingPublished').textContent=plan?'회원 공개 중':'';
    el('#trainingPlanNotice').textContent=!plan?'운영진이 참가 명단에서 추천 조합을 누르면 편성이 공개됩니다.':plan.registrationRevision!==data.registrationRevision?'편성 후 신청 변경이 있습니다. 운영진이 참가 명단을 확인해 주세요.':admin?'배별 멤버의 출석·불참을 선택하세요. 출석 체크는 편성을 변경하지 않습니다.':'운영진이 공개한 편성 및 출석 현황입니다.';
    const seats=plan?plan.boats.flatMap(b=>b.seats):[],statuses=seats.map(m=>plan.checks[m.id]||'미확인');
    el('#trainingCheckSummary').textContent=plan?`편성 ${seats.length}명 · 출석 ${statuses.filter(s=>s==='출석').length} · 불참 ${statuses.filter(s=>s==='불참').length} · 미확인 ${statuses.filter(s=>s==='미확인').length}`:'';
    el('#trainingBoats').innerHTML=plan?plan.boats.map(b=>`<section class="training-boat"><h3>${esc(b.name)} <small>${esc(b.type)}</small></h3>${b.seats.map(m=>{const status=plan.checks[m.id]||'미확인';return `<div class="training-person"><div><strong>${esc(m.name)}</strong><small>${esc(m.seat)}</small></div>${admin?`<select data-training-check="${esc(m.id)}" aria-label="${esc(m.name)} 출석 확인" ${busy?'disabled':''}>${['미확인','출석','불참'].map(v=>`<option${v===status?' selected':''}>${v}</option>`).join('')}</select>`:`<span class="${status==='불참'?'training-absent':''}">${esc(status)}</span>`}</div>`;}).join('')}</section>`).join(''):'';
    el('#trainingWait').innerHTML=plan&&plan.wait.length?`<h3>운영진 확인 필요 · ${plan.wait.length}명</h3>${plan.wait.map(m=>`<p><strong>${esc(m.name)}</strong> · ${esc(m.reason)}</p>`).join('')}`:'';
  }
  async function load(quiet=false){
    if(busy)return;
    const sequence=++loadSequence,date=dateField.value;
    controller?.abort();controller=new AbortController();
    try{
      if(!quiet)message('훈련 정보를 불러오는 중입니다.');
      // The shared API supplies credentials only for admin mutations.
      const response=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'trainingGet',payload:{date}}),signal:controller.signal});
      const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.message||'훈련 정보를 불러오지 못했습니다.');
      if(sequence!==loadSequence||date!==dateField.value)return;
      data=result.training;render();if(!quiet)message('');
    }catch(error){if(error.name==='AbortError'||sequence!==loadSequence)return;message(/지원하지 않는 요청|관리자 인증/.test(error.message)?'주말 훈련 서버 배포가 준비 중입니다. 잠시 후 새로고침해 주세요.':error.message,true);}
  }
  async function mutate(action,payload,admin=false){
    if(busy||!data)return;busy=true;loadSequence++;controller?.abort();render();message('저장 중입니다.');
    try{const result=await api(action,{...payload,date:dateField.value,revision:data.revision},admin);data=result.training;if(action==='trainingRecommend')setView('crew');message(action==='trainingRecommend'?'크루 편성을 공개했습니다.':action==='trainingCheck'?'출석 상태를 저장했습니다.':'참가 신청을 저장했습니다.');}
    catch(error){message(error.message,true);}
    finally{busy=false;render();}
  }
  function editKey(name){const storageKey='srcTrainingEditKeys';let keys;try{keys=JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{keys={};}if(!keys||typeof keys!=='object'||Array.isArray(keys))keys={};if(!Object.hasOwn(keys,name)){Object.defineProperty(keys,name,{value:crypto.randomUUID(),enumerable:true,writable:true});localStorage.setItem(storageKey,JSON.stringify(keys));}return keys[name];}
  form.addEventListener('submit',event=>{event.preventDefault();const values=new FormData(form),payload=Object.fromEntries(values);payload.name=payload.name.trim();payload.canCox=values.has('canCox');payload.canSmallBoat=values.has('canSmallBoat');try{payload.editKey=editKey(payload.name);mutate('trainingJoin',payload);}catch{message('신청 수정키를 저장할 수 없습니다. 브라우저 저장소를 허용해 주세요.',true);}});
  form.elements.name.addEventListener('change',()=>{const m=data?.participants.find(p=>p.name===form.elements.name.value.trim());if(!m)return;for(const key of ['status','arrival','preference','experience'])form.elements[key].value=m[key];for(const key of ['canCox','canSmallBoat'])form.elements[key].checked=m[key];});
  panel.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.dataset.trainingView){setView(b.dataset.trainingView);render();return;}if(b.dataset.trainingAction==='reload')load();if(b.dataset.trainingAction==='recommend'&&state.adminToken)mutate('trainingRecommend',{},true);});
  panel.addEventListener('change',event=>{if(event.target.dataset.trainingCheck&&state.adminToken)mutate('trainingCheck',{id:event.target.dataset.trainingCheck,status:event.target.value},true);});
  dateField.addEventListener('change',()=>{data=null;render();load();});
  form.elements.name.addEventListener('focus',render);
  document.querySelector('[data-tab="training"]').addEventListener('click',()=>{panel.classList.add('is-active');render();load();});
  document.addEventListener('click',event=>{if(event.target.closest('#adminLogout'))setTimeout(render,0);});
  // Avoid retaining enabled controls when the existing login form changes authorization.
  document.querySelector('#adminLoginForm').addEventListener('submit',()=>setTimeout(render,0));
  setInterval(()=>{if(panel.classList.contains('is-active')&&!document.hidden)load(true);},30000);
  if(location.hash==='#training')document.querySelector('[data-tab="training"]').click();
  setView('join');render();
})();
