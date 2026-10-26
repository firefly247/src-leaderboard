/* Shared pure planner. Keep apps-script/RaceLineupPlan.gs identical. */
var RaceLineupPlan=(()=>{
  'use strict';
  const copy=v=>JSON.parse(JSON.stringify(v));
  function age(player,year){const birth=String(player?.birthYear||'');return /^\d{4}$/.test(birth)&&Number(birth)>=1900&&Number(birth)<=year?year-Number(birth):null;}
  function eventShape(name){
    if(String(name).trim()==='로잉머신')return {rowers:1,cox:false};
    const m=String(name).trim().toUpperCase().match(/^([1248])X?([+-])?$/);return m?{rowers:Number(m[1]),cox:m[2]==='+'}:null;
  }
  function ageRange(name){
    const label=String(name).replace(/\s/g,'');let m;
    if(/일반부|오픈|OPEN/i.test(label))return {min:0,max:null};
    if((m=label.match(/(\d+)(?:세)?[~～–-](\d+)(?:세)?/)))return Number(m[1])<Number(m[2])?{min:Number(m[1]),max:Number(m[2])-1}:null;
    if((m=label.match(/(\d+)(?:세)?미만/)))return {min:0,max:Number(m[1])-1};
    if((m=label.match(/(\d+)(?:세)?이하/)))return {min:0,max:Number(m[1])};
    if((m=label.match(/(\d+)(?:세)?이상/)))return {min:Number(m[1]),max:null};
    if((m=label.match(/(\d+)(?:세)?초과/)))return {min:Number(m[1])+1,max:null};
    return null;
  }
  function group(config,events,divisions){
    const event=events.find(e=>e.competition_event_id===config.eventId),division=divisions.find(d=>d.competition_division_id===config.divisionId),shape=event&&eventShape(event.competition_event_name),range=division&&ageRange(division.competition_division_name),team=String(config.teamName||'').trim();
    if(!shape)throw new Error('좌석 수를 확인할 수 있는 종목을 선택해 주세요.');
    if(!range)throw new Error('합계 나이 범위가 있는 나이대 또는 일반부를 선택해 주세요.');
    if(!team||team.length>30||/[<>\x00-\x1f]/.test(team))throw new Error('팀명을 30자 이내로 입력해 주세요.');
    if(typeof config.id!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(config.id))throw new Error('조 정보를 확인해 주세요.');
    return {id:config.id,eventId:config.eventId,eventName:event.competition_event_name,divisionId:config.divisionId,divisionName:division.competition_division_name,teamName:team,...shape,...range,slots:[...(shape.cox?[{kind:'cox',label:'COX'}]:[]),...Array.from({length:shape.rowers},(_,i)=>({kind:'rower',label:(i+1)+'번'})),{kind:'reserve',label:'후보 1'},{kind:'reserve',label:'후보 2'}].map(s=>({...s,name:'',locked:false,changed:false}))};
  }
  function status(g,players,year){
    const byName=new Map(players.map(p=>[p.memberName,p])),rowers=g.slots.filter(s=>s.kind==='rower'),main=g.slots.filter(s=>s.kind!=='reserve');
    const ages=rowers.map(s=>s.name?age(byName.get(s.name),year):null),complete=main.every(s=>s.name),known=ages.every(a=>a!==null),sum=ages.reduce((n,a)=>n+(a||0),0),within=known&&sum>=g.min&&(g.max===null||sum<=g.max);
    return {sum,complete,known,within,valid:complete&&within,missing:rowers.some(s=>s.name&&age(byName.get(s.name),year)===null)};
  }
  function validate(groups,players,year,complete=false){
    const ids=new Set(),teams=new Set(),assigned=new Set(),known=new Set(players.map(p=>p.memberName));
    if(!Array.isArray(groups)||groups.length>40)throw new Error('조는 최대 40개까지 추가할 수 있습니다.');
    if(complete&&!groups.length)throw new Error('조를 먼저 추가해 주세요.');
    groups.forEach(g=>{
      const key=[g.eventId,g.divisionId,g.teamName].join('\0');if(ids.has(g.id)||teams.has(key))throw new Error('같은 종목·나이대·팀명의 조가 중복되었습니다.');ids.add(g.id);teams.add(key);
      g.slots.forEach(s=>{if(!s.name)return;if(!known.has(s.name))throw new Error(s.name+': 확정된 참가자가 아닙니다.');const k=g.eventId+'\0'+s.name;if(assigned.has(k))throw new Error(s.name+': 같은 종목에 중복 배정할 수 없습니다.');assigned.add(k);});
      const result=status(g,players,year);
      if(result.known&&result.complete&&!result.within)throw new Error(g.teamName+': 콕스·후보 제외 합계 나이가 나이대에 맞지 않습니다.');
      if(g.max!==null&&result.sum>g.max)throw new Error(g.teamName+': 합계 나이가 상한을 초과합니다.');
      if(complete&&!result.valid)throw new Error(g.teamName+': 출전 슬롯과 회원 생년·합계 나이를 확인해 주세요.');
    });return groups;
  }
  function normalise(input,players,year,events,divisions,complete=false){
    if(!Array.isArray(input)||input.length>40)throw new Error('조 정보를 확인해 주세요.');
    const groups=input.map(raw=>{
      const g=group(raw,events,divisions);if(!Array.isArray(raw.slots)||raw.slots.length!==g.slots.length)throw new Error('종목의 좌석 수를 확인해 주세요.');
      g.slots=g.slots.map((s,i)=>{const value=raw.slots[i];if(!value||value.kind!==s.kind||typeof value.name!=='string')throw new Error('좌석 정보를 확인해 주세요.');return {...s,name:value.name,locked:!!value.name&&value.locked===true,changed:value.changed===true};});return g;
    });return validate(groups,players,year,complete);
  }
  function setSlot(original,id,index,name,players,year){
    const groups=copy(original),g=groups.find(g=>g.id===id),slot=g?.slots[index];if(!slot)throw new Error('좌석을 찾을 수 없습니다.');
    if(slot.locked)throw new Error('고정을 해제한 뒤 변경해 주세요.');
    if(name){const other=groups.flatMap(v=>v.eventId===g.eventId?v.slots:[]).find(s=>s.name===name);if(other===slot)return groups;if(other)throw new Error('이미 이 종목에 배정된 회원입니다. 기존 슬롯을 먼저 비워 주세요.');}
    Object.assign(slot,{name,changed:true,locked:false});return validate(groups,players,year);
  }
  function shuffle(values,rng){const a=values.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  function rowerSubset(players,count,min,max,year,rng){
    const dp=Array.from({length:count+1},()=>new Map());dp[0].set(0,[]);
    shuffle(players,rng).forEach(p=>{const a=age(p,year);if(a===null)return;for(let k=count;k>0;k--)for(const [sum,names] of dp[k-1]){const next=sum+a;if(next>max)continue;if(!dp[k].has(next)||rng()<0.25)dp[k].set(next,[...names,p.memberName]);}});
    const sums=[...dp[count].keys()].filter(s=>s>=min&&s<=max);if(!sums.length)return null;return dp[count].get(sums[Math.floor(rng()*sums.length)]);
  }
  function randomGroup(original,id,players,year,rng=Math.random){
    const groups=copy(original),g=groups.find(g=>g.id===id);if(!g)throw new Error('조를 먼저 추가해 주세요.');
    const reserves=new Set(groups.flatMap(v=>v.slots.filter(s=>s.kind==='reserve').map(s=>s.name)).filter(Boolean));
    const used=new Set(groups.flatMap(v=>v.eventId!==g.eventId?[]:v===g?v.slots.filter(s=>s.locked||s.kind==='reserve').map(s=>s.name):v.slots.map(s=>s.name)).filter(Boolean));
    const pool=players.filter(p=>!used.has(p.memberName)&&!reserves.has(p.memberName));
    const fixed=g.slots.filter(s=>s.kind==='rower'&&s.locked),count=g.slots.filter(s=>s.kind==='rower'&&!s.locked).length;
    if(fixed.some(s=>age(players.find(p=>p.memberName===s.name),year)===null))throw new Error('고정된 회원의 생년을 확인해 주세요.');
    const fixedSum=fixed.reduce((sum,s)=>sum+age(players.find(p=>p.memberName===s.name),year),0),cox=g.slots.find(s=>s.kind==='cox'&&!s.locked);
    if(pool.length<count+(cox?1:0))throw new Error('후보와 다른 조의 회원를 제외하면 배정할 인원이 부족합니다.');
    const names=rowerSubset(pool,count,Math.max(0,g.min-fixedSum),(g.max===null?200*g.rowers:g.max)-fixedSum,year,rng);
    if(!names)throw new Error(g.teamName+': 나이대에 맞는 조합을 찾지 못했습니다.');
    const available=names.slice();g.slots.filter(s=>s.kind==='rower'&&!s.locked).forEach(s=>{const name=available.shift();Object.assign(s,{name,changed:s.changed||s.name!==name});});
    if(cox){const name=shuffle(pool.filter(p=>!names.includes(p.memberName)),rng)[0].memberName;Object.assign(cox,{name,changed:cox.changed||cox.name!==name});}
    return validate(groups,players,year);
  }
  function recommend(original,players,year,rng=Math.random){
    if(!original.length)throw new Error('종목·나이대·팀명을 선택하고 조를 먼저 추가해 주세요.');
    const base=copy(original);base.forEach(g=>g.slots.forEach(s=>{if(s.kind!=='reserve'&&!s.locked)s.name='';}));
    const order=base.slice().sort((a,b)=>((a.max??2000)-a.min)-((b.max??2000)-b.min)||b.rowers-a.rowers);
    for(let attempt=0;attempt<40;attempt++){
      let groups=copy(base);try{for(const g of order)groups=randomGroup(groups,g.id,players,year,rng);return validate(groups,players,year,true);}catch(e){if(attempt===39)throw new Error('모든 조의 나이대를 만족하는 추천 조합을 찾지 못했습니다. 참가자·후보·고정을 조정해 주세요.');}
    }
  }
  return {age,eventShape,ageRange,group,status,validate,normalise,setSlot,randomGroup,recommend};
})();
if(typeof module==='object'&&module.exports)module.exports=RaceLineupPlan;
