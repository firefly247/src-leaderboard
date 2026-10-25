const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('Client accepts exactly 150KiB and tries quality before reducing dimensions',async()=>{
 const source=fs.readFileSync('static/leaderboard.js','utf8'),body=source.slice(source.indexOf('async function compress(file)'),source.indexOf('async function fetchWithTimeout'));
 const attempts=[];let closed=false;const ctx={createImageBitmap:async()=>({width:1600,height:1200,close(){closed=true;}}),document:{createElement:()=>{const canvas={width:0,height:0,getContext:()=>({drawImage(){}}),toBlob(callback,type,quality){attempts.push({width:canvas.width,height:canvas.height,quality,type});callback({size:attempts.length===1?153601:153600});}};return canvas;}},FileReader:class{readAsDataURL(){this.result='data:image/jpeg;base64,TEST';this.onload();}}};
 vm.createContext(ctx);vm.runInContext(body,ctx);const result=await ctx.compress({size:1,name:'proof.png'});assert.equal(result.base64,'TEST');assert.equal(closed,true);assert.equal(attempts.length,2);assert.equal(attempts[0].width,attempts[1].width);assert.equal(attempts[0].height,attempts[1].height);assert.equal(result.mimeType,'image/jpeg');
});
test('Server rejects oversized uploads before writing; reuses existing identical pictures',()=>{
 const writes=[],ctx={Utilities:{base64Decode:()=>Buffer.alloc(153601)}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),ctx);ctx.proofFindIdentical_=()=>assert.fail('oversize must reject before lookup');assert.throws(()=>ctx.savePhotoToGitHub_('id',{base64:'x',mimeType:'image/jpeg'}),/150KB/);
 ctx.Utilities.base64Decode=()=>Buffer.alloc(153600);ctx.proofFindIdentical_=()=> 'data/proofs/canonical.jpg';ctx.githubRawUrl_=path=>path;ctx.githubPutBase64_=(...args)=>writes.push(args);assert.equal(ctx.savePhotoToGitHub_('id',{base64:'x',mimeType:'image/jpeg'}),'data/proofs/canonical.jpg');assert.equal(writes.length,0);
});
