(() => {
  'use strict';
  const api=window.ClubApi,button=document.querySelector('#kakaoLogin'),logout=document.querySelector('#memberLogout'),status=document.querySelector('#memberAuthStatus');
  let profile=null,pending=false;
  const dialog=document.createElement('dialog');dialog.className='member-dialog member-signup';dialog.setAttribute('aria-label','회원 가입');document.body.appendChild(dialog);
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const needsName=()=>Boolean(profile&&!profile.playerName&&!profile.requestedPlayerName);
  dialog.oncancel=event=>{if(needsName())event.preventDefault();};
  dialog.onclose=()=>{window.closeCompetitionMemberMenu?.();if(needsName()&&!dialog.open)dialog.showModal();};
  function render(){
    button.hidden=Boolean(profile);button.disabled=!api?.ready||pending;logout.hidden=!profile;
    status.textContent=profile?(profile.playerName?`${profile.playerName}님`:profile.requestedPlayerName?`${profile.requestedPlayerName} · 가입 승인 대기`:'회원 가입을 완료해 주세요'):api?.ready?'':'회원 로그인 준비 중';
    document.dispatchEvent(new CustomEvent('club-auth-changed',{detail:{member:needsName()?null:profile}}));
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
    dialog.innerHTML=`<div class="dialog-header"><h2>${profile.requestedPlayerName?'가입 승인 대기':'회원 가입'}</h2>${profile.requestedPlayerName?'<button type="button" data-close-link aria-label="닫기">×</button>':''}</div><p>${profile.requestedPlayerName?escape(profile.requestedPlayerName)+'님, 가입 신청이 완료되었습니다. 운영진 승인 후 참가 신청할 수 있습니다.':'회원명을 입력하고 가입 신청을 완료해 주세요. 운영진 승인 후 참가 신청할 수 있습니다.'}</p><p data-link-message role="status"></p>${profile.requestedPlayerName?'':'<form data-signup-form><label>이름<input type="text" data-link-search data-member-mode="search" maxlength="30" placeholder="회원명 입력" aria-label="회원명 입력" autocomplete="off" required></label><fieldset data-new-member-years hidden><legend>명부에 없는 신규 회원 정보</legend><label>출생연도<input type="number" data-signup-birth-year min="1900" step="1" inputmode="numeric" placeholder="예: 1984"></label><label>가입연도<input type="number" data-signup-join-year min="1900" step="1" inputmode="numeric" placeholder="예: 2026"></label></fieldset><button class="primary-button" type="submit" data-signup-submit disabled>가입 신청</button><button class="secondary-button member-signup-cancel" type="button" data-cancel-signup>가입 취소</button></form>'}`;
    const close=dialog.querySelector('[data-close-link]');if(close)close.onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();
    if(profile.requestedPlayerName)return;
    const cancel=dialog.querySelector('[data-cancel-signup]');
    cancel.onclick=async()=>{cancel.disabled=true;const cancelled=await signOut();if(!cancelled&&dialog.open)dialog.querySelector('[data-link-message]').textContent=status.textContent;cancel.disabled=false;};
    try{const {names}=await api.call('memberLinkOptions');if(!dialog.open||!profile||profile.playerName)return;
      const search=dialog.querySelector('[data-link-search]'),form=dialog.querySelector('[data-signup-form]'),submit=dialog.querySelector('[data-signup-submit]'),message=dialog.querySelector('[data-link-message]');
      const years=dialog.querySelector('[data-new-member-years]'),birth=dialog.querySelector('[data-signup-birth-year]'),join=dialog.querySelector('[data-signup-join-year]'),currentYear=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date()));
      birth.max=join.max=String(currentYear);join.value=String(currentYear);
      let saving=false;
      const validYear=input=>/^\d{4}$/.test(input.value)&&Number(input.value)>=1900&&Number(input.value)<=currentYear;
      function update(){
        if(saving)return;
        const name=search.value.trim(),isNew=Boolean(name&&!names.includes(name));years.hidden=!isNew;birth.required=join.required=isNew;
        submit.disabled=!name||name.length>30||isNew&&(!validYear(birth)||!validYear(join)||Number(join.value)<Number(birth.value));message.textContent='';
      }
      window.setupCompetitionMemberInput(search,names);
      search.oninput=birth.oninput=join.oninput=update;update();
      form.onsubmit=async event=>{event.preventDefault();update();if(submit.disabled||saving)return;
        const selectedName=search.value.trim(),isNew=!names.includes(selectedName),payload={name:selectedName,...(isNew?{birthYear:birth.value,joinYear:join.value}:{})};
        saving=true;cancel.disabled=true;submit.disabled=true;submit.textContent='신청 중…';search.disabled=birth.disabled=join.disabled=true;window.closeCompetitionMemberMenu?.();
        try{await api.call('memberLinkRequest',payload);await refresh();}
        catch(error){message.textContent=error.message;}
        finally{saving=false;cancel.disabled=false;if(dialog.querySelector('[data-signup-submit]')===submit){const text=message.textContent;search.disabled=birth.disabled=join.disabled=false;submit.textContent='가입 신청';update();message.textContent=text;}}
      };
    }catch(error){dialog.querySelector('[data-link-message]').textContent=error.message;}
  }
  async function signOut(){
    try{const {error}=await api.client.auth.signOut();if(error)throw error;profile=null;pending=false;if(dialog.open)dialog.close();render();return true;}
    catch{status.textContent='로그아웃하지 못했습니다. 다시 시도해 주세요.';return false;}
  }
  button.onclick=login;logout.onclick=signOut;
  document.addEventListener('click',event=>{if(event.target.closest('[data-member-login]'))login();if(event.target.closest('[data-member-link]'))refresh();});
  if(api?.client)api.client.auth.onAuthStateChange(()=>{setTimeout(refresh,0);});
  window.ClubMembership={get member(){return needsName()?null:profile;},login,refresh,bindMemberAccounts(container,isCurrent=()=>true,onSaved=async()=>{}){
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
