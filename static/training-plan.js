/* Pure, in-memory crew editing. Persistence is handled only by save/publish. */
((root)=>{
  'use strict';
  const limits={'4X+':4,'2X':2,'1X':1};
  const clone=value=>JSON.parse(JSON.stringify(value));
  function boat(type,index){
    if(!limits[type])throw new Error('보트를 확인해 주세요.');
    return {name:type==='4X+'?'유타쿼드 '+String.fromCharCode(65+index):type==='2X'?'더블스컬 '+String.fromCharCode(65+index):'싱글스컬',type,seats:(type==='4X+'?['COX','1번','2번','3번','4번']:type==='2X'?['1번','2번']:['1번']).map(seat=>({seat,id:'',name:''}))};
  }
  function wait(draft,participants){
    const used=new Set(draft.boats.flatMap(b=>b.seats.map(m=>m.id)));
    draft.wait=participants.filter(m=>m.status==='참석'&&!used.has(m.id)).map(m=>({id:m.id,name:m.name,reason:'배정 대기'}));return draft;
  }
  function recommend(participants,previous){
    const people=participants.filter(m=>m.status==='참석'),pins=(previous?.boats||[]).flatMap(b=>b.seats.filter(m=>m.locked).map(m=>({boat:b.name,...m})));
    if(pins.some(m=>!people.some(p=>p.id===m.id)))throw new Error('고정된 멤버의 참가 여부를 확인하고 고정을 해제해 주세요.');
    let best=null;
    for(let q=0;q<=4;q++)for(let d=0;d<=2;d++)for(let s=0;s<=1;s++){
      const count=q*5+d*2+s;if(count>people.length)continue;
      const boats=[...Array.from({length:q},(_,i)=>boat('4X+',i)),...Array.from({length:d},(_,i)=>boat('2X',i)),...(s?[boat('1X',0)]:[])],used=new Set();let valid=true;
      pins.forEach(m=>{const seat=boats.find(b=>b.name===m.boat)?.seats.find(p=>p.seat===m.seat);if(!seat||used.has(m.id)){valid=false;return;}Object.assign(seat,{id:m.id,name:m.name,locked:true,changed:!!m.changed});used.add(m.id);});
      if(!valid)continue;
      const senior=(a,b)=>(b.tenure||0)-(a.tenure||0)||a.name.localeCompare(b.name,'ko');
      const fill=(seat,sort)=>{if(seat.id)return;const m=people.filter(p=>!used.has(p.id)).sort(sort)[0];Object.assign(seat,{id:m.id,name:m.name});used.add(m.id);};
      boats.filter(b=>b.type==='4X+').forEach(b=>fill(b.seats[0],(a,b)=>Number(!!b.canCox)-Number(!!a.canCox)||senior(a,b)));
      boats.filter(b=>b.type!=='4X+').forEach(b=>b.seats.forEach(seat=>fill(seat,(a,b)=>Number(!!b.canSmallBoat)-Number(!!a.canSmallBoat)||senior(a,b))));
      for(let seat=1;seat<=4;seat++)boats.filter(b=>b.type==='4X+').forEach(b=>fill(b.seats[seat],senior));
      const score=count*1000+q;if(!best||score>best.score)best={score,boats};
    }
    if(!best)throw new Error('고정된 배와 좌석을 유지할 수 없습니다. 고정을 조정해 주세요.');
    return wait({boats:best.boats},participants);
  }
  function edit(original,participants,p,rng=Math.random){
    const draft=clone(original),people=participants.filter(m=>m.status==='참석');
    if(p.operation==='addBoat'){
      if(!limits[p.type])throw new Error('보트를 확인해 주세요.');
      const index=Array.from({length:limits[p.type]},(_,i)=>i).find(i=>!draft.boats.some(b=>b.name===boat(p.type,i).name));
      if(index==null)throw new Error('보유한 보트 수를 초과했습니다.');draft.boats.push(boat(p.type,index));
    }else{
      const b=draft.boats.find(b=>b.name===p.boat);if(!b)throw new Error('보트를 찾을 수 없습니다.');
      if(p.operation==='removeBoat'){
        draft.boats=draft.boats.filter(v=>v!==b);
      }else if(p.operation==='random'){
        const taken=new Set(draft.boats.flatMap(v=>v===b?v.seats.filter(m=>m.locked):v.seats).map(m=>m.id));
        const pool=people.filter(m=>!taken.has(m.id));
        for(let i=pool.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
        b.seats.filter(m=>!m.locked).forEach(seat=>{const m=pool.shift();Object.assign(seat,{id:m?.id||'',name:m?.name||'',changed:!!m&&(!!seat.changed||seat.id!==m.id)});});
      }else{
        const seat=b.seats.find(m=>m.seat===p.seat);if(!seat)throw new Error('좌석을 찾을 수 없습니다.');
        if(p.operation==='lock'){
          if(!seat.id)throw new Error('멤버를 먼저 배정해 주세요.');seat.locked=!seat.locked;
        }else if(p.operation==='replace'){
          if(seat.locked)throw new Error('고정을 해제한 뒤 변경해 주세요.');
          const member=people.find(m=>m.id===p.id);if(!member)throw new Error('참석 신청자를 선택해 주세요.');
          const other=draft.boats.flatMap(b=>b.seats).find(m=>m.id===member.id);
          if(other===seat)return draft;if(other?.locked)throw new Error('선택한 멤버의 고정을 먼저 해제해 주세요.');
          if(other)Object.assign(other,{id:seat.id,name:seat.name,changed:true});Object.assign(seat,{id:member.id,name:member.name,changed:true});
        }else throw new Error('변경 작업을 확인해 주세요.');
      }
    }
    return wait(draft,participants);
  }
  const api={boat,recommend,edit,wait};if(typeof module==='object'&&module.exports)module.exports=api;else root.TrainingPlan=api;
})(globalThis);
