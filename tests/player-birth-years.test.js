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
    assert.throws(() => call("savePlayerBirthYears", { players: [{ memberName: "김선수", birthYear: "1985" }] }, token), /관리자 인증/);
  }
  assert.equal(sheets.size, 0);
});

test("birth years combine both member lists and privately create, update and clear years", () => {
  const { call, sheets, lock } = server();
  const list = () => JSON.parse(JSON.stringify(call("adminList", { view: "player-birth-years" }).players));
  assert.deepEqual(list(), ["김선수", "박선수", "이선수"].map(memberName => ({ memberName, birthYear: "", joinYear: "" })));
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

test("birth year admin view escapes names and keeps missing years empty and offers year step controls", () => {
  const container = { innerHTML: "" };
  const context = vm.createContext({ document: { querySelector: () => container }, sessionStorage: { getItem: () => "" } });
  vm.runInContext(clientSource.slice(0, clientSource.indexOf('document.querySelectorAll(".tab-button")')), context);
  context.adminContent("player-birth-years", { players: [{ memberName: '<img src=x onerror="x">', birthYear: "1985" }] });
  assert.match(container.innerHTML, /선수 정보/);
  assert.match(container.innerHTML, /value="1985"/);
  assert.match(container.innerHTML, /type="number" min="1900"/);
  assert.match(container.innerHTML, /id="birthYearBatchForm"/);
  assert.match(container.innerHTML, /id="birthYearBatchSave"/);
  assert.match(container.innerHTML, /class="birth-year-check"/);
  assert.doesNotMatch(container.innerHTML, /<th>관리<|birthYearForm0/);
  assert.doesNotMatch(container.innerHTML, /<img/);
  assert.match(container.innerHTML, /&lt;img/);
  context.adminContent("player-birth-years", { players: [{ memberName: "미입력선수", birthYear: "" }] });
  assert.match(container.innerHTML, /value=""/);
  assert.doesNotMatch(container.innerHTML, /value="1985"/);
  assert.match(container.innerHTML, /data-birth-year-step="1"/);
  assert.match(container.innerHTML, /data-birth-year-step="-1"/);
  assert.match(container.innerHTML, /name="joinYear"[^>]*value=""/);
  assert.match(container.innerHTML, /data-join-year-step="1"/);
  assert.match(container.innerHTML, /data-join-year-step="-1"/);
  context.adminContent("player-birth-years", { players: [{ memberName: "기존선수", birthYear: "1980", joinYear: "2018" }] });
  assert.match(container.innerHTML, /name="joinYear"[^>]*value="2018"/);
  assert.doesNotMatch(container.innerHTML, /name="joinYear"[^>]*value="2026"/);
});

test("late admin responses cannot repopulate private data after logout", async () => {
  const container = { innerHTML: "", classList: { toggle() {} } };
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

test("year arrows start an empty field at 1985 then change by one without affecting typed years", () => {
  const context = vm.createContext({ document: { querySelector: () => ({}) }, sessionStorage: { getItem: () => "" }, Event: class {} });
  vm.runInContext(clientSource.slice(0, clientSource.indexOf('document.querySelectorAll(".tab-button")')), context);
  const input = {
    value: "",
    stepUp() { this.value = String(Number(this.value) + 1); },
    stepDown() { this.value = String(Number(this.value) - 1); },
    dispatchEvent() {},
  };
  for (const direction of [1, -1]) {
    input.value = "";
    context.stepBirthYear(input, direction);
    assert.equal(input.value, "1985");
    context.stepBirthYear(input, direction);
    assert.equal(input.value, String(1985 + direction));
  }
  input.value = "1978";
  context.stepBirthYear(input, 1);
  assert.equal(input.value, "1979");
});

test("batch saving updates selected players and preserves others; invalid batches write nothing", () => {
  const { call, sheets, lock } = server();
  call("savePlayerBirthYear", { memberName: "이선수", birthYear: "1975" });
  const result = call("savePlayerBirthYears", { players: [
    { memberName: "김선수", birthYear: "1985" },
    { memberName: "박선수", birthYear: "1986" },
  ] });
  assert.equal(result.savedCount, 2);
  const before = JSON.stringify(sheets.get("PLAYER_BIRTH_YEARS").rows);
  for (const players of [
    [{ memberName: "김선수", birthYear: "1995" }, { memberName: "박선수", birthYear: "2027" }],
    [{ memberName: "김선수", birthYear: "1995" }, { memberName: "미등록", birthYear: "1985" }],
    [{ memberName: "김선수", birthYear: "1995" }, { memberName: "김선수", birthYear: "1985" }],
    [], [null],
  ]) {
    assert.throws(() => call("savePlayerBirthYears", { players }));
    assert.equal(JSON.stringify(sheets.get("PLAYER_BIRTH_YEARS").rows), before);
    assert.equal(lock.held, false);
  }
  call("savePlayerBirthYears", { players: [
    { memberName: "김선수", birthYear: "" },
    { memberName: "박선수", birthYear: "1990" },
  ] });
  const players = call("adminList", { view: "player-birth-years" }).players;
  assert.equal(players.find(p => p.memberName === "김선수").birthYear, "");
  assert.equal(players.find(p => p.memberName === "박선수").birthYear, "1990");
  assert.equal(players.find(p => p.memberName === "이선수").birthYear, "1975");
});

test("joining year arrows initialize a blank field at 2026 and preserve entered years", () => {
  const context = vm.createContext({ document: { querySelector: () => ({}) }, sessionStorage: { getItem: () => "" }, Event: class {} });
  vm.runInContext(clientSource.slice(0, clientSource.indexOf('document.querySelectorAll(".tab-button")')), context);
  const input = { value: "", stepUp() { this.value = String(Number(this.value) + 1); }, stepDown() { this.value = String(Number(this.value) - 1); }, dispatchEvent() {} };
  for (const direction of [1,-1]) {
    input.value = "";
    context.stepJoinYear(input,direction);
    assert.equal(input.value,"2026");
    context.stepJoinYear(input,-1);
    assert.equal(input.value,"2025");
  }
  input.value="2018";
  context.stepJoinYear(input,1);
  assert.equal(input.value,"2019");
  context.stepJoinYear(input,-1);
  assert.equal(input.value,"2018");
});

test("client batch save sends only selected rows and retains edits on API failure", async () => {
  const button = { disabled: false, textContent: "" };
  const message = { textContent: "", classList: { remove() {}, add() {} } };
  const makeRow = (name, checked, value) => {
    const check = { checked }, input = { value, reportValidity: () => true }, joinInput = { value: "2020", reportValidity: () => true };
    return { dataset: { birthYearName: name }, querySelector: selector => selector === ".birth-year-check" ? check : selector === ".join-year-input" ? joinInput : input };
  };
  const rows = [makeRow("김선수", true, "1985"), makeRow("박선수", false, "invalid")];
  const form = {
    isConnected: false,
    querySelectorAll: selector => selector === "input,button" ? [button] : rows,
    querySelector: selector => selector === "#birthYearBatchSave" ? button : message,
  };
  let sent;
  const context = vm.createContext({
    document: { querySelector: () => ({}) }, sessionStorage: { getItem: () => "valid" },
    fetch: async (url, options) => {
      sent = JSON.parse(options.body);
      return { ok: true, json: async () => ({ ok: true, savedCount: 1, players: sent.payload.players.map(player => ({ ...player, joinYear: player.joinYear ?? "2020" })) }) };
    },
  });
  vm.runInContext(clientSource.slice(0, clientSource.indexOf('document.querySelectorAll(".tab-button")')), context);
  await context.saveSelectedBirthYears(form);
  assert.equal(sent.action, "savePlayerBirthYears");
  assert.equal(sent.adminToken, "valid");
  assert.deepEqual(sent.payload.players, [{ memberName: "김선수", birthYear: "1985", joinYear: "2020" }]);
  assert.equal(rows[0].querySelector(".birth-year-check").checked, false);
  assert.equal(rows[1].querySelector(".birth-year-input").value, "invalid");
  rows[0].dataset.savedJoinYear = "2020";
  rows[0].querySelector(".birth-year-check").checked = true;
  await context.saveSelectedBirthYears(form);
  assert.deepEqual(sent.payload.players, [{ memberName: "김선수", birthYear: "1985" }]);
  rows[0].querySelector(".birth-year-check").checked = true;
  rows[0].querySelector(".join-year-input").value = "2019";
  context.fetch = async () => ({ ok: true, json: async () => ({ ok: true, savedCount: 1, players: [{ memberName: "김선수", birthYear: "1985" }] }) });
  await context.saveSelectedBirthYears(form);
  assert.equal(rows[0].querySelector(".birth-year-check").checked, true);
  assert.equal(rows[0].querySelector(".join-year-input").value, "2019");
  assert.match(message.textContent, /저장되지 않았습니다/);
  rows[0].querySelector(".birth-year-check").checked = true;
  context.fetch = async () => { throw new Error("연결 실패"); };
  await context.saveSelectedBirthYears(form);
  assert.equal(rows[0].querySelector(".birth-year-check").checked, true);
  assert.equal(rows[0].querySelector(".birth-year-input").value, "1985");
  assert.equal(message.textContent, "연결 실패");
  assert.equal(button.disabled, false);
});

test("joining years migrate legacy private rows, validate batches and survive birth-only updates", () => {
  const { call, sheets } = server();
  call("savePlayerBirthYear", { memberName: "김선수", birthYear: "1985" });
  const sheet = sheets.get("PLAYER_BIRTH_YEARS");
  sheet.rows[0] = ["member_name", "birth_year", "updated_at"];
  sheet.rows[1] = ["김선수", "1985", "old-date"];
  call("savePlayerBirthYears", { players: [{ memberName: "김선수", birthYear: "1985", joinYear: "2018" }] });
  const read = () => call("adminList", { view: "player-birth-years" }).players.find(p => p.memberName === "김선수");
  assert.equal(read().joinYear, "2018");
  assert.equal(sheet.rows[0][3], "join_year");
  call("savePlayerBirthYear", { memberName: "김선수", birthYear: "1986" });
  assert.equal(read().joinYear, "2018");
  const before = JSON.stringify(sheet.rows);
  for (const joinYear of ["1899", "2027", "20.5", "abcd"]) {
    assert.throws(() => call("savePlayerBirthYears", { players: [{ memberName: "김선수", birthYear: "1980", joinYear }] }), /가입연도/);
    assert.equal(JSON.stringify(sheet.rows), before);
  }
  call("savePlayerBirthYears", { players: [{ memberName: "김선수", birthYear: "", joinYear: "2018" }] });
  assert.equal(read().joinYear, "2018");
  assert.equal(read().birthYear, "");
  call("savePlayerBirthYears", { players: [{ memberName: "김선수", birthYear: "", joinYear: "" }] });
  assert.equal(read().joinYear, "");
});

test("edited cells and row badges reset only when values match the saved originals", () => {
  const context = vm.createContext({ document: { querySelector: () => ({}) }, sessionStorage: { getItem: () => "" } });
  vm.runInContext(clientSource.slice(0, clientSource.indexOf('document.querySelectorAll(".tab-button")')), context);
  const makeInput = value => {
    const classes = new Set(), attributes = new Map();
    return { value, classes, attributes, closest: () => ({ classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); } } }), setAttribute: (k,v) => attributes.set(k,v), removeAttribute: k => attributes.delete(k) };
  };
  const birth = makeInput("1985"), join = makeInput("2018"), badge = { hidden: true };
  const row = { dataset: { savedBirthYear: "1985", savedJoinYear: "2018" }, querySelector: s => s === ".birth-year-input" ? birth : s === ".join-year-input" ? join : badge };
  context.updatePlayerYearDirtyState(row);assert.equal(badge.hidden,true);
  join.value = "2020";context.updatePlayerYearDirtyState(row);
  assert.equal(badge.hidden,false);assert(join.classes.has("is-dirty"));assert(!birth.classes.has("is-dirty"));assert.match(join.attributes.get("aria-description"),/저장 전/);
  join.value = "2018";context.updatePlayerYearDirtyState(row);assert.equal(badge.hidden,true);assert(!join.classes.has("is-dirty"));
  birth.value = "1986";context.updatePlayerYearDirtyState(row);assert.equal(badge.hidden,false);assert(birth.classes.has("is-dirty"));
  row.dataset.savedBirthYear = "1986";context.updatePlayerYearDirtyState(row);assert.equal(badge.hidden,true);
});
