/* Pending approvals are read through the existing role-protected admin APIs. */
((root)=>{
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function collectNotifications(requests=[],links=[]){
    const records=requests.filter(r=>r.status==='pending'&&['add','competition_add'].includes(r.request_type)).map(r=>({key:'record:'+r.request_id,view:r.request_type==='add'?'add':'competition-add',title:r.request_type==='add'?'ERG 기록 등록 요청':'대회 기록 등록 요청',name:r.member_name||'회원',detail:r.event_name||r.competition_name||'',time:r.requested_at||''}));
    const members=links.filter(a=>a.requested_player_name&&!a.player_name).map(a=>({key:'member:'+a.user_id,view:'member-info',title:'회원 가입 요청',name:a.requested_player_name,detail:'가입 승인 대기',time:''}));
    return [...members,...records.sort((a,b)=>b.time.localeCompare(a.time))];
  }
  function createNotificationStore({call,onChange=()=>{}}){
    let actor='',sequence=0,items=[],loading=false,error='';
    const value=()=>({enabled:Boolean(actor),items:items.slice(),loading,error});
    async function refresh(){
      if(!actor||loading)return;
      const current=++sequence;loading=true;error='';onChange(value());
      try{
        const [records,members]=await Promise.all([call('adminList',{view:'pending'}),call('memberLinkList',{})]);
        if(current!==sequence)return;
        items=collectNotifications(records.requests,members.links);
      }catch(e){if(current===sequence)error=e.message||'알림을 불러오지 못했습니다.';}
      finally{if(current===sequence){loading=false;onChange(value());}}
    }
    function setMember(member){
      const next=member?.role==='admin'?member.userId:'';
      if(next!==actor){actor=next;sequence++;items=[];loading=false;error='';onChange(value());}
      return refresh();
    }
    return {refresh,setMember,get value(){return value();}};
  }
  const exported={collectNotifications,createNotificationStore};if(typeof module==='object'&&module.exports)module.exports=exported;
  if(!root||typeof document==='undefined')return;
  const host=document.querySelector('#adminNotifications'),toggle=document.querySelector('#adminNotificationToggle'),panel=document.querySelector('#adminNotificationPanel'),badge=document.querySelector('#adminNotificationBadge'),list=document.querySelector('#adminNotificationList'),status=document.querySelector('#adminNotificationStatus'),reload=document.querySelector('#adminNotificationRefresh');
  if(!host)return;
  let open=false,renderedItems='';
  function setOpen(next){open=next&&store.value.enabled;panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));}
  function render(state){
    host.hidden=!state.enabled;
    if(!state.enabled){setOpen(false);list.innerHTML='';renderedItems='';badge.textContent='';badge.hidden=true;status.textContent='';return;}
    const count=state.items.length;
    badge.textContent=count>99?'99+':String(count);badge.hidden=!count;
    toggle.setAttribute('aria-label',`관리자 알림, 승인 대기 ${count}건`);
    reload.disabled=state.loading;
    status.textContent=state.error?'알림을 불러오지 못했습니다. 새로고침해 주세요.':state.loading?'알림 확인 중…':count?`승인 대기 ${count}건`:'승인 대기 중인 요청이 없습니다.';
    const fingerprint=JSON.stringify(state.items);if(fingerprint===renderedItems)return;renderedItems=fingerprint;
    list.innerHTML=state.items.map((item,index)=>`<button type="button" class="admin-notification-item" data-notification-index="${index}"><span class="admin-notification-kind">${esc(item.title)}</span><strong>${esc(item.name)}</strong><small>${esc(item.detail)}</small><span class="admin-notification-arrow" aria-hidden="true">›</span></button>`).join('');
  }
  const store=createNotificationStore({call:(action,payload)=>root.ClubApi.call(action,payload),onChange:render});
  toggle.addEventListener('click',()=>{setOpen(!open);if(open){root.setHeaderMenuOpen?.(false);store.refresh();}});
  reload.addEventListener('click',()=>store.refresh());
  list.addEventListener('click',event=>{
    const button=event.target.closest('[data-notification-index]'),item=button&&store.value.items[Number(button.dataset.notificationIndex)];
    if(!item||!store.value.enabled)return;setOpen(false);root.openClubTab('admin',item.view);
  });
  document.addEventListener('click',event=>{if(open&&!host.contains(event.target))setOpen(false);});
  document.addEventListener('keydown',event=>{if(open&&event.key==='Escape'){setOpen(false);toggle.focus();}});
  document.addEventListener('club-auth-changed',event=>store.setMember(event.detail.member));
  document.addEventListener('club-admin-requests-changed',()=>store.refresh());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)store.refresh();});
  setInterval(()=>{if(!document.hidden)store.refresh();},60000);
  render(store.value);
})(typeof window!=='undefined'?window:null);
