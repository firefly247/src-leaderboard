"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function formView() {
  const elements = {};
  function element(id, select = false) {
    const field = { tagName: select ? "SELECT" : "INPUT", value: "", readOnly: true, rebuilds: 0,
      options: [], closest: () => null };
    Object.defineProperty(field, "innerHTML", { set(html) {
      if (!select) return;
      this.rebuilds++;
      this.options = [...html.matchAll(/<option value="([^"]*)"([^>]*)>/g)]
        .map(match => ({ value: match[1], selected: match[2].includes("selected") }));
      this.value = (this.options.find(option => option.selected) || this.options[0])?.value || "";
    }});
    elements[id] = field;
    return field;
  }
  for (const id of ["competitionMemberSelect", "requestEvent", "bulkRequestEvent", "competitionSelect", "bulkCompetitionSelect", "raceSelect", "bulkRaceSelect", "competitionYearSelect", "bulkCompetitionYearSelect", "competitionTypeSelect", "bulkCompetitionTypeSelect", "competitionEventSelect", "competitionDivisionSelect"]) element(id, true);
  for (const id of ["ergoMemberSuggestions", "competitionMemberSuggestions", "competitionInput", "bulkCompetitionInput", "raceNameInput", "bulkRaceNameInput", "competitionEventNameInput", "competitionDivisionNameInput"]) element(id);
  for (const id of ["competitionTypeSelect", "bulkCompetitionTypeSelect"]) elements[id].innerHTML = '<option value="water">수상</option><option value="indoor">실내</option>';
  const source = fs.readFileSync(path.join(__dirname, "../static/leaderboard.js"), "utf8");
  const context = vm.createContext({ document: {
    querySelector: selector => elements[selector.slice(1)],
    querySelectorAll: () => Object.values(elements)
  }, sessionStorage: { getItem: () => "" } });
  vm.runInContext(source.slice(0, source.indexOf("async function api")), context);
  vm.runInContext(`
    const DEFAULT_ERGO_PLACE='용인 훈련장';
    function syncDropdownTriggers() {}
    function refreshCompetitionTeams() {}
    function setSwapSelectValue(select,input,value) { $(select).value=value;$(input).value=value; }
    state.competitions=[{competition_id:'hanam',competition_name:'하남'}];
    state.competitionEvents=[{competition_event_id:'competition-event-indoor-rowing',competition_event_name:'로잉머신'}];
    renderForms();
  `, context);
  return { elements, render: (catalogChanged = false) => {
    if(catalogChanged)vm.runInContext("state.competitions.push({competition_id:'new',competition_name:'새 대회'});",context);
    vm.runInContext("renderForms()", context);
  } };
}

test("catalog refresh preserves competition draft and direct-entry mode", () => {
  const { elements: e, render } = formView();
  e.bulkCompetitionYearSelect.value = "2024";
  e.bulkCompetitionTypeSelect.value = "indoor";
  e.bulkRaceSelect.value = "hanam";
  e.bulkRaceNameInput.value = "하남";
  e.raceSelect.value = "__new__";
  e.raceNameInput.value = "새 대회";
  e.raceNameInput.readOnly = false;
  render(true);
  assert.equal(e.bulkCompetitionYearSelect.value, "2024");
  assert.equal(e.bulkCompetitionTypeSelect.value, "indoor");
  assert.equal(e.bulkRaceSelect.value, "hanam");
  assert.equal(e.bulkRaceNameInput.value, "하남");
  assert.equal(e.raceSelect.value, "__new__");
  assert.equal(e.raceNameInput.value, "새 대회");
  assert.equal(e.raceNameInput.readOnly, false);
});

test("initial form population still supplies the current year", () => {
  const { elements: e } = formView();
  assert.equal(e.bulkCompetitionYearSelect.value, String(new Date().getFullYear()));
  assert.equal(e.bulkRaceSelect.value, "");
});

test("refresh keeps a cleared direct-entry place empty and editable", () => {
  const { elements: e, render } = formView();
  e.bulkCompetitionSelect.value = "__new__";
  e.bulkCompetitionInput.value = "";
  e.bulkCompetitionInput.readOnly = false;
  render(true);
  assert.equal(e.bulkCompetitionSelect.value, "__new__");
  assert.equal(e.bulkCompetitionInput.value, "");
  assert.equal(e.bulkCompetitionInput.readOnly, false);
});

test("repeated background refresh leaves registration controls untouched", () => {
  const { elements: e, render } = formView();
  e.bulkCompetitionYearSelect.value = "2025";
  e.bulkCompetitionTypeSelect.value = "indoor";
  e.bulkRaceSelect.value = "hanam";
  e.bulkRaceNameInput.value = "하남";
  const rebuilds = e.bulkRaceSelect.rebuilds;
  for(let index=0;index<3;index++)render();
  assert.equal(e.bulkRaceSelect.rebuilds, rebuilds);
  assert.equal(e.bulkCompetitionYearSelect.value, "2025");
  assert.equal(e.bulkCompetitionTypeSelect.value, "indoor");
  assert.equal(e.bulkRaceSelect.value, "hanam");
  assert.equal(e.bulkRaceNameInput.value, "하남");
});
