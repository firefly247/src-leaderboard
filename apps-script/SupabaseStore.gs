/** Dormant connection adapter. Existing storage routes do not call this module. */
function supabaseSettings_() {
  const props = properties_(), url = String(props.getProperty('SUPABASE_URL') || '').replace(/\/$/, '');
  const key = String(props.getProperty('SUPABASE_SECRET_KEY') || '');
  if (!url && !key) return null;
  // Fixed hosted origin prevents credentials being sent to arbitrary destinations.
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url) || !/^sb_secret_[A-Za-z0-9_-]+$/.test(key))
    throw new Error('Supabase 프로젝트 주소와 서버용 Secret key 설정을 확인해 주세요.');
  return { url: url, key: key };
}
function supabaseRequest_(path, method, payload) {
  const settings = supabaseSettings_();
  if (!settings) throw new Error('Supabase 연결 정보가 등록되지 않았습니다.');
  const allowed = ['events','records','competitions','competition_dates','competition_events','competition_divisions','competition_records','dormant_members','player_birth_years','weekend_training','competition_lineups','request_log'];
  if (!(path === 'rpc/club_connection_status' && method === 'post') && !(allowed.some(function (name) { return path === 'club_' + name; }) && method === 'get'))
    throw new Error('허용되지 않은 Supabase 연결 요청입니다.');
  const options = { method: method, muteHttpExceptions: true, followRedirects: false,
    headers: { apikey: settings.key, 'Content-Type': 'application/json' } };
  if (method === 'post') options.payload = JSON.stringify(payload || {});
  let response;
  try { response = UrlFetchApp.fetch(settings.url + '/rest/v1/' + path, options); }
  catch (_) { throw new Error('Supabase에 연결하지 못했습니다.'); }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300)
    throw new Error('Supabase 연결을 확인하지 못했습니다. 프로젝트 상태·키·테이블 설정을 확인해 주세요.');
  try { return JSON.parse(response.getContentText()); }
  catch (_) { throw new Error('Supabase 응답 형식을 확인하지 못했습니다.'); }
}
function supabaseConnectionStatus_() {
  if (!supabaseSettings_()) return { configured: false, connected: false, activeStorage: 'sheets-and-csv' };
  const result = supabaseRequest_('rpc/club_connection_status', 'post', {});
  if (result.schemaVersion !== '20261025130000' || result.tables !== 12) throw new Error('Supabase 테이블 버전이 일치하지 않습니다.');
  return { configured: true, connected: true, schemaVersion: result.schemaVersion, activeStorage: 'sheets-and-csv' };
}
/** Run in the owner-only Apps Script editor after setting the two properties. */
function supabaseConnectionReport() { console.log(JSON.stringify(supabaseConnectionStatus_())); }
/** Measures actual populated cell text, not Google Sheets physical disk usage. */
function databaseStorageStats_() {
  const ss = SpreadsheetApp.openById(prop_('REQUEST_SHEET_ID'));
  const sheets = ss.getSheets().map(function (sheet) {
    const rows = sheet.getLastRow(), columns = sheet.getLastColumn();
    const values = rows && columns ? sheet.getRange(1, 1, rows, columns).getDisplayValues() : [];
    const bytes = Utilities.newBlob(JSON.stringify(values), 'application/json').getBytes().length;
    return { name: sheet.getName(), rows: Math.max(0, rows - 1), columns: columns, utf8JsonBytes: bytes };
  });
  return { measuredAt: new Date().toISOString(), basis: 'UTF-8 JSON of displayed used cells, including headers', sheets: sheets,
    totalUtf8JsonBytes: sheets.reduce(function (sum, sheet) { return sum + sheet.utf8JsonBytes; }, 0) };
}
/** Run from the Apps Script editor; prints sizes/counts only, never cell values. */
function databaseStorageReport() { console.log(JSON.stringify(databaseStorageStats_())); }
