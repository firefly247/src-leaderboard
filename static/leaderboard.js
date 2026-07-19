"use strict";

const SPREADSHEET_ID = "1qF0k-jsI9gqmMvA_IjT03duBjukT56PbjVQv6PsAcm0";
const SHEET_GID = "90249257";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const EVENTS = ["500M", "1000M", "2000M"];

const HEADER_ALIASES = {
  memberName: ["member_name", "name", "이름", "회원명"],
  event: ["event", "종목", "거리"],
  timeMs: ["time_ms"],
  timeDisplay: ["time_display", "time", "record", "기록"],
  competition: ["competition", "competition_name", "대회명", "대회"],
  competitionDate: ["competition_date", "date", "대회일자", "대회일", "일자"],
};

const state = {
  rankings: Object.fromEntries(EVENTS.map((event) => [event, []])),
  members: [],
  selectedEvent: EVENTS[0],
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function columnIndex(headers, aliases) {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  return normalized.findIndex((header) => aliases.includes(header));
}

function parseTimeToMs(value) {
  const text = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!text) return 0;

  const numeric = Number(text);
  if (!text.includes(":") && Number.isFinite(numeric)) return Math.round(numeric * 1000);

  const match = text.match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) return 0;
  const minutes = Number(match[1] || 0);
  const seconds = Number(match[2]);
  if (match[1] && seconds >= 60) return 0;
  const milliseconds = Number((match[3] || "0").padEnd(3, "0").slice(0, 3));
  return (minutes * 60 + seconds) * 1000 + milliseconds;
}

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((milliseconds % 1000) / 100);
  return minutes ? `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}` : `${seconds}.${tenths}`;
}

function normalizeRecords(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0];
  const indexes = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, columnIndex(headers, aliases)]),
  );
  if (indexes.memberName < 0 || indexes.event < 0 || (indexes.timeMs < 0 && indexes.timeDisplay < 0)) {
    throw new Error("시트의 헤더를 확인해 주세요. 이름, 종목, 기록 열이 필요합니다.");
  }

  return rows.slice(1).map((row) => {
    const memberName = String(row[indexes.memberName] ?? "").trim();
    const event = String(row[indexes.event] ?? "").trim().toUpperCase().replace(/\s/g, "");
    const rawMs = indexes.timeMs >= 0 ? Number(String(row[indexes.timeMs] ?? "").replace(/,/g, "")) : 0;
    const timeMs = Number.isFinite(rawMs) && rawMs > 0
      ? Math.round(rawMs)
      : parseTimeToMs(row[indexes.timeDisplay]);
    return {
      memberName,
      event,
      timeMs,
      timeDisplay: timeMs > 0 ? formatTime(timeMs) : "-",
      competition: indexes.competition >= 0 ? String(row[indexes.competition] ?? "").trim() : "",
      competitionDate: indexes.competitionDate >= 0 ? String(row[indexes.competitionDate] ?? "").trim() : "",
    };
  }).filter((record) => record.memberName && EVENTS.includes(record.event) && record.timeMs > 0);
}

function buildLeaderboard(records) {
  const best = new Map();
  const histories = new Map();

  records.forEach((record) => {
    if (!histories.has(record.memberName)) histories.set(record.memberName, []);
    histories.get(record.memberName).push(record);
    const key = `${record.memberName}\u0000${record.event}`;
    const current = best.get(key);
    if (!current || record.timeMs < current.timeMs) best.set(key, record);
  });

  EVENTS.forEach((event) => {
    const rows = [...best.values()]
      .filter((record) => record.event === event)
      .sort((left, right) => left.timeMs - right.timeMs || left.memberName.localeCompare(right.memberName, "ko"));
    let previousTime = null;
    let previousRank = 0;
    rows.forEach((record, index) => {
      record.rank = record.timeMs === previousTime ? previousRank : index + 1;
      previousTime = record.timeMs;
      previousRank = record.rank;
    });
    state.rankings[event] = rows;
  });

  state.members = [...histories.keys()].sort((a, b) => a.localeCompare(b, "ko")).map((memberName) => {
    const summary = { memberName, recordCount: histories.get(memberName).length };
    EVENTS.forEach((event) => {
      summary[event] = best.get(`${memberName}\u0000${event}`)?.timeDisplay || "-";
    });
    return summary;
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function renderEventTabs() {
  document.querySelector("#eventTabs").innerHTML = EVENTS.map((event) => `
    <button class="event-tab ${event === state.selectedEvent ? "active" : ""}" type="button"
      role="tab" aria-selected="${event === state.selectedEvent}" data-event="${event}">${event}</button>
  `).join("");
}

function renderPodium(rows) {
  const cards = [2, 1, 3].map((position) => {
    const row = rows[position - 1];
    if (!row) return `
      <article class="podium-card podium-${position}">
        <div class="medal">${position}</div><h3>기록 없음</h3><div class="record-time">-</div><p>기록을 기다리고 있습니다.</p>
      </article>`;
    return `
      <article class="podium-card podium-${position}">
        <div class="medal">${position}</div><h3>${escapeHtml(row.memberName)}</h3>
        <div class="record-time">${escapeHtml(row.timeDisplay)}</div>
        <p>${escapeHtml(row.competition || "대회명 미입력")}</p>
        <small>${escapeHtml(row.competitionDate || "-")}</small>
      </article>`;
  });
  document.querySelector("#podiumGrid").innerHTML = cards.join("");
}

function renderRanking(rows) {
  const body = document.querySelector("#rankingTable tbody");
  body.innerHTML = rows.length ? rows.map((row) => `
    <tr><td><span class="rank-badge">${row.rank}</span></td><td class="member-name">${escapeHtml(row.memberName)}</td>
      <td class="time-cell">${escapeHtml(row.timeDisplay)}</td><td>${escapeHtml(row.competition || "-")}</td>
      <td>${escapeHtml(row.competitionDate || "-")}</td></tr>
  `).join("") : '<tr><td colspan="5" class="empty-cell">등록된 기록이 없습니다.</td></tr>';
}

function renderMembers() {
  const body = document.querySelector("#memberTable tbody");
  body.innerHTML = state.members.length ? state.members.map((member, index) => `
    <tr><td>${index + 1}</td><td class="member-name">${escapeHtml(member.memberName)}</td>
      ${EVENTS.map((event) => `<td>${escapeHtml(member[event])}</td>`).join("")}
      <td>${member.recordCount}</td></tr>
  `).join("") : '<tr><td colspan="6" class="empty-cell">등록된 회원이 없습니다.</td></tr>';
}

function renderSelectedEvent() {
  const rows = state.rankings[state.selectedEvent];
  document.querySelector("#podiumTitle").textContent = `${state.selectedEvent} 명예의 전당`;
  document.querySelector("#rankingTitle").textContent = `${state.selectedEvent} 전체 순위`;
  renderEventTabs();
  renderPodium(rows);
  renderRanking(rows);
  document.querySelector("#rankingSearch").dispatchEvent(new Event("input"));
}

function bindSearch(inputSelector, tableSelector) {
  const input = document.querySelector(inputSelector);
  const table = document.querySelector(tableSelector);
  input.addEventListener("input", () => {
    const keyword = input.value.trim().toLocaleLowerCase("ko");
    table.querySelectorAll("tbody tr").forEach((row) => {
      row.hidden = Boolean(keyword) && !row.textContent.toLocaleLowerCase("ko").includes(keyword);
    });
  });
}

async function loadRecords() {
  const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Spreadsheet 응답 오류 (${response.status})`);
  const records = normalizeRecords(await response.text());
  buildLeaderboard(records);
  document.querySelector("#memberCount").textContent = state.members.length;
  document.querySelector("#recordCount").textContent = records.length;
  renderSelectedEvent();
  renderMembers();
  document.querySelector("#statusMessage").hidden = true;
}

document.querySelector("#currentYear").textContent = new Date().getFullYear();
document.querySelector("#eventTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-event]");
  if (!button) return;
  state.selectedEvent = button.dataset.event;
  renderSelectedEvent();
});
bindSearch("#rankingSearch", "#rankingTable");
bindSearch("#memberSearch", "#memberTable");

loadRecords().catch((error) => {
  const message = document.querySelector("#statusMessage");
  message.classList.add("status-error");
  message.textContent = "기록을 불러오지 못했습니다. Google Spreadsheet를 '링크가 있는 모든 사용자 - 뷰어'로 공유했는지 확인해 주세요.";
  console.error(error);
});
