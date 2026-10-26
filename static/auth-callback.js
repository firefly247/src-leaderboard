(async()=>{
  'use strict';
  const message=document.querySelector('#message'),params=new URLSearchParams(location.search);
  try{
    if(params.has('error'))throw new Error('카카오 로그인을 완료하지 못했습니다. 다시 시도해 주세요.');
    const code=params.get('code');if(!code||!window.ClubApi?.client)throw new Error('로그인 요청을 확인하지 못했습니다. 사이트에서 다시 로그인해 주세요.');
    const {error}=await ClubApi.client.auth.exchangeCodeForSession(code);
    history.replaceState(null,'',location.pathname);if(error)throw new Error('로그인이 만료되었거나 요청이 일치하지 않습니다. 다시 로그인해 주세요.');
    location.replace(new URL('../',location.href).href);
  }catch(error){history.replaceState(null,'',location.pathname);message.textContent=error.message;}
})();
