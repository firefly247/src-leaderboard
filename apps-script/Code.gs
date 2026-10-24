/**
 * Deploy this file as an Apps Script web app (execute as you; access: anyone).
 * Required Script Properties: ADMIN_PASSWORD, GITHUB_TOKEN, GITHUB_OWNER,
 * GITHUB_REPO and REQUEST_SHEET_ID.
 */
const REQUEST_SHEET = 'REQUEST_LOG';
const BIRTH_YEAR_SHEET = 'PLAYER_BIRTH_YEARS';
const RECORD_COLUMNS = ['record_id','member_name','event_id','event_name','time_ms','time_display','competition','competition_date','note','proof_photo_url','created_at'];
const COMPETITION_RECORD_COLUMNS = ['record_id','member_name','competition_id','competition_name','competition_event_id','competition_event_name','competition_division_id','competition_division_name','year','competition_type','is_cox','gold','silver','bronze','note','created_at','lineup_group_id'];

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
  if (action === 'trainingGet') return trainingGet_(p);
  if (action === 'trainingJoin') return trainingJoin_(p);
  requireAdmin_(token);
  if (action === 'trainingRecommend') return trainingRecommend_(p);
  if (action === 'trainingCheck') return trainingCheck_(p);
  if (action === 'adminList') return adminList_(p.view);
  if (action === 'saveApprovedRecord') return saveApprovedRecord_(p);
  if (action === 'saveCompetitionDates') return saveCompetitionDates_(p);
  if (action === 'updateCompetitionRequests') return updateCompetitionRequests_(p);
  if (action === 'savePlayerBirthYear') return savePlayerBirthYear_(p);
  if (action === 'savePlayerBirthYears') return savePlayerBirthYears_(p);
  if (action === 'processRequest') return processRequest_(p);
  if (action === 'processAddRequests') return processAddRequests_(p);
  if (action === 'processCompetitionAddRequests') return processCompetitionAddRequests_(p);
  if (action === 'processRejectRequests') return processRejectRequests_(p);
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
function updateCompetitionRequests_(p) {
  const edits = p.edits;
  if (!Array.isArray(edits) || !edits.length || edits.length > 100) throw new Error('수정할 대회 요청을 1~100건 지정해 주세요.');
  if (new Set(edits.map(edit => edit.requestId)).size !== edits.length) throw new Error('중복된 요청입니다.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const requests = rowsToRequests_();
    // Validate the entire batch before writing, including the source seen by the administrator.
    const updates = edits.map(edit => {
      const request = requests.find(r => r.request_id === edit.requestId);
      if (!request || request.request_type !== 'competition_add' || request.status !== 'pending') throw new Error('승인 대기 중인 대회 요청만 수정할 수 있습니다.');
      if (typeof edit.expectedSourceJson !== 'string' || request.source_json !== edit.expectedSourceJson) throw new Error('요청 내용이 변경되었습니다. 새로 조회한 뒤 수정해 주세요.');
      const source = JSON.parse(request.source_json);
      if (!['year','gold','silver','bronze'].some(key => Object.prototype.hasOwnProperty.call(edit, key))) throw new Error('수정할 연도 또는 메달 수를 지정해 주세요.');
      ['year','gold','silver','bronze'].forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(edit, key)) return;
        if (typeof edit[key] !== 'number' || !Number.isInteger(edit[key])) throw new Error('연도와 메달 수는 정수여야 합니다.');
        source[key] = edit[key];
      });
      validateCompetitionAdd_(source);
      const type = source.competitionType === 'indoor' ? '실내대회' : source.competitionType === 'beach' ? '비치대회' : '수상대회';
      const isCox = source.isCox === true || String(source.isCox) === '1';
      const display = type + (isCox ? ' · COX' : '') + ' · ' + source.competitionEventName + ' · ' + source.competitionDivisionName + ' · 금 ' + Number(source.gold || 0) + ' · 은 ' + Number(source.silver || 0) + ' · 동 ' + Number(source.bronze || 0);
      return { request: request, source: JSON.stringify(source), display: display, year: String(source.year) };
    });
    const sheet = requestSheet_();
    updates.forEach(update => {
      sheet.getRange(update.request._row, 4).setValue(update.source);
      sheet.getRange(update.request._row, 12, 1, 2).setValues([[update.display, update.year]]);
    });
    SpreadsheetApp.flush();
    return { updatedCount: updates.length };
  } finally { lock.releaseLock(); }
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
  const competitionType = clean_(p.competitionType);
  const isCox = p.isCox === true || String(p.isCox) === '1';
  const competitionTypeDisplay = competitionType === 'indoor' ? '실내대회' : competitionType === 'beach' ? '비치대회' : '수상대회';
  const medalDisplay = competitionTypeDisplay + (isCox ? ' · COX' : '') + ' · ' + competitionEventName + ' · ' + competitionDivisionName + ' · 금 ' + Number(p.gold || 0) + ' · 은 ' + Number(p.silver || 0) + ' · 동 ' + Number(p.bronze || 0);
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
  if (!['water','indoor','beach'].includes(clean_(p.competitionType))) throw new Error('대회유형을 선택해 주세요.');
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
  if (view === 'ergo-records') return { records: records_(), events: events_().sort(eventNameCompare_) };
  if (view === 'competition-records') return { records: competitionRecords_(), competitions: competitions_(), competitionEvents: competitionEvents_(), competitionDivisions: competitionDivisions_() };
  if (view === 'competition-dates') return { competitionDates: competitionDateCatalog_() };
  if (view === 'player-birth-years') return { players: playerBirthYears_(), partialYearUpdates: true, dormancyUpdates: true };
  if (view === 'events') return { events: events_().sort(eventNameCompare_) };
  if (view === 'competitions') return { competitions: competitions_().sort((a,b) => a.competition_name.localeCompare(b.competition_name, 'ko')) };
  if (view === 'competition-events') return { competitionEvents: competitionEvents_() };
  if (view === 'competition-divisions') return { competitionDivisions: competitionDivisions_() };
  const type = view === 'add' ? 'add' : view === 'competition-add' ? 'competition_add' : view === 'delete' ? 'delete' : '';
  const requests = rowsToRequests_().filter(r => (!type || r.request_type === type) && (view === 'history' ? r.status !== 'pending' : r.status === 'pending')).sort((a,b) => b.requested_at.localeCompare(a.requested_at));
  return { requests: requests };
}

// Player years are private reference data. Never write them to GitHub CSVs or request logs.
function birthYearSheet_(create) {
  const ss = SpreadsheetApp.openById(prop_('REQUEST_SHEET_ID'));
  let sheet = ss.getSheetByName(BIRTH_YEAR_SHEET);
  if (!sheet && create) {
    sheet = ss.insertSheet(BIRTH_YEAR_SHEET);
    sheet.appendRow(['member_name', 'birth_year', 'updated_at', 'join_year']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function dormantMembers_() { return readCsv_('data/dormant_members.csv').map(row => clean_(row.member_name)).filter(Boolean); }
function playerBirthYears_() {
  const sheet = birthYearSheet_(false);
  const values = sheet ? sheet.getDataRange().getDisplayValues().slice(1) : [];
  const years = new Map(values.filter(row => row[0]).map(row => [row[0], { birthYear: row[1], joinYear: row[3] || '' }]));
  const names = new Set([...records_(), ...competitionRecords_()].map(row => clean_(row.member_name)).filter(Boolean));
  years.forEach((year, name) => names.add(name));
  const dormant = new Set(dormantMembers_());
  dormant.forEach(name => names.add(name));
  return [...names].sort((a, b) => a.localeCompare(b, 'ko')).map(name => ({ memberName: name, birthYear: years.get(name)?.birthYear || '', joinYear: years.get(name)?.joinYear || '', ...(dormant.has(name) ? { isDormant: true } : {}) }));
}
function savePlayerBirthYear_(p) {
  const result = savePlayerBirthYears_({ players: [p] });
  return result.players[0];
}
function savePlayerBirthYears_(p) {
  if (!Array.isArray(p.players) || !p.players.length || p.players.length > 1000) throw new Error('저장할 선수를 1~1000명 선택해 주세요.');
  const currentYear = Number(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy'));
  const players = p.players.map(player => {
    if (!player || typeof player !== 'object') throw new Error('선수 정보가 올바르지 않습니다.');
    const name = clean_(player.memberName), year = player.birthYear == null ? undefined : String(player.birthYear).trim();
    if (year && (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > currentYear)) {
      throw new Error(name + ': 생년은 1900년부터 올해까지의 4자리 연도로 입력해 주세요.');
    }
    const joinYear = player.joinYear == null ? undefined : String(player.joinYear).trim();
    if (player.isDormant !== undefined && typeof player.isDormant !== 'boolean') throw new Error(name + ': 휴면 여부가 올바르지 않습니다.');
    if (year === undefined && joinYear === undefined && player.isDormant === undefined) throw new Error(name + ': 수정할 연도를 지정해 주세요.');
    if (joinYear && (!/^\d{4}$/.test(joinYear) || Number(joinYear) < 1900 || Number(joinYear) > currentYear)) throw new Error(name + ': 가입연도는 1900년부터 올해까지의 4자리 연도로 입력해 주세요.');
    return { memberName: name, birthYear: year, joinYear, isDormant: player.isDormant };
  });
  if (new Set(players.map(player => player.memberName)).size !== players.length) throw new Error('중복된 선수가 있습니다.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const names = new Set(playerBirthYears_().map(player => player.memberName));
    if (players.some(player => !player.memberName || !names.has(player.memberName))) throw new Error('등록된 선수를 선택해 주세요.');
    const sheet = birthYearSheet_(true), previous = sheet.getDataRange().getDisplayValues().slice(1);
    const saved = new Map(previous.filter(row => row[0]).map(row => [row[0], row]));
    const now = new Date().toISOString();
    players.forEach(player => {
      const birthYear = player.birthYear === undefined ? (saved.get(player.memberName)?.[1] || '') : player.birthYear;
      const joinYear = player.joinYear === undefined ? (saved.get(player.memberName)?.[3] || '') : player.joinYear;
      if (birthYear || joinYear) saved.set(player.memberName, [player.memberName, birthYear, now, joinYear]);
      else saved.delete(player.memberName);
    });
    sheet.getRange(1, 4, 1, 1).setValues([['join_year']]);
    const values = [...saved.values()].map(row => [row[0], row[1], row[2], row[3] || '']);
    // Clear removed rows in the same write, after validating every selected player.
    while (values.length < previous.length) values.push(['', '', '', '']);
    if (values.length) {
      sheet.getRange(2, 1, values.length, 1).setNumberFormat('@');
      sheet.getRange(2, 1, values.length, 4).setValues(values);
    }
    SpreadsheetApp.flush();
    const persisted = new Map(sheet.getDataRange().getDisplayValues().slice(1).filter(row => row[0]).map(row => [row[0], row]));
    const confirmed = players.map(player => {
      const row = persisted.get(player.memberName) || [], expected = saved.get(player.memberName) || [];
      if ((row[1] || '') !== (expected[1] || '') || (row[3] || '') !== (expected[3] || '')) throw new Error(player.memberName + ': 저장된 연도를 확인하지 못했습니다. 다시 조회해 주세요.');
      return { memberName: player.memberName, birthYear: row[1] || '', joinYear: row[3] || '' };
    });
    const statusChanges = players.filter(player => player.isDormant !== undefined);
    if (statusChanges.length) {
      const dormant = new Set(dormantMembers_());
      statusChanges.forEach(player => player.isDormant ? dormant.add(player.memberName) : dormant.delete(player.memberName));
      writeCsv_('data/dormant_members.csv', ['member_name'], [...dormant].sort((a,b) => a.localeCompare(b,'ko')).map(member_name => ({ member_name })), 'Update dormant member visibility');
      const persistedDormant = new Set(dormantMembers_());
      confirmed.forEach(player => { player.isDormant = persistedDormant.has(player.memberName); });
      if (statusChanges.some(player => persistedDormant.has(player.memberName) !== player.isDormant)) throw new Error('휴면 상태 저장을 확인하지 못했습니다. 다시 조회해 주세요.');
    }
    return { savedCount: confirmed.length, players: confirmed };
  } finally { lock.releaseLock(); }
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
function processAddRequests_(p) {
  const requestIds = Array.isArray(p.requestIds) ? [...new Set(p.requestIds.map(clean_).filter(Boolean))] : [];
  if (!requestIds.length) throw new Error('승인할 에르고 기록을 선택해 주세요.');
  if (requestIds.length > 100) throw new Error('한 번에 최대 100건까지 승인할 수 있습니다.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const allRequests = rowsToRequests_();
    const requests = requestIds.map(id => allRequests.find(r => r.request_id === id));
    if (requests.some(r => !r)) throw new Error('일부 요청을 찾을 수 없습니다. 목록을 새로고침해 주세요.');
    if (requests.some(r => r.request_type !== 'add')) throw new Error('에르고 기록 요청만 일괄승인할 수 있습니다.');
    if (requests.some(r => r.status !== 'pending')) throw new Error('이미 처리된 요청이 포함되어 있습니다. 목록을 새로고침해 주세요.');
    approveAdds_(requests);
    const sheet = requestSheet_(), now = new Date().toISOString();
    requests.forEach(request => sheet.getRange(request._row, 5, 1, 3).setValues([['approved', now, 'GitHub CSV 일괄 커밋 완료']]));
    return { processedCount: requests.length };
  } finally { lock.releaseLock(); }
}
function processCompetitionAddRequests_(p) {
  const requestIds = Array.isArray(p.requestIds) ? [...new Set(p.requestIds.map(clean_).filter(Boolean))] : [];
  if (!requestIds.length) throw new Error('승인할 대회 기록을 선택해 주세요.');
  if (requestIds.length > 100) throw new Error('한 번에 최대 100건까지 승인할 수 있습니다.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const allRequests = rowsToRequests_();
    const requests = requestIds.map(id => allRequests.find(r => r.request_id === id));
    if (requests.some(r => !r)) throw new Error('일부 요청을 찾을 수 없습니다. 목록을 새로고침해 주세요.');
    if (requests.some(r => r.request_type !== 'competition_add')) throw new Error('대회 기록 요청만 일괄승인할 수 있습니다.');
    if (requests.some(r => r.status !== 'pending')) throw new Error('이미 처리된 요청이 포함되어 있습니다. 목록을 새로고침해 주세요.');
    approveCompetitionAdds_(requests);
    const sheet = requestSheet_(), now = new Date().toISOString();
    requests.forEach(request => sheet.getRange(request._row, 5, 1, 3).setValues([['approved', now, 'GitHub CSV 일괄 커밋 완료']]));
    return { processedCount: requests.length };
  } finally { lock.releaseLock(); }
}
function processRejectRequests_(p) {
  const requestIds = Array.isArray(p.requestIds) ? [...new Set(p.requestIds.map(clean_).filter(Boolean))] : [];
  if (!requestIds.length) throw new Error('거절할 기록을 선택해 주세요.');
  if (requestIds.length > 100) throw new Error('한 번에 최대 100건까지 거절할 수 있습니다.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const allRequests = rowsToRequests_();
    const requests = requestIds.map(id => allRequests.find(r => r.request_id === id));
    if (requests.some(r => !r)) throw new Error('일부 요청을 찾을 수 없습니다. 목록을 새로고침해 주세요.');
    if (requests.some(r => !['add','competition_add'].includes(r.request_type))) throw new Error('대회 또는 에르고 기록 요청만 일괄거절할 수 있습니다.');
    if (requests.some(r => r.status !== 'pending')) throw new Error('이미 처리된 요청이 포함되어 있습니다. 목록을 새로고침해 주세요.');
    const sheet = requestSheet_(), now = new Date().toISOString();
    const range = sheet.getRange(2, 5, sheet.getLastRow() - 1, 3), values = range.getValues();
    requests.forEach(request => { values[request._row - 2] = ['rejected', now, '관리자 일괄 거절']; });
    range.setValues(values);
    return { processedCount: requests.length };
  } finally { lock.releaseLock(); }
}
function approveAdd_(r) {
  const rows = records_(), events = events_();
  const eventAdded = appendApprovedAdd_(r, rows, events);
  if (eventAdded) writeCsv_('data/events.csv', ['event_id','event_name'], events, 'Add requested leaderboard event ' + r.request_id);
  writeCsv_('data/records.csv', RECORD_COLUMNS, rows, 'Approve record request ' + r.request_id);
}
function approveAdds_(requests) {
  const rows = records_(), events = events_();
  let eventAdded = false;
  requests.forEach(request => { eventAdded = appendApprovedAdd_(request, rows, events) || eventAdded; });
  const messageSuffix = requests.length + ' selected record requests';
  if (eventAdded) writeCsv_('data/events.csv', ['event_id','event_name'], events, 'Add events for ' + messageSuffix);
  writeCsv_('data/records.csv', RECORD_COLUMNS, rows, 'Approve ' + messageSuffix);
}
function appendApprovedAdd_(r, rows, events) {
  let event = events.find(e => e.event_id === r.event_id);
  if (!event && clean_(r.event_name)) event = events.find(e => e.event_name.toLowerCase() === r.event_name.toLowerCase());
  let eventAdded = false;
  if (!event && clean_(r.event_name)) {
    event = { event_id: 'event-' + randomId_(), event_name: r.event_name };
    events.push(event);
    eventAdded = true;
  }
  if (!event) throw new Error('종목이 삭제되어 승인할 수 없습니다.');
  const timeMs = parseTimeMs_(r.time_display);
  if (!timeMs) throw new Error('올바르지 않은 기록이 포함되어 있습니다: ' + r.member_name);
  rows.push({ record_id: nextRecordId_(rows), member_name: r.member_name, event_id: event.event_id, event_name: event.event_name, time_ms: String(timeMs), time_display: formatTime_(timeMs), competition: r.competition, competition_date: r.competition_date, note: r.note, proof_photo_url: r.proof_photo_url, created_at: new Date().toISOString() });
  return eventAdded;
}
function approveDelete_(r) {
  const rows = records_(), next = rows.filter(row => row.record_id !== r.record_id);
  if (rows.length === next.length) return false;
  writeCsv_('data/records.csv', RECORD_COLUMNS, next, 'Approve record deletion ' + r.request_id);
  return true;
}
function competitionApprovalContext_() {
  return { rows: competitionRecords_(), competitions: competitions_(), competitionEvents: competitionEvents_(), competitionDivisions: competitionDivisions_(), competitionAdded: false, eventAdded: false, divisionAdded: false };
}
function appendApprovedCompetitionAdd_(r, context) {
  const source = JSON.parse(r.source_json || '{}'), rows = context.rows, competitions = context.competitions, competitionEvents = context.competitionEvents, competitionDivisions = context.competitionDivisions;
  let competition = competitions.find(c => c.competition_id === (r.event_id || source.competitionId));
  if (!competition && clean_(r.event_name)) competition = competitions.find(c => c.competition_name.toLowerCase() === r.event_name.toLowerCase());
  if (!competition && clean_(r.event_name)) {
    competition = { competition_id: 'competition-' + randomId_(), competition_name: r.event_name };
    competitions.push(competition);
    context.competitionAdded = true;
  }
  if (!competition) throw new Error('대회가 삭제되어 승인할 수 없습니다.');
  let competitionEvent = competitionEvents.find(e => e.competition_event_id === source.competitionEventId);
  if (!competitionEvent && clean_(source.competitionEventName)) competitionEvent = competitionEvents.find(e => e.competition_event_name.toLowerCase() === clean_(source.competitionEventName).toLowerCase());
  if (!competitionEvent && clean_(source.competitionEventName)) {
    competitionEvent = { competition_event_id: 'competition-event-' + randomId_(), competition_event_name: clean_(source.competitionEventName) };
    competitionEvents.push(competitionEvent);
    context.eventAdded = true;
  }
  if (!competitionEvent) throw new Error('대회 종목이 삭제되어 승인할 수 없습니다.');
  let competitionDivision = competitionDivisions.find(d => d.competition_division_id === source.competitionDivisionId);
  if (!competitionDivision && clean_(source.competitionDivisionName)) competitionDivision = competitionDivisions.find(d => d.competition_division_name.toLowerCase() === clean_(source.competitionDivisionName).toLowerCase());
  if (!competitionDivision && clean_(source.competitionDivisionName)) {
    competitionDivision = { competition_division_id: 'division-' + randomId_(), competition_division_name: clean_(source.competitionDivisionName) };
    competitionDivisions.push(competitionDivision);
    context.divisionAdded = true;
  }
  if (!competitionDivision) throw new Error('나이대가 삭제되어 승인할 수 없습니다.');
  rows.push({
    record_id: nextCompetitionRecordId_(rows), member_name: r.member_name,
    competition_id: competition.competition_id, competition_name: competition.competition_name,
    competition_event_id: competitionEvent.competition_event_id, competition_event_name: competitionEvent.competition_event_name,
    competition_division_id: competitionDivision.competition_division_id, competition_division_name: competitionDivision.competition_division_name,
    year: String(Number(source.year || r.competition_date)), competition_type: clean_(source.competitionType) || 'water',
    is_cox: source.isCox === true || String(source.isCox) === '1' ? '1' : '0', gold: String(Number(source.gold || 0)),
    silver: String(Number(source.silver || 0)), bronze: String(Number(source.bronze || 0)),
    note: r.note, created_at: new Date().toISOString(), lineup_group_id: clean_(source.lineupGroupId)
  });
}
function writeCompetitionApprovals_(context, message) {
  if (context.competitionAdded) writeCsv_('data/competitions.csv', ['competition_id','competition_name'], context.competitions, message);
  if (context.eventAdded) writeCsv_('data/competition_events.csv', ['competition_event_id','competition_event_name'], context.competitionEvents, message);
  if (context.divisionAdded) writeCsv_('data/competition_divisions.csv', ['competition_division_id','competition_division_name'], context.competitionDivisions, message);
  writeCsv_('data/competition_records.csv', COMPETITION_RECORD_COLUMNS, context.rows, message);
}
function approveCompetitionAdd_(r) {
  const context = competitionApprovalContext_();
  appendApprovedCompetitionAdd_(r, context);
  writeCompetitionApprovals_(context, 'Approve competition record request ' + r.request_id);
}
function approveCompetitionAdds_(requests) {
  const context = competitionApprovalContext_();
  requests.forEach(request => appendApprovedCompetitionAdd_(request, context));
  writeCompetitionApprovals_(context, 'Approve ' + requests.length + ' selected competition record requests');
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

function approvedTeamKey_(row) {
  return row.lineup_group_id || [row.year,row.competition_id,row.competition_event_id,row.competition_division_id,row.gold > 0 ? 'gold' : row.silver > 0 ? 'silver' : row.bronze > 0 ? 'bronze' : 'participation',row.note || ''].join('\0');
}
function sameApprovedRecord_(a, b, columns) {
  return b && typeof b === 'object' && columns.every(key => String(a[key] || '') === String(b[key] || ''));
}
function saveApprovedRecord_(p) {
  if (!['ergo','competition'].includes(p.kind)) throw new Error('기록 종류를 확인해 주세요.');
  if (!p.changes || typeof p.changes !== 'object' || Array.isArray(p.changes)) throw new Error('수정 내용을 확인해 주세요.');
  const competition = p.kind === 'competition', path = competition ? 'data/competition_records.csv' : 'data/records.csv';
  const columns = competition ? COMPETITION_RECORD_COLUMNS : RECORD_COLUMNS;
  const allowed = competition ? ['member_name','competition_id','competition_event_id','competition_division_id','year','competition_type','is_cox','gold','silver','bronze','note'] : ['member_name','event_id','time_display','competition','competition_date','note'];
  if (!Object.keys(p.changes).length || Object.keys(p.changes).some(key => !allowed.includes(key))) throw new Error('수정할 수 없는 항목입니다.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const snapshot = githubGet_(path), rows = parseCsvObjects_(snapshot.content);
    const row = rows.find(record => record.record_id === p.recordId);
    if (!row || !sameApprovedRecord_(row, p.expectedRecord, columns)) throw new Error('기록이 변경되었거나 삭제되었습니다. 새로 조회한 뒤 수정해 주세요.');
    const next = Object.assign({}, row);
    Object.keys(p.changes).forEach(key => { next[key] = String(p.changes[key] == null ? '' : p.changes[key]).trim(); });
    if (!next.member_name || next.member_name.length > 50 || next.note.length > 300) throw new Error('이름은 1~50자, 메모·팀명은 300자 이하여야 합니다.');
    let team = [row];
    if (competition) {
      const race = competitions_().find(item => item.competition_id === next.competition_id);
      const event = competitionEvents_().find(item => item.competition_event_id === next.competition_event_id);
      const division = competitionDivisions_().find(item => item.competition_division_id === next.competition_division_id);
      if (!race || !event || !division) throw new Error('기준정보에 등록된 대회, 종목, 나이대를 선택해 주세요.');
      next.competition_name = race.competition_name;
      next.competition_event_name = event.competition_event_name;
      next.competition_division_name = division.competition_division_name;
      if (!['0','1'].includes(next.is_cox) || !/^\d{4}$/.test(next.year) || !['gold','silver','bronze'].every(key => /^\d{1,2}$/.test(next[key]))) throw new Error('연도, 역할, 메달 수를 확인해 주세요.');
      validateCompetitionAdd_({ memberName: next.member_name, competitionId: next.competition_id, competitionEventId: next.competition_event_id, competitionDivisionId: next.competition_division_id, year: Number(next.year), competitionType: next.competition_type, gold: Number(next.gold), silver: Number(next.silver), bronze: Number(next.bronze) });
      if (p.applyToTeam === true) {
        team = rows.filter(record => approvedTeamKey_(record) === approvedTeamKey_(row));
        const expected = p.expectedTeamRecords;
        if (!Array.isArray(expected) || expected.length !== team.length || new Set(expected.map(record => record.record_id)).size !== team.length || team.some(record => !sameApprovedRecord_(record, expected.find(item => item.record_id === record.record_id), columns))) throw new Error('팀 기록이 변경되었습니다. 새로 조회한 뒤 수정해 주세요.');
        // Only shared race fields propagate; each athlete keeps their name and role.
        const shared = ['competition_id','competition_name','competition_event_id','competition_event_name','competition_division_id','competition_division_name','year','competition_type','gold','silver','bronze','note'];
        team.forEach(record => shared.forEach(key => { record[key] = next[key]; }));
      }
    } else {
      const event = events_().find(item => item.event_id === next.event_id), timeMs = parseTimeMs_(next.time_display);
      const date = new Date(next.competition_date + 'T00:00:00Z');
      if (!event || !timeMs || !/^\d{4}-\d{2}-\d{2}$/.test(next.competition_date) || Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== next.competition_date || next.competition.length > 100) throw new Error('종목, 기록, 날짜, 대회/장소를 확인해 주세요.');
      next.event_name = event.event_name;
      next.time_ms = String(timeMs);
      next.time_display = formatTime_(timeMs);
    }
    Object.assign(row, next);
    writeCsv_(path, columns, rows, 'Edit approved ' + p.kind + ' record ' + row.record_id + (team.length > 1 ? ' and team (' + team.length + ')' : ''), snapshot.sha);
    return { updatedCount: team.length };
  } finally { lock.releaseLock(); }
}
function records_() { return readCsv_('data/records.csv'); }
function events_() { return readCsv_('data/events.csv'); }
function competitionDates_() { return readCsv_('data/competition_dates.csv'); }
function competitionDateCatalog_() {
  const names = new Map(competitions_().map(c => [c.competition_id, c.competition_name]));
  const dates = new Map(competitionDates_().map(row => [row.year + '\0' + row.competition_id, row.competition_date]));
  const entries = new Map();
  competitionRecords_().forEach(row => {
    const key = row.year + '\0' + row.competition_id;
    if (!entries.has(key)) entries.set(key, {
      competition_id: row.competition_id, competition_name: names.get(row.competition_id) || row.competition_name,
      year: Number(row.year), competition_date: dates.get(key) || ''
    });
  });
  return [...entries.values()].sort((a,b) => b.year - a.year || b.competition_date.localeCompare(a.competition_date) || a.competition_name.localeCompare(b.competition_name, 'ko'));
}
function saveCompetitionDates_(p) {
  if (!Array.isArray(p.dates) || !p.dates.length || p.dates.length > 100) throw new Error('저장할 대회 날짜를 1~100건 지정해 주세요.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const available = new Set(competitionRecords_().map(row => row.year + '\0' + row.competition_id));
    const seen = new Set();
    const edits = p.dates.map(row => {
      const year = Number(row.year), id = clean_(row.competitionId), date = row.date;
      const key = year + '\0' + id;
      if (!Number.isInteger(year) || year < 1900 || year > 2100 || !available.has(key)) throw new Error('기록에 있는 연도와 대회만 날짜를 지정할 수 있습니다.');
      if (seen.has(key)) throw new Error('같은 연도와 대회가 중복되었습니다.');
      seen.add(key);
      if (typeof date !== 'string') throw new Error('날짜를 YYYY-MM-DD 형식으로 입력해 주세요.');
      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜를 YYYY-MM-DD 형식으로 입력해 주세요.');
        const parsed = new Date(date + 'T00:00:00Z');
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) throw new Error('실제 존재하는 날짜를 입력해 주세요.');
        if (Number(date.slice(0,4)) !== year) throw new Error('개최일의 연도는 해당 대회 연도와 같아야 합니다.');
      }
      return { key: key, competition_id: id, year: String(year), competition_date: date };
    });
    const dates = new Map(competitionDates_().map(row => [row.year + '\0' + row.competition_id, row]));
    edits.forEach(row => {
      if (row.competition_date) dates.set(row.key, row);
      else dates.delete(row.key);
    });
    writeCsv_('data/competition_dates.csv', ['competition_id','year','competition_date'], [...dates.values()].sort((a,b) => Number(b.year) - Number(a.year) || a.competition_id.localeCompare(b.competition_id)), 'Update competition dates');
    return { savedCount: edits.length, competitionDates: competitionDateCatalog_() };
  } finally { lock.releaseLock(); }
}
function competitions_() { return readCsv_('data/competitions.csv'); }
function competitionEvents_() { return readCsv_('data/competition_events.csv'); }
function competitionDivisions_() { return readCsv_('data/competition_divisions.csv'); }
function competitionRecords_() { return readCsv_('data/competition_records.csv'); }
function readCsv_(path) { return parseCsvObjects_(githubGet_(path).content); }
function parseCsvObjects_(text) {
  const rows = Utilities.parseCsv(text);
  const headers = rows.shift();
  return rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(headers.map((h,i) => [h, r[i] || ''])));
}
function writeCsv_(path, headers, rows, message, expectedSha) {
  const content = [headers.join(',')].concat(rows.map(r => headers.map(h => csvValue_(r[h])).join(','))).join('\n') + '\n';
  githubPut_(path, content, message, expectedSha);
}
function csvValue_(value) { const text = String(value == null ? '' : value); return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }
function githubGet_(path) {
  const url = githubUrl_(path);
  const response = UrlFetchApp.fetch(url, { headers: githubHeaders_(), muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('GitHub 파일을 읽지 못했습니다: ' + response.getResponseCode());
  const body = JSON.parse(response.getContentText());
  return { sha: body.sha, content: Utilities.newBlob(Utilities.base64Decode(body.content.replace(/\n/g,''))).getDataAsString('UTF-8') };
}
function githubPut_(path, content, message, expectedSha) {
  const current = githubGet_(path);
  if (expectedSha && current.sha !== expectedSha) throw new Error('기록이 변경되었습니다. 새로 조회한 뒤 수정해 주세요.');
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
