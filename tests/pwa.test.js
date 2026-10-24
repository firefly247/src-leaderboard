'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function app(userAgent='Android',matches=false){
  const listeners={},elements={},windowEvents={};let closedMenu=false;
  for(const id of ['appInstallButton','appInstallDialog','appInstallSteps','appInstallClose','headerMenuToggle'])elements[id]={textContent:'',disabled:false,open:false,addEventListener(type,fn){(listeners[id]??={})[type]=fn;},showModal(){this.open=true;},close(){this.open=false;},replaceChildren(...items){this.items=items;},focus(){}};
  const context=vm.createContext({document:{querySelector:selector=>elements[selector.slice(1)],createElement:()=>({textContent:''})},navigator:{userAgent,platform:'',maxTouchPoints:0},window:{matchMedia:()=>({matches,addEventListener(){}}),addEventListener:(type,fn)=>windowEvents[type]=fn},setHeaderMenuOpen:()=>{closedMenu=true;}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/pwa.js'),'utf8'),context);
  return {elements,windowEvents,click:()=>listeners.appInstallButton.click(),menuClosed:()=>closedMenu};
}
test('install guidance covers iPhone and Android when no browser prompt is available',async()=>{
  for(const [agent,expected] of [['iPhone','共有'],['Android','Chrome']]){
    const current=app(agent);await current.click();assert.equal(current.elements.appInstallDialog.open,true);assert.equal(current.menuClosed(),true);
    const text=current.elements.appInstallSteps.items.map(item=>item.textContent).join(' ');
    assert.match(text,agent==='iPhone'?/홈 화면에 추가/:new RegExp(expected));
  }
});
test('the captured browser prompt is used once and cancellation does not claim installation',async()=>{
  const current=app();let prompted=0,prevented=false;
  current.windowEvents.beforeinstallprompt({preventDefault(){prevented=true;},async prompt(){prompted++;},userChoice:Promise.resolve({outcome:'dismissed'})});
  await current.click();assert.equal(prevented,true);assert.equal(prompted,1);assert.equal(current.elements.appInstallButton.disabled,false);assert.equal(current.elements.appInstallDialog.open,false);
  await current.click();assert.equal(prompted,1);assert.equal(current.elements.appInstallDialog.open,true);
});
test('installed and standalone apps show their actual installed state',()=>{
  assert.equal(app('Android',true).elements.appInstallButton.disabled,true);
  const current=app();current.windowEvents.appinstalled();assert.equal(current.elements.appInstallButton.textContent,'앱 설치됨');assert.equal(current.elements.appInstallButton.disabled,true);
});
test('Samsung Internet uses the available browser install prompt',async()=>{
  const current=app('Android SamsungBrowser/28.0');let prompted=false;
  current.windowEvents.beforeinstallprompt({preventDefault(){},async prompt(){prompted=true;},userChoice:Promise.resolve({outcome:'accepted'})});
  await current.click();assert.equal(prompted,true);assert.equal(current.elements.appInstallDialog.open,false);
});
test('manifest targets the project root and references deployable PNG icons',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../static/manifest.webmanifest'),'utf8'));
  const url=new URL('https://firefly247.github.io/src-leaderboard/static/manifest.webmanifest');
  assert.equal(new URL(manifest.start_url,url).pathname,'/src-leaderboard/');assert.equal(new URL(manifest.scope,url).pathname,'/src-leaderboard/');assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons){const bytes=fs.readFileSync(path.join(__dirname,'../static',icon.src));assert.equal(bytes.readUInt32BE(16),Number(icon.sizes.split('x')[0]));}
});
