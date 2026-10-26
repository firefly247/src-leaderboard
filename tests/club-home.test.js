const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {summarize}=require('../static/club-home.js');
test('Club introduction counts competition editions and crew medals once, including indoor and beach',()=>{
 const base={year:'2026',competition_id:'race',competition_name:'대회',competition_event_id:'quad',competition_event_name:'4X+',competition_division_id:'open',competition_type:'water',gold:'1',silver:'0',bronze:'0'};
 const rows=Array.from({length:5},(_,i)=>({...base,member_name:'선수'+i}));
 rows.push({...base,member_name:'선수0',note:'B팀'});
 rows.push({...base,year:'2013',competition_type:'indoor',gold:'0',silver:'1',member_name:'선수0'});
 rows.push({...base,competition_id:'beach',competition_type:'beach',gold:'0',bronze:'1',member_name:'선수0'});
 const result=summarize(rows,[{year:'2026',competition_id:'race',competition_date:'2026-10-18'}]);
 assert.equal(result.editions,3);assert.equal(result.people,5);assert.deepEqual(result.medals,{gold:2,silver:1,bronze:1});assert.equal(result.total,4);
 assert.equal(result.firstYear,2013);assert.equal(result.lastYear,2026);assert.equal(result.latest[0].date,'2026-10-18');assert.doesNotMatch(JSON.stringify(result),/선수0/);
});
test('Club introduction accepts normalized UI records and has an honest empty state',()=>{
 const result=summarize([{year:2026,competitionId:'one',competitionName:'하남',competitionType:'water',competitionEventId:'quad',competitionDivisionId:'open',competitionEventName:'4X+',memberName:'선수',gold:1,silver:0,bronze:0}]);
 assert.equal(result.total,1);assert.equal(result.latest[0].name,'하남');assert.equal(summarize([]).firstYear,null);assert.equal(summarize([]).editions,0);
});
test('Site starts on club introduction and member menus are hidden in initial markup',()=>{
 const html=fs.readFileSync('index.html','utf8');assert.match(html,/<title>삼성조정클럽<\/title>/);assert.doesNotMatch(html,/삼성조정클럽 리더보드/);
 assert.match(html,/class="tab-panel is-active club-home" data-panel="home"/);assert.match(html,/data-tab="ergo"[^>]*hidden>ERG 리더보드/);assert.match(html,/data-tab="competition"[^>]*hidden>대회 리더보드/);
 assert.equal(JSON.parse(fs.readFileSync('static/manifest.webmanifest','utf8')).name,'삼성조정클럽');
});
