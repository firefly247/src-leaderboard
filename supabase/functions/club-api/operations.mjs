const categories=new Set(['rules','equipment','general']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pageSize=10;
const minimumPasswordLength=6;
export const OPERATIONS_ACTIONS=new Set(['operationsSetPassword','operationsUnlock','operationsList','operationsCreate','operationsUpdate','operationsArchive']);

function passwordFrom(payload,min){
  const password=payload.password;
  if(typeof password!=='string'||!password.trim()||password.includes('\0')||[...password].length<min||new TextEncoder().encode(password).length>72){
    throw new Error(min===minimumPasswordLength?`암호를 ${min}자 이상, 72바이트 이하로 입력해 주세요.`:'운영 암호를 확인해 주세요.');
  }
  return password;
}

export async function handleOperations(action,p,member,{rest,rpc,hex,limitUnlock}){
  if(action==='operationsSetPassword'){
    if(member.role!=='admin')throw new Error('관리자만 운영 암호를 설정할 수 있습니다.');
    if(!await rpc('club_operations_set_password',{p_user_id:member.user_id,p_password:passwordFrom(p,minimumPasswordLength)}))throw new Error('운영 암호를 설정하지 못했습니다.');
    return {};
  }
  if(action==='operationsUnlock'){
    const password=passwordFrom(p,1),token=crypto.randomUUID();
    await limitUnlock();
    const result=await rpc('club_operations_unlock',{p_user_id:member.user_id,p_password:password,p_token_hash:hex(token)});
    if(result==='unconfigured')throw new Error('운영 암호가 설정되지 않았습니다. 관리자에게 문의해 주세요.');
    if(result!=='ok')throw new Error('운영 암호가 일치하지 않습니다.');
    return {token,expiresIn:1800};
  }
  if(typeof p.token!=='string'||!uuid.test(p.token)||!await rpc('club_operations_session',{p_user_id:member.user_id,p_token_hash:hex(p.token)})){
    throw Object.assign(new Error('운영 암호를 다시 입력해 주세요.'),{code:'operations_locked'});
  }
  const table='club_operations_posts';
  if(action==='operationsList'){
    const category=p.category??'',offset=p.offset??0;
    if((category!==''&&!categories.has(category))||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new Error('게시판 분류와 페이지를 확인해 주세요.');
    const query=new URLSearchParams({archived_at:'is.null',select:'id,category,title,content,author_id,author_name,created_at,updated_at',order:'created_at.desc,id.desc',offset:String(offset),limit:String(pageSize+1)});
    if(category)query.set('category','eq.'+category);
    const rows=await rest(table+'?'+query,undefined,'GET');
    const posts=rows.slice(0,pageSize).map(({author_id,...post})=>({...post,canEdit:member.role==='admin'||author_id===member.user_id}));
    return {posts,nextOffset:rows.length>pageSize?offset+pageSize:null};
  }
  let changes;
  if(action==='operationsArchive'){
    changes={archived_at:new Date().toISOString()};
  }else{
    const title=typeof p.title==='string'?p.title.trim():'',content=typeof p.content==='string'?p.content.trim():'';
    if(!categories.has(p.category)||!title||title.length>120||!content||content.length>8000||title.includes('\0')||content.includes('\0'))throw new Error('분류, 제목과 본문을 확인해 주세요.');
    changes={category:p.category,title,content};
  }
  if(action==='operationsCreate'){
    await rest(table,{...changes,author_id:member.user_id,author_name:member.player_name||member.nickname});
  }else{
    if(typeof p.id!=='string'||!uuid.test(p.id)||typeof p.updatedAt!=='string'||!p.updatedAt||p.updatedAt.length>40)throw new Error('게시물 정보를 확인해 주세요.');
    const query=new URLSearchParams({id:'eq.'+p.id,updated_at:'eq.'+p.updatedAt,archived_at:'is.null',select:'id'});
    if(member.role!=='admin')query.set('author_id','eq.'+member.user_id);
    const rows=await rest(table+'?'+query,{...changes,updated_at:new Date().toISOString()},'PATCH',{Prefer:'return=representation'});
    if(!rows?.length)throw new Error('게시물을 변경할 수 없습니다. 권한과 최신 내용을 확인해 주세요.');
  }
  return {};
}
