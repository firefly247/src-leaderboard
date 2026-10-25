/** Owner-only cleanup. Existing file backups and Git history preserve originals. */
function proofGithubJson_(path,method,payload){
  var options={method:method||'get',headers:githubHeaders_(),muteHttpExceptions:true};if(payload!==undefined){options.contentType='application/json';options.payload=JSON.stringify(payload);}
  var response=UrlFetchApp.fetch('https://api.github.com/repos/'+prop_('GITHUB_OWNER')+'/'+prop_('GITHUB_REPO')+'/'+path,options);
  if(response.getResponseCode()<200||response.getResponseCode()>=300)throw new Error('사진 중복 정리 중 GitHub 요청에 실패했습니다: '+response.getResponseCode());return JSON.parse(response.getContentText());
}
function deduplicateProofFiles(){
  var lock=storageLock_();lock.waitLock(30000);
  try{
    if(storageProvider_()!=='sheets-and-csv')throw new Error('이 정리는 기존 저장소 운영 중에만 실행해 주세요.');
    var branch=properties_().getProperty('GITHUB_BRANCH')||'main',head=proofGithubJson_('commits/'+encodeURIComponent(branch)),files=proofManifest_(head.sha),groups=new Map(),aliases=new Map(),removed=[];
    files.forEach(function(f){if(!groups.has(f.sha))groups.set(f.sha,[]);groups.get(f.sha).push(f);});
    groups.forEach(function(list){list.sort(function(a,b){return a.path.localeCompare(b.path);});list.slice(1).forEach(function(f){aliases.set(githubRawUrl_(f.path),githubRawUrl_(list[0].path));removed.push(f);});});
    if(!removed.length){console.log(JSON.stringify({removedFiles:0,uniqueFiles:files.length,verified:true}));return;}
    function rewrite(value){var text=String(value||'');aliases.forEach(function(target,source){text=text.split(source).join(target);});return text;}
    var changes=[];Object.keys(StorageLayout).forEach(function(name){var spec=StorageLayout[name];if(!spec.path)return;var source=proofGithubJson_('contents/'+spec.path+'?ref='+head.sha),old=Utilities.newBlob(Utilities.base64Decode(source.content.replace(/\n/g,''))).getDataAsString('UTF-8'),next=rewrite(old);if(next!==old){var blob=proofGithubJson_('git/blobs','post',{content:next,encoding:'utf-8'});changes.push({path:spec.path,mode:'100644',type:'blob',sha:blob.sha});}});
    // Point all workbook references at still-existing canonical files before removing aliases.
    var ss=SpreadsheetApp.openById(prop_('REQUEST_SHEET_ID')),cellsUpdated=0;ss.getSheets().forEach(function(sheet){var range=sheet.getDataRange(),values=range.getValues(),changed=false;values.forEach(function(row){row.forEach(function(value,i){if(typeof value==='string'){var next=rewrite(value);if(next!==value){row[i]=next;changed=true;cellsUpdated++;}}});});if(changed)range.setValues(values);});SpreadsheetApp.flush();
    removed.forEach(function(f){changes.push({path:f.path,mode:'100644',type:'blob',sha:null});});
    var tree=proofGithubJson_('git/trees','post',{base_tree:head.commit.tree.sha,tree:changes}),commit=proofGithubJson_('git/commits','post',{message:'Deduplicate identical proof photos and update references',tree:tree.sha,parents:[head.sha]});
    proofGithubJson_('git/refs/heads/'+encodeURIComponent(branch),'patch',{sha:commit.sha,force:false});
    var remaining=proofManifest_(commit.sha);if(remaining.length!==files.length-removed.length||removed.some(function(f){return remaining.some(function(r){return r.path===f.path;});}))throw new Error('중복 정리 결과를 확인하지 못했습니다.');
    var report={verified:true,sourceFiles:files.length,uniqueFiles:remaining.length,removedFiles:removed.length,savedBytes:removed.reduce(function(n,f){return n+f.size;},0),workbookCellsUpdated:cellsUpdated,commit:commit.sha,backupsPreserved:true};
    properties_().setProperty('CLUB_PROOF_DEDUP_REPORT',JSON.stringify(report));console.log(JSON.stringify(report));
  }finally{lock.releaseLock();}
}
