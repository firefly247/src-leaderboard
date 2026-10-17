"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const serverSource = fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8");
const clientSource = fs.readFileSync(path.join(__dirname, "../static/leaderboard.js"), "utf8");

function server() {
  const sheets = new Map();
  const lock = { held: false, waitLock() { this.held = true; }, releaseLock() { this.held = false; } };
  const spreadsheet = {
    getSheetByName: name => sheets.get(name),
    insertSheet(name) {
      const rows = [];
      const sheet = {
        rows,
        appendRow(row) { rows.push(row); },
        setFrozenRows() {},
        getDataRange: () => ({ getDisplayValues: () => rows.map(row => row.map(String)) }),
        getLastRow: () => rows.length,
        deleteRow(index) { rows.splice(index - 1, 1); },
        getRange(row, column) {
          const range = {
            setNumberFormat() { return range; },
            setValue(value) { return range.setValues([[value]]); },
            setValues(values) {
              assert.equal(lock.held, true, "writes must hold the script lock");
              values.forEach((valuesRow, i) => {
                rows[row - 1 + i] ||= [];
                valuesRow.forEach((value, j) => { rows[row - 1 + i][column - 1 + j] = value; });
              });
              return range;
            },
          };
          return range;
        },
      };
      sheets.set(name, sheet);
      return sheet;
    },
  };
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === "REQUEST_SHEET_ID" ? "private-sheet" : null }) },
    SpreadsheetApp: { openById: () => spreadsheet, flush() { assert.equal(lock.held, true); } },
    LockService: { getScriptLock: () => lock },
    CacheService: { getScriptCache: () => ({ get: key => key === "admin:valid" ? "1" : null }) },
    Utilities: { formatDate: () => "2026" },
  });
  vm.runInContext(serverSource, context);
  vm.runInContext(`
    records_=()=>[{member_name:'김선수'},{member_name:'이선수'},{member_name:'김선수'}];
    competitionRecords_=()=>[{member_name:'박선수'},{member_name:'이선수'}];
    githubPut_=()=>{throw new Error('Private data must never be committed');};
    appendRequest_=()=>{throw new Error('Private data must never enter request history');};
  `, context);
  const call = (action, payload, token = "valid") => context.dispatch_(action, payload, token);
  return { call, sheets, lock };
}

test("birth year reads and writes reject missing, invalid and expired admin tokens", () => {
  const { call, sheets } = server();
  for (const token of ["", "invalid", "expired"]) {
    assert.throws(() => call("adminList", { view: "player-birth-years" }, token), /관리자 인증/);
    assert.throws(() => call("savePlayerBirthYear", { memberName: "김선수", birthYear: "1985" }, token), /관리자 인증/);
  }
  assert.equal(sheets.size, 0);
});

test("birth years combine both member lists and privately create, update and clear years", () => {
  const { call, sheets, lock } = server();
  const list = () => JSON.parse(JSON.stringify(call("adminList", { view: "player-birth-years" }).players));
  assert.deepEqual(list(), ["김선수", "박선수", "이선수"].map(memberName => ({ memberName, birthYear: "" })));
  call("savePlayerBirthYear", { memberName: "김선수", birthYear: "1985" });
  call("savePlayerBirthYear", { memberName: "박선수", birthYear: "1990" });
  call("savePlayerBirthYear", { memberName: "김선수", birthYear: "1986" });
  assert.equal(list()[0].birthYear, "1986");
  assert.equal(sheets.get("PLAYER_BIRTH_YEARS").rows.length, 3);
  call("savePlayerBirthYear", { memberName: "김선수", birthYear: "" });
  assert.equal(list()[0].birthYear, "");
  assert.equal(list()[1].birthYear, "1990");
  assert.equal(lock.held, false);
  assert.deepEqual([...sheets.keys()], ["PLAYER_BIRTH_YEARS"]);
});

test("server rejects malformed, out of range years and unknown members without changing saved data", () => {
  const { call, sheets, lock } = server();
  call("savePlayerBirthYear", { memberName: "김선수", birthYear: "1900" });
  for (const birthYear of [0, false, "1899", "2027", "85", "1985.5", "1e3", "abcd", "1985-01-01"]) {
    assert.throws(() => call("savePlayerBirthYear", { memberName: "김선수", birthYear }), /4자리 연도/);
  }
  assert.throws(() => call("savePlayerBirthYear", { memberName: "미등록", birthYear: "2000" }), /등록된 선수/);
  assert.equal(sheets.get("PLAYER_BIRTH_YEARS").rows[1][1], "1900");
  call("savePlayerBirthYear", { memberName: "김선수", birthYear: "2026" });
  assert.equal(sheets.get("PLAYER_BIRTH_YEARS").rows[1][1], "2026");
  assert.equal(lock.held, false);
});

test("birth year admin view escapes names and offers per-player year forms", () => {
  const container = { innerHTML: "" };
  const context = vm.createContext({ document: { querySelector: () => container }, sessionStorage: { getItem: () => "" } });
  vm.runInContext(clientSource.slice(0, clientSource.indexOf('document.querySelectorAll(".tab-button")')), context);
  context.adminContent("player-birth-years", { players: [{ memberName: '<img src=x onerror="x">', birthYear: "1985" }] });
  assert.match(container.innerHTML, /선수 생년 입력/);
  assert.match(container.innerHTML, /value="1985"/);
  assert.match(container.innerHTML, /type="number" min="1900"/);
  assert.match(container.innerHTML, /form="birthYearForm0"/);
  assert.doesNotMatch(container.innerHTML, /<img/);
  assert.match(container.innerHTML, /&lt;img/);
});

test("late admin responses cannot repopulate private data after logout", async () => {
  const container = { innerHTML: "" };
  let resolve;
  const context = vm.createContext({
    document: { querySelector: () => container, querySelectorAll: () => [] },
    sessionStorage: { getItem: () => "valid" },
    fetch: () => new Promise(done => { resolve = done; }),
  });
  vm.runInContext(clientSource.slice(0, clientSource.indexOf('document.querySelectorAll(".tab-button")')), context);
  const pending = context.loadAdmin("player-birth-years");
  vm.runInContext('state.adminToken="";adminLoadSequence++;', context);
  container.innerHTML = "";
  resolve({ ok: true, json: async () => ({ ok: true, players: [{ memberName: "김선수", birthYear: "1985" }] }) });
  await pending;
  assert.equal(container.innerHTML, "");
});
