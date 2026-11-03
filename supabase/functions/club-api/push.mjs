// RFC 8291 encryption keeps notification contents private in transit.
const allowedHosts=new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
export function pushEndpoint(value){
  if(typeof value!=='string'||value.length>2048)throw new Error('알림 기기 주소를 확인해 주세요.');
  let endpoint;try{endpoint=new URL(value);}catch{throw new Error('알림 기기 주소를 확인해 주세요.');}
  if(endpoint.protocol!=='https:'||endpoint.port||endpoint.username||endpoint.password||endpoint.hash||!(allowedHosts.has(endpoint.hostname)||endpoint.hostname.endsWith('.notify.windows.com')))throw new Error('지원하지 않는 알림 서비스입니다. Chrome 또는 Safari에서 다시 시도해 주세요.');
  return endpoint.href;
}
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const enc=value=>b64(new TextEncoder().encode(JSON.stringify(value)));
const bytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const join=(...parts)=>{const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;};
const text=value=>new TextEncoder().encode(value);
export async function subscriptionKeys(value){
  try{
    if(!value||typeof value.p256dh!=='string'||typeof value.auth!=='string'||value.p256dh.length>90||value.auth.length>25)throw new Error();
    const publicKey=bytes(value.p256dh),auth=bytes(value.auth);
    if(publicKey.length!==65||publicKey[0]!==4||auth.length!==16)throw new Error();
    await crypto.subtle.importKey('raw',publicKey,{name:'ECDH',namedCurve:'P-256'},false,[]);
    return {p256dh:b64(publicKey),auth:b64(auth)};
  }catch{throw new Error('알림 기기 연결 정보를 확인해 주세요. 알림을 다시 켜 주세요.');}
}
export async function encryptPush(subscription,payload){
  const ua=bytes(subscription.p256dh),auth=bytes(subscription.auth);
  const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const server=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
  const peer=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=await crypto.subtle.deriveBits({name:'ECDH',public:peer},pair.privateKey,256);
  const derive=async(input,salt,info,length)=>new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},await crypto.subtle.importKey('raw',input,'HKDF',false,['deriveBits']),length*8));
  const ikm=await derive(shared,auth,join(text('WebPush: info\0'),ua,server),32),salt=crypto.getRandomValues(new Uint8Array(16));
  const cek=await derive(ikm,salt,text('Content-Encoding: aes128gcm\0'),16),nonce=await derive(ikm,salt,text('Content-Encoding: nonce\0'),12);
  const plain=text(JSON.stringify(payload));if(plain.length>3000)throw new Error('알림 내용이 너무 깁니다.');
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']),join(plain,Uint8Array.of(2))));
  // RFC 8188 header: salt (16), record size (4), key length (1), sender key (65).
  return join(salt,Uint8Array.of(0,0,16,0,65),server,encrypted);
}
export function requestPush(request){
  return {title:request.request_type==='competition_add'?'대회 기록 등록 요청':'ERG 기록 등록 요청',body:[request.member_name,request.event_name,request.time_display,request.competition_date].filter(Boolean).join(' · ').slice(0,500),tag:'record-'+request.request_id};
}
export async function generatePushKeys(){
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  return {id:true,public_key:b64(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey))),private_jwk:await crypto.subtle.exportKey('jwk',pair.privateKey)};
}
export async function sendWebPush(endpoint,keys,{fetcher=fetch,subject='https://firefly247.github.io/src-leaderboard/',subscription,payload}={}){
  const target=pushEndpoint(endpoint),token=enc({typ:'JWT',alg:'ES256'})+'.'+enc({aud:new URL(target).origin,exp:Math.floor(Date.now()/1000)+3600,sub:subject});
  const key=await crypto.subtle.importKey('jwk',keys.private_jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(token)));
  const body=subscription?.p256dh&&subscription?.auth&&payload?await encryptPush(subscription,payload):undefined;
  const res=await fetcher(target,{method:'POST',redirect:'error',headers:{Authorization:`vapid t=${token}.${b64(signature)}, k=${keys.public_key}`,TTL:'300',Urgency:'normal',...(body?{'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream'}:{})},...(body?{body}:{}),signal:AbortSignal.timeout(10000)});
  return {sent:res.ok,expired:[404,410].includes(res.status)};
}
export function createPush({rest,hash,send=sendWebPush}){
  const id=endpoint=>Array.from(hash(new TextEncoder().encode(endpoint)),b=>b.toString(16).padStart(2,'0')).join('');
  async function keys(){
    let rows=await rest('club_push_keys?select=public_key,private_jwk',undefined,'GET');
    if(!rows.length){await rest('club_push_keys',await generatePushKeys(),'POST',{Prefer:'resolution=ignore-duplicates'});rows=await rest('club_push_keys?select=public_key,private_jwk',undefined,'GET');}
    if(!rows[0])throw new Error('알림 설정을 확인하지 못했습니다.');return rows[0];
  }
  async function deliver(row,key,payload){
    const result=await send(row.endpoint,key,{subscription:row,payload});
    if(result.expired)await rest('club_push_subscriptions?endpoint_hash=eq.'+row.endpoint_hash,undefined,'DELETE');
    return result;
  }
  return {
    async dispatch(action,p,member){
      if(action==='adminPushConfig')return {publicKey:(await keys()).public_key};
      const endpoint=pushEndpoint(p.endpoint),endpointHash=id(endpoint),path='club_push_subscriptions?endpoint_hash=eq.'+endpointHash+'&user_id=eq.'+encodeURIComponent(member.user_id);
      if(action==='adminPushDisable'){await rest(path,undefined,'DELETE');return {};}
      if(action==='adminPushSubscribe'){
        const encryption=await subscriptionKeys(p.keys);
        const own=await rest('club_push_subscriptions?select=endpoint_hash&user_id=eq.'+encodeURIComponent(member.user_id),undefined,'GET');
        if(own.length>=10&&!own.some(r=>r.endpoint_hash===endpointHash))throw new Error('기기 등록은 최대 10대까지 가능합니다. 사용하지 않는 기기에서 알림을 꺼 주세요.');
        await rest('club_push_subscriptions?on_conflict=endpoint_hash',{endpoint_hash:endpointHash,user_id:member.user_id,endpoint,...encryption,updated_at:new Date().toISOString()},'POST',{Prefer:'resolution=merge-duplicates'});return {};
      }
      const rows=await rest(path+'&select=endpoint_hash,endpoint,p256dh,auth',undefined,'GET');
      if(action==='adminPushStatus')return {subscribed:Boolean(rows.length)};
      if(!rows.length)throw new Error('이 기기에서 먼저 알림을 켜 주세요.');
      const result=await deliver(rows[0],await keys(),{title:'삼성조정클럽 테스트 알림',body:'테스트 알림입니다. 가입·기록 요청 시 이곳에 신청자와 요청 내용이 표시됩니다.',tag:'club-push-test'});
      if(!result.sent)throw new Error(result.expired?'알림 연결이 만료되었습니다. 알림을 다시 켜 주세요.':'알림 서비스가 전송을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return {sent:true};
    },
    async notifyAdmins(payload){
      // Recheck current roles at send time. Unsubscribed or demoted users never receive broadcasts.
      try{
        const rows=await rest('club_push_subscriptions?select=endpoint_hash,endpoint,p256dh,auth,club_accounts!inner(role)&club_accounts.role=eq.admin',undefined,'GET');
        if(!rows.length)return;
        const key=await keys();await Promise.allSettled(rows.map(row=>deliver(row,key,payload)));
      }catch{/* Notification outages must never roll back a successful signup/record request. */}
    }
  };
}
