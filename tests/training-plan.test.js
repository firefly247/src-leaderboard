'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),plan=require('../static/training-plan.js');
const participants=n=>Array.from({length:n},(_,i)=>({id:`p${i}`,name:`선수${i}`,status:'참석',tenure:n-i}));
test('initial recommendation fills available fleet using seniority even without eligibility flags',()=>{
  const p=participants(6),draft=plan.recommend(p);assert.equal(draft.boats.length,2);assert.equal(draft.boats[0].type,'4X+');assert.equal(draft.boats[0].seats[0].id,'p0');assert.equal(draft.wait.length,0);
  const full=plan.recommend(participants(32));assert.equal(full.boats.flatMap(b=>b.seats).length,25);assert.equal(full.wait.length,7);
  p[5].canCox=true;assert.equal(plan.recommend(p).boats[0].seats[0].id,'p5');
});
test('added boats have fixed empty slots and random fill cannot steal other boats or move pins',()=>{
  const p=participants(10);let draft={boats:[plan.boat('4X+',0)],wait:[]};
  draft=plan.edit(draft,p,{operation:'random',boat:'유타쿼드 A'},()=>0);
  const first=JSON.stringify(draft.boats[0]);draft=plan.edit(draft,p,{operation:'addBoat',type:'2X'});
  assert.equal(draft.boats[1].seats.length,2);assert.ok(draft.boats[1].seats.every(m=>!m.id));
  draft=plan.edit(draft,p,{operation:'random',boat:'더블스컬 A'},()=>0);
  assert.equal(JSON.stringify(draft.boats[0]),first);
  draft=plan.edit(draft,p,{operation:'lock',boat:'더블스컬 A',seat:'1번'});const pinned=draft.boats[1].seats[0].id;
  draft=plan.edit(draft,p,{operation:'random',boat:'더블스컬 A'},()=>0.8);
  assert.equal(draft.boats[1].seats[0].id,pinned);assert.equal(new Set(draft.boats.flatMap(b=>b.seats.map(m=>m.id))).size,7);
  draft=plan.edit(draft,p,{operation:'removeBoat',boat:'더블스컬 A'});assert.equal(draft.wait.length,5);
});
test('random fill leaves shortages empty, swaps are atomic and locks survive recommendation',()=>{
  const p=participants(6);let draft=plan.recommend(p);const single=draft.boats.find(b=>b.type==='1X'),quad=draft.boats[0],id=quad.seats[2].id;
  draft=plan.edit(draft,p,{operation:'replace',boat:single.name,seat:'1번',id});
  assert.ok(draft.boats.find(b=>b.type==='1X').seats[0].changed);draft=plan.edit(draft,p,{operation:'lock',boat:single.name,seat:'1번'});
  const again=plan.recommend(p,draft);assert.equal(again.boats.find(b=>b.type==='1X').seats[0].id,id);
  const original=JSON.stringify(draft);assert.throws(()=>plan.edit(draft,p,{operation:'replace',boat:quad.name,seat:'1번',id}),/고정/);assert.equal(JSON.stringify(draft),original);
  let shortage=plan.edit({boats:[plan.boat('4X+',0)]},p.slice(0,2),{operation:'random',boat:quad.name},()=>0);assert.equal(shortage.boats[0].seats.filter(m=>m.id).length,2);
});
test('editing stays in memory until save or publish and retains the original revision for conflicts',()=>{
  const source=fs.readFileSync(`${__dirname}/../static/training.js`,'utf8'),calls=[],record={date:'2026-10-24',opened:true,revision:9,registrationRevision:6,participants:participants(6)};
  const context=vm.createContext({state:{adminUserId:'verified-admin'},busy:false,rosterData:[record],localDrafts:new Map(),TrainingPlan:plan,isDormantMember:()=>false,setView(){},render(){},message(){},mutate:(...args)=>calls.push(args)});
  vm.runInContext(source.match(/function draftAction\(date,action,payload=\{\}\)\{[\s\S]*?\n  \}/)[0],context);
  const action=(a,p)=>context.draftAction(record.date,a,p);
  action('trainingRecommend');action('trainingDraftEdit',{operation:'addBoat',type:'2X'});action('trainingDraftEdit',{operation:'random',boat:'더블스컬 A'});action('trainingDraftEdit',{operation:'lock',boat:'유타쿼드 A',seat:'COX'});
  assert.equal(calls.length,0);assert.equal(context.localDrafts.size,1);assert.equal(record.draft,undefined);
  record.revision=10;action('trainingDraftSave');assert.equal(calls.length,1);assert.equal(calls[0][0],'trainingDraftSave');assert.equal(calls[0][1].revision,9);
  action('trainingPublish');assert.equal(calls.length,2);assert.equal(calls[1][1].draft.boats.length,3);
});
