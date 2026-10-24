"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),test=require("node:test"),vm=require("node:vm");
function client() {
  const source=fs.readFileSync(path.join(__dirname,"../static/leaderboard.js"),"utf8");
  const context=vm.createContext({document:{querySelector:()=>({}),querySelectorAll:()=>[]},sessionStorage:{getItem:()=>""},Event:class {constructor(type){this.type=type;}}});
  vm.runInContext(source.slice(0,source.indexOf('document.querySelectorAll(".tab-button")')),context);return context;
}
test("member search includes every matching distinct member and keeps A/B names distinct",()=>{
  const app=client();vm.runInContext('state.members=[{memberName:"이동훈B"},{memberName:"김선수"},{memberName:"이동훈A"},{memberName:"이동훈B"}];',app);
  assert.deepEqual(Array.from(app.competitionMemberNames(" 이동훈 ")),["이동훈A","이동훈B"]);
  assert.deepEqual(Array.from(app.competitionMemberNames("신규선수")),[]);
});
test("member suggestions match Korean syllables while the next consonant is still a final",()=>{
  const app=client();vm.runInContext('state.members=[{memberName:"조홍관"},{memberName:"조현우"},{memberName:"김기현"}];',app);
  for(const query of ["조","좋","조ㅎ","조홍","조홍ㄱ","조홍관"])assert.ok(Array.from(app.competitionMemberNames(query)).includes("조홍관"),query);
  assert.deepEqual(Array.from(app.competitionMemberNames("좋")),["조현우","조홍관"]);
  assert.deepEqual(Array.from(app.competitionMemberNames("조홍간")),[]);
  assert.deepEqual(Array.from(app.competitionMemberNames("김기혀")),["김기현"]);
});
test("new member status clears for an existing name or an empty input",()=>{
  const app=client(),classes=new Set(),input={value:"새선수",classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}}};
  vm.runInContext('state.members=[{memberName:"이동훈B"}];',app);
  app.updateCompetitionMemberStatus(input);assert.equal(classes.has("is-new-member"),true);
  input.value=" 이동훈B ";app.updateCompetitionMemberStatus(input);assert.equal(classes.has("is-new-member"),false);
  input.value=" ";app.updateCompetitionMemberStatus(input);assert.equal(classes.has("is-new-member"),false);
});
test("empty inputs keep suggestions closed",()=>{
  const app=client();app.openCompetitionMemberMenu({value:" ",disabled:false});
});
test("choosing a member commits the full name to that input and notifies input/change listeners",()=>{
  const app=client(),events=[],other={value:"다른선수"},input={isConnected:true,disabled:false,value:"김",focus(){},dispatchEvent(event){events.push(event.type);}};
  app.chooseCompetitionMember(input,"김선수");assert.equal(input.value,"김선수");assert.deepEqual(events,["input","change"]);assert.equal(other.value,"다른선수");
  input.disabled=true;app.chooseCompetitionMember(input,"이선수");assert.equal(input.value,"김선수");
  input.disabled=false;input.isConnected=false;app.chooseCompetitionMember(input,"박선수");assert.equal(input.value,"김선수");
});
