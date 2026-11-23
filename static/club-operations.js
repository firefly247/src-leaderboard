(() => {
  'use strict';
  const root=document.querySelector('#clubOperations');
  const get=id=>root.querySelector('#operations'+id);
  const board=get('Board');
  const editor=get('Post'),posts=get('Posts'),category=get('Category'),more=get('More'),status=get('Status');
  const postCategory=get('PostCategory'),categoryEntry=get('CategoryEntry'),categoryName=get('CategoryName');
  const list=get('List'),toolbar=get('Toolbar'),article=get('Article'),empty=get('Empty');
  const content=get('Content');
  const markdown=window.markdownit?.({html:false,breaks:true}).disable('image');
  if(markdown){
    markdown.renderer.rules.table_open=()=>'<div class="operations-table-scroll" tabindex="0" role="region" aria-label="표"><table>\n';
    markdown.renderer.rules.table_close=()=>'</table></div>\n';
  }
  const defaultCategories=[['rules','동호회 회칙'],['equipment','물품관리'],['general','기타']];
  const newCategory='__new__';
  let labels=new Map(defaultCategories);
  const postRows=new Map();
  const date=new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'});
  const call=(action,payload)=>window.ClubApi.call(action,payload);
  let revision=0,busy=false,visible=false,operator='',editing=null,nextOffset=null,markdownEditor=null,postTrigger=null;

  function message(text='',error=false){
    status.classList.toggle('is-error',error);
    status.textContent=text;
  }
  function closeEditor(){
    if(markdownEditor){
      markdownEditor.toTextArea();
      markdownEditor=null;
      content.required=true;
    }
    editing=null;
    editor.reset();
    categoryEntry.hidden=true;
    categoryName.value='';
    editor.hidden=true;
  }
  function clearBoard(text='',error=false){
    revision++;
    busy=false;nextOffset=null;
    closeEditor();
    category.value='';category.disabled=false;posts.replaceChildren();more.hidden=true;empty.hidden=true;board.hidden=true;
    postRows.clear();
    labels=new Map(defaultCategories);
    syncCategoryOptions();
    showList();
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
        if(error.code==='operations_forbidden'){
          operator='';
          clearBoard(error.message,true);
          window.ClubMembership?.refresh();
        }else message(error.message,true);
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
  function syncCategoryOptions(){
    function option(value,label){
      const node=element('option',label);
      node.value=value;
      return node;
    }
    const filter=category.value,selected=postCategory.value;
    category.replaceChildren(option('','전체'),...[...labels].map(([id,name])=>option(id,name)));
    category.value=labels.has(filter)?filter:'';
    postCategory.replaceChildren(...[...labels].map(([id,name])=>option(id,name)),option(newCategory,'신규 입력'));
    postCategory.value=labels.has(selected)||selected===newCategory?selected:'general';
  }
  function addCategory(){
    if(busy||postCategory.value!==newCategory)return;
    const name=categoryName.value.trim();
    if(!name){
      message('새 분류 이름을 입력해 주세요.',true);
      categoryName.focus();
      return;
    }
    run(async current=>{
      const result=await call('operationsAddCategory',{name});
      if(!current())return;
      labels.set(result.category.id,result.category.name);
      syncCategoryOptions();
      postCategory.value=result.category.id;
      categoryEntry.hidden=true;
      categoryName.value='';
      postCategory.focus();
      message('분류를 선택했습니다.');
    });
  }
  function openEditor(post=null){
    if(busy||!operator)return;
    editing=post;
    editor.querySelector('h2').textContent=post?'게시물 수정':'게시물 작성';
    postCategory.value=post?.category||category.value||'general';
    categoryEntry.hidden=true;
    categoryName.value='';
    editor.elements.title.value=post?.title||'';
    editor.hidden=false;
    if(markdownEditor){
      markdownEditor.value(post?.content||'');
    }else{
      content.value=post?.content||'';
      if(markdown&&window.EasyMDE){
        const EasyMDE=window.EasyMDE;
        markdownEditor=new EasyMDE({
          element:content,autoDownloadFontAwesome:false,spellChecker:false,status:false,
          minHeight:'190px',maxHeight:'55vh',sideBySideFullscreen:false,
          previewClass:'operations-markdown',previewRender:text=>markdown.render(text),
          shortcuts:{toggleFullScreen:null,toggleSideBySide:null},
          toolbar:[
            {name:'heading',action:EasyMDE.toggleHeadingSmaller,text:'제목',title:'제목'},
            {name:'bold',action:EasyMDE.toggleBold,text:'굵게',title:'굵게'},
            {name:'unordered-list',action:EasyMDE.toggleUnorderedList,text:'목록',title:'글머리 목록'},
            {name:'ordered-list',action:EasyMDE.toggleOrderedList,text:'번호',title:'번호 목록'},
            {name:'table',action:EasyMDE.drawTable,text:'표',title:'표 삽입'},
            {name:'link',action:EasyMDE.drawLink,text:'링크',title:'링크 삽입'},
            '|',
            {name:'preview',action:EasyMDE.togglePreview,text:'미리보기',title:'미리보기 전환'},
          ],
        });
        content.required=false;
        markdownEditor.codemirror.getInputField().setAttribute('aria-label','본문');
      }
    }
    editor.elements.title.focus();
  }
  function postDate(post){
    const time=element('time',date.format(new Date(post.updated_at)),'operations-date');
    time.dateTime=post.updated_at;
    return time;
  }
  function postRow(post){
    const row=element('li','','operations-post-row');
    const button=element('button','','operations-post-link');
    button.type='button';
    postRows.set(post.id,{post,button});
    button.onclick=()=>{
      if(busy||!operator)return;
      const state={operationsPost:post.id};
      if(history.state?.operationsPost)history.replaceState(state,'');
      else history.pushState(state,'');
      showPost(post,button);
    };
    button.append(
      element('span',labels.get(post.category),'operations-tag'),
      element('strong',post.title,'operations-post-title'),
      element('span',post.author_name,'operations-author'),
      postDate(post),
    );
    row.append(button);
    return row;
  }
  function showList(restoreFocus=false){
    article.hidden=true;article.replaceChildren();list.hidden=false;toolbar.hidden=false;
    if(restoreFocus)(postTrigger?.isConnected?postTrigger:get('New')).focus();
    postTrigger=null;
  }
  function returnToList(){
    if(history.state?.operationsPost)history.back();
    else showList(true);
  }
  function articleContents(body){
    const headings=[...body.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    if(!headings.length)return null;
    const nav=element('nav','','operations-contents'),items=element('ol');
    const firstLevel=Math.min(...headings.map(heading=>Number(heading.tagName[1])));
    nav.setAttribute('aria-label','게시물 목차');
    nav.append(element('h3','목차'),items);
    for(const heading of headings){
      const entry=element('li'),jump=element('button',heading.textContent);
      entry.style.setProperty('--heading-indent',Number(heading.tagName[1])-firstLevel);
      jump.type='button';
      jump.onclick=()=>{
        heading.focus({preventScroll:true});
        heading.scrollIntoView({block:'start'});
      };
      heading.tabIndex=-1;
      entry.append(jump);items.append(entry);
    }
    return nav;
  }
  function showPost(post,trigger){
    if(busy||!operator)return;
    postTrigger=trigger;
    const back=actionButton('← 목록',()=>{back.disabled=true;returnToList();});
    const tools=element('div','','operations-article-tools');
    const title=element('h2',post.title,'operations-article-title');
    title.tabIndex=-1;
    const meta=element('div','','operations-meta');
    meta.append(element('span',labels.get(post.category),'operations-tag'),element('span',post.author_name),postDate(post));
    const body=element('div','','operations-content');
    if(markdown){
      body.classList.add('operations-markdown');
      body.innerHTML=markdown.render(post.content);
    }else body.textContent=post.content;
    const reading=element('div','','operations-reading'),contents=articleContents(body);
    if(contents)reading.append(contents);
    reading.append(body);
    tools.append(back);
    if(post.canEdit){
      const actions=element('div','','operations-actions');
      actions.append(actionButton('수정',()=>openEditor(post)),actionButton('삭제',()=>{
        if(!busy&&operator&&confirm('게시물을 삭제할까요?'))run(async current=>{
          await call('operationsArchive',{id:post.id,updatedAt:post.updated_at});
          if(!current())return;
          if(editing?.id===post.id)closeEditor();
          returnToList();
          await loadPosts(current);
          if(current())message('게시물을 삭제했습니다.');
        });
      }));
      tools.append(actions);
    }
    article.replaceChildren(tools,title,meta,reading);
    article.hidden=false;list.hidden=true;toolbar.hidden=true;
    title.focus();
    title.scrollIntoView({block:'nearest'});
  }
  async function loadPosts(current,offset=0){
    const selected=category.value;
    more.hidden=true;
    if(!offset){posts.replaceChildren();postRows.clear();empty.hidden=true;}
    const result=await call('operationsList',{category:selected,offset});
    if(!current())return;
    if(result.categories){
      labels=new Map(defaultCategories);
      for(const {id,name} of result.categories)labels.set(id,name);
      syncCategoryOptions();
    }
    if(!offset)empty.hidden=result.posts.length>0;
    posts.append(...result.posts.map(postRow));
    nextOffset=result.nextOffset;more.hidden=nextOffset===null;
  }
  function openBoard(){
    if(!visible||!operator||!board.hidden)return;
    board.hidden=false;
    run(loadPosts);
  }
  editor.onsubmit=event=>{
    event.preventDefault();
    if(busy)return;
    if(postCategory.value===newCategory){
      message('새 분류를 추가하거나 기존 분류를 선택해 주세요.',true);
      categoryName.focus();
      return;
    }
    const text=(markdownEditor?.value()??content.value).trim();
    if(!text||text.length>content.maxLength){
      message('본문을 1자 이상 8,000자 이하로 입력해 주세요.',true);
      if(markdownEditor){
        if(markdownEditor.isPreviewActive())window.EasyMDE.togglePreview(markdownEditor);
        markdownEditor.codemirror.focus();
      }else content.focus();
      return;
    }
    run(async current=>{
      const fields=Object.fromEntries(new FormData(editor));
      fields.content=text;
      const post=editing;
      await call(post?'operationsUpdate':'operationsCreate',{...fields,...(post?{id:post.id,updatedAt:post.updated_at}:{})});
      if(!current())return;
      closeEditor();
      if(post)returnToList();
      if(category.value)category.value=fields.category;
      await loadPosts(current);
      if(current())message('게시물을 저장했습니다.');
    });
  };
  postCategory.onchange=()=>{
    categoryEntry.hidden=postCategory.value!==newCategory;
    if(categoryEntry.hidden)categoryName.value='';
    else categoryName.focus();
  };
  categoryName.onkeydown=event=>{
    if(event.key==='Enter'&&!event.isComposing){event.preventDefault();addCategory();}
  };
  get('AddCategory').onclick=addCategory;
  category.onchange=()=>run(loadPosts);
  get('Refresh').onclick=()=>run(loadPosts);
  more.onclick=()=>{if(nextOffset!==null)run(current=>loadPosts(current,nextOffset));};
  get('New').onclick=()=>openEditor();
  get('Cancel').onclick=()=>{if(!busy){closeEditor();if(article.hidden)get('New').focus();else article.querySelector('h2').focus();}};
  window.addEventListener('popstate',event=>{
    if(!visible||!operator)return;
    const row=postRows.get(event.state?.operationsPost);
    if(row&&!busy)showPost(row.post,row.button);
    else if(!article.hidden){
      if(editing)closeEditor();
      showList(true);
    }
  });
  document.addEventListener('club-operator-changed',event=>{
    operator=event.detail.userId;
    clearBoard();
    openBoard();
  });
  window.ClubOperations={route(tab){
    const next=tab==='operations';
    if(!next&&visible)clearBoard();
    visible=next;
    openBoard();
  }};
})();
