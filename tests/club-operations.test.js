const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const markdownit=require('../static/vendor/markdown-it-15.0.3.js');

test('Operations posts render Markdown tables and lists without loading images or executing author HTML',async()=>{
  function node(){
    return {children:[],classList:{add(){},toggle(){}},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
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
  const window={markdownit,ClubApi:{async call(action,payload){
    calls++;
    assert.equal(action,'operationsList');
    assert.deepEqual({...payload},{category:'',offset:0});
    return {posts:[{title:'경비 안내',content,category:'rules',author_name:'테스트',updated_at:'2026-11-23T00:00:00Z'}],nextOffset:null};
  }}};
  const context={window,document:{querySelector:()=>root,createElement:()=>node(),addEventListener:(name,fn)=>listeners.set(name,fn)},setTimeout(){},clearTimeout(){}};
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
  tools.children[0].onclick();
  assert.equal(list.hidden,false);
  assert.equal(article.hidden,true);
  assert.equal(rowButton.focused,true);
  listeners.get('club-operator-changed')({detail:{userId:'',admin:false}});
  assert.equal(root.querySelector('#operationsBoard').hidden,true);
  assert.equal(root.querySelector('#operationsPosts').children.length,0);
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
  const window={ClubApi:{async call(action,payload){
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
