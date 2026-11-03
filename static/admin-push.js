(() => {
  'use strict';
  const host=document.querySelector('#adminPushSettings'),enable=document.querySelector('#adminPushEnable'),test=document.querySelector('#adminPushTest'),disable=document.querySelector('#adminPushDisable'),status=document.querySelector('#adminPushStatus');
  if(!host)return;
  let actor='',sequence=0,busy=false,connected=false,registration=null;
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const supported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
  const keyBytes=key=>Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-key.length%4)%4)),c=>c.charCodeAt(0));
  const call=(action,payload={})=>window.ClubApi.call(action,payload);
  const device=sub=>({endpoint:sub.endpoint,keys:sub.toJSON().keys});
  function render(message){
    host.hidden=!actor;enable.hidden=connected;disable.hidden=!connected;
    const available=supported()&&(!ios||standalone());
    enable.disabled=busy||!available;test.disabled=busy||!connected;disable.disabled=busy;
    if(message)status.textContent=message;
    else status.textContent=!available?(ios&&!standalone()?'Safari에서 홈 화면에 추가한 뒤 앱을 열어 주세요.':'이 브라우저는 푸시 알림을 지원하지 않습니다. Chrome 또는 Safari에서 열어 주세요.'):connected?'이 기기에서 신청자·요청 내용이 포함된 관리자 알림을 받습니다.':Notification.permission==='denied'?'브라우저·휴대폰 설정에서 이 사이트의 알림을 허용해 주세요.':'알림을 켜면 신청자·요청 내용이 담긴 가입·기록 요청 알림을 받습니다.';
  }
  async function worker(){
    registration=await navigator.serviceWorker.register(new URL('push-worker.js',new URL('./',location.href)),{scope:new URL('./',location.href).pathname,updateViaCache:'none'});await navigator.serviceWorker.ready;
    const pending=registration.installing||registration.waiting;
    if(pending&&pending.state!=='activated')await new Promise((resolve,reject)=>{
      const finish=()=>{if(['activated','redundant'].includes(pending.state)){clearTimeout(timer);pending.removeEventListener('statechange',finish);pending.state==='activated'?resolve():reject(new Error('알림 업데이트를 다시 시도해 주세요.'));}};
      const timer=setTimeout(()=>{pending.removeEventListener('statechange',finish);reject(new Error('알림 업데이트가 지연되고 있습니다. 다시 시도해 주세요.'));},15000);pending.addEventListener('statechange',finish);finish();
    });
    return registration;
  }
  async function disableDevice(){
    if(!supported())return;
    const reg=registration||await navigator.serviceWorker.getRegistration(new URL('./',location.href));
    const sub=await reg?.pushManager.getSubscription();
    try{if(sub){try{await call('adminPushDisable',{endpoint:sub.endpoint});}finally{await sub.unsubscribe();}}}
    finally{connected=false;}
  }
  async function setMember(member){
    const next=member?.role==='admin'?member.userId:'';
    if(next===actor)return;
    const current=++sequence;actor=next;connected=false;busy=false;render();
    if(!actor||!supported())return;
    try{
      const reg=await navigator.serviceWorker.getRegistration(new URL('./',location.href)),sub=await reg?.pushManager.getSubscription();
      const out=sub?await call('adminPushStatus',{endpoint:sub.endpoint}):{subscribed:false};
      if(current!==sequence)return;registration=reg||null;
      if(out.subscribed){await worker();if(current!==sequence)return;await call('adminPushSubscribe',device(sub));}
      if(current!==sequence)return;connected=out.subscribed;render();
    }catch{if(current===sequence)render('알림 연결을 확인하지 못했습니다. 알림창을 다시 열어 주세요.');}
  }
  enable.addEventListener('click',async()=>{
    if(!actor||busy)return;const current=++sequence;busy=true;render('알림 연결 중…');let sub;
    try{
      // Ask during the actual click, before any network wait (required by Safari).
      const permission=await Notification.requestPermission();
      if(permission!=='granted'){render('알림이 허용되지 않았습니다. 브라우저 설정에서 변경할 수 있습니다.');return;}
      const reg=await worker(),{publicKey}=await call('adminPushConfig');
      if(current!==sequence)return;
      sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
      if(current!==sequence){await sub.unsubscribe();return;}
      await call('adminPushSubscribe',device(sub));
      if(current!==sequence){await sub.unsubscribe();return;}
      connected=true;render('알림을 켰습니다. 테스트 알림을 보내 수신을 확인해 주세요.');
    }catch(error){if(current===sequence)render(error.message||'알림을 연결하지 못했습니다.');}
    finally{if(current===sequence){busy=false;render(status.textContent);}}
  });
  test.addEventListener('click',async()=>{
    if(!actor||busy||!connected)return;const current=sequence;busy=true;render('테스트 알림 전송 중…');
    try{const sub=await (await worker()).pushManager.getSubscription();if(!sub)throw new Error('알림을 다시 켜 주세요.');await call('adminPushTest',{endpoint:sub.endpoint});if(current===sequence)render('푸시 서비스에 전송했습니다. 휴대폰 알림을 확인해 주세요. 방해 금지·알림 설정에 따라 표시가 늦어질 수 있습니다.');}
    catch(error){if(current===sequence)render(error.message);}
    finally{if(current===sequence){busy=false;render(status.textContent);}}
  });
  disable.addEventListener('click',async()=>{if(!actor||busy)return;busy=true;render();try{await disableDevice();render('이 기기의 관리자 알림을 껐습니다.');}catch{render('알림 해제 상태를 확인하지 못했습니다. 다시 시도해 주세요.');}finally{busy=false;render(status.textContent);}});
  document.addEventListener('club-auth-changed',event=>setMember(event.detail.member));
  window.ClubPush={disable:async()=>{try{await disableDevice();}catch{/* Local unsubscribe is attempted even if the API is unavailable. */}}};
  render();setMember(window.ClubMembership?.member);
})();
