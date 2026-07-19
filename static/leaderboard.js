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
  note: ["note", "비고", "메모"],
  createdAt: ["created_at", "등록일", "등록일시"],
};

const state = {
  rankings: Object.fromEntries(EVENTS.map((event) => [event, []])),
  members: [],
  records: [],
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
      note: indexes.note >= 0 ? String(row[indexes.note] ?? "").trim() : "",
      createdAt: indexes.createdAt >= 0 ? String(row[indexes.createdAt] ?? "").trim() : "",
    };
  }).filter((record) => record.memberName && EVENTS.includes(record.event) && record.timeMs > 0);
}

function buildLeaderboard(records) {
  state.records = records;
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
    const summary = { memberName, recordCount: histories.get(memberName).length, pb: {} };
    EVENTS.forEach((event) => {
      const pb = best.get(`${memberName}\u0000${event}`) || null;
      summary.pb[event] = pb;
      summary[event] = pb?.timeDisplay || "-";
    });
    return summary;
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function podiumMarkup(rows) {
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
        <p>${escapeHtml(row.competition)}</p>
        <small>${escapeHtml(row.competitionDate || "-")}</small>
      </article>`;
  });
  return cards.join("");
}

function rankingRowsMarkup(rows) {
  return rows.length ? rows.map((row) => `
    <tr>
      <td><span class="rank-badge">${row.rank}</span></td><td class="member-name">${escapeHtml(row.memberName)}</td>
      <td class="time-cell">${escapeHtml(row.timeDisplay)}</td><td>${escapeHtml(row.competition)}</td>
      <td>${escapeHtml(row.competitionDate || "-")}</td></tr>
  `).join("") : '<tr><td colspan="5" class="empty-cell">등록된 기록이 없습니다.</td></tr>';
}

function renderEventSections() {
  document.querySelector("#eventSections").innerHTML = EVENTS.map((event) => {
    const rows = state.rankings[event];
    return `
      <section class="event-section" aria-labelledby="event-title-${event}">
        <section class="podium-section">
          <div class="section-heading event-heading">
            <div><p class="eyebrow">TOP 3</p><h2 id="event-title-${event}">${event} 명예의 전당</h2></div>
            <span class="event-distance">${event}</span>
          </div>
          <div class="podium-grid">${podiumMarkup(rows)}</div>
        </section>

        <section class="panel">
          <div class="section-heading table-heading">
            <div><p class="eyebrow">RANKING</p><h2>${event} 전체 순위</h2></div>
            <input class="search-input event-search" type="search" placeholder="${event} 이름 검색"
              aria-label="${event} 이름 검색" data-ranking-table="ranking-${event}">
          </div>
          <div class="table-wrap ranking-scroll">
            <table id="ranking-${event}">
              <thead><tr><th>순위</th><th>이름</th><th>PB</th><th>대회</th><th>대회일</th></tr></thead>
              <tbody>${rankingRowsMarkup(rows)}</tbody>
            </table>
          </div>
        </section>
      </section>`;
  }).join("");
}

function renderMembers() {
  const body = document.querySelector("#memberTable tbody");
  body.innerHTML = state.members.length ? state.members.map((member, index) => `
    <tr><td>${index + 1}</td><td class="member-name">${escapeHtml(member.memberName)}</td>
      ${EVENTS.map((event) => `<td>${escapeHtml(member[event])}</td>`).join("")}
      <td>${member.recordCount}</td>
      <td><button class="record-detail-button" type="button" data-member-index="${index}">개인별 최고기록</button></td></tr>
  `).join("") : '<tr><td colspan="7" class="empty-cell">등록된 회원이 없습니다.</td></tr>';
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

function filterRanking(table, input) {
  const keyword = input.value.trim().toLocaleLowerCase("ko");
  table.querySelectorAll("tbody tr").forEach((row) => {
    row.hidden = Boolean(keyword) && !row.textContent.toLocaleLowerCase("ko").includes(keyword);
  });
}

function recordHistoryMarkup(records) {
  return records.length ? records.map((record) => `
    <tr><td>${escapeHtml(record.competitionDate || "-")}</td><td class="time-cell">${escapeHtml(record.timeDisplay)}</td>
      <td>${escapeHtml(record.competition)}</td><td>${escapeHtml(record.note)}</td></tr>
  `).join("") : '<tr><td colspan="4" class="empty-cell">등록된 기록이 없습니다.</td></tr>';
}

function openMemberDialog(memberIndex) {
  const member = state.members[memberIndex];
  if (!member) return;
  document.querySelector("#dialogMemberName").textContent = `${member.memberName} 선수 기록`;
  document.querySelector("#dialogContent").innerHTML = `
    <div class="member-pb-grid">
      ${EVENTS.map((event) => {
        const pb = member.pb[event];
        return `<div class="member-pb-card"><span>${event} PB</span><strong>${escapeHtml(pb?.timeDisplay || "-")}</strong>
          <small>${escapeHtml(pb?.competitionDate || "")}</small></div>`;
      }).join("")}
    </div>
    <div class="member-history-list">
      ${EVENTS.map((event) => {
        const records = state.records
          .filter((record) => record.memberName === member.memberName && record.event === event)
          .sort((left, right) => (right.competitionDate || "").localeCompare(left.competitionDate || "") || left.timeMs - right.timeMs);
        return `<section class="member-event-history">
          <div class="member-event-heading"><h3>${event}</h3><span>${records.length}개 기록</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>날짜</th><th>기록</th><th>대회</th><th>비고</th></tr></thead>
            <tbody>${recordHistoryMarkup(records)}</tbody>
          </table></div>
        </section>`;
      }).join("")}
    </div>`;

  document.querySelector("#memberDialog").showModal();
}

async function loadRecords() {
  const response = await fetch(`${SHEET_CSV_URL}&_=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Spreadsheet 응답 오류 (${response.status})`);
  const records = normalizeRecords(await response.text());
  buildLeaderboard(records);
  document.querySelector("#memberCount").textContent = state.members.length;
  document.querySelector("#recordCount").textContent = records.length;
  renderEventSections();
  renderMembers();
  document.querySelector("#memberSearch").dispatchEvent(new Event("input"));
  document.querySelector("#statusMessage").hidden = true;
}

async function refreshRecords() {
  const button = document.querySelector("#refreshButton");
  const message = document.querySelector("#statusMessage");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  message.hidden = false;
  message.classList.remove("status-error");
  message.textContent = "Google Spreadsheet에서 최신 기록을 불러오는 중입니다.";

  try {
    await loadRecords();
  } catch (error) {
    message.classList.add("status-error");
    message.textContent = "기록을 불러오지 못했습니다. 잠시 후 새로고침 버튼을 다시 눌러 주세요.";
    console.error(error);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

document.querySelector("#currentYear").textContent = new Date().getFullYear();
document.querySelector("#refreshButton").addEventListener("click", refreshRecords);
document.querySelector("#eventSections").addEventListener("input", (event) => {
  const input = event.target.closest("[data-ranking-table]");
  if (!input) return;
  const table = document.querySelector(`#${input.dataset.rankingTable}`);
  filterRanking(table, input);
});
document.querySelector("#memberTable").addEventListener("click", (event) => {
  const button = event.target.closest("[data-member-index]");
  if (button) openMemberDialog(Number(button.dataset.memberIndex));
});
document.querySelector("#dialogCloseButton").addEventListener("click", () => document.querySelector("#memberDialog").close());
document.querySelector("#memberDialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
bindSearch("#memberSearch", "#memberTable");
refreshRecords();
