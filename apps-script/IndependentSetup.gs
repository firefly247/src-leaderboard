/** Owner-only one-time migration helpers. Never called by the new website/API. */
function independentRpc_(name,payload){
  var settings=supabaseSettings_(),res=UrlFetchApp.fetch(settings.url+'/rest/v1/rpc/'+name,{method:'post',headers:{apikey:settings.key,'Content-Type':'application/json'},payload:JSON.stringify(payload||{}),muteHttpExceptions:true,followRedirects:false});
  if(res.getResponseCode()<200||res.getResponseCode()>=300)throw new Error('새 서버 초기화에 실패했습니다. 기존 운영 연결은 유지합니다.');
  return JSON.parse(res.getContentText());
}
function initializeIndependentApiAdministrator(){
  var created=independentRpc_('club_admin_initialize',{p_password:prop_('ADMIN_PASSWORD')});
  console.log(JSON.stringify({initialized:true,created:created,existingAdminPasswordPreserved:true,passwordExported:false}));
}
function migrateActiveProofStorageBatch(){
  var lock=storageLock_();lock.waitLock(30000);
  try{
    var props=properties_(),head=proofGithubJson_('commits/'+encodeURIComponent(props.getProperty('GITHUB_BRANCH')||'main')).sha;
    var saved=JSON.parse(props.getProperty('CLUB_ACTIVE_PROOF_PROGRESS')||'null'),progress=saved||{commit:head,index:0};
    if(saved&&saved.commit!==head&&proofManifest_(head).some(function(f){return !props.getProperty('CLUB_PUBLIC_PROOF_'+f.sha);}))progress={commit:head,index:0};
    var files=proofManifest_(progress.commit);
    var bucket=proofStorageFetch_('bucket/club-proofs','get');
    if([400,404].includes(bucket.getResponseCode())){
      var made=proofStorageFetch_('bucket','post',JSON.stringify({id:'club-proofs',name:'club-proofs',public:true,file_size_limit:153600,allowed_mime_types:['image/jpeg']}),'application/json');
      if(made.getResponseCode()<200||made.getResponseCode()>=300)throw new Error('새 사진 저장소 생성 실패');
    }else if(bucket.getResponseCode()!==200||JSON.parse(bucket.getContentText()).public!==true)throw new Error('새 사진 저장소 설정을 확인해 주세요. 기존 비공개 백업은 변경하지 않습니다.');
    var end=Math.min(progress.index+10,files.length);
    for(var i=progress.index;i<end;i++){
      var file=files[i];
      if(props.getProperty('CLUB_PUBLIC_PROOF_'+file.sha)){progress.index=i+1;props.setProperty('CLUB_ACTIVE_PROOF_PROGRESS',JSON.stringify(progress));continue;}
      var res=UrlFetchApp.fetch(githubUrl_(file.path)+'?ref='+progress.commit,{headers:githubHeaders_(),muteHttpExceptions:true});
      if(res.getResponseCode()!==200)throw new Error('사진 원본 읽기 실패');var body=JSON.parse(res.getContentText());if(body.sha!==file.sha)throw new Error('사진 원본 버전 불일치');
      var bytes=Utilities.base64Decode(body.content.replace(/\n/g,''));if(bytes.length!==file.size||bytes.length>153600)throw new Error('사진 용량 또는 버전 불일치');
      var hash=proofHash_(bytes),path='object/club-proofs/'+hash+'.jpg',uploaded=proofStorageFetch_(path,'post',bytes,'image/jpeg');
      if(uploaded.getResponseCode()<200||uploaded.getResponseCode()>=300)throw new Error('사진 업로드 실패');
      var verified=proofStorageFetch_(path,'get');if(verified.getResponseCode()!==200||proofHash_(verified.getBlob().getBytes())!==hash)throw new Error('사진 업로드 대조 실패');
      props.setProperty('CLUB_PUBLIC_PROOF_'+file.sha,hash);progress.index=i+1;props.setProperty('CLUB_ACTIVE_PROOF_PROGRESS',JSON.stringify(progress));
    }
    console.log(JSON.stringify({verifiedFiles:progress.index,totalFiles:files.length,complete:progress.index===files.length,bucket:'club-proofs',originalBackupsPreserved:true}));
  }finally{lock.releaseLock();}
}
function connectActiveProofStorage(){
  var lock=storageLock_();lock.waitLock(30000);
  try{
    if(storageProvider_()!=='supabase')throw new Error('Supabase 운영 연결을 먼저 확인해 주세요.');
    var props=properties_(),progress=JSON.parse(props.getProperty('CLUB_ACTIVE_PROOF_PROGRESS')||'null');if(!progress)throw new Error('사진 복사 미완료');
    var files=proofManifest_(progress.commit);if(progress.index!==files.length)throw new Error('사진 복사 미완료');
    var mappings=files.map(function(f){var hash=props.getProperty('CLUB_PUBLIC_PROOF_'+f.sha);if(!hash)throw new Error('사진 대조 기록 누락');return {source:githubRawUrl_(f.path),target:supabaseSettings_().url+'/storage/v1/object/public/club-proofs/'+hash+'.jpg'};});
    var before=storageRead_(),text=JSON.stringify(before.tables);mappings.forEach(function(m){text=text.split(m.source).join(m.target);});
    if(text.indexOf('raw.githubusercontent.com/'+prop_('GITHUB_OWNER')+'/'+prop_('GITHUB_REPO')+'/')>=0)throw new Error('아직 이전되지 않은 사진 주소가 있습니다. 추가 사진을 확인해 주세요.');
    var next=JSON.parse(text);storageValidate_(next);var result=storageCommit_(before.revision,next,before.tables),after=storageRead_();
    if(result.revision!==after.revision||storageDigest_(next)!==storageDigest_(after.tables))throw new Error('사진 주소 전환 대조 실패');
    console.log(JSON.stringify({verified:true,photos:files.length,revision:after.revision,photoServing:'supabase-storage',originalBackupsPreserved:true}));
  }finally{lock.releaseLock();}
}
