/* Installation uses the browser prompt where supported; other browsers get instructions. */
(() => {
  'use strict';
  const button=document.querySelector('#appInstallButton'),dialog=document.querySelector('#appInstallDialog'),androidButton=document.querySelector('#androidDownloadButton');
  const standalone=window.matchMedia('(display-mode: standalone)');
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const nativeApp=/SamsungRowingClubAndroid\//.test(navigator.userAgent);
  let installPrompt=null,installed=false;
  function updateButton(){
    const active=installed||standalone.matches||navigator.standalone===true;
    button.disabled=active;button.textContent=active?'홈 화면 앱 설치됨':'홈 화면에 추가';
    button.hidden=nativeApp;androidButton.hidden=ios||nativeApp;
  }
  function openInstallDialog(title,intro,steps,apk=false){
    document.querySelector('#appInstallTitle').textContent=title;
    document.querySelector('#appInstallIntro').textContent=intro;
    document.querySelector('#apkDownloadLink').hidden=!apk;
    document.querySelector('#apkCompatibility').hidden=!apk;
    const list=document.querySelector('#appInstallSteps');list.replaceChildren(...steps.map(text=>{const item=document.createElement('li');item.textContent=text;return item;}));
    if(!dialog.open)dialog.showModal();
  }
  function showInstructions(){
    const android=/Android/.test(navigator.userAgent);
    const steps=ios?['브라우저의 공유 버튼(□↑)을 누르세요.','‘홈 화면에 추가’를 선택하세요.','‘웹 앱으로 열기’ 옵션이 보이면 켠 뒤 ‘추가’를 누르세요.']:android?['브라우저 메뉴(⋮ 또는 ☰)를 누르세요.','‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택하세요.','설치 메뉴가 보이지 않으면 이 사이트를 Chrome 또는 삼성 인터넷에서 열어주세요.']:['Chrome 또는 Edge의 주소창 설치 아이콘이나 브라우저 메뉴에서 ‘앱 설치’를 선택하세요.','설치 항목이 없으면 Chrome 또는 Edge에서 이 사이트를 다시 열어주세요.'];
    openInstallDialog('홈 화면에 추가','홈 화면에 추가하면 앱처럼 바로 실행할 수 있습니다.',steps);
  }
  androidButton.addEventListener('click',()=>{
    setHeaderMenuOpen(false);
    openInstallDialog('Android 앱 다운로드','삼성조정클럽 앱을 휴대전화에 설치합니다.',[
      '아래 버튼으로 APK 파일을 다운로드하세요.',
      '다운로드한 파일을 열고 기기에 표시되는 설치 안내를 따라주세요.',
      '설치 후 홈 화면이나 앱 목록에서 ‘삼성조정클럽’을 실행하세요.'
    ],true);
  });
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;updateButton();});
  window.addEventListener('appinstalled',()=>{installed=true;installPrompt=null;updateButton();if(dialog.open)dialog.close();});
  standalone.addEventListener?.('change',updateButton);
  button.addEventListener('click',async()=>{
    setHeaderMenuOpen(false);
    if(!installPrompt){showInstructions();return;}
    const prompt=installPrompt;installPrompt=null;
    try{await prompt.prompt();await prompt.userChoice;updateButton();}
    catch{showInstructions();}
  });
  document.querySelector('#appInstallClose').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{const rect=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))dialog.close();});
  dialog.addEventListener('close',()=>document.querySelector('#headerMenuToggle').focus());
  updateButton();
})();
