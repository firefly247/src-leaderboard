(() => {
  'use strict';
  const root=document.querySelector('#clubOperations');
  const get=id=>root.querySelector('#operations'+id);
  const unlock=get('Unlock'),settings=get('Settings'),password=get('Password'),board=get('Board');
  const editor=get('Post'),posts=get('Posts'),category=get('Category'),more=get('More'),status=get('Status');
  const labels={rules:'동호회 회칙',equipment:'물품관리',general:'기타'};
  const date=new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'});
  const call=(action,payload)=>window.ClubApi.call(action,payload);
  let token='',expiry,revision=0,busy=false,visible=false,operator='',admin=false,editing=null,nextOffset=null;

  function message(text='',error=false){
    status.classList.toggle('is-error',error);
    status.textContent=text;
  }
  function closeEditor(){
    editing=null;
    editor.reset();
    editor.hidden=true;
  }
  function lock(text='',error=false){
    revision++;
    clearTimeout(expiry);
    token='';busy=false;nextOffset=null;
    unlock.reset();password.reset();closeEditor();
    category.value='';category.disabled=false;posts.replaceChildren();more.hidden=true;board.hidden=true;
    unlock.hidden=false;settings.hidden=!admin;settings.open=false;
    root.removeAttribute('aria-busy');
    message(text,error);
  }
  async function run(operation){
    if(!visible||!operator||busy)return;
    const current=revision,isCurrent=()=>current===revision;
    busy=true;category.disabled=true;root.setAttribute('aria-busy','true');message();
    try{await operation(isCurrent);}
    catch(error){
      if(isCurrent()){
        if(error.code==='operations_locked')lock(error.message,true);
        else message(error.message,true);
      }
    }finally{
      if(isCurrent()){busy=false;category.disabled=false;root.removeAttribute('aria-busy');}
    }
  }
  function element(tag,text,className){
    const node=document.createElement(tag);
    if(text)node.textContent=text;
    if(className)node.className=className;
    return node;
  }
  function actionButton(text,handler){
    const button=element('button',text,'secondary-button');
    button.type='button';button.onclick=handler;
    return button;
  }
  function openEditor(post=null){
    if(busy||!token)return;
    editing=post;
    editor.querySelector('h2').textContent=post?'게시물 수정':'게시물 작성';
    editor.elements.category.value=post?.category||category.value||'general';
    editor.elements.title.value=post?.title||'';
    editor.elements.content.value=post?.content||'';
    editor.hidden=false;
    editor.elements.title.focus();
  }
  function postCard(post){
    const article=element('article','','operations-card'),details=element('details'),summary=element('summary');
    const meta=element('span',`${post.author_name} · ${date.format(new Date(post.updated_at))}`,'operations-meta');
    summary.append(element('span',labels[post.category],'operations-tag'),element('strong',post.title),meta);
    details.append(summary,element('p',post.content,'operations-content'));
    if(post.canEdit){
      const actions=element('div','','operations-actions');
      actions.append(actionButton('수정',()=>openEditor(post)),actionButton('삭제',()=>{
        if(!busy&&token&&confirm('게시물을 삭제할까요?'))run(async current=>{
          await call('operationsArchive',{token,id:post.id,updatedAt:post.updated_at});
          if(!current())return;
          if(editing?.id===post.id)closeEditor();
          await loadPosts(current);
          if(current())message('게시물을 삭제했습니다.');
        });
      }));
      details.append(actions);
    }
    article.append(details);
    return article;
  }
  async function loadPosts(current,offset=0){
    const selected=category.value;
    more.hidden=true;
    if(!offset)posts.replaceChildren();
    const result=await call('operationsList',{token,category:selected,offset});
    if(!current())return;
    if(!offset&&!result.posts.length)posts.append(element('p','등록된 게시물이 없습니다.','form-description'));
    posts.append(...result.posts.map(postCard));
    nextOffset=result.nextOffset;more.hidden=nextOffset===null;
  }
  unlock.onsubmit=event=>{
    event.preventDefault();
    run(async current=>{
      const value=unlock.elements.password.value;
      unlock.reset();
      const result=await call('operationsUnlock',{password:value});
      if(!current())return;
      token=result.token;
      expiry=setTimeout(()=>lock('운영 암호를 다시 입력해 주세요.'),result.expiresIn*1000);
      unlock.hidden=true;board.hidden=false;
      await loadPosts(current);
    });
  };
  password.onsubmit=event=>{
    event.preventDefault();
    run(async current=>{
      const value=password.elements.password.value;
      if(value!==password.elements.confirm.value){message('새 운영 암호가 일치하지 않습니다.',true);return;}
      password.reset();
      await call('operationsSetPassword',{password:value});
      if(current())lock('운영 암호를 저장했습니다.');
    });
  };
  editor.onsubmit=event=>{
    event.preventDefault();
    run(async current=>{
      const fields=Object.fromEntries(new FormData(editor));
      const post=editing;
      await call(post?'operationsUpdate':'operationsCreate',{token,...fields,...(post?{id:post.id,updatedAt:post.updated_at}:{})});
      if(!current())return;
      closeEditor();
      if(category.value)category.value=fields.category;
      await loadPosts(current);
      if(current())message('게시물을 저장했습니다.');
    });
  };
  category.onchange=()=>run(loadPosts);
  get('Refresh').onclick=()=>run(loadPosts);
  more.onclick=()=>{if(nextOffset!==null)run(current=>loadPosts(current,nextOffset));};
  get('New').onclick=()=>openEditor();
  get('Cancel').onclick=()=>{if(!busy){closeEditor();get('New').focus();}};
  get('Lock').onclick=()=>{lock();unlock.elements.password.focus();};
  document.addEventListener('club-operator-changed',event=>{
    operator=event.detail.userId;admin=event.detail.admin;
    lock();
  });
  window.ClubOperations={route(tab){
    const next=tab==='operations';
    if(!next&&visible)lock();
    visible=next;
  }};
})();
