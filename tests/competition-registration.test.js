"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),test=require("node:test"),vm=require("node:vm");
function client() {
  const source=fs.readFileSync(path.join(__dirname,"../static/leaderboard.js"),"utf8");
  const context=vm.createContext({document:{querySelector:()=>({})},sessionStorage:{getItem:()=>""},Event:class {constructor(type){this.type=type;}}});
  vm.runInContext(source.slice(0,source.indexOf('document.querySelectorAll(".tab-button")')),context);return context;
}
test("member search includes every matching distinct member and keeps A/B names distinct",()=>{
  const app=client();vm.runInContext('state.members=[{memberName:"이동훈B"},{memberName:"김선수"},{memberName:"이동훈A"},{memberName:"이동훈B"}];',app);
  assert.deepEqual(Array.from(app.competitionMemberNames(" 이동훈 ")),["이동훈A","이동훈B"]);
  assert.deepEqual(Array.from(app.competitionMemberNames("신규선수")),[]);
});
test("choosing a member commits the full name to that input and notifies input/change listeners",()=>{
  const app=client(),events=[],other={value:"다른선수"},input={isConnected:true,disabled:false,value:"김",focus(){},dispatchEvent(event){events.push(event.type);}};
  app.chooseCompetitionMember(input,"김선수");assert.equal(input.value,"김선수");assert.deepEqual(events,["input","change"]);assert.equal(other.value,"다른선수");
  input.disabled=true;app.chooseCompetitionMember(input,"이선수");assert.equal(input.value,"김선수");
  input.disabled=false;input.isConnected=false;app.chooseCompetitionMember(input,"박선수");assert.equal(input.value,"김선수");
});
