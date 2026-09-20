/**
 * Deploy this file as an Apps Script web app (execute as you; access: anyone).
 * Required Script Properties: ADMIN_PASSWORD, GITHUB_TOKEN, GITHUB_OWNER,
 * GITHUB_REPO and REQUEST_SHEET_ID.
 */
const REQUEST_SHEET = 'REQUEST_LOG';
const RECORD_COLUMNS = ['record_id','member_name','event_id','event_name','time_ms','time_display','competition','competition_date','note','proof_photo_url','created_at'];
const COMPETITION_RECORD_COLUMNS = ['record_id','member_name','competition_id','competition_name','competition_event_id','competition_event_name','competition_division_id','competition_division_name','year','gold','silver','bronze','note','created_at'];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const result = dispatch_(body.action, body.payload || {}, body.adminToken || '');
    return json_({ ok: true, ...result });
  } catch (error) {
    console.error(error.stack || error);
    return json_({ ok: false, message: error.message || '요청을 처리하지 못했습니다.' });
  }
}

function dispatch_(action, p, token) {
  if (action === 'adminLogin') return login_(p.password);
  if (action === 'requestAdd') return requestAdd_(p);
  if (action === 'requestCompetitionAdd') return requestCompetitionAdd_(p);
  if (action === 'requestDelete') return requestDelete_(p);
  if (action === 'pendingDeleteRecords') return pendingDeleteRecords_();
  requireAdmin_(token);
  if (action === 'adminList') return adminList_(p.view);
  if (action === 'processRequest') return processRequest_(p);
  if (action === 'manageEvent') return manageEvent_(p);
  if (action === 'manageCompetition') return manageCompetition_(p);
  if (action === 'manageCompetitionEvent') return manageCompetitionEvent_(p);
  if (action === 'manageCompetitionDivision') return manageCompetitionDivision_(p);
  throw new Error('지원하지 않는 요청입니다.');
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function properties_() { return PropertiesService.getScriptProperties(); }
function prop_(name) {
  const value = properties_().getProperty(name);
  if (!value) throw new Error('Script Properties에 ' + name + ' 설정이 필요합니다.');
  return value;
}
function requireAdmin_(token) {
  if (!token || CacheService.getScriptCache().get('admin:' + token) !== '1') throw new Error('관리자 인증이 만료되었습니다.');
}
function login_(password) {
  if (!password || password !== prop_('ADMIN_PASSWORD')) throw new Error('관리자 비밀번호가 올바르지 않습니다.');
  const adminToken = Utilities.getUuid();
  CacheService.getScriptCache().put('admin:' + adminToken, '1', 21600);
  return { adminToken: adminToken };
}

function requestSheet_() {
  const ss = SpreadsheetApp.openById(prop_('REQUEST_SHEET_ID'));
  let sheet = ss.getSheetByName(REQUEST_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(REQUEST_SHEET);
    sheet.appendRow(['request_id','request_type','requested_at','source_json','status','processed_at','result','record_id','member_name','event_id','event_name','time_display','competition_date','competition','note','proof_photo_url','delete_reason']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function appendRequest_(request) {
  const sheet = requestSheet_();
  sheet.appendRow([request.request_id,request.request_type,request.requested_at,JSON.stringify(request.source),request.status,'','',request.record_id||'',request.member_name||'',request.event_id||'',request.event_name||'',request.time_display||'',request.competition_date||'',request.competition||'',request.note||'',request.proof_photo_url||'',request.delete_reason||'']);
}
function rowsToRequests_() {
  const values = requestSheet_().getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const headers = values.shift();
  return values.map((row, rowIndex) => Object.assign({ _row: rowIndex + 2 }, Object.fromEntries(headers.map((h, i) => [h, row[i]]))));
}
function updateRequest_(request, status, result) {
  const sheet = requestSheet_();
  const now = new Date().toISOString();
  sheet.getRange(request._row, 5, 1, 3).setValues([[status, now, result]]);
}

function requestAdd_(p) {
  validateAdd_(p);
  const event = p.eventId ? events_().find(e => e.event_id === p.eventId) : null;
  if (p.eventId && !event) throw new Error('존재하지 않는 종목입니다.');
  const eventName = event ? event.event_name : clean_(p.eventName);
  const requestId = Utilities.getUuid();
  const photoUrl = p.photo ? savePhotoToGitHub_(requestId, p.photo) : '';
  const request = {
    request_id: requestId, request_type: 'add', requested_at: new Date().toISOString(),
    // Do not write the base64 image payload into the audit Spreadsheet cell.
    source: requestSource_(p, photoUrl), status: 'pending', record_id: '', member_name: clean_(p.memberName), event_id: event ? event.event_id : '',
    event_name: eventName, time_display: clean_(p.timeDisplay), competition_date: clean_(p.competitionDate),
    competition: clean_(p.competition), note: clean_(p.note), proof_photo_url: photoUrl
  };
  appendRequest_(request);
  return { requestId: request.request_id };
}
function requestDelete_(p) {
  if (!clean_(p.recordId) || !clean_(p.reason)) throw new Error('삭제 대상과 삭제 사유는 필수입니다.');
  const current = records_().find(r => r.record_id === p.recordId);
  if (!current) throw new Error('삭제 대상 기록을 찾을 수 없습니다.');
  const request = {
    request_id: Utilities.getUuid(), request_type: 'delete', requested_at: new Date().toISOString(),
    source: p, status: 'pending', record_id: current.record_id, member_name: current.member_name,
    event_id: current.event_id, event_name: current.event_name, time_display: current.time_display,
    competition_date: current.competition_date, competition: current.competition, note: current.note,
    proof_photo_url: current.proof_photo_url, delete_reason: clean_(p.reason)
  };
  appendRequest_(request);
  return { requestId: request.request_id };
}
function requestCompetitionAdd_(p) {
  validateCompetitionAdd_(p);
  const competition = p.competitionId ? competitions_().find(c => c.competition_id === p.competitionId) : null;
  if (p.competitionId && !competition) throw new Error('존재하지 않는 대회입니다.');
  const competitionName = competition ? competition.competition_name : clean_(p.competitionName);
  const competitionEvent = p.competitionEventId ? competitionEvents_().find(e => e.competition_event_id === p.competitionEventId) : null;
  if (p.competitionEventId && !competitionEvent) throw new Error('존재하지 않는 대회 종목입니다.');
  const competitionEventName = competitionEvent ? competitionEvent.competition_event_name : clean_(p.competitionEventName);
  const competitionDivision = p.competitionDivisionId ? competitionDivisions_().find(d => d.competition_division_id === p.competitionDivisionId) : null;
  if (p.competitionDivisionId && !competitionDivision) throw new Error('존재하지 않는 나이대입니다.');
  const competitionDivisionName = competitionDivision ? competitionDivision.competition_division_name : clean_(p.competitionDivisionName);
  const medalDisplay = competitionEventName + ' · ' + competitionDivisionName + ' · 금 ' + Number(p.gold || 0) + ' · 은 ' + Number(p.silver || 0) + ' · 동 ' + Number(p.bronze || 0);
  const request = {
    request_id: Utilities.getUuid(), request_type: 'competition_add', requested_at: new Date().toISOString(),
    source: p, status: 'pending', record_id: '', member_name: clean_(p.memberName),
    event_id: competition ? competition.competition_id : '', event_name: competitionName,
    time_display: medalDisplay, competition_date: String(Number(p.year)), competition: '대회',
    note: clean_(p.note), proof_photo_url: ''
  };
  appendRequest_(request);
  return { requestId: request.request_id };
}
function pendingDeleteRecords_() {
  return { recordIds: rowsToRequests_().filter(r => r.request_type === 'delete' && r.status === 'pending').map(r => r.record_id).filter(Boolean) };
}
function validateAdd_(p) {
  if (!clean_(p.memberName) || !clean_(p.competitionDate) || (!clean_(p.eventId) && !clean_(p.eventName)) || !parseTimeMs_(p.timeDisplay)) throw new Error('이름, 날짜, 종목, 올바른 기록은 필수입니다.');
  if (clean_(p.memberName).length > 50) throw new Error('이름은 50자 이하여야 합니다.');
}
function validateCompetitionAdd_(p) {
  const year = Number(p.year), medals = [p.gold, p.silver, p.bronze].map(Number);
  if (!clean_(p.memberName) || (!clean_(p.competitionId) && !clean_(p.competitionName)) || (!clean_(p.competitionEventId) && !clean_(p.competitionEventName)) || (!clean_(p.competitionDivisionId) && !clean_(p.competitionDivisionName))) throw new Error('이름, 대회명, 대회 종목, 나이대는 필수입니다.');
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new Error('연도를 올바르게 입력해 주세요.');
  if (!medals.every(n => Number.isInteger(n) && n >= 0 && n <= 99)) throw new Error('메달 수는 0~99 사이의 정수여야 합니다.');
  if (clean_(p.memberName).length > 50 || clean_(p.competitionName).length > 100 || clean_(p.competitionEventName).length > 100 || clean_(p.competitionDivisionName).length > 100) throw new Error('입력값이 너무 깁니다.');
}
function requestSource_(payload, photoUrl) {
  const source = Object.assign({}, payload);
  delete source.photo;
  source.proof_photo_url = photoUrl;
  return source;
}
function savePhotoToGitHub_(requestId, photo) {
  if (!photo.base64 || photo.mimeType !== 'image/jpeg') throw new Error('증빙사진 형식이 올바르지 않습니다.');
  const bytes = Utilities.base64Decode(photo.base64);
  if (bytes.length > 307200) throw new Error('증빙사진은 300KB 이하여야 합니다.');
  const path = 'data/proofs/' + requestId + '.jpg';
  githubPutBase64_(path, photo.base64, 'Store proof photo for request ' + requestId);
  return githubRawUrl_(path);
}

function eventNameCompare_(a, b) {
  const aName = String(a.event_name || a), bName = String(b.event_name || b);
  const aMatch = aName.match(/^\s*(\d+(?:\.\d+)?)/), bMatch = bName.match(/^\s*(\d+(?:\.\d+)?)/);
  if (aMatch && bMatch && Number(aMatch[1]) !== Number(bMatch[1])) return Number(aMatch[1]) - Number(bMatch[1]);
  return aName.localeCompare(bName, 'ko');
}

function adminList_(view) {
  if (view === 'events') return { events: events_().sort(eventNameCompare_) };
  if (view === 'competitions') return { competitions: competitions_().sort((a,b) => a.competition_name.localeCompare(b.competition_name, 'ko')) };
  if (view === 'competition-events') return { competitionEvents: competitionEvents_() };
  if (view === 'competition-divisions') return { competitionDivisions: competitionDivisions_() };
  const type = view === 'add' ? 'add' : view === 'competition-add' ? 'competition_add' : view === 'delete' ? 'delete' : '';
  const requests = rowsToRequests_().filter(r => (!type || r.request_type === type) && (view !== 'history' || r.status !== 'pending')).sort((a,b) => b.requested_at.localeCompare(a.requested_at));
  return { requests: requests };
}
function processRequest_(p) {
  if (!['approved','rejected'].includes(p.decision)) throw new Error('처리 결과가 올바르지 않습니다.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const request = rowsToRequests_().find(r => r.request_id === p.requestId);
    if (!request) throw new Error('요청을 찾을 수 없습니다.');
    if (request.status !== 'pending') throw new Error('이미 처리된 요청입니다.');
    if (p.decision === 'rejected') { updateRequest_(request, 'rejected', '관리자 거절'); return {}; }
    let result = 'GitHub CSV 커밋 완료';
    if (request.request_type === 'add') approveAdd_(request);
    else if (request.request_type === 'competition_add') approveCompetitionAdd_(request);
    else if (request.request_type === 'delete') { if (!approveDelete_(request)) result = '대상 기록이 이미 삭제되어 CSV 변경 없이 승인 처리'; }
    else throw new Error('요청 종류가 올바르지 않습니다.');
    updateRequest_(request, 'approved', result);
    return {};
  } finally { lock.releaseLock(); }
}
function approveAdd_(r) {
  const rows = records_(), events = events_();
  let event = events.find(e => e.event_id === r.event_id);
  if (!event && clean_(r.event_name)) event = events.find(e => e.event_name.toLowerCase() === r.event_name.toLowerCase());
  if (!event && clean_(r.event_name)) {
    event = { event_id: 'event-' + randomId_(), event_name: r.event_name };
    events.push(event);
    writeCsv_('data/events.csv', ['event_id','event_name'], events, 'Add requested leaderboard event ' + r.request_id);
  }
  if (!event) throw new Error('종목이 삭제되어 승인할 수 없습니다.');
  const timeMs = parseTimeMs_(r.time_display);
  rows.push({ record_id: nextRecordId_(rows), member_name: r.member_name, event_id: event.event_id, event_name: event.event_name, time_ms: String(timeMs), time_display: formatTime_(timeMs), competition: r.competition, competition_date: r.competition_date, note: r.note, proof_photo_url: r.proof_photo_url, created_at: new Date().toISOString() });
  writeCsv_('data/records.csv', RECORD_COLUMNS, rows, 'Approve record request ' + r.request_id);
}
function approveDelete_(r) {
  const rows = records_(), next = rows.filter(row => row.record_id !== r.record_id);
  if (rows.length === next.length) return false;
  writeCsv_('data/records.csv', RECORD_COLUMNS, next, 'Approve record deletion ' + r.request_id);
  return true;
}
function approveCompetitionAdd_(r) {
  const source = JSON.parse(r.source_json || '{}'), rows = competitionRecords_(), competitions = competitions_(), competitionEvents = competitionEvents_(), competitionDivisions = competitionDivisions_();
  let competition = competitions.find(c => c.competition_id === (r.event_id || source.competitionId));
  if (!competition && clean_(r.event_name)) competition = competitions.find(c => c.competition_name.toLowerCase() === r.event_name.toLowerCase());
  if (!competition && clean_(r.event_name)) {
    competition = { competition_id: 'competition-' + randomId_(), competition_name: r.event_name };
    competitions.push(competition);
    writeCsv_('data/competitions.csv', ['competition_id','competition_name'], competitions, 'Add requested competition ' + r.request_id);
  }
  if (!competition) throw new Error('대회가 삭제되어 승인할 수 없습니다.');
  let competitionEvent = competitionEvents.find(e => e.competition_event_id === source.competitionEventId);
  if (!competitionEvent && clean_(source.competitionEventName)) competitionEvent = competitionEvents.find(e => e.competition_event_name.toLowerCase() === clean_(source.competitionEventName).toLowerCase());
  if (!competitionEvent && clean_(source.competitionEventName)) {
    competitionEvent = { competition_event_id: 'competition-event-' + randomId_(), competition_event_name: clean_(source.competitionEventName) };
    competitionEvents.push(competitionEvent);
    writeCsv_('data/competition_events.csv', ['competition_event_id','competition_event_name'], competitionEvents, 'Add requested competition event ' + r.request_id);
  }
  if (!competitionEvent) throw new Error('대회 종목이 삭제되어 승인할 수 없습니다.');
  let competitionDivision = competitionDivisions.find(d => d.competition_division_id === source.competitionDivisionId);
  if (!competitionDivision && clean_(source.competitionDivisionName)) competitionDivision = competitionDivisions.find(d => d.competition_division_name.toLowerCase() === clean_(source.competitionDivisionName).toLowerCase());
  if (!competitionDivision && clean_(source.competitionDivisionName)) {
    competitionDivision = { competition_division_id: 'division-' + randomId_(), competition_division_name: clean_(source.competitionDivisionName) };
    competitionDivisions.push(competitionDivision);
    writeCsv_('data/competition_divisions.csv', ['competition_division_id','competition_division_name'], competitionDivisions, 'Add requested competition division ' + r.request_id);
  }
  if (!competitionDivision) throw new Error('나이대가 삭제되어 승인할 수 없습니다.');
  rows.push({
    record_id: nextCompetitionRecordId_(rows), member_name: r.member_name,
    competition_id: competition.competition_id, competition_name: competition.competition_name,
    competition_event_id: competitionEvent.competition_event_id, competition_event_name: competitionEvent.competition_event_name,
    competition_division_id: competitionDivision.competition_division_id, competition_division_name: competitionDivision.competition_division_name,
    year: String(Number(source.year || r.competition_date)), gold: String(Number(source.gold || 0)),
    silver: String(Number(source.silver || 0)), bronze: String(Number(source.bronze || 0)),
    note: r.note, created_at: new Date().toISOString()
  });
  writeCsv_('data/competition_records.csv', COMPETITION_RECORD_COLUMNS, rows, 'Approve competition record request ' + r.request_id);
}
function manageEvent_(p) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const events = events_(), name = clean_(p.eventName);
    if (p.operation === 'add') {
      if (!name) throw new Error('종목 이름을 입력해 주세요.');
      events.push({ event_id: 'event-' + randomId_(), event_name: name });
    } else if (p.operation === 'rename') {
      const event = events.find(e => e.event_id === p.eventId);
      if (!event || !name) throw new Error('종목을 찾을 수 없거나 이름이 비어 있습니다.');
      event.event_name = name; // event_id remains stable; records keep their original event_id.
    } else if (p.operation === 'delete') {
      if (records_().some(r => r.event_id === p.eventId)) throw new Error('이 종목에 연결된 기록이 있어 삭제할 수 없습니다.');
      const index = events.findIndex(e => e.event_id === p.eventId);
      if (index < 0) throw new Error('종목을 찾을 수 없습니다.');
      events.splice(index, 1);
    } else throw new Error('종목 작업이 올바르지 않습니다.');
    writeCsv_('data/events.csv', ['event_id','event_name'], events, 'Manage leaderboard event');
    return {};
  } finally { lock.releaseLock(); }
}

function manageCompetition_(p) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const competitions = competitions_(), name = clean_(p.competitionName);
    if (p.operation === 'add') {
      if (!name) throw new Error('대회 이름을 입력해 주세요.');
      if (competitions.some(c => c.competition_name.toLowerCase() === name.toLowerCase())) throw new Error('같은 이름의 대회가 이미 있습니다.');
      competitions.push({ competition_id: 'competition-' + randomId_(), competition_name: name });
    } else if (p.operation === 'rename') {
      const competition = competitions.find(c => c.competition_id === p.competitionId);
      if (!competition || !name) throw new Error('대회를 찾을 수 없거나 이름이 비어 있습니다.');
      competition.competition_name = name;
      const records = competitionRecords_();
      records.forEach(r => { if (r.competition_id === p.competitionId) r.competition_name = name; });
      writeCsv_('data/competition_records.csv', COMPETITION_RECORD_COLUMNS, records, 'Rename competition records');
    } else if (p.operation === 'delete') {
      if (competitionRecords_().some(r => r.competition_id === p.competitionId)) throw new Error('이 대회에 연결된 기록이 있어 삭제할 수 없습니다.');
      const index = competitions.findIndex(c => c.competition_id === p.competitionId);
      if (index < 0) throw new Error('대회를 찾을 수 없습니다.');
      competitions.splice(index, 1);
    } else throw new Error('대회 작업이 올바르지 않습니다.');
    writeCsv_('data/competitions.csv', ['competition_id','competition_name'], competitions, 'Manage competition list');
    return {};
  } finally { lock.releaseLock(); }
}

function manageCompetitionEvent_(p) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const events = competitionEvents_(), name = clean_(p.competitionEventName);
    if (p.operation === 'add') {
      if (!name) throw new Error('대회 종목 이름을 입력해 주세요.');
      if (events.some(e => e.competition_event_name.toLowerCase() === name.toLowerCase())) throw new Error('같은 이름의 대회 종목이 이미 있습니다.');
      events.push({ competition_event_id: 'competition-event-' + randomId_(), competition_event_name: name });
    } else if (p.operation === 'rename') {
      const event = events.find(e => e.competition_event_id === p.competitionEventId);
      if (!event || !name) throw new Error('대회 종목을 찾을 수 없거나 이름이 비어 있습니다.');
      event.competition_event_name = name;
      const records = competitionRecords_();
      records.forEach(r => { if (r.competition_event_id === p.competitionEventId) r.competition_event_name = name; });
      writeCsv_('data/competition_records.csv', COMPETITION_RECORD_COLUMNS, records, 'Rename competition event records');
    } else if (p.operation === 'delete') {
      if (competitionRecords_().some(r => r.competition_event_id === p.competitionEventId)) throw new Error('이 종목에 연결된 기록이 있어 삭제할 수 없습니다.');
      const index = events.findIndex(e => e.competition_event_id === p.competitionEventId);
      if (index < 0) throw new Error('대회 종목을 찾을 수 없습니다.');
      events.splice(index, 1);
    } else throw new Error('대회 종목 작업이 올바르지 않습니다.');
    writeCsv_('data/competition_events.csv', ['competition_event_id','competition_event_name'], events, 'Manage competition event list');
    return {};
  } finally { lock.releaseLock(); }
}

function manageCompetitionDivision_(p) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const divisions = competitionDivisions_(), name = clean_(p.competitionDivisionName);
    if (p.operation === 'add') {
      if (!name) throw new Error('나이대 이름을 입력해 주세요.');
      if (divisions.some(d => d.competition_division_name.toLowerCase() === name.toLowerCase())) throw new Error('같은 이름의 나이대가 이미 있습니다.');
      divisions.push({ competition_division_id: 'division-' + randomId_(), competition_division_name: name });
    } else if (p.operation === 'rename') {
      const division = divisions.find(d => d.competition_division_id === p.competitionDivisionId);
      if (!division || !name) throw new Error('나이대를 찾을 수 없거나 이름이 비어 있습니다.');
      division.competition_division_name = name;
      const records = competitionRecords_();
      records.forEach(r => { if (r.competition_division_id === p.competitionDivisionId) r.competition_division_name = name; });
      writeCsv_('data/competition_records.csv', COMPETITION_RECORD_COLUMNS, records, 'Rename competition division records');
    } else if (p.operation === 'delete') {
      if (competitionRecords_().some(r => r.competition_division_id === p.competitionDivisionId)) throw new Error('이 나이대에 연결된 기록이 있어 삭제할 수 없습니다.');
      const index = divisions.findIndex(d => d.competition_division_id === p.competitionDivisionId);
      if (index < 0) throw new Error('나이대를 찾을 수 없습니다.');
      divisions.splice(index, 1);
    } else throw new Error('나이대 작업이 올바르지 않습니다.');
    writeCsv_('data/competition_divisions.csv', ['competition_division_id','competition_division_name'], divisions, 'Manage competition division list');
    return {};
  } finally { lock.releaseLock(); }
}

function records_() { return readCsv_('data/records.csv'); }
function events_() { return readCsv_('data/events.csv'); }
function competitions_() { return readCsv_('data/competitions.csv'); }
function competitionEvents_() { return readCsv_('data/competition_events.csv'); }
function competitionDivisions_() { return readCsv_('data/competition_divisions.csv'); }
function competitionRecords_() { return readCsv_('data/competition_records.csv'); }
function readCsv_(path) {
  const text = githubGet_(path).content;
  const rows = Utilities.parseCsv(text);
  const headers = rows.shift();
  return rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(headers.map((h,i) => [h, r[i] || ''])));
}
function writeCsv_(path, headers, rows, message) {
  const content = [headers.join(',')].concat(rows.map(r => headers.map(h => csvValue_(r[h])).join(','))).join('\n') + '\n';
  githubPut_(path, content, message);
}
function csvValue_(value) { const text = String(value == null ? '' : value); return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }
function githubGet_(path) {
  const url = githubUrl_(path);
  const response = UrlFetchApp.fetch(url, { headers: githubHeaders_(), muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('GitHub 파일을 읽지 못했습니다: ' + response.getResponseCode());
  const body = JSON.parse(response.getContentText());
  return { sha: body.sha, content: Utilities.newBlob(Utilities.base64Decode(body.content.replace(/\n/g,''))).getDataAsString('UTF-8') };
}
function githubPut_(path, content, message) {
  const current = githubGet_(path);
  const response = UrlFetchApp.fetch(githubUrl_(path), { method: 'put', contentType: 'application/json', headers: githubHeaders_(), payload: JSON.stringify({ message: message, content: Utilities.base64Encode(content, Utilities.Charset.UTF_8), sha: current.sha, branch: properties_().getProperty('GITHUB_BRANCH') || 'main' }), muteHttpExceptions: true });
  if (response.getResponseCode() < 200 || response.getResponseCode() > 299) throw new Error('GitHub 커밋에 실패했습니다: ' + response.getContentText());
}
function githubPutBase64_(path, base64, message) {
  const response = UrlFetchApp.fetch(githubUrl_(path), {
    method: 'put', contentType: 'application/json', headers: githubHeaders_(),
    payload: JSON.stringify({ message: message, content: base64, branch: properties_().getProperty('GITHUB_BRANCH') || 'main' }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() > 299) throw new Error('증빙사진 GitHub 커밋에 실패했습니다: ' + response.getContentText());
}
function githubUrl_(path) { return 'https://api.github.com/repos/' + prop_('GITHUB_OWNER') + '/' + prop_('GITHUB_REPO') + '/contents/' + path; }
function githubRawUrl_(path) { return 'https://raw.githubusercontent.com/' + prop_('GITHUB_OWNER') + '/' + prop_('GITHUB_REPO') + '/' + (properties_().getProperty('GITHUB_BRANCH') || 'main') + '/' + path; }
function githubHeaders_() { return { Authorization: 'Bearer ' + prop_('GITHUB_TOKEN'), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
function clean_(v) { return String(v || '').trim(); }
function randomId_() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_';
  const digest = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid())).replace(/-/g, '_');
  return digest.slice(0, 8);
}
function nextRecordId_(rows) {
  let recordId;
  do { recordId = randomId_(); } while (rows.some(row => row.record_id === recordId));
  return recordId;
}
function nextCompetitionRecordId_(rows) {
  let recordId;
  do { recordId = 'cr-' + randomId_(); } while (rows.some(row => row.record_id === recordId));
  return recordId;
}
function parseTimeMs_(v) { const m=clean_(v).replace(',', '.').match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$/); return !m || m[1] && Number(m[2]) >= 60 ? 0 : (Number(m[1] || 0) * 60 + Number(m[2])) * 1000 + Number((m[3] || '0').padEnd(3,'0').slice(0,3)); }
function formatTime_(value) { const seconds=Math.floor(value/1000), minutes=Math.floor(seconds/60); return minutes + ':' + String(seconds%60).padStart(2,'0') + '.' + Math.floor(value%1000/100); }
