const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const markdownit=require('../static/vendor/markdown-it-15.0.3.js');

test('Operations posts render Markdown tables and lists without loading images or executing author HTML',async()=>{
  function node(){
    return {children:[],isConnected:true,classList:{add(){},toggle(){}},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
      reset(){},setAttribute(){},removeAttribute(){},style:{setProperty(){}},focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;},
      querySelectorAll(){return this.innerHTML?.includes('<h2>지출 기준</h2>')?[heading]:[];}};
  }
  const selectors=new Map(),listeners=new Map(),root=node(),heading={...node(),tagName:'H2',textContent:'지출 기준'};
  root.querySelector=selector=>{
    if(!selectors.has(selector))selectors.set(selector,node());
    return selectors.get(selector);
  };
  const content='## 지출 기준\n\n| 항목 | 금액 |\n| --- | --- |\n| **장비** | 30만 원 |\n\n1. 신청\n2. 정산\n\n<img src="https://example.test/profile">\n\n![비공개](https://example.test/image)\n\n[링크](https://example.test/info)';
  let calls=0;
  const copied=[];
  const window={markdownit,ClubOperationsLink:{read:()=>null,url:id=>'https://example.test/?operationsPost='+id,clear(){}},addEventListener:(name,fn)=>listeners.set(name,fn),ClubApi:{async call(action,payload){
    calls++;
    assert.equal(action,'operationsList');
    assert.deepEqual({...payload},{category:'',offset:0});
    return {posts:[{id:'post-id',title:'경비 안내',content,category:'rules',author_name:'테스트',updated_at:'2026-11-23T00:00:00Z'}],nextOffset:null};
  }}};
  const entries=[null];
  let position=0;
  const history={
    get state(){return entries[position];},
    pushState(state){entries.splice(++position,entries.length,state);},
    back(){listeners.get('popstate')({state:entries[--position]});},
    forward(){listeners.get('popstate')({state:entries[++position]});},
  };
  const context={window,history,navigator:{clipboard:{async writeText(url){copied.push(url);}}},document:{querySelector:()=>root,createElement:()=>node(),addEventListener:(name,fn)=>listeners.set(name,fn)},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(fs.readFileSync('static/club-operations.js','utf8'),context);
  window.ClubOperations.route('operations');
  assert.equal(calls,0);
  listeners.get('club-operator-changed')({detail:{userId:'operator',admin:false}});
  await new Promise(resolve=>setImmediate(resolve));
  const rowButton=root.querySelector('#operationsPosts').children[0].children[0];
  const article=root.querySelector('#operationsArticle'),list=root.querySelector('#operationsList');
  assert.equal(article.hidden,true);
  rowButton.onclick();
  assert.equal(list.hidden,true);
  const [tools,title,,reading]=article.children,[contents,body]=reading.children;
  assert.equal(title.textContent,'경비 안내');
  assert.equal(tools.children[1].children[0].textContent,'링크 복사');
  await tools.children[1].children[0].onclick();
  assert.deepEqual(copied,['https://example.test/?operationsPost=post-id']);
  assert.match(body.innerHTML,/<h2>지출 기준<\/h2>/);
  assert.match(body.innerHTML,/class="operations-table-scroll"[^>]*><table>[\s\S]*<strong>장비<\/strong>/);
  assert.match(body.innerHTML,/<ol>[\s\S]*<li>신청<\/li>/);
  assert.match(body.innerHTML,/<a href="https:\/\/example.test\/info">링크<\/a>/);
  assert.doesNotMatch(body.innerHTML,/<img\b/i);
  const jump=contents.children[1].children[0].children[0];
  assert.equal(jump.textContent,'지출 기준');
  jump.onclick();
  assert.equal(heading.focused,true);
  assert.equal(heading.scrolled,true);
  assert.equal(history.state.operationsPost,'post-id');
  history.back();
  assert.equal(list.hidden,false);
  assert.equal(article.hidden,true);
  assert.equal(rowButton.focused,true);
  history.forward();
  assert.equal(article.children[1].textContent,'경비 안내');
  assert.equal(list.hidden,true);
  article.children[0].children[0].onclick();
  assert.equal(history.state,null);
  assert.equal(article.hidden,true);
  assert.equal(calls,1);
  listeners.get('club-operator-changed')({detail:{userId:'',admin:false}});
  assert.equal(root.querySelector('#operationsBoard').hidden,true);
  assert.equal(root.querySelector('#operationsPosts').children.length,0);
});

test('An authorized shared link loads a post outside the current list',async()=>{
  const id='12345678-1234-1234-1234-123456789012';
  const calls=[],nodes=new Map(),listeners=new Map();
  const node=()=>({children:[],classList:{toggle(){}},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
    reset(){},setAttribute(){},removeAttribute(){},focus(){},scrollIntoView(){},querySelectorAll:()=>[]});
  const root={...node(),querySelector(selector){
    if(!nodes.has(selector))nodes.set(selector,node());
    return nodes.get(selector);
  }};
  const window={addEventListener(){},ClubOperationsLink:{read:()=>id},ClubApi:{async call(action,payload){
    calls.push([action,{...payload}]);
    if(action==='operationsGet')return {post:{id,title:'이전 회의록',category:'rules',content:'회의 내용',updated_at:'2026-11-23T00:00:00Z'}};
    return {posts:[],nextOffset:null};
  }}};
  const document={querySelector:()=>root,createElement:node,addEventListener:(name,fn)=>listeners.set(name,fn)};
  vm.runInNewContext(fs.readFileSync('static/club-operations.js','utf8'),{window,document});
  window.ClubOperations.route('operations');
  assert.deepEqual(calls,[]);
  listeners.get('club-operator-changed')({detail:{userId:'operator'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[['operationsList',{category:'',offset:0}],['operationsGet',{id}]]);
  assert.equal(nodes.get('#operationsArticle').children[1].textContent,'이전 회의록');
  assert.equal(nodes.get('#operationsArticle').hidden,false);
});

test('Adding a category selects it in the editor and makes it available in the list filter',async()=>{
  const nodes=new Map(),listeners=new Map(),calls=[];
  const node=()=>({value:'',children:[],classList:{toggle(){}},append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;},focus(){this.focused=true;},reset(){},setAttribute(){},removeAttribute(){}});
  const get=selector=>{
    if(!nodes.has(selector))nodes.set(selector,node());
    return nodes.get(selector);
  };
  const editor=get('#operationsPost');
  editor.querySelector=get;
  editor.elements={title:node()};
  const category={id:'custom-id',name:'행사 안내'};
  const window={addEventListener(){},ClubApi:{async call(action,payload){
    calls.push([action,{...payload}]);
    if(action==='operationsAddCategory')return {category};
    return {posts:[],categories:[],nextOffset:null};
  }}};
  const root={...node(),querySelector:get};
  const document={querySelector:()=>root,createElement:node,addEventListener:(name,fn)=>listeners.set(name,fn)};
  vm.runInNewContext(fs.readFileSync('static/club-operations.js','utf8'),{window,document});
  window.ClubOperations.route('operations');
  listeners.get('club-operator-changed')({detail:{userId:'operator'}});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  await flush();
  get('#operationsNew').onclick();
  const select=get('#operationsPostCategory'),entry=get('#operationsCategoryEntry'),name=get('#operationsCategoryName');
  select.value=select.children.find(option=>option.textContent==='신규 입력').value;
  select.onchange();
  assert.equal(entry.hidden,false);
  assert.equal(name.focused,true);
  name.value=' 행사 안내 ';
  get('#operationsAddCategory').onclick();
  await flush();
  assert.deepEqual(calls.at(-1),['operationsAddCategory',{name:'행사 안내'}]);
  assert.equal(select.value,category.id);
  assert.equal(entry.hidden,true);
  assert.equal(get('#operationsCategory').children.find(option=>option.value===category.id).textContent,category.name);
});
