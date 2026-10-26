"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createView() {
  const source = fs.readFileSync(path.join(__dirname, "..", "static", "leaderboard.js"), "utf8");
  const renderSource = source.slice(0, source.indexOf("async function api"));
  const elements = {
    "#competitionYearFilter": { value: "" },
    "#competitionParticipantSearch": { value: "" },
    "#competitionSummaryHead": { innerHTML: "" },
    "#competitionSummaryColumns": { innerHTML: "" },
    "#competitionSummaryBody": { innerHTML: "" },
    "#competitionHistoryBody": { innerHTML: "" },
    "#dialogMemberName": { textContent: "" },
    "#dialogContent": { innerHTML: "" },
    "#memberDialog": { showModal() { this.open = true; } },
    ".medal-matrix": {
      style: { setProperty() {} },
      classList: { toggle() {} },
    },
  };
  const context = vm.createContext({
    console,
    document: { querySelector: selector => elements[selector] },
    sessionStorage: { getItem: () => "" },
  });
  vm.runInContext(renderSource, context);
  vm.runInContext(`
    state.competitionDivisions = [
      { competition_division_id: "division-men-under-160", competition_division_name: "남자 160미만" },
      { competition_division_id: "division-men-open", competition_division_name: "남자 일반부" },
      { competition_division_id: "division-women-under-160", competition_division_name: "여자 160미만" },
      { competition_division_id: "division-mixed-under-160", competition_division_name: "혼성 160미만" },
      { competition_division_id: "division-men-over-200", competition_division_name: "남자 200이상" }
    ];
    const makeRecord = (name, eventId, eventName, divisionId, divisionName, isCox, lineupGroupId, bronze = 0) => competitionRecord({
      member_name: name,
      competition_id: "competition-tangeum",
      competition_name: "탄금호",
      competition_event_id: eventId,
      competition_event_name: eventName,
      competition_division_id: divisionId,
      competition_division_name: divisionName,
      competition_type: "water",
      year: "2026",
      is_cox: isCox ? "1" : "0",
      gold: "0",
      silver: "0",
      bronze: String(bronze),
      note: lineupGroupId === "team-4x" ? "A팀" : "B팀",
      lineup_group_id: lineupGroupId
    });
    state.competitionRecords = [
      makeRecord("김콕스", "event-4x", "4X+", "division-men-under-160", "남자 160미만", true, "team-4x", 1),
      ...["김크루", "박크루", "이크루", "최크루"].map(name => makeRecord(name, "event-4x", "4X+", "division-men-under-160", "남자 160미만", false, "team-4x", 1)),
      makeRecord("정콕스", "event-8", "8+", "division-men-open", "남자 일반부", true, "team-8"),
      ...Array.from({ length: 8 }, (_, index) => makeRecord("팔크루" + (index + 1), "event-8", "8+", "division-men-open", "남자 일반부", false, "team-8"))
    ];
    build();
    renderCompetitionTables();
  `, context);
  return { context, elements };
}

test("대회와 성별 헤더를 병합하고 대회명을 참가자 명단에 연결한다", () => {
  const { context, elements } = createView();
  assert.match(elements["#competitionSummaryHead"].innerHTML, /colspan="3">남자/);
  assert.ok(elements["#competitionSummaryHead"].innerHTML.indexOf("200이상") < elements["#competitionSummaryHead"].innerHTML.indexOf("일반부"));
  assert.match(elements["#competitionSummaryHead"].innerHTML, />여자</);
  assert.match(elements["#competitionSummaryHead"].innerHTML, />혼성</);
  assert.equal((elements["#competitionSummaryBody"].innerHTML.match(/>탄금호<\/button>/g) || []).length, 1);
  assert.match(elements["#competitionSummaryBody"].innerHTML, /rowspan="2"><button class="competition-name-button"/);

  assert.match(elements["#competitionSummaryBody"].innerHTML, /data-competition-participants="competition-1"/);
  assert.doesNotMatch(elements["#competitionSummaryBody"].innerHTML, /data-lineup-key/);
  const participantCount = vm.runInContext("state.competitionLineups.get('competition-1').length", context);
  assert.equal(participantCount, 14);
  vm.runInContext("openCompetitionParticipants('competition-1')", context);
  assert.match(elements["#dialogContent"].innerHTML, /<th>종목<\/th><th>나이대<\/th><th>팀명<\/th><th>결과<\/th><th>COX<\/th><th>CREW<\/th>/);
  assert.doesNotMatch(elements["#dialogContent"].innerHTML, /<th>대회<\/th>/);
  assert.match(elements["#dialogContent"].innerHTML, /<td>4X\+<\/td><td>남자 160미만<\/td><td>A팀<\/td><td class="lineup-medal"><span class="result-icon" title="동메달">🥉<\/span><\/td>/);
  assert.match(elements["#dialogContent"].innerHTML, /<td>8\+<\/td><td>남자 일반부<\/td><td>B팀<\/td><td class="lineup-medal"><span class="result-icon participation" title="참가">👥<\/span><\/td>/);
  assert.match(elements["#dialogContent"].innerHTML, />김콕스<\/td>/);
  assert.match(elements["#dialogContent"].innerHTML, /김크루, 박크루, 이크루, 최크루/);
  assert.match(elements["#dialogContent"].innerHTML, /<span class="crew-line">팔크루1, 팔크루2, 팔크루3, 팔크루4<\/span><span class="crew-line">팔크루5, 팔크루6, 팔크루7, 팔크루8<\/span>/);
});

test("개최월은 연도 옆에서 종목 행을 병합하고 대회명 괄호는 둘째 줄에 표시한다", () => {
  const { context, elements } = createView();
  vm.runInContext(`
    state.competitionDates=[{competition_id:'competition-tangeum',year:2026,competition_date:'2026-09-06'}];
    state.competitionRecords.forEach(row=>row.competitionName='용인(경기도)');
    renderCompetitionTables();
  `,context);
  assert.match(elements["#competitionSummaryHead"].innerHTML,/>연도<\/th><th rowspan="2">월<\/th><th rowspan="2">대회/);
  const html=elements["#competitionSummaryBody"].innerHTML;
  assert.match(html,/class="matrix-month" rowspan="2">9<\/td>/);
  assert.match(html,/<span class="competition-name-line">용인<\/span><span class="competition-name-line">\(경기도\)<\/span>/);
  assert.doesNotMatch(html,/2026-09-06|class="record-tags"/);
  vm.runInContext('state.competitionDates=[];renderCompetitionTables()',context);
  assert.match(elements["#competitionSummaryBody"].innerHTML,/class="matrix-month" rowspan="2"><\/td>/);
});

test("참가자 검색은 일치하는 팀의 전체 명단을 유지한다", () => {
  const { context, elements } = createView();
  elements["#competitionParticipantSearch"].value = "김크루";
  vm.runInContext("renderCompetitionTables()", context);
  assert.match(elements["#competitionSummaryBody"].innerHTML, /4X\+/);
  assert.doesNotMatch(elements["#competitionSummaryBody"].innerHTML, />8\+</);
  assert.equal(vm.runInContext("state.competitionLineups.get('competition-1').length", context), 14);
});

test("회원별 표는 0과 기록 버튼을 숨기고 이름을 상세 버튼으로 쓴다", () => {
  const { elements } = createView();
  const html = elements["#competitionHistoryBody"].innerHTML;
  assert.match(html, /class="member-name-button"/);
  assert.match(html, /data-competition-member="김콕스"/);
  assert.doesNotMatch(html, />기록<\/button>/);
  assert.doesNotMatch(html, />0<\/td>/);
});

test("모바일 대회 요약은 2열과 조밀한 레이아웃을 사용한다", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "static", "style.css"), "utf8");
  assert.doesNotMatch(html, /출전의 순간부터 시상대의 영광까지/);
  assert.match(styles, /\.competition-leaderboards \{ grid-template-columns: repeat\(2,minmax\(0,1fr\)\); gap: 8px; \}/);
  assert.match(styles, /\.competition-leaderboards \.top-five-row \{[^}]*min-height: 34px;[^}]*padding: 3px 4px;/);
  assert.match(styles, /\.competition-hero:not\(\.ergo-hero\) \{[^}]*padding: 16px 14px;/);
  assert.match(styles, /\.competition-summary-filters \{[^}]*grid-template-columns: minmax\(0,2fr\) minmax\(96px,1fr\);[^}]*width: 100%;/);
  assert.match(styles, /\.competition-summary-filters \.search-input \{[^}]*margin-top: 0;/);
  assert.match(html, /<h2>대회 출석왕<\/h2>/);
  assert.match(html, /<h2>대회 메달왕<\/h2>/);
  assert.match(html, /id="medalTop5"[^>]*><\/div><p class="ranking-rule">금메달 수를 우선하며/);
  assert.match(styles, /\.competition-leaderboards \.section-heading h2 \{[^}]*font-size: 19px;[^}]*white-space: nowrap;/);
  assert.match(styles, /\.competition-leaderboards \.top-five-row > strong \{[^}]*font-size: 12px;/);
});

test("자동 생성된 실내 나이대도 실내대회 열에 표시한다", () => {
  const { context, elements } = createView();
  vm.runInContext(`
    state.competitionSummaryType = "indoor";
    state.competitionDivisions = [{ competition_division_id: "division-random", competition_division_name: "남자 50세미만(경량)" }];
    state.competitionRecords = [competitionRecord({
      member_name: "박경량", competition_id: "competition-indoor", competition_name: "용인실내",
      competition_event_id: "competition-event-indoor-rowing", competition_event_name: "로잉머신",
      competition_division_id: "division-random", competition_division_name: "남자 50세미만(경량)",
      competition_type: "indoor", year: "2026", is_cox: "0", gold: "0", silver: "1", bronze: "0"
    })];
    build();
    renderCompetitionTables();
  `, context);
  assert.match(elements["#competitionSummaryHead"].innerHTML, /50세미만\(경량\)/);
  assert.match(elements["#competitionSummaryBody"].innerHTML, /은메달/);
});

test("에르고 화면은 종목 검색과 설명을 제거하고 모바일 간격을 줄인다", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "..", "static", "leaderboard.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "static", "style.css"), "utf8");
  assert.doesNotMatch(html, /훈련과 도전의 순간/);
  assert.doesNotMatch(source, /event-search|data-ranking-table|#eventSections"\)\.oninput/);
  assert.match(styles, /\.competition-hero \{[^}]*grid-template-columns: minmax\(0,1fr\);[^}]*justify-content: stretch;/);
  assert.match(styles, /\.ergo-hero \{[^}]*padding: 16px 14px;/);
  assert.match(styles, /\.ergo-hero \.club-medal-summary \{ justify-items: stretch; \}/);
  assert.match(styles, /\.ergo-hero \.ergo-record-total \{ width: 100%; \}/);
  assert.match(styles, /\.top-champion-card \{[^}]*min-height: 66px;[^}]*padding: 6px 3px;/);
  assert.match(styles, /\.tab-panel\[data-panel="ergo"\] \.ranking-scroll \{ max-height: 190px; \}/);
});

test("회원별 PB 이름과 삭제요청 버튼이 상세 동작을 제공한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "static", "leaderboard.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "static", "style.css"), "utf8");
  assert.match(source, /class="member-name-button" type="button" data-member-index=/);
  assert.doesNotMatch(source, /record-detail-button" data-member-index=/);
  assert.doesNotMatch(source, /<th>상세<\/th>/);
  assert.match(source, />삭제요청<\/button>/);
  assert.match(source, /<th>삭제요청<\/th>/);
  assert.match(styles, /\.member-history-table \.delete-request-button,[^{]+\{ min-height: 28px; padding: 3px 7px;/);
});

test("대회 일괄 등록은 반응형 팀 입력과 회원 검색 선택을 지원한다", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "..", "static", "leaderboard.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "static", "style.css"), "utf8");
  assert.match(source, /function competitionTeamNames\(\)/);
  assert.match(source, /competition-team-name-select/);
  assert.match(source, /<option value="__new__">새 팀명 입력<\/option>/);
  assert.match(html, /competition-team-grid-headings[^>]*>.*종목.*나이대.*팀명.*메달.*COX.*CREW/);
  assert.match(source, /function setupCompetitionMemberInput\(input,names\)/);
  assert.doesNotMatch(source, /list="competitionMemberSuggestions"/);
  assert.match(source, /class="batch-member-input competition-person-input"/);
  assert.doesNotMatch(source, /competition-team-summary|CREW \$\{crewIndex\}명/);
  assert.match(source, /rows=\[\.\.\.team\.querySelectorAll\("\.competition-person"\)\]/);
  assert.match(source, /lineupGroupId,note:teamName,memberName/);
  assert.match(styles, /\.competition-team-grid-headings,\.competition-team \{[^}]*grid-template-columns:/);
  assert.match(source, /wrapper\.closest\("\.competition-team-table-wrap"\)/);
  assert.match(source, /menu\.classList\.add\("is-floating"\);document\.body\.appendChild\(menu\)/);
  assert.match(styles, /\.dropdown-menu\.is-floating \{[^}]*position: fixed;[^}]*z-index: 1000;/);
});

test("에르고 등록은 종목과 장소를 한 행에 두고 직접 입력 전환을 지원한다", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "..", "static", "leaderboard.js"), "utf8");
  assert.match(html, /form-grid ergo-meta-grid[^>]*>.*id="requestEvent".*id="competitionSelect"/);
  assert.match(html, /form-grid ergo-meta-grid[^>]*>.*id="bulkRequestEvent".*id="bulkCompetitionSelect"/);
  assert.doesNotMatch(html, /id="(?:bulk)?CompetitionInput"[^>]*value="용인 훈련장"/);
  assert.match(source, /const DEFAULT_ERGO_PLACE="용인 훈련장"/);
  assert.match(source, /setSwapSelectValue\("#competitionSelect","#competitionInput",DEFAULT_ERGO_PLACE\)/);
  assert.match(source, /bindSwapSelect\("#requestEvent","#eventNameInput"/);
  assert.match(source, /bindSwapSelect\("#bulkRequestEvent","#bulkEventNameInput"/);
  assert.match(html, /id="memberNameInput"[^>]*autocomplete="off"/);
  assert.doesNotMatch(html, /ergoMemberSuggestions/);
  assert.match(source, /class="batch-member-input ergo-member-input"/);
  assert.doesNotMatch(source, /batchMemberOptions|bindBatchMember|batch-member-select/);
});

test("선수 카드의 접이식 기록은 기존 이름 클릭 팝업과 같은 내용을 사용한다", () => {
  const {context,elements}=createView();
  elements["#athleteCard"]={innerHTML:""};
  vm.runInContext(`
    state.events=[{event_id:"500",event_name:"500m"}];
    state.records=[record({record_id:"proof-1",member_name:"김콕스",event_id:"500",event_name:"500m",time_ms:"95000",competition_date:"2026-03-14",proof_photo_url:"https://example.com/proof.png"})];
    build();
    state.athleteSelectedName="김콕스";
    athleteProfiles=new Map([["김콕스",{type:"기록 수집 중",stats:[{name:"500m",pb:state.members.find(m=>m.memberName==="김콕스").pb["500"]}],tags:[],strengths:[],goals:[],rivals:[]}]]);
    renderAthleteProfile();
    openMember(state.members.findIndex(m=>m.memberName==="김콕스"));
  `,context);
  const card=elements["#athleteCard"].innerHTML;
  assert.ok(card.includes(elements["#dialogContent"].innerHTML));
  assert.match(elements["#dialogContent"].innerHTML,/data-photo-url="https:\/\/example.com\/proof.png"/);
  assert.match(elements["#dialogContent"].innerHTML,/data-record-id="proof-1"/);
  vm.runInContext('openCompetitionMember("김콕스")',context);
  assert.ok(card.includes(elements["#dialogContent"].innerHTML));
  assert.match(card,/<details class="athlete-record-disclosure" data-athlete-records="ergo"><summary>에르고 기록/);
  assert.match(card,/<details class="athlete-record-disclosure" data-athlete-records="competition"><summary>대회 기록/);
  assert.doesNotMatch(card,/<details class="athlete-record-disclosure"[^>]*\sopen/);
  const positions=["athlete-name-line","athlete-profile-tags","athlete-layout-main","athlete-rivals","athlete-insight-grid","athlete-record-disclosures","athlete-badges"].map(name=>card.indexOf(name));
  assert.ok(positions.every((position,index)=>position>=0&&(!index||position>positions[index-1])));
  assert.match(vm.runInContext('memberCompetitionRecordsHtml("기록없는회원")',context),/등록된 대회 기록이 없습니다/);
});

test("선수 Beta는 전체 메달, 배지, 전 종목 비교를 제공한다", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "..", "static", "leaderboard.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "static", "style.css"), "utf8");
  const panel = html.match(/<section class="tab-panel" data-panel="athletes">([\s\S]*?)<section class="tab-panel" data-panel="request">/)[1];
  assert.match(html, /data-tab="athletes"[^>]*>선수\(Beta\)<\/button>/);
  assert.match(panel, /id="athleteSearch"/);
  assert.match(panel, /data-athlete-view="card"/);
  assert.match(panel, /data-athlete-view="compare"/);
  assert.doesNotMatch(panel, /프로필|나이|<img/);
  assert.match(source, /water:\{label:"수상대회"/);
  assert.match(source, /indoor:\{label:"실내대회"/);
  assert.match(source, /beach:\{label:"비치대회"/);
  assert.match(source, /state\.events\.slice\(\)\.sort\(eventNameCompare\)/);
  assert.match(source, /left\?\.timeDisplay\|\|"없음"/);
  assert.match(source, /right\?\.timeDisplay\|\|"없음"/);
  ["오각형 완성","PB 갱신","윈터 챌린지","성장왕","첫 출전","첫 메달","금빛 질주","멀티 레이서","그랜드 슬램"].forEach(name=>assert.match(source,new RegExp(name)));
  assert.doesNotMatch(source, /대회 개근/);
  assert.match(source, /class="athlete-badge-name"[^>]*aria-expanded="false"/);
  assert.match(source, /class="athlete-badge-rule" role="tooltip"/);
  assert.match(source, /static\/badges\/pentagon-complete\.png/);
  assert.match(source, /static\/badges\/grand-slam\.png/);
  assert.match(source, /<img src="\$\{esc\(item\.image\)\}" alt="" loading="lazy">/);
  assert.match(source, /배지 이름을 누르거나 마우스를 올리면 달성 기준을 확인할 수 있습니다/);
  assert.match(source, /badgeCard\.classList\.add\("is-explaining"\)/);
  assert.match(styles, /\.athlete-badge:hover \.athlete-badge-rule/);
  assert.match(styles, /\.athlete-badge\.is-locked \.athlete-badge-icon/);
  assert.match(styles, /\.athlete-badge-icon img \{[^}]*object-fit: contain;/);
  assert.match(source, /aria-label="미획득">🔒/);
  assert.match(styles, /\.athlete-workspace \{ grid-template-columns: minmax\(0,1fr\); gap: 10px; \}/);
});

test("dormant athletes disappear while competition results and club medals remain",()=>{
  const {context,elements}=createView();
  vm.runInContext('state.dormantMembers=new Set(["김콕스","김크루","박크루","이크루","최크루"]);build();renderCompetitionTables();',context);
  assert.equal(vm.runInContext('state.members.some(m=>state.dormantMembers.has(m.memberName))',context),false);
  assert.equal(vm.runInContext('state.competitionMembers.some(m=>state.dormantMembers.has(m.memberName))',context),false);
  assert.equal(vm.runInContext('state.clubMedals.bronze',context),1);
  assert.equal(vm.runInContext('state.competitionRecords.length',context),14);
  assert.match(elements['#competitionSummaryBody'].innerHTML,/🥉/);
  vm.runInContext("openCompetitionParticipants('competition-1')",context);
  assert.doesNotMatch(elements['#dialogContent'].innerHTML,/김콕스|김크루|박크루|이크루|최크루/);
  assert.match(elements['#dialogContent'].innerHTML,/4X\+/);
  vm.runInContext('state.dormantMembers.clear();build();',context);
  assert.equal(vm.runInContext('state.members.some(m=>m.memberName==="김콕스")',context),true);
});
