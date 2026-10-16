"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {analyzeAthletes}=require("../static/athlete-analysis.js");
const events=[100,300,500,1000,2000].map(d=>({event_id:String(d),event_name:d+"m"}));
function fixture(times) {
 const records=Object.entries(times).flatMap(([name,values])=>values.flatMap((ms,i)=>ms?[{memberName:name,eventId:events[i].event_id,timeMs:ms,timeDisplay:String(ms),competition_date:"2026-01-01"}]:[]));
 const members=Object.keys(times).map(memberName=>({memberName,pb:Object.fromEntries(events.map(e=>[e.event_id,records.find(r=>r.memberName===memberName&&r.eventId===e.event_id)||null]))}));
 const rankings=Object.fromEntries(events.map(e=>{const rows=records.filter(r=>r.eventId===e.event_id).sort((a,b)=>a.timeMs-b.timeMs);return [e.event_id,rows.map(r=>({...r,rank:rows.findIndex(x=>x.timeMs===r.timeMs)+1}))];}));
 return {records,members,rankings};
}
function run(f){return analyzeAthletes(f.members,events,f.rankings,f.records,new Date("2026-10-16T00:00:00Z"));}
test("power boundaries and incomplete records are handled without invented grades",()=>{
 const p=run(fixture({A:[18000,50000],B:[17900,49900],C:[19000,55000],D:[20000,60000],E:[18000],F:[]}));
 assert.ok(p.get("A").tags.some(t=>t.name==="파워 2등급"));
 assert.ok(p.get("B").tags.some(t=>t.name==="파워 1등급"));
 assert.ok(p.get("C").tags.some(t=>t.name==="파워 3등급"));
 for(const name of ["D","E","F"])assert.ok(!p.get(name).tags.some(t=>t.name.startsWith("파워 ")));
 assert.equal(p.get("E").type,"기록 수집 중");
});
test("rivals require two common events, exclude self and order by relative difference",()=>{
 const p=run(fixture({A:[18000,50000],B:[18100,50100],C:[22000,65000],D:[18000]}));
 assert.deepEqual(p.get("A").rivals.map(r=>r.name),["B","C"]);
});
test("growth requires distinct valid dates and uses historical PB",()=>{
 const f=fixture({A:[18000,50000],B:[18000,50000]});
 f.records.push({memberName:"A",eventId:"100",timeMs:20000,competition_date:"2025-01-01"});
 f.records.push({memberName:"A",eventId:"100",timeMs:10000,competition_date:"2030-01-01"});
 const p=run(f);
 assert.equal(p.get("A").stats[0].growth,10);
 assert.equal(p.get("B").stats[0].growth,null);
 assert.equal(p.get("A").stats[0].rank,1);
 assert.equal(p.get("A").stats[0].gap,null);
});
