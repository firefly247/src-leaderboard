const categories=new Set(['rules','equipment','general']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pageSize=10;
export const OPERATIONS_ACTIONS=new Set(['operationsList','operationsCreate','operationsUpdate','operationsArchive']);

export async function handleOperations(action,p,member,rest){
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
