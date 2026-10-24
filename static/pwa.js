/* Installation uses the browser prompt where supported; other browsers get instructions. */
(() => {
  'use strict';
  const button=document.querySelector('#appInstallButton'),dialog=document.querySelector('#appInstallDialog');
  const standalone=window.matchMedia('(display-mode: standalone)');
  let installPrompt=null,installed=false;
  function updateButton(){
    const active=installed||standalone.matches||navigator.standalone===true;
    button.disabled=active;button.textContent=active?'앱 설치됨':'앱 설치';
  }
  function showInstructions(){
    const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const android=/Android/.test(navigator.userAgent);
    const samsung=/SamsungBrowser/i.test(navigator.userAgent);
    const steps=ios?['브라우저의 공유 버튼(□↑)을 누르세요.','‘홈 화면에 추가’를 선택하세요.','‘웹 앱으로 열기’ 옵션이 보이면 켠 뒤 ‘추가’를 누르세요.']:samsung?['삼성 인터넷에서는 기기에 따라 앱 설치 시 보안 경고가 나타날 수 있습니다.','아래 ‘사이트 주소 복사’를 누른 뒤 최신 Chrome에서 붙여넣어 여세요.','Chrome에서 ☰ → 앱 설치를 누르세요. 보안 경고가 계속되면 설치를 중단해 주세요.']:android?['최신 Chrome에서 이 사이트를 여세요.','이 사이트의 ☰ → 앱 설치 또는 Chrome 메뉴(⋮) → 홈 화면에 추가를 선택하세요.','보안 경고가 나타나면 설치를 중단하고 브라우저와 기기의 업데이트를 확인해 주세요.']:['Chrome 또는 Edge의 주소창 설치 아이콘이나 브라우저 메뉴에서 ‘앱 설치’를 선택하세요.','설치 항목이 없으면 Chrome 또는 Edge에서 이 사이트를 다시 열어주세요.'];
    const copy=document.querySelector('#appInstallCopyLink');copy.hidden=!android;copy.textContent='사이트 주소 복사';
    const list=document.querySelector('#appInstallSteps');list.replaceChildren(...steps.map(text=>{const item=document.createElement('li');item.textContent=text;return item;}));
    if(!dialog.open)dialog.showModal();
  }
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;updateButton();});
  window.addEventListener('appinstalled',()=>{installed=true;installPrompt=null;updateButton();if(dialog.open)dialog.close();});
  standalone.addEventListener?.('change',updateButton);
  button.addEventListener('click',async()=>{
    setHeaderMenuOpen(false);
    if(/SamsungBrowser/i.test(navigator.userAgent)||!installPrompt){showInstructions();return;}
    const prompt=installPrompt;installPrompt=null;
    try{await prompt.prompt();await prompt.userChoice;updateButton();}
    catch{showInstructions();}
  });
  document.querySelector('#appInstallClose').addEventListener('click',()=>dialog.close());
  document.querySelector('#appInstallCopyLink').addEventListener('click',async event=>{
    const copyButton=event.currentTarget;
    try{await navigator.clipboard.writeText(location.href);copyButton.textContent='주소 복사 완료';}
    catch{copyButton.textContent='브라우저 주소창에서 주소를 복사해 주세요';}
  });
  dialog.addEventListener('click',event=>{const rect=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))dialog.close();});
  dialog.addEventListener('close',()=>document.querySelector('#headerMenuToggle').focus());
  updateButton();
})();
