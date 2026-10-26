(() => {
  'use strict';
  const api=window.ClubApi,button=document.querySelector('#kakaoLogin'),logout=document.querySelector('#memberLogout'),status=document.querySelector('#memberAuthStatus');
  let profile=null,pending=false;
  const dialog=document.createElement('dialog');dialog.className='member-dialog member-signup';dialog.setAttribute('aria-label','회원 가입');document.body.appendChild(dialog);
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(){
    button.hidden=Boolean(profile);button.disabled=!api?.ready||pending;logout.hidden=!profile;
    status.textContent=profile?(profile.playerName?`${profile.playerName}님`:profile.requestedPlayerName?`${profile.requestedPlayerName} · 가입 승인 대기`:'회원 가입을 완료해 주세요'):api?.ready?'':'카카오 로그인 준비 중';
    document.dispatchEvent(new CustomEvent('club-auth-changed',{detail:{member:profile}}));
  }
  async function refresh(){
    if(!api?.ready){render();return;}
    const {data:{session}}=await api.client.auth.getSession();
    if(!session){profile=null;if(dialog.open)dialog.close();render();return;}
    try{profile=(await api.call('memberSession')).member;render();if(profile.playerName&&dialog.open)dialog.close();if(!profile.playerName)await linkDialog();}
    catch(error){profile=null;render();status.textContent=error.message;}
  }
  async function login(){
    if(!api?.ready)return;pending=true;render();
    try{const redirectTo=new URL('static/auth-callback.html',new URL('./',location.href)).href;const {error}=await api.client.auth.signInWithOAuth({provider:'kakao',options:{redirectTo}});if(error)throw new Error('카카오 로그인에 연결하지 못했습니다.');}
    catch(error){pending=false;render();status.textContent=error.message;}
  }
  async function linkDialog(){
    if(!profile||profile.playerName)return;
    dialog.innerHTML=`<div class="dialog-header"><h2>${profile.requestedPlayerName?'가입 승인 대기':'회원 가입'}</h2><button type="button" data-close-link aria-label="닫기">×</button></div><p>${profile.requestedPlayerName?escape(profile.requestedPlayerName)+'님, 가입 신청이 완료되었습니다. 운영진 승인 후 참가 신청할 수 있습니다.':'본인 이름을 선택해 주세요. 운영진 승인 후 참가 신청할 수 있습니다.'}</p><p data-link-message role="status"></p>${profile.requestedPlayerName?'':'<form data-signup-form><input type="search" data-link-search placeholder="이름 검색" aria-label="선수 이름 검색"><div class="training-buttons" data-link-names></div><p data-link-selection role="status">선택한 이름이 없습니다.</p><button class="primary-button" type="submit" data-signup-submit disabled>가입 신청</button></form>'}`;
    dialog.querySelector('[data-close-link]').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();
    if(profile.requestedPlayerName)return;
    try{const {names}=await api.call('memberLinkOptions');if(!dialog.open||!profile||profile.playerName)return;
      const list=dialog.querySelector('[data-link-names]'),search=dialog.querySelector('[data-link-search]'),form=dialog.querySelector('[data-signup-form]'),submit=dialog.querySelector('[data-signup-submit]'),message=dialog.querySelector('[data-link-message]');
      let selectedName='',saving=false;
      function draw(){const filtered=names.filter(n=>n.includes(search.value.trim()));list.innerHTML=filtered.length?filtered.map(n=>`<button type="button" data-link-name="${escape(n)}" aria-pressed="${n===selectedName}">${escape(n)}</button>`).join(''):'<p>일치하는 선수가 없습니다. 운영진에게 문의해 주세요.</p>';}
      search.oninput=draw;draw();list.onclick=event=>{const selected=event.target.closest('[data-link-name]');if(!selected||saving)return;
        selectedName=selected.dataset.linkName;dialog.querySelector('[data-link-selection]').textContent=`선택한 이름: ${selectedName}`;submit.disabled=false;message.textContent='';draw();
      };
      form.onsubmit=async event=>{event.preventDefault();if(!selectedName||saving)return;saving=true;submit.disabled=true;submit.textContent='신청 중…';search.disabled=true;list.querySelectorAll('button').forEach(b=>b.disabled=true);
        try{await api.call('memberLinkRequest',{name:selectedName});await refresh();}
        catch(error){message.textContent=error.message;}
        finally{saving=false;if(dialog.querySelector('[data-signup-submit]')===submit){submit.disabled=false;submit.textContent='가입 신청';search.disabled=false;draw();}}
      };
    }catch(error){dialog.querySelector('[data-link-message]').textContent=error.message;}
  }
  button.onclick=login;logout.onclick=async()=>{const {error}=await api.client.auth.signOut();if(error){status.textContent='로그아웃하지 못했습니다.';return;}profile=null;if(dialog.open)dialog.close();render();};
  document.addEventListener('click',event=>{if(event.target.closest('[data-member-login]'))login();if(event.target.closest('[data-member-link]'))refresh();});
  if(api?.client)api.client.auth.onAuthStateChange(()=>{setTimeout(refresh,0);});
  window.ClubMembership={get member(){return profile;},login,refresh,async renderAdmin(container){
    const {links}=await window.api('memberLinkList',{},true);
    container.innerHTML='<h2>회원 계정 연결</h2><p>실제 회원인지 확인한 뒤 선수 연결을 승인해 주세요.</p>'+(links.length?links.map(row=>`<div class="training-member"><strong>${escape(row.requested_player_name)}</strong><small>카카오 ${escape(row.display_name||"회원")} · 계정 ${escape(row.user_id)}</small><button type="button" data-approve-user="${escape(row.user_id)}" data-player-name="${escape(row.requested_player_name)}">연결 승인</button><button type="button" data-reject-user="${escape(row.user_id)}" data-player-name="${escape(row.requested_player_name)}">거절</button></div>`).join(''):'<p>확인할 연결 요청이 없습니다.</p>');
    container.onclick=async event=>{const selected=event.target.closest('[data-approve-user],[data-reject-user]');if(!selected)return;selected.disabled=true;
      try{await window.api(selected.dataset.approveUser?'memberLinkApprove':'memberLinkReject',{userId:selected.dataset.approveUser||selected.dataset.rejectUser,name:selected.dataset.playerName},true);await window.ClubMembership.renderAdmin(container);}catch(error){selected.disabled=false;alert(error.message);}
    };
  }};
  refresh();
})();
