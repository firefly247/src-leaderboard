/**
 * Deploy this file as an Apps Script web app (execute as you; access: anyone).
 * Required Script Properties: ADMIN_PASSWORD, GITHUB_TOKEN, GITHUB_OWNER,
 * GITHUB_REPO and REQUEST_SHEET_ID.
 */
const REQUEST_SHEET = 'REQUEST_LOG';
const RECORD_COLUMNS = ['record_id','member_name','event_id','event_name','time_ms','time_display','competition','competition_date','note','proof_photo_url','created_at'];

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
  if (action === 'requestDelete') return requestDelete_(p);
  requireAdmin_(token);
  if (action === 'adminList') return adminList_(p.view);
  if (action === 'processRequest') return processRequest_(p);
  if (action === 'manageEvent') return manageEvent_(p);
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
function validateAdd_(p) {
  if (!clean_(p.memberName) || !clean_(p.competitionDate) || (!clean_(p.eventId) && !clean_(p.eventName)) || !parseTimeMs_(p.timeDisplay)) throw new Error('이름, 날짜, 종목, 올바른 기록은 필수입니다.');
  if (clean_(p.memberName).length > 50) throw new Error('이름은 50자 이하여야 합니다.');
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
  const type = view === 'add' ? 'add' : view === 'delete' ? 'delete' : '';
  const requests = rowsToRequests_().filter(r => !type || r.request_type === type).sort((a,b) => b.requested_at.localeCompare(a.requested_at));
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
    if (request.request_type === 'add') approveAdd_(request);
    else if (request.request_type === 'delete') approveDelete_(request);
    else throw new Error('요청 종류가 올바르지 않습니다.');
    updateRequest_(request, 'approved', 'GitHub CSV 커밋 완료');
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
  if (rows.length === next.length) throw new Error('삭제 대상 기록이 이미 존재하지 않습니다.');
  writeCsv_('data/records.csv', RECORD_COLUMNS, next, 'Approve record deletion ' + r.request_id);
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

function records_() { return readCsv_('data/records.csv'); }
function events_() { return readCsv_('data/events.csv'); }
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
function parseTimeMs_(v) { const m=clean_(v).replace(',', '.').match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$/); return !m || m[1] && Number(m[2]) >= 60 ? 0 : (Number(m[1] || 0) * 60 + Number(m[2])) * 1000 + Number((m[3] || '0').padEnd(3,'0').slice(0,3)); }
function formatTime_(value) { const seconds=Math.floor(value/1000), minutes=Math.floor(seconds/60); return minutes ? minutes + ':' + String(seconds%60).padStart(2,'0') + '.' + Math.floor(value%1000/100) : (seconds%60) + '.' + Math.floor(value%1000/100); }
