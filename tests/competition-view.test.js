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
      note: "",
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

test("대회와 성별 헤더를 병합하고 메달 아이콘을 참가자 명단에 연결한다", () => {
  const { context, elements } = createView();
  assert.match(elements["#competitionSummaryHead"].innerHTML, /colspan="3">남자/);
  assert.ok(elements["#competitionSummaryHead"].innerHTML.indexOf("200이상") < elements["#competitionSummaryHead"].innerHTML.indexOf("일반부"));
  assert.match(elements["#competitionSummaryHead"].innerHTML, />여자</);
  assert.match(elements["#competitionSummaryHead"].innerHTML, />혼성</);
  assert.equal((elements["#competitionSummaryBody"].innerHTML.match(/>탄금호<\/td>/g) || []).length, 1);
  assert.match(elements["#competitionSummaryBody"].innerHTML, /rowspan="2" title="탄금호"/);

  const lineupSize = vm.runInContext("state.competitionLineups.get('lineup-1').length", context);
  assert.equal(lineupSize, 5);
  vm.runInContext("openCompetitionLineup('lineup-1')", context);
  assert.match(elements["#dialogContent"].innerHTML, /<th>COX<\/th><th>CREW<\/th>/);
  assert.match(elements["#dialogContent"].innerHTML, />김콕스<\/td>/);
  assert.match(elements["#dialogContent"].innerHTML, /김크루, 박크루, 이크루, 최크루/);
});

test("참가자 검색은 일치하는 팀의 전체 명단을 유지한다", () => {
  const { context, elements } = createView();
  elements["#competitionParticipantSearch"].value = "김크루";
  vm.runInContext("renderCompetitionTables()", context);
  assert.match(elements["#competitionSummaryBody"].innerHTML, /4X\+/);
  assert.doesNotMatch(elements["#competitionSummaryBody"].innerHTML, />8\+</);
  assert.equal(vm.runInContext("state.competitionLineups.get('lineup-1').length", context), 5);
});

test("회원별 표는 0과 기록 버튼을 숨기고 이름을 상세 버튼으로 쓴다", () => {
  const { elements } = createView();
  const html = elements["#competitionHistoryBody"].innerHTML;
  assert.match(html, /class="member-name-button"/);
  assert.match(html, /data-competition-member="김콕스"/);
  assert.doesNotMatch(html, />기록<\/button>/);
  assert.doesNotMatch(html, />0<\/td>/);
});
