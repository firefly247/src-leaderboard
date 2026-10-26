import { createEngine } from './engine.mjs';
import { makeUtilities } from './utilities.mjs';

const PUBLIC = new Set(['trainingGet','trainingList','trainingRoster','raceLineupList','raceLineupGet','pendingDeleteRecords']);
const MEMBER = new Set(['trainingJoin','trainingWeekJoin','requestAdd','requestCompetitionAdd','requestDelete']);
const ADMIN = new Set(['adminList','saveApprovedRecord','saveCompetitionDates','updateCompetitionRequests','savePlayerBirthYear','savePlayerBirthYears','processRequest','processAddRequests','processCompetitionAddRequests','processRejectRequests','manageEvent','manageCompetition','manageCompetitionEvent','manageCompetitionDivision','trainingOpen','trainingRecommend','trainingDraftGet','trainingDraftEdit','trainingDraftSave','trainingPublish','trainingCheck','trainingQualifications','raceLineupAdminData','raceLineupGetAdmin','raceLineupCreate','raceLineupParticipants','raceLineupSave','raceLineupFinalize','memberLinkList','memberLinkApprove','memberLinkReject','memberAccountList','memberAccountRole']);
const clone=x=>structuredClone(x);
const csv=value=>{const text=String(value??'');return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;};

export function createHandler({url,key,hash,fetcher=fetch,origins=['https://firefly247.github.io']}) {
  const utilities=makeUtilities(hash), hex=v=>Array.from(hash(new TextEncoder().encode(v)),b=>b.toString(16).padStart(2,'0')).join('');
  async function rest(path,payload,method='POST',extra={}) {
    const res=await fetcher(url+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...extra},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    if(!res.ok){const error=await res.json().catch(()=>({}));if(error.message?.includes('storage_revision_conflict'))throw new Error('다른 사람이 변경했습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.');throw new Error('데이터를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
    const text=await res.text();return text?JSON.parse(text):null;
  }
  const rpc=(name,p={})=>rest('rpc/'+name,p);
  async function account(accessToken) {
    if(!accessToken)return null;
    const res=await fetcher(url+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+accessToken}});
    if(!res.ok)throw new Error('로그인이 만료되었습니다. 카카오로 다시 로그인해 주세요.');
    const user=await res.json();if(!user.id||!user.identities?.some(i=>i.provider==='kakao'))throw new Error('카카오 로그인이 필요합니다.');
    const accountPath='club_accounts?user_id=eq.'+encodeURIComponent(user.id)+'&select=user_id,player_name,requested_player_name,role';
    let rows=await rest(accountPath,undefined,'GET');
    if(!rows.length){
      await rest('club_accounts',{user_id:user.id,display_name:String(user.user_metadata?.name||user.user_metadata?.full_name||user.user_metadata?.nickname||'회원').slice(0,80)},'POST',{Prefer:'resolution=ignore-duplicates'});
      rows=await rest(accountPath,undefined,'GET');
    }
    if(!rows?.[0])throw new Error('회원 정보를 확인하지 못했습니다.');
    return {...rows[0],nickname:String(user.user_metadata?.name||user.user_metadata?.full_name||user.user_metadata?.nickname||'회원').slice(0,80)};
  }
  async function limited(request,action,max=60) {
    const ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||request.headers.get('cf-connecting-ip')||'unknown';
    if(!await rpc('club_api_limit',{p_key:hex(ip+'|'+action),p_limit:max,p_seconds:300}))throw new Error('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  }
  async function photoInfo(photo) {
    if(!photo)return null;
    if(photo.mimeType!=='image/jpeg'||typeof photo.base64!=='string'||photo.base64.length>204800)throw new Error('증빙사진은 JPEG 150KB 이하여야 합니다.');
    let bytes;try{bytes=Uint8Array.from(atob(photo.base64),c=>c.charCodeAt(0));}catch{throw new Error('사진 형식이 올바르지 않습니다.');}
    if(bytes.length<4||bytes.length>153600||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new Error('사진 형식 또는 용량을 확인해 주세요.');
    const digest=Array.from(hash(bytes),b=>b.toString(16).padStart(2,'0')).join(''),path=digest+'.jpg';
    return {bytes,path,url:url+'/storage/v1/object/public/club-proofs/'+path};
  }
  async function upload(photo) {
    const res=await fetcher(url+'/storage/v1/object/club-proofs/'+photo.path,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'image/jpeg','x-upsert':'true'},body:photo.bytes});
    if(!res.ok)throw new Error('사진 저장에 실패했습니다. 다시 시도해 주세요.');
  }
  async function publicData(){
    const snapshot=await rpc('club_public_read'),files={};
    // Public projection contains exactly the existing eight public datasets.
    const metadata=createEngine({tables:{...snapshot.tables,request_log:[],player_birth_years:[],weekend_training:[],competition_lineups:[]}},{utilities,admin:false}).publicData();
    Object.assign(files,metadata.files);return {provider:'supabase',revision:snapshot.revision,files};
  }
  return async function handler(request) {
    const origin=request.headers.get('origin'),allowed=!origin||origins.includes(origin);
    const cors={'Access-Control-Allow-Origin':origin&&allowed?origin:origins[0],'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
    const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
    if(request.method==='OPTIONS')return new Response(null,{status:allowed?204:403,headers:cors});
    if(!allowed)return respond({ok:false,message:'허용되지 않은 사이트입니다.'},403);
    if(request.method!=='POST')return respond({ok:false,message:'POST 요청이 필요합니다.'},405);
    try {
      const raw=await request.text();if(raw.length>524288)return respond({ok:false,message:'요청 용량을 초과했습니다.'},413);
      const body=JSON.parse(raw),action=body.action,p=body.payload||{};
      if(typeof action!=='string'||!p||typeof p!=='object'||Array.isArray(p))throw new Error('요청 형식이 올바르지 않습니다.');
      if(action==='storageSource')return respond({ok:true,provider:'supabase',version:2});
      if(action==='publicData')return respond({ok:true,...await publicData()});
      if(!PUBLIC.has(action)&&!MEMBER.has(action)&&!ADMIN.has(action)&&!['memberSession','memberLinkRequest','memberLinkOptions'].includes(action))throw new Error('지원하지 않는 요청입니다.');
      const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
      const member=token&&!PUBLIC.has(action)?await account(token):null;
      if(action.startsWith('member')&&!ADMIN.has(action)&&!member)throw new Error('카카오 로그인이 필요합니다.');
      if(action==='memberSession')return respond({ok:true,member:{userId:member.user_id,nickname:member.nickname,playerName:member.player_name,requestedPlayerName:member.requested_player_name,role:member.role}});
      if(action==='memberLinkOptions'){
        const tables=await Promise.all(['club_player_birth_years','club_records','club_competition_records','club_dormant_members'].map(n=>rest(n+'?select=member_name',undefined,'GET')));
        const dormant=new Set(tables[3].map(r=>r.member_name)),names=[...new Set(tables.slice(0,3).flatMap(rows=>rows.map(r=>r.member_name)))].filter(n=>n&&!dormant.has(n)).sort((a,b)=>a.localeCompare(b,'ko'));
        return respond({ok:true,names});
      }
      if(action==='memberLinkRequest'){
        await limited(request,action,10);if(member.player_name)throw new Error('이미 선수 정보가 연결되어 있습니다.');
        if(typeof p.name!=='string'||p.name.length>30)throw new Error('선수 이름을 확인해 주세요.');
        const matched=await Promise.all(['club_player_birth_years','club_records','club_competition_records','club_dormant_members'].map(n=>rest(n+'?select=member_name&member_name=eq.'+encodeURIComponent(p.name),undefined,'GET')));if(!matched.slice(0,3).some(rows=>rows.length)||matched[3].length)throw new Error('등록된 활동 선수를 선택해 주세요.');
        await rest('club_accounts?user_id=eq.'+encodeURIComponent(member.user_id),{requested_player_name:p.name,display_name:member.nickname},'PATCH');return respond({ok:true,requestedPlayerName:p.name});
      }
      const admin=ADMIN.has(action)&&member?.role==='admin';
      if(ADMIN.has(action)&&!admin)throw new Error('관리자 인증이 만료되었습니다.');
      if(action==='memberAccountList'){const accounts=await rest('club_accounts?select=user_id,player_name,requested_player_name,display_name,role,created_at,linked_at&order=created_at',undefined,'GET');return respond({ok:true,accounts});}
      if(action==='memberAccountRole'){
        if(typeof p.userId!=='string'||!['member','admin'].includes(p.role))throw new Error('회원과 권한을 확인해 주세요.');
        // Last-admin protection and the actor's current role are rechecked atomically.
        try{await rpc('club_account_set_role',{p_actor_id:member.user_id,p_user_id:p.userId,p_role:p.role});}
        catch{throw new Error('권한을 변경하지 못했습니다. 마지막 관리자는 해제할 수 없습니다. 최신 회원 목록을 확인해 주세요.');}
        return respond({ok:true});
      }
      if(action==='memberLinkList'){const links=await rest('club_accounts?select=user_id,player_name,requested_player_name,display_name,created_at&requested_player_name=not.is.null&order=created_at',undefined,'GET');return respond({ok:true,links});}
      if(action==='memberLinkReject'){if(typeof p.name!=='string'||typeof p.userId!=='string')throw new Error('연결 요청을 확인해 주세요.');const changed=await rest('club_accounts?user_id=eq.'+encodeURIComponent(p.userId)+'&requested_player_name=eq.'+encodeURIComponent(p.name),{requested_player_name:null},'PATCH',{Prefer:'return=representation'});if(!changed?.length)throw new Error('연결 요청이 변경되었습니다. 다시 조회해 주세요.');return respond({ok:true});}
      if(action==='memberLinkApprove'){await rpc('club_member_approve',{p_user_id:p.userId,p_player_name:p.name});return respond({ok:true});}
      if(MEMBER.has(action)){if(!member)throw new Error('카카오 로그인 후 신청해 주세요.');if(!member.player_name)throw new Error('운영진이 선수 연결을 확인한 뒤 신청할 수 있습니다.');await limited(request,member.user_id+':'+action,30);}
      if(p.photo&&action!=='requestAdd')throw new Error('이 요청에는 사진을 첨부할 수 없습니다.');
      const snapshot=await rpc('club_store_read'),photo=await photoInfo(p.photo);
      if(MEMBER.has(action)&&snapshot.tables.dormant_members.some(r=>r.member_name===member.player_name))throw new Error('휴면 상태입니다. 운영진에게 문의해 주세요.');
      const engine=createEngine(snapshot,{utilities,admin,photoUrl:photo?.url});
      const payload=clone(p);
      if(['trainingJoin','trainingWeekJoin'].includes(action)) {
        if(payload.name&&payload.name!==member.player_name)throw new Error('본인 이름으로만 참가 신청할 수 있습니다.');
        payload.name=member.player_name;payload.editKey=hex('club-member-edit:'+member.user_id+':'+key);
        const digest=utilities.base64Encode(utilities.computeDigest('sha256',payload.editKey));
        // Transfer old browser-only edit keys only after an administrator verified ownership.
        for(const row of engine.tables().weekend_training){if(row.date===payload.date||payload.week&&row.date>=payload.week&&row.date<=new Date(Date.parse(payload.week+'T00:00:00Z')+86400000).toISOString().slice(0,10)){
          const person=row.session_json.participants?.find(v=>v.name===member.player_name);if(person)person.editHash=digest;
        }}
      }
      const result=engine.dispatch(action,payload)||{};
      if(['requestAdd','requestCompetitionAdd'].includes(action)){
        const request=engine.tables().request_log.find(row=>row.request_id===result.requestId);
        if(!request)throw new Error('등록 요청을 확인하지 못했습니다.');
        const source=JSON.parse(request.source_json);
        // Private audit metadata is stamped by the server, never trusted from form data.
        source.__club_requester={user_id:member.user_id,name:member.player_name};
        request.source_json=JSON.stringify(source);
      }
      if(action==='adminList'&&Array.isArray(result.requests))result.requests=result.requests.map(request=>{
        const requester=JSON.parse(request.source_json).__club_requester;
        return {...request,requester_name:typeof requester?.name==='string'?requester.name:''};
      });
      const changes=engine.changes();
      if(photo)await upload(photo);
      if(Object.keys(changes).length)await rpc('club_store_commit',{p_expected_revision:snapshot.revision,p_changes:changes});
      return respond({ok:true,...result});
    } catch(error) {
      return respond({ok:false,message:error instanceof SyntaxError?'요청 형식이 올바르지 않습니다.':error.message||'요청을 처리하지 못했습니다.'},400);
    }
  };
}
