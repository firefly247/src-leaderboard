(() => {
  'use strict';
  const config=window.CLUB_BACKEND;
  // Legacy Google sessions cannot authenticate to the independent API.
  try {if(config?.ready&&sessionStorage.getItem('clubBackendVersion')!=='supabase-edge-v1'){sessionStorage.removeItem('ergAdminToken');sessionStorage.setItem('clubBackendVersion','supabase-edge-v1');}}catch{}
  const client=config?.publishableKey?SupabaseSDK.createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}):null;
  const names=['events','records','competitions','competition_events','competition_divisions','competition_records','competition_dates','dormant_members'];
  const columns={events:['event_id','event_name'],records:['record_id','member_name','event_id','event_name','time_ms','time_display','competition','competition_date','note','proof_photo_url','created_at'],competitions:['competition_id','competition_name'],competition_events:['competition_event_id','competition_event_name'],competition_divisions:['competition_division_id','competition_division_name'],competition_records:['record_id','member_name','competition_id','competition_name','competition_event_id','competition_event_name','competition_division_id','competition_division_name','year','competition_type','is_cox','gold','silver','bronze','note','created_at','lineup_group_id'],competition_dates:['competition_id','year','competition_date'],dormant_members:['member_name']};
  const cell=v=>{const t=String(v??'');return /[",\r\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;};
  async function call(action,payload={},adminToken='') {
    if(!config?.ready||!client)throw new Error('새 연결을 준비 중입니다.');
    const {data:{session}}=await client.auth.getSession();
    const res=await fetch(config.url+'/functions/v1/club-api',{method:'POST',headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.access_token}:{})},body:JSON.stringify({action,payload,adminToken})});
    const out=await res.json();if(!res.ok||!out.ok)throw new Error(out.message||'요청을 처리하지 못했습니다.');return out;
  }
  async function publicFiles() {
    if(!config?.ready||!client)throw new Error('새 연결을 준비 중입니다.');
    const {data,error}=await client.rpc('club_public_read');if(error)throw new Error('공개 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    if(!data?.tables||names.some(n=>!Array.isArray(data.tables[n])))throw new Error('공개 기록 응답을 확인하지 못했습니다.');
    return names.map(n=>[columns[n].join(','),...data.tables[n].map(row=>columns[n].map(c=>cell(row[c])).join(','))].join('\n')+'\n');
  }
  window.ClubApi=Object.freeze({client,call,publicFiles,ready:Boolean(config?.ready&&client)});
})();
