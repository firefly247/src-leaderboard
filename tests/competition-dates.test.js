"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const serverSource = fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8");
const clientSource = fs.readFileSync(path.join(__dirname, "../static/leaderboard.js"), "utf8");

function server() {
  let locked = false, dates = [{competition_id:"a",year:"2025",competition_date:"2025-02-01"}];
  const records = [{competition_id:"a",competition_name:"옛 이름",year:"2025"},{competition_id:"a",year:"2025"},{competition_id:"a",year:"2024"},{competition_id:"b",competition_name:"나 대회",year:"2025"}];
  const writes=[];
  const context=vm.createContext({
    CacheService:{getScriptCache:()=>({get:key=>key==="admin:valid"?"1":null})},
    LockService:{getScriptLock:()=>({waitLock(){locked=true;},releaseLock(){locked=false;}})},
    read(path){
      if(path==="data/competition_dates.csv")return dates.map(row=>({...row}));
      if(path==="data/competition_records.csv")return records;
      if(path==="data/competitions.csv")return [{competition_id:"a",competition_name:"새 이름"},{competition_id:"b",competition_name:"나 대회"}];
      throw Error(path);
    },
    write(path,headers,rows){assert.equal(locked,true);assert.equal(path,"data/competition_dates.csv");dates=rows.map(row=>Object.fromEntries(headers.map(key=>[key,row[key]])));writes.push(dates);}
  });
  vm.runInContext(serverSource,context);
  vm.runInContext("readCsv_=read;writeCsv_=write;",context);
  return {writes,context,call(action,payload,token="valid"){
    Object.assign(context,{action,payload,token});return vm.runInContext("dispatch_(action,payload,token)",context);
  }};
}

test("date catalog deduplicates year and competition, shares types, and uses current names",()=>{
  const app=server(),rows=app.call("adminList",{view:"competition-dates"}).competitionDates;
  assert.equal(rows.length,3);
  assert.equal(rows.find(row=>row.competition_id==="a"&&row.year===2025).competition_name,"새 이름");
  assert.equal(rows.find(row=>row.year===2024).competition_date,"");
  assert.throws(()=>app.call("adminList",{view:"competition-dates"},""),/인증/);
});

test("saving, clearing and leap dates preserve unrelated years and competitions",()=>{
  const app=server();
  app.call("saveCompetitionDates",{dates:[{competitionId:"a",year:2024,date:"2024-02-29"},{competitionId:"b",year:2025,date:"2025-10-01"}]});
  let rows=app.call("adminList",{view:"competition-dates"}).competitionDates;
  assert.equal(rows.find(row=>row.competition_id==="a"&&row.year===2025).competition_date,"2025-02-01");
  app.call("saveCompetitionDates",{dates:[{competitionId:"a",year:2025,date:""}]});
  rows=app.call("adminList",{view:"competition-dates"}).competitionDates;
  assert.equal(rows.find(row=>row.competition_id==="a"&&row.year===2025).competition_date,"");
  assert.equal(rows.find(row=>row.year===2024).competition_date,"2024-02-29");
  assert.equal(rows.find(row=>row.competition_id==="b").competition_date,"2025-10-01");
});

test("invalid batch dates, unknown pairs and unauthorized writes do not alter storage",()=>{
  for(const edit of [
    {competitionId:"a",year:2025,date:"2025-02-29"},
    {competitionId:"a",year:2025,date:"2025-04-31"},
    {competitionId:"a",year:2025,date:"2024-01-01"},
    {competitionId:"a",year:2025,date:"25-1-1"},
    {competitionId:"a",year:2025,date:null},
    {competitionId:"missing",year:2025,date:"2025-01-01"},
    {competitionId:"b",year:2024,date:"2024-01-01"}
  ]){
    const app=server();
    assert.throws(()=>app.call("saveCompetitionDates",{dates:[{competitionId:"a",year:2024,date:"2024-03-01"},edit]}));
    assert.equal(app.writes.length,0);
  }
  const app=server();
  assert.throws(()=>app.call("saveCompetitionDates",{dates:[]},""),/인증/);
  assert.equal(app.writes.length,0);
});

test("date sorting stays within year groups, puts undated competitions last and ignores names",()=>{
  const context=vm.createContext({sessionStorage:{getItem:()=>""}});
  vm.runInContext(clientSource.slice(0,clientSource.indexOf("async function api")),context);
  const ids=vm.runInContext(`
    state.competitionDates=[{competition_id:'z',year:2025,competition_date:'2025-10-01'},{competition_id:'a',year:2025,competition_date:'2025-02-01'}];
    [{id:'a',year:2025,name:'가'},{id:'z',year:2025,name:'하'},{id:'missing',year:2025,name:'나'},{id:'z',year:2024,name:'하'},{id:'missing',year:2026,name:'나'}].sort(compareCompetitions).map(row=>row.year+'-'+row.id);
  `,context);
  assert.deepEqual(Array.from(ids),["2026-missing","2025-z","2025-a","2025-missing","2024-z"]);
});

test("admin date form escapes catalog names and keeps each edition distinct",()=>{
  const container={innerHTML:""};
  const context=vm.createContext({document:{querySelector:()=>container},sessionStorage:{getItem:()=>""}});
  vm.runInContext(clientSource.slice(0,clientSource.indexOf("const DEFAULT_ERGO_PLACE")),context);
  vm.runInContext(`renderCompetitionDateAdmin(document.querySelector('x'),[{competition_id:'a',year:2025,competition_name:'<img onerror=bad()>',competition_date:'2025-10-01'},{competition_id:'a',year:2024,competition_name:'이전 대회',competition_date:''}])`,context);
  assert.match(container.innerHTML,/&lt;img onerror=bad\(\)&gt;/);
  assert.doesNotMatch(container.innerHTML,/<img/);
  assert.match(container.innerHTML,/data-year="2025"/);
  assert.match(container.innerHTML,/data-year="2024"/);
  assert.match(container.innerHTML,/min="2025-01-01" max="2025-12-31"/);
});
