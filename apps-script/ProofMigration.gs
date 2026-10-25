/** Copies existing proof files into a private backup bucket; preserves all current URLs. */
function proofStorageFetch_(path,method,payload,contentType){
  var settings=supabaseSettings_(),options={method:method,muteHttpExceptions:true,followRedirects:false,headers:{apikey:settings.key}};
  if(contentType)options.contentType=contentType;
  if(payload!==undefined)options.payload=payload;
  if(method==='post'&&path.indexOf('object/')===0)options.headers['x-upsert']='true';
  var response;try{response=UrlFetchApp.fetch(settings.url+'/storage/v1/'+path,options);}catch(_){throw new Error('사진 이전 저장소에 연결하지 못했습니다.');}
  return response;
}
function proofManifest_(commit){
  var response=UrlFetchApp.fetch('https://api.github.com/repos/'+prop_('GITHUB_OWNER')+'/'+prop_('GITHUB_REPO')+'/git/trees/'+commit+'?recursive=1',{headers:githubHeaders_(),muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('사진 원본 목록을 확인하지 못했습니다.');var tree=JSON.parse(response.getContentText());if(tree.truncated)throw new Error('사진 목록이 잘렸습니다.');
  return tree.tree.filter(function(f){return f.type==='blob'&&/^data\/proofs\/[A-Za-z0-9_./-]+\.(jpg|jpeg|png|webp)$/i.test(f.path);}).sort(function(a,b){return a.path.localeCompare(b.path);});
}
function proofHash_(bytes){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');}
function proofFindIdentical_(bytes){
  var prefix=Utilities.newBlob('blob '+bytes.length+'\x00').getBytes(),sha=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1,prefix.concat(bytes)).map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');
  var branch=properties_().getProperty('GITHUB_BRANCH')||'main';
  var matches=proofManifest_(encodeURIComponent(branch)).filter(function(f){return f.sha===sha;});
  return matches.length?matches.map(function(f){return f.path;}).sort()[0]:null;
}
function migrateProofPhotoBatch(){
  var lock=storageLock_();lock.waitLock(30000);
  try{
    var props=properties_(),migration=JSON.parse(props.getProperty('CLUB_MIGRATION_REPORT')||'null');if(!migration||!migration.verified)throw new Error('먼저 구조화 데이터 이전을 검증해 주세요.');
    var commit=migration.sourceCommit,allFiles=proofManifest_(commit),unique=new Map();allFiles.forEach(function(f){if(!unique.has(f.sha))unique.set(f.sha,f);});var files=Array.from(unique.values()),saved=JSON.parse(props.getProperty('CLUB_PROOF_PROGRESS')||'null');
    var progress=saved&&saved.sourceCommit===commit?saved:{sourceCommit:commit,index:0};
    var bucket=proofStorageFetch_('bucket/club-proof-backup','get');
    if(bucket.getResponseCode()===404||bucket.getResponseCode()===400){bucket=proofStorageFetch_('bucket','post',JSON.stringify({id:'club-proof-backup',name:'club-proof-backup',public:false}),'application/json');if(bucket.getResponseCode()<200||bucket.getResponseCode()>=300)throw new Error('비공개 사진 버킷을 만들지 못했습니다.');}
    else if(bucket.getResponseCode()!==200||JSON.parse(bucket.getContentText()).public!==false)throw new Error('사진 백업 버킷의 비공개 설정을 확인해 주세요.');
    var end=Math.min(progress.index+10,files.length);
    for(var i=progress.index;i<end;i++){
      var file=files[i],res=UrlFetchApp.fetch(githubUrl_(file.path)+'?ref='+commit,{headers:githubHeaders_(),muteHttpExceptions:true});
      if(res.getResponseCode()!==200)throw new Error('사진 원본을 읽지 못했습니다.');var body=JSON.parse(res.getContentText());if(body.sha!==file.sha||!body.content)throw new Error('사진 원본 버전이 일치하지 않습니다.');
      var bytes=Utilities.base64Decode(body.content.replace(/\n/g,''));if(bytes.length!==file.size)throw new Error('사진 원본 크기가 일치하지 않습니다.');
      var objectPath='object/club-proof-backup/'+proofHash_(bytes)+file.path.slice(file.path.lastIndexOf('.')).toLowerCase();
      var upload=proofStorageFetch_(objectPath,'post',bytes,/\.png$/i.test(file.path)?'image/png':/\.webp$/i.test(file.path)?'image/webp':'image/jpeg');
      if(upload.getResponseCode()<200||upload.getResponseCode()>=300)throw new Error('사진 백업 업로드에 실패했습니다.');
      var verified=proofStorageFetch_(objectPath,'get');if(verified.getResponseCode()!==200||proofHash_(verified.getBlob().getBytes())!==proofHash_(bytes))throw new Error('사진 백업 파일 대조에 실패했습니다.');
      progress.index=i+1;props.setProperty('CLUB_PROOF_PROGRESS',JSON.stringify(progress));
    }
    var report={sourceCommit:commit,verifiedFiles:progress.index,totalFiles:files.length,sourceFiles:allFiles.length,duplicatesSkipped:allFiles.length-files.length,totalBytes:files.reduce(function(n,f){return n+f.size;},0),complete:progress.index===files.length,bucket:'club-proof-backup',public:false,existingUrlsPreserved:true};
    props.setProperty('CLUB_PROOF_REPORT',JSON.stringify(report));console.log(JSON.stringify(report));
  }finally{lock.releaseLock();}
}
