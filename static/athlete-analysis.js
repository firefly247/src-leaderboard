"use strict";

// Pure analysis functions shared by the browser and Node tests.
function analyzeAthletes(members, events, rankings, records, now = new Date()) {
  const distance = event => Number(String(event.event_name).match(/^\s*(\d+)\s*m\s*$/i)?.[1]);
  const today = now.toISOString().slice(0, 10);
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(value)) && value <= today;
  const profiles = members.map(member => {
    const stats = events.map(event => {
      const pb = member.pb[event.event_id], rows = rankings[event.event_id] || [];
      const ranked = rows.find(row => row.memberName === member.memberName);
      const history = records.filter(row => row.memberName === member.memberName && row.eventId === event.event_id && row.timeMs > 0 && validDate(row.competition_date)).sort((a,b) => a.competition_date.localeCompare(b.competition_date) || a.timeMs-b.timeMs);
      const dates = [...new Set(history.map(row => row.competition_date))];
      const first = history[0], best = history.length ? Math.min(...history.map(row => row.timeMs)) : null;
      const faster = pb ? rows.filter(row => row.timeMs < pb.timeMs).at(-1) : null;
      const score = ranked ? rows.length < 2 ? null : 100 * rows.filter(row => row.timeMs > pb.timeMs).length / (rows.length-1) : null;
      return {eventId:event.event_id, name:event.event_name, distance:distance(event), pb, rank:ranked?.rank, count:rows.length, score, gap:faster ? pb.timeMs-faster.timeMs : null, latest:history.at(-1)?.competition_date, growth:dates.length >= 2 ? Math.max(0,(first.timeMs-best)/first.timeMs*100) : null};
    });
    const byDistance = Object.fromEntries(stats.map(stat => [stat.distance,stat]));
    const average = distances => { const values = distances.map(d => byDistance[d]?.score); return values.every(v => v != null) ? values.reduce((a,b)=>a+b,0)/values.length : null; };
    const power = average([100,300]), endurance = average([1000,2000]);
    const tags = [];
    const add = (name,reason) => tags.push({name,reason});
    const hundred = byDistance[100]?.pb?.timeMs, three = byDistance[300]?.pb?.timeMs;
    // Fixed anchors: each tier boundary is exclusive, matching "under" times.
    if (hundred && three) {
      const index = ((hundred-18000)/1000)*.6 + ((three-50000)/5000)*.4;
      const grade = index < 0 ? 1 : index < 1 ? 2 : index < 2 ? 3 : null;
      if (grade) add("파워 " + grade + "등급", `100m 60% + 300m 40% 가중 기준. 1등급 경계 18초·50초, 2등급 19초·55초, 3등급 20초·60초 미만. 두 거리 간 보완을 허용하는 시범 기준입니다.`);
    }
    let type = "기록 수집 중";
    if (power != null && endurance != null) {
      type = power-endurance >= 20 ? "스프린터" : endurance-power >= 20 ? "지구력형" : "균형형";
      if (Math.min(power,endurance) >= 60 && Math.abs(power-endurance) < 20) type = "올라운더";
      add(type, `클럽 내 단거리·장거리 상대점수 비교: 파워 ${power.toFixed(0)}, 체력 ${endurance.toFixed(0)}. 점수 차이 20점 이상이면 해당 성향으로 분류합니다.`);
    }
    const growing = stats.filter(s=>s.growth != null).sort((a,b)=>b.growth-a.growth);
    if (growing[0]?.growth >= 5) add("기록 성장형", `${growing[0].name} 최초 날짜 기록 대비 전체 PB ${growing[0].growth.toFixed(1)}% 향상. 최근 성장 속도를 뜻하지 않습니다.`);
    const own = records.filter(r=>r.memberName===member.memberName && validDate(r.competition_date));
    const recentDays = new Set(own.filter(r=>(now-Date.parse(r.competition_date))/86400000<=90).map(r=>r.competition_date));
    if (recentDays.size >= 3) add("꾸준한 기록", `최근 90일 동안 서로 다른 ${recentDays.size}일에 기록을 남겼습니다. 실제 훈련 횟수와는 다를 수 있습니다.`);
    const rankedStats = stats.filter(s=>s.rank).sort((a,b)=>a.rank-b.rank || b.count-a.count);
    const strengths = rankedStats.slice(0,2).map(s=>`${s.name} 클럽 ${s.rank}위 / ${s.count}명입니다.`);
    if(growing[0]?.growth>0) strengths.push(`${growing[0].name} 최초 기록 대비 ${growing[0].growth.toFixed(1)}% 향상됐습니다.`);
    const missing = stats.filter(s=>!s.pb);
    const goals = [];
    if(missing.length) goals.push(`${missing.map(s=>s.name).join("·")} 기록을 등록하면 선수 분석이 더 정확해집니다.`);
    const reachable = stats.filter(s=>s.gap>0).sort((a,b)=>a.gap/a.pb.timeMs-b.gap/b.pb.timeMs)[0];
    if(reachable) goals.push(`${reachable.name}에서 ${(reachable.gap/1000).toFixed(1)}초 단축하면 바로 위 기록과 동률입니다.`);
    return {name:member.memberName,stats,tags,type,strengths:strengths.slice(0,2),goals,coverage:stats.filter(s=>s.pb).length,rivals:[]};
  });
  profiles.forEach(profile=>{
    profile.rivals = profiles.filter(p=>p!==profile).map(candidate=>{
      const common=profile.stats.filter(s=>s.pb && candidate.stats.some(c=>c.eventId===s.eventId && c.pb));
      const difference=common.reduce((sum,s)=>{const other=candidate.stats.find(c=>c.eventId===s.eventId);return sum+Math.abs(Math.log(s.pb.timeMs/other.pb.timeMs));},0)/common.length;
      return {name:candidate.name,common:common.length,difference,reason:`공통 ${common.length}종목 · 평균 기록 차이 약 ${(Math.expm1(difference)*100).toFixed(1)}%`};
    }).filter(c=>c.common>=2).sort((a,b)=>a.difference-b.difference || b.common-a.common || a.name.localeCompare(b.name,"ko")).slice(0,3);
  });
  return new Map(profiles.map(p=>[p.name,p]));
}
if(typeof module!=="undefined") module.exports={analyzeAthletes};
