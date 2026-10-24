"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname,"../apps-script/Code.gs"),"utf8");
const client = fs.readFileSync(path.join(__dirname,"../static/leaderboard.js"),"utf8");
const copy = value => JSON.parse(JSON.stringify(value));
function server() {
  const ergo = {record_id:"r1",member_name:"김선수",event_id:"e1",event_name:"2000m",time_ms:"450000",time_display:"7:30.0",competition:"클럽",competition_date:"2025-10-01",note:"메모",proof_photo_url:"proof.jpg",created_at:"original"};
  const make = (id,name,role) => ({record_id:id,member_name:name,competition_id:"c1",competition_name:"대회",competition_event_id:"ce1",competition_event_name:"4X+",competition_division_id:"d1",competition_division_name:"남자 160미만",year:"2025",competition_type:"water",is_cox:role,gold:"0",silver:"0",bronze:"0",note:"A팀",created_at:"original",lineup_group_id:"team1"});
  const files={"data/records.csv":[ergo],"data/competition_records.csv":[make("c1","김선수","0"),make("c2","박선수","1"),{...make("c3","이선수","0"),lineup_group_id:"other"}]};
  let locked=false;const writes=[];
  const context=vm.createContext({
    CacheService:{getScriptCache:()=>({get:token=>token==="admin:valid"?"1":null})},
    LockService:{getScriptLock:()=>({waitLock(){locked=true;},releaseLock(){locked=false;}})},
    snapshot:file=>({sha:"snapshot-sha",content:JSON.stringify(files[file])}),
    read:file=>copy(files[file]||({"data/events.csv":[{event_id:"e1",event_name:"2000m"}],"data/competitions.csv":[{competition_id:"c1",competition_name:"대회"}],"data/competition_events.csv":[{competition_event_id:"ce1",competition_event_name:"4X+"}],"data/competition_divisions.csv":[{competition_division_id:"d1",competition_division_name:"남자 160미만"}]}[file])),
    write(file,columns,rows,message,sha){assert(locked);assert.equal(sha,"snapshot-sha");files[file]=copy(rows);writes.push({file,columns,message});},
  });
  vm.runInContext(source,context);vm.runInContext("githubGet_=snapshot;parseCsvObjects_=JSON.parse;readCsv_=read;writeCsv_=write;",context);
  const payload=(kind="ergo",changes={time_display:"7:20.5"})=>({kind,recordId:kind==="ergo"?"r1":"c1",expectedRecord:copy(files[kind==="ergo"?"data/records.csv":"data/competition_records.csv"][0]),changes});
  return {files,writes,context,payload,call:(p,token="valid")=>context.dispatch_("saveApprovedRecord",p,token)};
}
test("approved record listing and editing require admin authentication",()=>{
  const app=server();for(const token of ["","expired"]){assert.throws(()=>app.call(app.payload(),token),/인증/);assert.throws(()=>app.context.dispatch_("adminList",{view:"ergo-records"},token),/인증/);}
  assert.equal(app.context.dispatch_("adminList",{view:"competition-records"},"valid").records.length,3);assert.equal(app.writes.length,0);
});
test("ergo edits normalize times and retain identity, proof and unrelated records",()=>{
  const app=server(),before=copy(app.files["data/competition_records.csv"]);app.call(app.payload());
  const row=app.files["data/records.csv"][0];assert.equal(row.time_ms,"440500");assert.equal(row.time_display,"7:20.5");assert.equal(row.proof_photo_url,"proof.jpg");assert.equal(row.created_at,"original");assert.equal(row.record_id,"r1");assert.deepEqual(app.files["data/competition_records.csv"],before);
});
test("invalid and stale approved edits reject without any writes",()=>{
  for(const changes of [{time_display:"7:60.0"},{competition_date:"2025-02-29"},{event_id:"missing"},{member_name:""},{record_id:"replace"},{proof_photo_url:"replace"}]){const app=server();assert.throws(()=>app.call(app.payload("ergo",changes)));assert.equal(app.writes.length,0);}
  const app=server(),p=app.payload();app.files["data/records.csv"][0].note="concurrent";assert.throws(()=>app.call(p),/변경/);assert.equal(app.writes.length,0);
});
test("competition team edits propagate shared fields while retaining every athlete's name and role",()=>{
  const app=server(),team=copy(app.files["data/competition_records.csv"].slice(0,2)),other=copy(app.files["data/competition_records.csv"][2]);
  const p={...app.payload("competition",{bronze:"1",year:"2024",member_name:"김수정",is_cox:"1"}),applyToTeam:true,expectedTeamRecords:team};
  assert.equal(app.call(p).updatedCount,2);const rows=app.files["data/competition_records.csv"];assert.equal(rows[0].member_name,"김수정");assert.equal(rows[0].is_cox,"1");assert.equal(rows[1].member_name,"박선수");assert.equal(rows[1].is_cox,"1");assert(rows.slice(0,2).every(row=>row.bronze==="1"&&row.year==="2024"));assert.deepEqual(rows[2],other);
});
test("single athlete edits stay local and stale or incomplete team snapshots reject atomically",()=>{
  const app=server();app.call(app.payload("competition",{bronze:"1"}));assert.equal(app.files["data/competition_records.csv"][1].bronze,"0");
  for(const mutate of [p=>p.expectedTeamRecords.pop(),p=>p.expectedTeamRecords[1].note="stale",p=>p.expectedTeamRecords[1]=p.expectedTeamRecords[0]]){const app=server(),p={...app.payload("competition",{gold:"1"}),applyToTeam:true,expectedTeamRecords:copy(app.files["data/competition_records.csv"].slice(0,2))};mutate(p);const before=copy(app.files);assert.throws(()=>app.call(p),/팀 기록/);assert.deepEqual(app.files,before);assert.equal(app.writes.length,0);}
  for(const changes of [{gold:"1.5"},{gold:"-1"},{gold:"100"},{year:"2025.0"},{competition_type:"bad"},{is_cox:"2"},{competition_id:"missing"}]){const app=server();assert.throws(()=>app.call(app.payload("competition",changes)));assert.equal(app.writes.length,0);}
});
test("GitHub write refuses a changed snapshot instead of overwriting concurrent CSV changes",()=>{
  const context=vm.createContext({});vm.runInContext(source,context);context.githubGet_=()=>({sha:"changed"});assert.throws(()=>context.githubPut_("file","content","message","expected"),/변경/);
});
test("player summary uses stored joining years with separate missing column and escaped names",()=>{
  const context=vm.createContext({document:{querySelector:()=>({})},sessionStorage:{getItem:()=>""}});vm.runInContext(client.slice(0,client.indexOf('document.querySelectorAll(".tab-button")')),context);
  const html=context.playerJoinYearSummaryHtml([{memberName:"김선수",joinYear:"2020"},{memberName:"<img>",joinYear:"2026"},{memberName:"미입력",joinYear:""}]);assert(html.indexOf("2026년")<html.indexOf("2020년"));assert.match(html,/미입력/);assert.match(html,/총 3명/);assert.doesNotMatch(html,/<img>/);assert.match(html,/&lt;img&gt;/);
});
