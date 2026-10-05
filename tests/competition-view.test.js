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
  assert.match(elements["#dialogContent"].innerHTML, /<th>종목<\/th><th>나이대<\/th><th>팀명<\/th><th>메달<\/th><th>COX<\/th><th>CREW<\/th>/);
  assert.doesNotMatch(elements["#dialogContent"].innerHTML, /<th>대회<\/th>/);
  assert.match(elements["#dialogContent"].innerHTML, /<td>4X\+<\/td><td>남자 160미만<\/td><td>A팀<\/td><td class="lineup-medal"><span class="result-icon" title="동메달">🥉<\/span><\/td>/);
  assert.match(elements["#dialogContent"].innerHTML, /<td>8\+<\/td><td>남자 일반부<\/td><td>B팀<\/td><td class="lineup-medal"><span class="result-icon participation" title="참가">👥<\/span><\/td>/);
  assert.match(elements["#dialogContent"].innerHTML, />김콕스<\/td>/);
  assert.match(elements["#dialogContent"].innerHTML, /김크루, 박크루, 이크루, 최크루/);
  assert.match(elements["#dialogContent"].innerHTML, /<span class="crew-line">팔크루1, 팔크루2, 팔크루3, 팔크루4<\/span><span class="crew-line">팔크루5, 팔크루6, 팔크루7, 팔크루8<\/span>/);
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
  assert.match(html, /<h2>대회 출석왕<\/h2>/);
  assert.match(html, /<h2>대회 메달왕<\/h2>/);
  assert.match(html, /id="medalTop5"[^>]*><\/div><p class="ranking-rule">금메달 수를 우선하며/);
  assert.match(styles, /\.competition-leaderboards \.section-heading h2 \{[^}]*font-size: 19px;[^}]*white-space: nowrap;/);
  assert.match(styles, /\.competition-leaderboards \.top-five-row > strong \{[^}]*font-size: 12px;/);
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
