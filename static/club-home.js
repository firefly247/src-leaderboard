/* Club introduction: aggregate published competition records without athlete names. */
((root)=>{
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function summarize(records,dates=[]){
    const editions=new Map(),people=new Set(),medalKeys=new Set(),medals={gold:0,silver:0,bronze:0};
    const dateByEdition=new Map(dates.map(r=>[JSON.stringify([Number(r.year),r.competition_id]),r.competition_date]));
    for(const r of records){
      const year=Number(r.year),id=r.competitionId??r.competition_id,type=r.competitionType??r.competition_type??'water';
      if(!Number.isInteger(year)||year<1900||!id)continue;
      const key=JSON.stringify([year,id,type]);
      if(!editions.has(key))editions.set(key,{year,id,type,name:r.competitionName??r.competition_name,date:dateByEdition.get(JSON.stringify([year,id]))||'',events:new Set(),medals:{gold:0,silver:0,bronze:0}});
      const edition=editions.get(key),person=r.memberName??r.member_name,event=r.competitionEventName??r.competition_event_name;
      if(person)people.add(person);if(event)edition.events.add(event);
      for(const color of ['gold','silver','bronze']){
        const medalKey=JSON.stringify([year,id,type,r.competitionEventId??r.competition_event_id,r.competitionDivisionId??r.competition_division_id,r.note||'',color]);
        if(Number(r[color])>0&&!medalKeys.has(medalKey)){medalKeys.add(medalKey);medals[color]++;edition.medals[color]++;}
      }
    }
    const items=[...editions.values()].map(e=>({...e,name:String(e.name||'대회'),events:[...e.events].sort()})).sort((a,b)=>b.year-a.year||b.date.localeCompare(a.date)||a.name.localeCompare(b.name,'ko'));
    const years=items.map(e=>e.year);
    return {editions:items.length,people:people.size,medals,total:medalKeys.size,firstYear:years.length?Math.min(...years):null,lastYear:years.length?Math.max(...years):null,latest:items.slice(0,3)};
  }
  function render(records,dates){
    const target=document.querySelector('#clubHomeStats');if(!target)return;
    const summary=summarize(records,dates),range=summary.firstYear?`${summary.firstYear} — ${summary.lastYear}`:'대회 기록';
    document.querySelector('#clubHomeRange').textContent=range;
    target.innerHTML=[[summary.editions,'대회 출전','회'],[summary.total,'함께 이룬 메달','개'],[summary.people,'대회에 함께한 회원','명']].map(([value,label,unit])=>`<div class="club-stat"><span>${label}</span><strong>${value}<small>${unit}</small></strong></div>`).join('');
    document.querySelector('#clubHomeMedals').innerHTML=['gold','silver','bronze'].map((color,i)=>`<span><i class="club-medal-dot ${color}"></i>${['금','은','동'][i]} <strong>${summary.medals[color]}</strong></span>`).join('');
    document.querySelector('#clubHomeSeason').textContent=summary.lastYear?`${summary.lastYear} SEASON`:'';
    document.querySelector('#clubHomeRaces').innerHTML=summary.latest.length?summary.latest.map(e=>{
      const date=/^\d{4}-\d{2}-\d{2}$/.test(e.date)?`${e.date.slice(0,4)}.${e.date.slice(5,7)}.${e.date.slice(8,10)}`:String(e.year);
      const awards=['gold','silver','bronze'].filter(c=>e.medals[c]).map(c=>`<span class="club-race-medal"><i class="club-medal-dot ${c}"></i>${{gold:'금',silver:'은',bronze:'동'}[c]} ${e.medals[c]}</span>`).join('');
      return `<article class="club-race"><div class="club-race-meta"><span>${{water:'수상대회',indoor:'실내대회',beach:'비치대회'}[e.type]||'대회'}</span><time${e.date?` datetime="${esc(e.date)}"`:''}>${esc(date)}</time></div><h3>${esc(e.name)}</h3><p>${e.events.map(esc).join(' · ')}</p><div class="club-race-result">${awards||'<span>함께한 레이스</span>'}</div></article>`;
    }).join(''):'<p class="club-home-note">등록된 대회 기록을 기다리고 있습니다.</p>';
  }
  function setMember(signedIn){document.querySelectorAll('[data-home-login]').forEach(e=>e.hidden=signedIn);document.querySelectorAll('[data-home-member]').forEach(e=>e.hidden=!signedIn);}
  const api={summarize,render,setMember};if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ClubHome=api;
  if(typeof document!=='undefined'){
    document.addEventListener('club-auth-changed',e=>setMember(Boolean(e.detail.member)));
    document.addEventListener('click',e=>{if(e.target.closest('[data-home-view="competition"]'))document.querySelector('[data-tab="competition"]').click();});
  }
})(typeof window!=='undefined'?window:null);
