/* Shared seat signup. Names are projected by the server only for administrators. */
((root)=>{
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label=date=>`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}(${new Date(date+'T00:00:00Z').getUTCDay()===6?'토':'일'})`;
  function boatSvg(){return '<svg class="seat-boat-drawing" viewBox="0 0 1000 130" preserveAspectRatio="none" aria-hidden="true"><path d="M5 65 Q70 12 180 20 H850 Q925 23 995 65 Q925 107 850 110 H180 Q70 118 5 65Z" fill="#f1f6fa" stroke="#94a9b9" stroke-width="2"/><path d="M120 25L100 3M290 25L270 3M460 25L440 3M630 25L610 3M800 25L780 3M160 105L180 127M330 105L350 127M500 105L520 127M670 105L690 127M840 105L860 127" stroke="#6c8798" stroke-width="4"/></svg>';}
  function boatHtml(boat,training,admin,pending){
    return `<article class="seat-boat"><div class="seat-boat-heading"><h4>${esc(boat.name)}</h4><span>${boat.seats.filter(s=>s.occupied).length}/${boat.seats.length}석${admin&&!training.confirmed&&!boat.seats.some(s=>s.occupied)?` <button type="button" class="seat-text-button" data-seat-action="trainingBoatRemove" data-date="${training.date}" data-boat="${esc(boat.id)}" ${pending?'disabled':''}>배 삭제</button>`:''}</span></div><div class="seat-boat-stage">${boatSvg()}<div class="seat-boat-slots" style="--seat-count:${boat.seats.length}">${boat.seats.map(s=>{
      const text=admin?(s.name||'빈자리'):s.mine?'내 자리':s.occupied?'선택됨':'빈자리';
      const status=s.mine?'내 자리':s.occupied?'선택된 자리':'빈자리';
      return `<button type="button" class="seat-place ${admin?'is-admin-seat':''} ${s.position==='COX'?'is-cox':''} ${s.mine?'is-mine':s.occupied?'is-taken':'is-free'}" data-seat-action="trainingSeatSelect" data-date="${training.date}" data-boat="${esc(boat.id)}" data-index="${s.index}" aria-label="${esc(boat.name)}, ${esc(s.position)}, ${esc(admin?text:status)}" aria-pressed="${s.mine}" ${pending||training.confirmed||s.occupied&&!s.mine?'disabled':''}><small>${esc(s.position)}</small><span>${esc(text)}</span></button>`;
    }).join('')}</div></div></article>`;
  }
  function trainingHtml(t,fleet,admin,pending,expanded){
    const available=Object.entries(fleet).filter(([type,spec])=>t.boats.filter(b=>b.type===type).length<spec.limit);
    return `<section class="seat-training" data-seat-date="${t.date}"><div class="section-heading"><h3>${label(t.date)}</h3><strong class="seat-publication">${t.confirmed?'확정 · 크루 편성 공개 중':'좌석 신청 중'}</strong></div><p class="seat-totals">참석 ${t.counts.attending} · 불참 ${t.counts.absent} · 미정 ${t.counts.tentative}</p>${t.ownStatus==='참석'&&!t.boats.some(b=>b.seats.some(s=>s.mine))?'<p class="seat-unassigned">참석 신청이 되어 있습니다. 탑승할 빈자리를 선택해 주세요.</p>':''}${t.confirmed?'<p class="training-draft-hint">확정된 크루 편성입니다. 좌석 변경은 운영진에게 문의해 주세요.</p>':''}${t.boats.map(b=>boatHtml(b,t,admin,pending)).join('')||'<p class="form-description">아직 추가된 배가 없습니다. 배를 추가하고 빈자리를 선택해 주세요.</p>'}${!t.confirmed?`<div class="seat-add-controls"><button type="button" class="secondary-button" data-add-toggle="${t.date}" aria-expanded="${expanded}" ${pending||!available.length?'disabled':''}>배 추가</button>${!available.length?'<span class="training-draft-hint">모든 배가 추가되었습니다.</span>':''}${expanded?`<div class="training-buttons seat-fleet-types" aria-label="추가할 배 종류">${Object.entries(fleet).map(([type,spec])=>{const count=t.boats.filter(b=>b.type===type).length;return `<button type="button" class="secondary-button" data-seat-action="trainingBoatAdd" data-date="${t.date}" data-type="${esc(type)}" ${pending||count>=spec.limit?'disabled':''}>${esc(type)} <small>${count}/${spec.limit}대</small></button>`;}).join('')}</div>`:''}</div><div class="training-buttons seat-response-actions">${['불참','미정'].map(status=>`<button type="button" class="secondary-button" data-seat-action="trainingSeatStatus" data-date="${t.date}" data-status="${status}" aria-pressed="${t.ownStatus===status}" ${pending?'disabled':''}>${status}</button>`).join('')}</div><details class="seat-comment"><summary>코멘트</summary><label>전달할 내용<textarea data-seat-comment="${t.date}" rows="2" maxlength="1000" placeholder="자유롭게 입력해 주세요.">${esc(comments.get(t.date)??t.ownComment)}</textarea></label><button type="button" class="secondary-button" data-seat-action="trainingSeatComment" data-date="${t.date}" ${pending?'disabled':''}>코멘트 저장</button></details>`:''}${admin&&t.unseated.length?`<p class="seat-unassigned">좌석 미선택 참석 회원: ${t.unseated.map(p=>esc(p.name)).join(', ')}</p>`:''}${admin&&t.responses?.some(p=>p.status!=='참석')?`<details class="seat-admin-responses"><summary>불참·미정 응답 보기</summary>${t.responses.filter(p=>p.status!=='참석').map(p=>`<p>${esc(p.name)} · ${esc(p.status)}${p.comment?' · '+esc(p.comment):''}</p>`).join('')}</details>`:''}${admin?`<div class="seat-confirm"><button type="button" class="${t.confirmed?'secondary-button':'primary-button'}" data-seat-action="${t.confirmed?'trainingSeatReopen':'trainingSeatConfirm'}" data-date="${t.date}" ${pending?'disabled':''}>${t.confirmed?'확정 취소 · 다시 신청받기':'확정 · 크루 편성 공개'}</button></div>`:''}</section>`;
  }
  let host=null,trainings=[],fleet={},loading=false,mutating='',loaded=false,sequence=0,error='',expanded=new Set(),comments=new Map();
  const member=()=>root.ClubMembership?.member,admin=()=>member()?.role==='admin';
  function shown(){
    const now=new Date(),local=new Date(now.toLocaleString('en-US',{timeZone:'Asia/Seoul'})),date=`${local.getFullYear()}-${String(local.getMonth()+1).padStart(2,'0')}-${String(local.getDate()).padStart(2,'0')}`;
    const future=trainings.filter(t=>t.date>=date);const anchor=future[0]?.date||trainings.at(-1)?.date;
    if(!anchor)return [];
    const d=new Date(anchor+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+5-(d.getUTCDay()+6)%7);const saturday=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+1);const sunday=d.toISOString().slice(0,10);
    return trainings.filter(t=>t.date===saturday||t.date===sunday);
  }
  function render(){
    if(!host)return;
    const approved=Boolean(member()?.playerName);host.hidden=!approved;
    if(!approved){host.innerHTML='';return;}
    host.innerHTML=`<div class="section-heading"><h2>훈련 참석 현황</h2><button type="button" class="secondary-button" data-seats-refresh ${loading||mutating?'disabled':''}>새로고침</button></div><p class="form-description">빈자리를 선택하면 참석 신청됩니다. 내 자리를 다시 누르면 취소할 수 있습니다. 배의 맨 왼쪽 COX는 콕스 자리입니다.</p><div class="seat-legend"><span>□ 빈자리</span><span>▣ 선택됨</span><span class="seat-legend-mine">■ 내 자리</span></div><p class="seat-feedback ${error?'is-error':''}" role="status">${error|| (mutating?'좌석을 저장하고 있습니다.':loading&&!loaded?'훈련 참석 현황을 불러오고 있습니다.':'')}</p>${shown().map(t=>trainingHtml(t,fleet,admin(),mutating===t.date,expanded.has(t.date))).join('')||(!loading&&loaded?'<p class="form-description">아직 개설된 훈련이 없습니다.</p>':'')}`;
  }
  async function refresh(){
    if(!host||!member()?.playerName||mutating||loading||host.contains(document.activeElement)&&document.activeElement.matches('textarea'))return;
    const request=++sequence,first=!loaded;let changed=false;loading=true;if(first)render();
    try{const result=await root.ClubApi.call('trainingSeats');if(request!==sequence)return;changed=Boolean(error)||JSON.stringify(trainings)!==JSON.stringify(result.trainings)||JSON.stringify(fleet)!==JSON.stringify(result.fleet);trainings=result.trainings;fleet=result.fleet;loaded=true;error='';}
    catch(e){if(request===sequence){error=e.message;changed=true;}}
    finally{if(request===sequence){loading=false;if(first||changed)render();}}
  }
  async function perform(action,payload){
    if(!member()?.playerName||mutating)return;
    const request=++sequence;loading=false;mutating=payload.date;error='';render();
    try{const out=await root.ClubApi.call(action,payload);if(request!==sequence)return;trainings=trainings.map(t=>t.date===out.training.date?out.training:t);document.dispatchEvent(new CustomEvent('training-seats-changed'));}
    catch(e){if(request===sequence){error=e.message;if(/먼저 선택|확정된 편성|모든 배/.test(error)){try{const latest=await root.ClubApi.call('trainingSeats');if(request===sequence){trainings=latest.trainings;fleet=latest.fleet;}}catch{}}}}
    finally{if(request===sequence){mutating='';render();}}
  }
  function mount(panel){
    if(host)return;
    host=document.createElement('div');host.id='trainingSeatSignup';panel.querySelector('#trainingJoinForm').before(host);panel.querySelector('#trainingJoinForm').hidden=true;
    host.addEventListener('input',e=>{if(e.target.dataset.seatComment)comments.set(e.target.dataset.seatComment,e.target.value);});
    host.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;e.stopPropagation();
      if(b.hasAttribute('data-seats-refresh')){refresh();return;}
      if(b.dataset.addToggle){const date=b.dataset.addToggle;if(expanded.has(date))expanded.delete(date);else expanded.add(date);render();return;}
      if(b.dataset.seatAction)perform(b.dataset.seatAction,{date:b.dataset.date,boatId:b.dataset.boat,index:b.dataset.index===undefined?undefined:Number(b.dataset.index),type:b.dataset.type,status:b.dataset.status,...(['trainingSeatSelect','trainingSeatStatus','trainingSeatComment'].includes(b.dataset.seatAction)?{comment:comments.get(b.dataset.date)??trainings.find(t=>t.date===b.dataset.date)?.ownComment??''}:{})});
    });
    document.addEventListener('club-auth-changed',()=>{sequence++;trainings=[];comments.clear();fleet={};loaded=false;error='';loading=false;mutating='';expanded.clear();render();if(panel.classList.contains('is-active'))refresh();});
    document.querySelector('[data-tab="training"]').addEventListener('click',refresh);
    document.addEventListener('training-opened',refresh);
    setInterval(()=>{if(panel.classList.contains('is-active')&&!document.hidden)refresh();},15000);render();if(panel.classList.contains('is-active'))refresh();
  }
  const api={mount,refresh,boatHtml,trainingHtml};if(root)root.ClubTrainingSeats=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
