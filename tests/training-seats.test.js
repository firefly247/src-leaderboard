const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const modulePath='../supabase/functions/club-api/training-seats.mjs';
const blank=()=>({date:'2026-10-31',opened:true,revision:1,registrationRevision:0,participants:[],plan:null});
const member={player_name:'신청회원',role:'member'},admin={player_name:'운영진',role:'admin'};
let serial=0;const options={uuid:()=>`id-${++serial}`};
test('Fleet limits match physical inventory and cox is always the first seat',async()=>{
 const {FLEET,changeSeats}=await import(modulePath);let t=blank();
 for(const [type,spec] of Object.entries(FLEET)){
  for(let n=0;n<spec.limit;n++)t=changeSeats(t,'trainingBoatAdd',{type},member,options);
  assert.throws(()=>changeSeats(t,'trainingBoatAdd',{type},member,options),/모든 배/);
  const boat=t.seatBooking.boats.find(b=>b.type===type);assert.equal(boat.seats.length,spec.crew+(spec.cox?1:0));assert.equal(boat.seats[0].position,spec.cox?'COX':'1번');
 }
 assert.equal(t.seatBooking.boats.length,9);assert.equal(t.seatBooking.boats.flatMap(b=>b.seats).length,39);
 assert.throws(()=>changeSeats(t,'trainingBoatAdd',{type:'__proto__'},member,options));
});
test('Seat claims own the authenticated name, cannot displace another member and switch atomically',async()=>{
 const {changeSeats,seatView}=await import(modulePath);let t=changeSeats(blank(),'trainingBoatAdd',{type:'2X'},member,options);
 const select=(who,index)=>t=changeSeats(t,'trainingSeatSelect',{boatId:'2X-1',index,name:'위조 이름'},who,options);
 select(member,0);assert.equal(t.participants[0].name,member.player_name);assert.equal(t.participants[0].status,'참석');
 const before=JSON.stringify(t);assert.throws(()=>select({...member,player_name:'다른회원'},0),/먼저 선택/);assert.equal(JSON.stringify(t),before);
 select(member,1);assert.equal(t.seatBooking.boats[0].seats[0].memberId,null);assert.equal(seatView(t,member).boats[0].seats[1].mine,true);
 select(member,1);assert.equal(t.participants[0].status,'미정');assert.ok(t.seatBooking.boats[0].seats.every(s=>!s.memberId));
});
test('Members see occupancy and their own position; only admins receive names and comments',async()=>{
 const {changeSeats,seatView}=await import(modulePath);let t=changeSeats(blank(),'trainingBoatAdd',{type:'1X'},member,options);
 t=changeSeats(t,'trainingSeatSelect',{boatId:'1X-1',index:0,comment:'비공개 코멘트'},member,options);
 const other=seatView(t,{player_name:'다른회원'}),own=seatView(t,member),staff=seatView(t,admin,true);
 assert.doesNotMatch(JSON.stringify(other),/신청회원|비공개 코멘트|memberId|id-/);assert.equal(other.boats[0].seats[0].occupied,true);assert.equal(other.boats[0].seats[0].mine,false);
 assert.equal(own.boats[0].seats[0].mine,true);assert.equal(staff.boats[0].seats[0].name,'신청회원');
 const {boatHtml}=require('../static/training-seats.js');assert.doesNotMatch(boatHtml(other.boats[0],other,false,false),/신청회원/);assert.match(boatHtml(staff.boats[0],staff,true,false),/신청회원/);
});
test('Absence releases the seat, dormant members do not block seats, and occupied boats cannot be removed',async()=>{
 const {changeSeats,seatView}=await import(modulePath);let t=changeSeats(blank(),'trainingBoatAdd',{type:'1X'},member,options);
 t=changeSeats(t,'trainingSeatSelect',{boatId:'1X-1',index:0},member,options);
 assert.throws(()=>changeSeats(t,'trainingBoatRemove',{boatId:'1X-1'},member,options),/운영진/);
 assert.throws(()=>changeSeats(t,'trainingBoatRemove',{boatId:'1X-1'},admin,options),/신청된 자리/);
 const dormant=seatView(t,admin,true,['신청회원']);assert.equal(dormant.boats[0].seats[0].occupied,false);
 const released=changeSeats(t,'trainingSeatStatus',{status:'불참'},member,options);assert.equal(released.seatBooking.boats[0].seats[0].memberId,null);assert.equal(released.participants[0].status,'불참');
 assert.equal(changeSeats(released,'trainingBoatRemove',{boatId:'1X-1'},admin,options).seatBooking.boats.length,0);
});
test('Only admins can confirm complete crews; confirmation publishes a plan and freezes signup until reopened',async()=>{
 const {changeSeats}=await import(modulePath);let t=changeSeats(blank(),'trainingBoatAdd',{type:'2X'},member,options);
 t=changeSeats(t,'trainingSeatSelect',{boatId:'2X-1',index:0},member,options);
 assert.throws(()=>changeSeats(t,'trainingSeatConfirm',{},member,options),/운영진/);assert.throws(()=>changeSeats(t,'trainingSeatConfirm',{},admin,options),/빈자리/);
 t=changeSeats(t,'trainingSeatSelect',{boatId:'2X-1',index:1},{...member,player_name:'다른회원'},options);
 t=changeSeats(t,'trainingSeatConfirm',{},admin,options);assert.equal(t.seatBooking.confirmed,true);assert.equal(t.plan.boats[0].seats[0].name,'신청회원');assert.equal(t.plan.boats[0].seats[1].seat,'2번');
 assert.throws(()=>changeSeats(t,'trainingSeatStatus',{status:'불참'},member,options),/확정된 편성/);
 t=changeSeats(t,'trainingSeatReopen',{},admin,options);assert.equal(t.seatBooking.confirmed,false);assert.equal(t.plan.boats[0].seats.length,2);
});
test('Existing crew arrangements are derived without changing stored data',async()=>{
 const {seatBooking,seatView}=await import(modulePath);const t=blank();t.participants=[{id:'p',name:'기존회원',status:'참석'}];t.plan={boats:[{name:'싱글',type:'1X',seats:[{id:'p',name:'기존회원',seat:'1번'}]}]};
 const before=JSON.stringify(t);assert.equal(seatBooking(t).confirmed,true);assert.equal(seatView(t,{player_name:'기존회원'}).boats[0].seats[0].mine,true);assert.equal(JSON.stringify(t),before);
});
test('Comments preserve selected seats and full fleet renders the exhausted-inventory notice',async()=>{
 const {changeSeats,seatView,FLEET}=await import(modulePath);let t=changeSeats(blank(),'trainingBoatAdd',{type:'1X'},member,options);t=changeSeats(t,'trainingSeatSelect',{boatId:'1X-1',index:0},member,options);const id=t.seatBooking.boats[0].seats[0].memberId;
 t=changeSeats(t,'trainingSeatComment',{comment:'전달할 내용'},member,options);assert.equal(t.seatBooking.boats[0].seats[0].memberId,id);assert.equal(t.participants[0].status,'참석');assert.equal(t.participants[0].comment,'전달할 내용');
 for(const [type,spec] of Object.entries(FLEET))for(let i=t.seatBooking.boats.filter(b=>b.type===type).length;i<spec.limit;i++)t=changeSeats(t,'trainingBoatAdd',{type},member,options);
 const {trainingHtml}=require('../static/training-seats.js');const html=trainingHtml(seatView(t,member),FLEET,false,false,true);assert.match(html,/모든 배가 추가되었습니다/);assert.doesNotMatch(html,/확정 · 크루 편성 공개|신청회원/);assert.match(trainingHtml(seatView(t,admin,true),FLEET,true,false,false),/확정 · 크루 편성 공개/);
});
