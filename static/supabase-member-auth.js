(() => {
  'use strict';
  const api=window.ClubApi,button=document.querySelector('#kakaoLogin'),logout=document.querySelector('#memberLogout'),status=document.querySelector('#memberAuthStatus');
  let profile=null,pending=false;
  const dialog=document.createElement('dialog');dialog.className='member-dialog member-signup';dialog.setAttribute('aria-label','회원 가입');document.body.appendChild(dialog);
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(){
    button.hidden=Boolean(profile);button.disabled=!api?.ready||pending;logout.hidden=!profile;
    status.textContent=profile?(profile.playerName?`${profile.playerName}님`:profile.requestedPlayerName?`${profile.requestedPlayerName} · 가입 승인 대기`:'회원 가입을 완료해 주세요'):api?.ready?'':'회원 로그인 준비 중';
    document.dispatchEvent(new CustomEvent('club-auth-changed',{detail:{member:profile}}));
  }
  async function refresh(){
    if(!api?.ready){render();return;}
    const {data:{session}}=await api.client.auth.getSession();
    if(!session){profile=null;if(dialog.open)dialog.close();render();return;}
    try{profile=(await api.call('memberSession')).member;render();if(profile.playerName&&dialog.open)dialog.close();if(!profile.playerName&&(!dialog.open||profile.requestedPlayerName))await linkDialog();}
    catch(error){profile=null;render();status.textContent=error.message;}
  }
  async function login(){
    if(!api?.ready)return;pending=true;render();
    // `scopes` adds to Kakao's defaults; the singular OAuth scope overrides them.
    try{const redirectTo=new URL('static/auth-callback.html',new URL('./',location.href)).href;const {error}=await api.client.auth.signInWithOAuth({provider:'kakao',options:{redirectTo,queryParams:{scope:'profile_nickname'}}});if(error)throw new Error('회원 로그인에 연결하지 못했습니다.');}
    catch(error){pending=false;render();status.textContent=error.message;}
  }
  async function linkDialog(){
    if(!profile||profile.playerName)return;
    window.closeCompetitionMemberMenu?.();
    dialog.innerHTML=`<div class="dialog-header"><h2>${profile.requestedPlayerName?'가입 승인 대기':'회원 가입'}</h2><button type="button" data-close-link aria-label="닫기">×</button></div><p>${profile.requestedPlayerName?escape(profile.requestedPlayerName)+'님, 가입 신청이 완료되었습니다. 운영진 승인 후 참가 신청할 수 있습니다.':'본인 이름을 입력해 주세요. 운영진 승인 후 참가 신청할 수 있습니다.'}</p><p data-link-message role="status"></p>${profile.requestedPlayerName?'':'<form data-signup-form><label>이름<input type="text" data-link-search data-member-mode="search" maxlength="30" placeholder="회원명 입력" aria-label="회원명 입력" autocomplete="off" required></label><button class="primary-button" type="submit" data-signup-submit disabled>가입 신청</button></form>'}`;
    dialog.onclose=()=>window.closeCompetitionMemberMenu?.();dialog.querySelector('[data-close-link]').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();
    if(profile.requestedPlayerName)return;
    try{const {names}=await api.call('memberLinkOptions');if(!dialog.open||!profile||profile.playerName)return;
      const search=dialog.querySelector('[data-link-search]'),form=dialog.querySelector('[data-signup-form]'),submit=dialog.querySelector('[data-signup-submit]'),message=dialog.querySelector('[data-link-message]');
      let saving=false;
      window.setupCompetitionMemberInput(search,names);
      search.oninput=()=>{if(saving)return;submit.disabled=!names.includes(search.value.trim());message.textContent='';};
      form.onsubmit=async event=>{event.preventDefault();const selectedName=search.value.trim();if(!names.includes(selectedName)||saving)return;saving=true;submit.disabled=true;submit.textContent='신청 중…';search.disabled=true;window.closeCompetitionMemberMenu?.();
        try{await api.call('memberLinkRequest',{name:selectedName});await refresh();}
        catch(error){message.textContent=error.message;}
        finally{saving=false;if(dialog.querySelector('[data-signup-submit]')===submit){submit.disabled=!names.includes(search.value.trim());submit.textContent='가입 신청';search.disabled=false;}}
      };
    }catch(error){dialog.querySelector('[data-link-message]').textContent=error.message;}
  }
  button.onclick=login;logout.onclick=async()=>{const {error}=await api.client.auth.signOut();if(error){status.textContent='로그아웃하지 못했습니다.';return;}profile=null;if(dialog.open)dialog.close();render();};
  document.addEventListener('click',event=>{if(event.target.closest('[data-member-login]'))login();if(event.target.closest('[data-member-link]'))refresh();});
  if(api?.client)api.client.auth.onAuthStateChange(()=>{setTimeout(refresh,0);});
  window.ClubMembership={get member(){return profile;},login,refresh,bindMemberAccounts(container,isCurrent=()=>true,onSaved=async()=>{}){
    const previous=container._clubAccountHandlers;if(previous){container.removeEventListener('change',previous.change);container.removeEventListener('click',previous.click);}
    const changed=async(refreshSelf=false)=>{if(refreshSelf)await refresh();if(profile?.role==='admin'&&isCurrent())await onSaved();};
    const change=async event=>{const selected=event.target.closest('[data-account-user]');if(!selected||selected.disabled||!isCurrent())return;selected.disabled=true;
      try{await window.api('memberAccountRole',{userId:selected.dataset.accountUser,role:selected.checked?'admin':'member'},true);selected.dataset.accountRole=selected.checked?'admin':'member';await changed(selected.dataset.accountUser===profile?.userId);}
      catch(error){selected.checked=selected.dataset.accountRole==='admin';if(isCurrent())alert(error.message);}
      finally{if(isCurrent())selected.disabled=false;}
    };
    const click=async event=>{const selected=event.target.closest('[data-approve-user],[data-reject-user]');if(!selected||selected.disabled||!isCurrent())return;selected.disabled=true;
      try{await window.api(selected.dataset.approveUser?'memberLinkApprove':'memberLinkReject',{userId:selected.dataset.approveUser||selected.dataset.rejectUser,name:selected.dataset.playerName},true);await changed();}
      catch(error){if(isCurrent())alert(error.message);}
      finally{if(isCurrent())selected.disabled=false;}
    };
    container._clubAccountHandlers={change,click};container.addEventListener('change',change);container.addEventListener('click',click);
  }};
  refresh();
})();
