'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('static/leaderboard.js','utf8');
function fixture(){
  let image;const images=[],status={hidden:true,textContent:''},attributes=new Map();
  const makeImage=()=>({hidden:false,src:'previous.jpg',decode:async()=>{},removeAttribute(name){delete this[name];},replaceWith(next){image=next;}});
  image=makeImage();const original=image;
  const dialog={open:false,showModal(){this.open=true;},setAttribute(name,value){attributes.set(name,value);},removeAttribute(name){attributes.delete(name);}};
  const document={querySelector:selector=>({'#photoDialog':dialog,'#proofPhotoImage':image,'#proofPhotoStatus':status}[selector]),createElement:()=>{const next=makeImage();images.push(next);return next;}};
  const context=vm.createContext({document,sessionStorage:{getItem:()=>''}});
  vm.runInContext(source.slice(0,source.indexOf('function recordTime(')),context);
  return {context,dialog,status,attributes,images,original,get image(){return image;}};
}
test('Opening another proof replaces the old bitmap immediately and reveals only the loaded image',async()=>{
  const f=fixture();f.context.openProofPhoto('selected.jpg');
  assert.notEqual(f.image,f.original);assert.equal(f.image.src,'selected.jpg');assert.equal(f.image.hidden,true);assert.equal(f.dialog.open,true);assert.equal(f.status.hidden,false);
  await f.image.onload();assert.equal(f.image.hidden,false);assert.equal(f.status.hidden,true);
  const previous=f.image;f.context.openProofPhoto('another.jpg');assert.notEqual(f.image,previous);assert.equal(f.image.hidden,true);assert.equal(f.image.src,'another.jpg');
});
test('A delayed decode from a previously selected record cannot reveal or replace the next photo',async()=>{
  const f=fixture();f.context.openProofPhoto('first.jpg');let finish;
  const first=f.image;first.decode=()=>new Promise(resolve=>finish=resolve);const pending=first.onload();
  f.context.openProofPhoto('second.jpg');const second=f.image;
  finish();await pending;assert.equal(f.image,second);assert.equal(second.hidden,true);assert.equal(f.status.hidden,false);assert.equal(f.attributes.get('aria-busy'),'true');
  await second.onload();assert.equal(second.hidden,false);assert.equal(f.status.hidden,true);
});
test('Closing clears the source and invalidates pending image work without disturbing a reopened dialog',async()=>{
  const f=fixture();f.context.openProofPhoto('first.jpg');let finish;
  f.image.decode=()=>new Promise(resolve=>finish=resolve);const pending=f.image.onload();
  f.dialog.open=false;f.context.resetProofPhoto();assert.equal(f.image.src,undefined);assert.equal(f.image.hidden,true);assert.equal(f.status.hidden,true);
  f.context.openProofPhoto('reopened.jpg');f.context.resetProofPhoto(); // A queued close event belongs to the old opening.
  const reopened=f.image;finish();await pending;assert.equal(reopened.hidden,true);
  await reopened.onload();assert.equal(reopened.hidden,false);assert.equal(reopened.src,'reopened.jpg');
});
test('Failed photo loads show an error instead of an old photo and the next opening can recover',async()=>{
  const f=fixture();f.context.openProofPhoto('missing.jpg');f.image.onerror();
  assert.equal(f.image.hidden,true);assert.equal(f.status.hidden,false);assert.match(f.status.textContent,/사진을 불러오지 못했습니다/);assert.equal(f.attributes.has('aria-busy'),false);
  f.context.openProofPhoto('working.jpg');await f.image.onload();assert.equal(f.image.hidden,false);assert.equal(f.status.hidden,true);
});
