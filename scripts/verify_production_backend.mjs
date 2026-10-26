import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root=process.argv[2]||process.cwd();
if(fs.readFileSync(path.join(root,'index.html'),'utf8').includes('static/supabase-backend.js')){
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'static/backend-config.js'),'utf8'),context,{timeout:1000});
  const config=context.window.CLUB_BACKEND;
  if(config?.ready!==true||!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.url)||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey||'')){
    console.error('Production deployment blocked: finish Kakao setup and live verification, then set the public backend configuration ready.');
    process.exitCode=1;
  }else console.log('Production public backend configuration verified.');
}
