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
  const window={markdownit,ClubApi:{async call(action){
    if(action==='operationsUnlock')return {token:'test',expiresIn:1};
    assert.equal(action,'operationsList');
    return {posts:[{title:'경비 안내',content,category:'rules',author_name:'테스트',updated_at:'2026-11-23T00:00:00Z'}],nextOffset:null};
  }}};
  const context={window,document:{querySelector:()=>root,createElement:()=>node(),addEventListener:(name,fn)=>listeners.set(name,fn)},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(fs.readFileSync('static/club-operations.js','utf8'),context);
  listeners.get('club-operator-changed')({detail:{userId:'operator',admin:false}});
  window.ClubOperations.route('operations');
  const unlock=root.querySelector('#operationsUnlock');
  unlock.elements={password:{value:'example'}};
  unlock.onsubmit({preventDefault(){}});
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
});
