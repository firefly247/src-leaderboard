/* Competition lineup editor: local edits, explicit participant/save/finalize writes. */
(()=>{
  'use strict';
  const panel=document.createElement('section');panel.className='tab-panel';panel.dataset.panel='race-lineup';
  panel.innerHTML='<section class="competition-hero"><div><p class="eyebrow">COMPETITION LINEUP</p><h1>대회 조 편성 <small>Beta</small></h1></div></section><div class="race-lineup-shell"><p id="raceMessage" role="status" aria-live="polite"></p><div id="raceCatalog"></div><div id="raceWorkspace"></div></div>';
  document.querySelector('main').appendChild(panel);
  const el=s=>panel.querySelector(s),planner=RaceLineupPlan,nowYear=Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Seoul'}).format(new Date()));
  let races=[],players=[],events=[],divisions=[],competitions=[],race=null,year=nowYear,busy=false,epoch=0,loaded=false,createCompetition='',eventId='',divisionId='',teamName='A팀',target=null,showSettings=true,hold=null,origin=null,longPress=false;
  const local=new Map(),selections=new Map();
  const clone=v=>JSON.parse(JSON.stringify(v));
  const message=(text,error=false)=>{el('#raceMessage').textContent=text;el('#raceMessage').classList.toggle('is-error',error);};
  const selected=()=>race?selections.get(race.id)||new Set(race.participants||[]):new Set();
  const selectedChanged=()=>race&&JSON.stringify([...selected()].sort())!==JSON.stringify([...(race.participants||[])].sort());
  const groups=()=>race?local.get(race.id)?.groups||race.groups||[]:[];
  const eligible=()=>race?players.filter(p=>race.participants?.includes(p.memberName)):[];
  const ageText=p=>{const a=planner.age(p,race?.year||year);return a===null?'생년 미등록':`만 ${a}세`;};
  const attrs=(g,i)=>`data-group="${esc(g.id)}" data-slot="${i}"`;
  const cleanLocal=(g,names)=>g.forEach(g=>g.slots.forEach(s=>{if(s.name&&!names.has(s.name))Object.assign(s,{name:'',locked:false,changed:true});}));
  function participantTable(){
    const columns=new Map();players.forEach(p=>{const key=p.joinYear||'';if(!columns.has(key))columns.set(key,[]);columns.get(key).push(p);});
    const years=[...columns.keys()].sort((a,b)=>a===''?1:b===''?-1:Number(a)-Number(b)),height=Math.max(0,...[...columns.values()].map(c=>c.length));columns.forEach(c=>c.sort((a,b)=>a.memberName.localeCompare(b.memberName,'ko')));
    return `<div class="table-wrap"><table class="player-join-table race-player-table" aria-label="가입연도별 대회 참가자 선택"><thead><tr>${years.map(y=>`<th>${y?esc(y)+'년':'미입력'}<small>${columns.get(y).filter(p=>selected().has(p.memberName)).length}/${columns.get(y).length}명</small></th>`).join('')}</tr></thead><tbody>${Array.from({length:height},(_,i)=>`<tr>${years.map(y=>{const p=columns.get(y)[i];return `<td>${p?`<button type="button" data-race-player="${esc(p.memberName)}" aria-pressed="${selected().has(p.memberName)}" ${busy?'disabled':''}>${esc(p.memberName)}<small>${ageText(p)}</small></button>`:''}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function groupHtml(g,admin){
    const status=admin?planner.status(g,eligible(),race.year):{sum:g.slots.filter(s=>s.kind==='rower').reduce((n,s)=>n+(s.age||0),0),valid:true,complete:true};
    const slotHtml=(s,i)=>{const p=players.find(p=>p.memberName===s.name),age=admin?ageText(p):s.age===null?'생년 미등록':`만 ${s.age}세`;return admin?`<button type="button" class="race-slot ${s.changed?'is-changed':''}" data-race-slot ${attrs(g,i)} aria-label="${esc(g.teamName)} ${esc(s.label)}, ${esc(s.name||'미배정')}${s.locked?', 고정됨':''}" ${busy?'disabled':''}><small>${esc(s.label)}${s.locked?' 🔒':''}</small><span>${esc(s.name||'배정')}</span><small>${s.name?age:'—'}</small></button>`:`<div class="race-slot"><small>${esc(s.label)}</small><span>${esc(s.name||'—')}</span><small>${s.name?age:'—'}</small></div>`;};
    const main=g.slots.map((s,i)=>({s,i})).filter(v=>v.s.kind!=='reserve'),reserve=g.slots.map((s,i)=>({s,i})).filter(v=>v.s.kind==='reserve');
    const current=target?.group===g.id?g.slots[target.index]:null;
    const picker=admin&&current?`<div class="race-picker"><strong>${esc(current.label)}</strong><div class="race-buttons">${current.name?`<button type="button" data-race-action="lock" ${attrs(g,target.index)} ${busy?'disabled':''}>${current.locked?'고정 해제':'고정'}</button>`:''}<button type="button" data-race-name="" ${attrs(g,target.index)} ${busy||current.locked?'disabled':''}>비우기</button>${eligible().map(p=>{let reason='';try{if(current.locked)throw new Error('고정됨');if(current.kind==='rower'&&planner.age(p,race.year)===null)throw new Error('생년 미등록');planner.setSlot(groups(),g.id,target.index,p.memberName,eligible(),race.year);}catch(e){reason=e.message;}return `<button type="button" data-race-name="${esc(p.memberName)}" ${attrs(g,target.index)} title="${esc(reason)}" ${busy||reason?'disabled':''}>${esc(p.memberName)}<small>${ageText(p)}</small></button>`;}).join('')}<button type="button" data-race-action="closePicker" ${busy?'disabled':''}>닫기</button></div></div>`:'';
    return `<section class="race-group"><div class="race-group-heading"><strong>${esc(g.eventName)} · ${esc(g.divisionName)} · ${esc(g.teamName)}</strong>${admin?`<div class="race-buttons"><button type="button" data-race-action="random" data-group="${esc(g.id)}" ${busy||selectedChanged()?'disabled':''}>랜덤 배정</button><button type="button" data-race-action="removeGroup" data-group="${esc(g.id)}" ${busy?'disabled':''}>삭제</button></div>`:''}</div><div class="race-slot-scroll"><div class="race-main-slots" style="--race-slots:${main.length}">${main.map(v=>slotHtml(v.s,v.i)).join('')}</div></div><div class="race-group-footer"><div class="race-reserves">${reserve.map(v=>slotHtml(v.s,v.i)).join('')}</div><div class="race-age-total ${status.valid?'is-valid':'is-incomplete'}"><strong>합계 ${status.sum}세</strong><small>콕스·후보 제외</small><small>${status.complete?(status.valid?'나이대 충족':status.missing?'생년 확인 필요':'나이대 미충족'):'출전 선수 배정 중'}</small></div></div>${picker}</section>`;
  }
  function render(){
    const admin=!!state.adminUserId,disabled=busy?'disabled':'',years=[...new Set([nowYear,...races.map(r=>r.year)])].sort((a,b)=>b-a);
    el('#raceCatalog').innerHTML=`<section class="panel race-catalog"><div class="race-heading"><div class="race-buttons">${years.map(y=>`<button type="button" data-race-year="${y}" aria-pressed="${year===y}" ${disabled}>${y}년</button>`).join('')}</div><button type="button" data-race-action="reload" ${disabled}>새로고침</button></div><div class="race-buttons race-list">${races.filter(r=>r.year===year).map(r=>`<button type="button" data-race-id="${esc(r.id)}" aria-pressed="${race?.id===r.id}" ${disabled}>${esc(r.name)}${r.finalizedAt?' ✓':''}</button>`).join('')||'<small>추가된 대회가 없습니다.</small>'}</div>${admin?`<details class="race-create"><summary>연도·대회 추가</summary><form id="raceCreateForm"><label>연도<input name="year" type="number" min="1900" max="2100" value="${year}" required></label><div class="race-buttons">${competitions.map(c=>`<button type="button" data-create-competition="${esc(c.competition_id)}" ${disabled}>${esc(c.competition_name)}</button>`).join('')}</div><label>대회명<input name="name" maxlength="100" placeholder="위에서 고르거나 새 대회명 입력" required></label><button type="submit" class="primary-button" ${disabled}>대회 추가</button></form></details>`:'<p class="race-note">운영진이 최종 확정한 조 편성을 확인할 수 있습니다.</p>'}</section>`;
    if(!race){el('#raceWorkspace').innerHTML='<p class="race-note">대회를 선택해 주세요.</p>';return;}
    if(!admin){el('#raceWorkspace').innerHTML=`<section class="panel"><h2>${race.year} ${esc(race.name)}</h2>${race.finalized?race.finalized.groups.map(g=>groupHtml(g,false)).join(''):'<p>아직 최종 확정된 조 편성이 없습니다.</p>'}</section>`;return;}
    const list=groups(),dirty=local.has(race.id),conflict=dirty&&local.get(race.id).revision!==race.revision,ready=race.participantsConfirmed&&race.participants.length&&!selectedChanged();
    let valid=false;try{planner.validate(list,eligible(),race.year,true);valid=true;}catch{}
    const range=divisions.find(d=>d.competition_division_id===divisionId),rule=range&&planner.ageRange(range.competition_division_name);
    el('#raceWorkspace').innerHTML=`<section class="panel race-workspace"><div class="race-heading"><h2>${race.year} ${esc(race.name)}</h2><small>${race.finalized?'최종 확정본 있음':'작성 중'}</small></div><details class="race-participants" ${!race.participantsConfirmed||selectedChanged()?'open':''}><summary>참가자 확정 · ${selected().size}명${selectedChanged()?' · 미저장':''}</summary>${participantTable()}<button type="button" class="primary-button" data-race-action="saveParticipants" ${busy||!selected().size?'disabled':''}>참가자 저장</button></details><p class="race-note">${race.year}년 − 출생연도 기준 · 후보는 조별 최대 2명, 선택 사항</p><details id="raceGroupSettings" ${showSettings?'open':''}><summary>조 추가 · 종목 / 나이대 / 팀명</summary><div class="race-setting"><strong>종목</strong><div class="race-buttons">${events.filter(e=>planner.eventShape(e.competition_event_name)).map(e=>`<button type="button" data-race-event="${esc(e.competition_event_id)}" aria-pressed="${eventId===e.competition_event_id}" ${disabled}>${esc(e.competition_event_name)}</button>`).join('')}</div></div><div class="race-setting"><strong>나이대</strong><div class="race-buttons">${divisions.filter(d=>planner.ageRange(d.competition_division_name)).map(d=>`<button type="button" data-race-division="${esc(d.competition_division_id)}" aria-pressed="${divisionId===d.competition_division_id}" ${disabled}>${esc(d.competition_division_name)}</button>`).join('')}</div>${rule?`<small>출전 선수 합계 ${rule.min}세${rule.max===null?' 이상':' ~ '+rule.max+'세'}</small>`:''}</div><div class="race-setting"><strong>팀명</strong><div class="race-buttons">${['A팀','B팀','C팀','D팀'].map(name=>`<button type="button" data-race-team="${name}" aria-pressed="${teamName===name}" ${disabled}>${name}</button>`).join('')}<input id="raceTeamName" maxlength="30" placeholder="팀명 직접 입력" value="${esc(teamName)}" ${disabled}></div></div><button type="button" class="primary-button" data-race-action="addGroup" ${busy||!ready||!eventId||!divisionId||!teamName.trim()?'disabled':''}>조 추가</button></details>${!ready?'<p class="race-note">참가자를 선택하고 저장하면 조를 추가·배정할 수 있습니다.</p>':''}${conflict?'<p class="race-note">다른 변경이 있습니다. 최신 명단을 검토한 뒤 반영해 주세요. <button type="button" data-race-action="rebase">최신 명단 반영</button></p>':''}<div id="raceGroups">${list.map(g=>groupHtml(g,true)).join('')}</div><div class="race-bottom"><small role="status">${dirty?'미저장 변경사항':race.savedAt?'임시저장됨':''}</small><div class="race-buttons"><button type="button" data-race-action="recommend" ${busy||!ready||!list.length?'disabled':''}>추천 조합</button><button type="button" data-race-action="save" ${busy||!ready||!dirty||conflict?'disabled':''}>임시저장</button><button type="button" class="primary-button" data-race-action="finalize" ${busy||!ready||!valid||conflict?'disabled':''}>최종 확정</button></div></div><p class="race-note">후보는 자동 배정하지 않습니다. 같은 종목에서는 중복 배정할 수 없습니다.</p></section>`;
  }
  async function loadCatalog(){
    if(busy)return;const token=state.adminUserId,request=++epoch;busy=true;render();message('대회 정보를 불러오는 중입니다.');
    try{const result=await api(token?'raceLineupAdminData':'raceLineupList',{},!!token);if(request!==epoch||token!==state.adminUserId)return;races=result.races;players=result.players||[];events=result.events||[];divisions=result.divisions||[];competitions=result.competitions||[];loaded=true;message('');if(race){const result=await api(token?'raceLineupGetAdmin':'raceLineupGet',{id:race.id},!!token);if(request!==epoch||token!==state.adminUserId)return;race=result.race;}}
    catch(e){if(request===epoch&&token===state.adminUserId)message(e.message,true);}finally{if(request===epoch){busy=false;render();}}
  }
  async function openRace(id){
    if(busy)return;const token=state.adminUserId,request=++epoch;busy=true;render();
    try{const result=await api(token?'raceLineupGetAdmin':'raceLineupGet',{id},!!token);if(request!==epoch||token!==state.adminUserId)return;race=result.race;year=race.year;if(token&&!selections.has(id))selections.set(id,new Set(race.participants));target=null;showSettings=!(race.groups?.length);message('');}
    catch(e){if(request===epoch&&token===state.adminUserId)message(e.message,true);}finally{if(request===epoch){busy=false;render();}}
  }
  async function save(action,payload={}){
    if(busy||!state.adminUserId)return;const token=state.adminUserId,request=++epoch,base=local.get(race?.id);busy=true;target=null;render();message('저장 중입니다.');
    try{const result=await api(action,{id:race?.id,revision:base?.revision??race?.revision,...payload},true);if(request!==epoch||token!==state.adminUserId)return;race=result.race;year=race.year;
      if(action==='raceLineupParticipants'){
        selections.set(race.id,new Set(race.participants));if(base){cleanLocal(base.groups,new Set(race.participants));base.revision=race.revision;}
      }else{local.delete(race.id);selections.set(race.id,new Set(race.participants));}
      const summary={id:race.id,year:race.year,name:race.name,finalizedAt:race.finalized?.finalizedAt||''};races=races.filter(r=>r.id!==race.id).concat(summary);showSettings=!race.groups.length;
      message(action==='raceLineupFinalize'?'대회 조 편성을 최종 확정했습니다.':action==='raceLineupParticipants'?'참가자를 저장했습니다.':action==='raceLineupCreate'?'대회를 추가했습니다.':'조합을 임시저장했습니다.');
    }catch(e){if(request===epoch&&token===state.adminUserId)message(e.message,true);}finally{if(request===epoch){busy=false;render();}}
  }
  function commit(next){planner.validate(next,eligible(),race.year);local.set(race.id,{groups:next,revision:local.get(race.id)?.revision??race.revision});target=null;render();message('');}
  function localAction(action,b){
    const list=clone(groups()),g=list.find(g=>g.id===b?.dataset.group),index=Number(b?.dataset.slot);
    if(action==='addGroup'){const next=planner.group({id:crypto.randomUUID(),eventId,divisionId,teamName},events,divisions);showSettings=false;commit([...list,next]);}
    if(action==='removeGroup')commit(list.filter(v=>v.id!==g.id));
    if(action==='random')commit(planner.randomGroup(list,g.id,eligible(),race.year));
    if(action==='recommend')commit(planner.recommend(list,eligible(),race.year));
    if(action==='lock'){const slot=g?.slots[index];if(!slot?.name)throw new Error('선수를 먼저 배정해 주세요.');slot.locked=!slot.locked;commit(list);}
    if(action==='rebase'){const current=local.get(race.id);if(current){cleanLocal(current.groups,new Set(race.participants));current.revision=race.revision;render();message('최신 참가 명단을 반영했습니다. 조합을 확인해 주세요.');}}
  }
  panel.addEventListener('submit',e=>{if(e.target.id!=='raceCreateForm')return;e.preventDefault();const values=new FormData(e.target);save('raceLineupCreate',{year:Number(values.get('year')),name:values.get('name'),competitionId:createCompetition});});
  panel.addEventListener('input',e=>{if(e.target.id==='raceTeamName'){teamName=e.target.value;const add=el('[data-race-action="addGroup"]');if(add)add.disabled=busy||!race.participantsConfirmed||selectedChanged()||!eventId||!divisionId||!teamName.trim();}if(e.target.name==='name'&&e.target.closest('#raceCreateForm'))createCompetition='';});
  panel.addEventListener('toggle',e=>{if(e.target.id==='raceGroupSettings')showSettings=e.target.open;},true);
  function cancelHold(){clearTimeout(hold);hold=null;origin=null;}
  panel.addEventListener('pointerdown',e=>{longPress=false;const b=e.target.closest('[data-race-slot]');if(!b||busy||!state.adminUserId||e.button!==0)return;origin={x:e.clientX,y:e.clientY};hold=setTimeout(()=>{hold=null;longPress=true;try{localAction('lock',b);}catch(e){message(e.message,true);}},650);});
  panel.addEventListener('pointermove',e=>{if(origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>10)cancelHold();});['pointerup','pointercancel','pointerleave'].forEach(type=>panel.addEventListener(type,cancelHold));panel.addEventListener('contextmenu',e=>{if(e.target.closest('[data-race-slot]'))e.preventDefault();});
  panel.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||b.disabled||busy)return;if(longPress&&e.detail!==0){longPress=false;return;}longPress=false;
    try{
      if(b.dataset.raceYear){year=Number(b.dataset.raceYear);render();return;}
      if(b.dataset.raceId){openRace(b.dataset.raceId);return;}
      if(b.dataset.createCompetition){createCompetition=b.dataset.createCompetition;el('#raceCreateForm [name="name"]').value=competitions.find(c=>c.competition_id===createCompetition).competition_name;return;}
      if(b.dataset.racePlayer){const set=new Set(selected());if(set.has(b.dataset.racePlayer))set.delete(b.dataset.racePlayer);else set.add(b.dataset.racePlayer);selections.set(race.id,set);render();return;}
      if(b.dataset.raceEvent){eventId=b.dataset.raceEvent;render();return;}
      if(b.dataset.raceDivision){divisionId=b.dataset.raceDivision;render();return;}
      if(b.dataset.raceTeam){teamName=b.dataset.raceTeam;render();return;}
      if(b.hasAttribute('data-race-slot')){target={group:b.dataset.group,index:Number(b.dataset.slot)};render();return;}
      if(b.hasAttribute('data-race-name')){commit(planner.setSlot(groups(),b.dataset.group,Number(b.dataset.slot),b.dataset.raceName,eligible(),race.year));return;}
      const action=b.dataset.raceAction;
      if(action==='reload'){loadCatalog();return;}
      if(!state.adminUserId)return;
      if(action==='closePicker'){target=null;render();return;}
      if(action==='saveParticipants'){save('raceLineupParticipants',{names:[...selected()]});return;}
      if(action==='save'||action==='finalize'){save(action==='save'?'raceLineupSave':'raceLineupFinalize',{groups:groups()});return;}
      localAction(action,b);
    }catch(e){message(e.message,true);}
  });
  window.addEventListener('beforeunload',e=>{if(local.size||selectedChanged()){e.preventDefault();e.returnValue='';}});
  document.querySelector('[data-tab="race-lineup"]').addEventListener('click',()=>{panel.classList.add('is-active');if(!loaded||!!state.adminUserId&&!players.length)loadCatalog();else render();});
  document.addEventListener('club-admin-changed',()=>{epoch++;busy=false;loaded=false;race=null;players=[];events=[];divisions=[];competitions=[];local.clear();selections.clear();render();if(panel.classList.contains('is-active'))loadCatalog();});
  render();if(location.hash==='#race-lineup')document.querySelector('[data-tab="race-lineup"]').click();
})();
