"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8");

function server() {
  const requests = [false, true].map((isCox, index) => ({
    _row: index + 2, request_id: `request-${index}`, request_type: "competition_add", status: "pending",
    competition_date: "2026", requested_at: "original-time", processed_at: "", result: "",
    source_json: JSON.stringify({ memberName: `선수${index}`, competitionName: "충주", competitionType: "water",
      competitionEventId: "4x", competitionEventName: "4X+", competitionDivisionName: "남자 160미만",
      year: 2026, gold: 0, silver: 0, bronze: 0, isCox, lineupGroupId: "A팀-ID", note: "A팀" })
  }));
  let locked = false;
  const writes = [];
  const context = vm.createContext({
    LockService: { getScriptLock: () => ({ waitLock() { locked = true; }, releaseLock() { locked = false; } }) },
    CacheService: { getScriptCache: () => ({ get: key => key === "admin:valid" ? "1" : null }) },
    SpreadsheetApp: { flush() {} },
    requests, sheet: { getRange(row, column, height = 1, width = 1) {
      return {
        setValue(value) { return this.setValues([[value]]); },
        setValues(values) {
          assert.equal(locked, true);
          assert.equal(height, 1);
          assert.equal(values[0].length, width);
          writes.push({ row, column, values });
          const request = requests.find(request => request._row === row);
          if (column === 4) request.source_json = values[0][0];
          else if (column === 12) [request.time_display, request.competition_date] = values[0];
          else throw Error("Unexpected column written");
        }
      };
    } }
  });
  vm.runInContext(source, context);
  vm.runInContext("rowsToRequests_=()=>requests;requestSheet_=()=>sheet;", context);
  return { requests, writes, update(edits, token = "valid") {
    context.edits = edits;
    context.token = token;
    return vm.runInContext("dispatch_('updateCompetitionRequests',{edits},token)", context);
  } };
}

test("pending edits update approval source and displayed year/medals without approving", () => {
  const app = server();
  const edits = app.requests.map((request, index) => ({ requestId: request.request_id, expectedSourceJson: request.source_json,
    year: 2025, ...(index === 1 ? { bronze: 1 } : {}) }));
  assert.equal(app.update(edits).updatedCount, 2);
  app.requests.forEach((request, index) => {
    const payload = JSON.parse(request.source_json);
    assert.equal(payload.year, 2025);
    assert.equal(payload.bronze, index);
    assert.equal(payload.lineupGroupId, "A팀-ID");
    assert.equal(payload.note, "A팀");
    assert.equal(request.competition_date, "2025");
    assert.equal(request.status, "pending");
    assert.equal(request.requested_at, "original-time");
    assert.equal(request.processed_at, "");
    assert.match(request.time_display, new RegExp(`동 ${index}$`));
  });
  assert.match(app.requests[1].time_display, /COX/);
});

test("edits require administrator authentication", () => {
  const app = server();
  assert.throws(() => app.update([], ""), /인증/);
  assert.equal(app.writes.length, 0);
});

test("invalid, processed or stale requests reject the batch before any writes", () => {
  for (const fault of ["year", "bronze", "status", "type", "stale", "duplicate"]) {
    const app = server();
    const edits = app.requests.map(request => ({ requestId: request.request_id, expectedSourceJson: request.source_json, year: 2025 }));
    if (fault === "year") edits[1].year = 9999;
    if (fault === "bronze") edits[1].bronze = -1;
    if (fault === "status") app.requests[1].status = "approved";
    if (fault === "type") app.requests[1].request_type = "add";
    if (fault === "stale") edits[1].expectedSourceJson = "{}";
    if (fault === "duplicate") edits[1] = edits[0];
    assert.throws(() => app.update(edits));
    assert.equal(app.writes.length, 0, fault);
  }
});
