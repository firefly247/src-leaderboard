// Seat reservations live inside the existing private weekend_training JSON.
export const FLEET = Object.freeze({'1X':{limit:1,crew:1},'2X':{limit:2,crew:2},'4X+':{limit:4,crew:4,cox:true},'4+':{limit:1,crew:4,cox:true},'8+':{limit:1,crew:8,cox:true}});
export const SEAT_ACTIONS = new Set(['trainingSeats','trainingBoatAdd','trainingBoatRemove','trainingSeatSelect','trainingSeatStatus','trainingSeatComment','trainingSeatConfirm','trainingSeatReopen']);
export function seatBooking(session){
  if(session.seatBooking)return structuredClone(session.seatBooking);
  // Preserve an existing published/draft crew when the new screen is first used.
  const counts={};const source=session.draft||session.plan;
  const boats=(source?.boats||[]).filter(b=>FLEET[b.type]).map(b=>{
    const n=(counts[b.type]||0)+1;counts[b.type]=n;
    const spec=FLEET[b.type],positions=[...(spec.cox?['COX']:[]),...Array.from({length:spec.crew},(_,i)=>`${i+1}번`)];
    return {id:`${b.type}-${n}`,type:b.type,name:`${b.type} ${n}호`,seats:positions.map(position=>({position,memberId:b.seats.find(s=>s.seat===position)?.id||null}))};
  });
  return {boats,confirmed:Boolean(session.plan&&!session.draft),version:1};
}
export function seatView(session,member,admin=false,dormant=[]){
  const booking=seatBooking(session),hidden=new Set(dormant),people=(session.participants||[]).filter(p=>!hidden.has(p.name));
  const byId=new Map(people.filter(p=>p.status==='참석').map(p=>[p.id,p])),own=people.find(p=>p.name===member?.player_name);
  return {date:session.date,revision:session.revision,confirmed:booking.confirmed,boats:booking.boats.filter(b=>!booking.confirmed||b.seats.some(s=>byId.has(s.memberId))).map(b=>({id:b.id,type:b.type,name:b.name,seats:b.seats.map((s,index)=>{
    const person=byId.get(s.memberId);return {index,position:s.position,occupied:Boolean(person),mine:Boolean(person&&person.id===own?.id),...(admin?{name:person?.name||'',memberId:person?.id||null}:{})};
  })})),ownStatus:own?.status||'',ownComment:own?.comment||'',counts:{attending:people.filter(p=>p.status==='참석').length,absent:people.filter(p=>p.status==='불참').length,tentative:people.filter(p=>p.status==='미정').length},unseated:people.filter(p=>p.status==='참석'&&!booking.boats.some(b=>b.seats.some(s=>s.memberId===p.id))).map(p=>admin?{id:p.id,name:p.name}:{}),...(admin?{responses:people.map(p=>({id:p.id,name:p.name,status:p.status,comment:p.comment||''}))}:{})};
}
export function changeSeats(original,action,p,member,{uuid,now=new Date().toISOString(),dormant=[]}={}){
  const session=structuredClone(original),admin=member.role==='admin';
  if(!session.opened)throw new Error('아직 개설되지 않은 훈련입니다.');
  if(!member.player_name||dormant.includes(member.player_name))throw new Error('승인된 활동 회원만 신청할 수 있습니다.');
  const booking=seatBooking(session);session.participants||=[];
  const activeIds=new Set(session.participants.filter(m=>m.status==='참석'&&!dormant.includes(m.name)).map(m=>m.id));for(const b of booking.boats)for(const s of b.seats)if(s.memberId&&!activeIds.has(s.memberId))s.memberId=null;
  if(['trainingBoatRemove','trainingSeatConfirm','trainingSeatReopen'].includes(action)&&!admin)throw new Error('운영진만 사용할 수 있습니다.');
  if(action==='trainingSeatReopen')booking.confirmed=false;
  else{
    if(booking.confirmed)throw new Error('확정된 편성입니다. 운영진에게 수정 요청해 주세요.');
    if(action==='trainingBoatAdd'){
      const spec=Object.hasOwn(FLEET,p.type)?FLEET[p.type]:null;if(!spec)throw new Error('배 종류를 확인해 주세요.');
      const count=booking.boats.filter(b=>b.type===p.type).length;
      if(count>=spec.limit)throw new Error('해당 종류의 모든 배가 추가되었습니다.');
      const serial=Array.from({length:spec.limit},(_,i)=>i+1).find(n=>!booking.boats.some(b=>b.id===`${p.type}-${n}`));
      const positions=[...(spec.cox?['COX']:[]),...Array.from({length:spec.crew},(_,i)=>`${i+1}번`)];
      booking.boats.push({id:`${p.type}-${serial}`,type:p.type,name:`${p.type} ${serial}호`,seats:positions.map(position=>({position,memberId:null}))});
    }else if(action==='trainingBoatRemove'){
      const boat=booking.boats.find(b=>b.id===p.boatId);if(!boat)throw new Error('배를 확인해 주세요.');
      if(boat.seats.some(s=>s.memberId))throw new Error('신청된 자리가 있는 배는 삭제할 수 없습니다.');
      booking.boats=booking.boats.filter(b=>b!==boat);
    }else if(action==='trainingSeatSelect'||action==='trainingSeatStatus'||action==='trainingSeatComment'){
      let person=session.participants.find(m=>m.name===member.player_name);
      if(action==='trainingSeatSelect'){
        const boat=booking.boats.find(b=>b.id===p.boatId),seat=Number.isInteger(p.index)?boat?.seats[p.index]:null;
        if(!seat)throw new Error('좌석을 확인해 주세요.');
        const occupant=session.participants.find(m=>m.id===seat.memberId&&!dormant.includes(m.name));
        if(occupant&&occupant.name!==member.player_name)throw new Error('다른 회원이 먼저 선택한 자리입니다. 다른 빈자리를 선택해 주세요.');
        if(!person){if(session.participants.length>=60)throw new Error('신청 인원이 최대 60명입니다.');person={id:uuid(),name:member.player_name};session.participants.push(person);}
        const cancel=seat.memberId===person.id;
        for(const b of booking.boats)for(const s of b.seats)if(s.memberId===person.id)s.memberId=null;
        seat.memberId=cancel?null:person.id;person.status=cancel?'미정':'참석';
      }else if(action==='trainingSeatComment'){
        if(typeof p.comment!=='string'||p.comment.length>1000)throw new Error('코멘트는 1000자 이내로 입력해 주세요.');
        if(!person){if(session.participants.length>=60)throw new Error('신청 인원이 최대 60명입니다.');person={id:uuid(),name:member.player_name,status:'미정'};session.participants.push(person);}
      }else{
        if(!['불참','미정'].includes(p.status))throw new Error('참가 상태를 확인해 주세요.');
        if(!person){if(session.participants.length>=60)throw new Error('신청 인원이 최대 60명입니다.');person={id:uuid(),name:member.player_name};session.participants.push(person);}
        for(const b of booking.boats)for(const s of b.seats)if(s.memberId===person.id)s.memberId=null;
        person.status=p.status;
      }
      if(p.comment!==undefined){if(typeof p.comment!=='string'||p.comment.length>1000)throw new Error('코멘트는 1000자 이내로 입력해 주세요.');person.comment=p.comment;}
      person.editHash||='seat-booking';session.registrationRevision=(session.registrationRevision||0)+1;
    }else if(action==='trainingSeatConfirm'){
      const people=new Map(session.participants.filter(m=>m.status==='참석'&&!dormant.includes(m.name)).map(m=>[m.id,m]));
      const assigned=new Set(),boats=[];
      for(const b of booking.boats){
        const filled=b.seats.filter(s=>people.has(s.memberId));if(!filled.length)continue;
        if(filled.length!==b.seats.length)throw new Error(`${b.name}에 빈자리가 있습니다. 인원을 채운 뒤 확정해 주세요.`);
        const seats=b.seats.map(s=>{if(assigned.has(s.memberId))throw new Error('중복된 좌석을 확인해 주세요.');assigned.add(s.memberId);return {id:s.memberId,name:people.get(s.memberId).name,seat:s.position,locked:false,changed:false};});
        boats.push({name:b.name,type:b.type,seats});
      }
      if(!boats.length)throw new Error('좌석 신청을 먼저 받아 주세요.');
      if([...people.keys()].some(id=>!assigned.has(id)))throw new Error('좌석을 선택하지 않은 참석 회원이 있습니다. 빈자리를 선택하도록 안내해 주세요.');
      booking.confirmed=true;booking.confirmedAt=now;
      session.plan={boats,wait:[],checks:{},registrationRevision:session.registrationRevision||0,publishedAt:now};session.draft=null;
    }else throw new Error('지원하지 않는 좌석 요청입니다.');
  }
  session.seatBooking=booking;session.revision=(session.revision||0)+1;return session;
}
