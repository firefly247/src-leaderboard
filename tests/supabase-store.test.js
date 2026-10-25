const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(props = {}) {
  const calls = [];
  const ctx = { properties_: () => ({ getProperty: key => props[key] }), prop_: key => props[key],
    Utilities: { newBlob: value => ({ getBytes: () => Buffer.from(value) }) },
    UrlFetchApp: { fetch: (url, options) => { calls.push({ url, options }); return { getResponseCode: () => 200, getContentText: () => '{"schemaVersion":"20261025130000","tables":12}' }; } } };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync('apps-script/SupabaseStore.gs', 'utf8'), ctx);
  return { ctx, calls };
}
const settings = { SUPABASE_URL: 'https://' + 'a'.repeat(20) + '.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_private-test' };
test('Supabase remains dormant until configured and never changes active storage', () => {
  const { ctx, calls } = fixture();
  assert.equal(ctx.supabaseConnectionStatus_().activeStorage, 'sheets-and-csv');
  assert.equal(ctx.supabaseConnectionStatus_().configured, false);
  assert.equal(calls.length, 0);
});
test('Supabase probe keeps the secret server-side and cannot write tables', () => {
  const { ctx, calls } = fixture(settings);
  const result = ctx.supabaseConnectionStatus_();
  assert.equal(result.connected, true);
  assert.equal(result.activeStorage, 'sheets-and-csv');
  assert.equal(JSON.stringify(result).includes(settings.SUPABASE_SECRET_KEY), false);
  assert.equal(calls[0].options.headers.apikey, settings.SUPABASE_SECRET_KEY);
  assert.equal(calls[0].options.followRedirects, false);
  assert.throws(() => ctx.supabaseRequest_('club_records', 'post', [{}]), /허용되지/);
  assert.throws(() => ctx.supabaseRequest_('club_records?redirect=evil', 'get'), /허용되지/);
});
test('Invalid origins and public keys cannot receive backend credentials', () => {
  for (const url of ['http://aaaaaaaaaaaaaaaaaaaa.supabase.co', 'https://evil.example', settings.SUPABASE_URL + '.evil.example', settings.SUPABASE_URL + '/rest/v1']) {
    const { ctx, calls } = fixture({ ...settings, SUPABASE_URL: url });
    assert.throws(() => ctx.supabaseConnectionStatus_(), /설정/); assert.equal(calls.length, 0);
  }
  assert.throws(() => fixture({ ...settings, SUPABASE_SECRET_KEY: 'sb_publishable_public' }).ctx.supabaseConnectionStatus_(), /설정/);
});
test('Provider errors do not leak secrets; incompatible schema fails', () => {
  const { ctx } = fixture(settings);
  ctx.UrlFetchApp.fetch = () => ({ getResponseCode: () => 401, getContentText: () => settings.SUPABASE_SECRET_KEY });
  assert.throws(() => ctx.supabaseConnectionStatus_(), error => !error.message.includes(settings.SUPABASE_SECRET_KEY));
  ctx.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => '{"schemaVersion":"old","tables":12}' });
  assert.throws(() => ctx.supabaseConnectionStatus_(), /버전/);
});
test('Spreadsheet measurement counts UTF-8 data and reveals no cell contents', () => {
  const { ctx } = fixture({ REQUEST_SHEET_ID: 'private-id' });
  const values = [['member_name', 'birth_year'], ['홍길동', '1980']];
  ctx.SpreadsheetApp = { openById: () => ({ getSheets: () => [{ getName: () => 'PLAYER_BIRTH_YEARS', getLastRow: () => 2, getLastColumn: () => 2, getRange: () => ({ getDisplayValues: () => values }) }] }) };
  const result = ctx.databaseStorageStats_();
  assert.equal(result.totalUtf8JsonBytes, Buffer.byteLength(JSON.stringify(values)));
  assert.equal(result.sheets[0].rows, 1);
  assert.equal(JSON.stringify(result).includes('홍길동'), false);
});
test('Connection/measurement endpoints require existing administrator authentication', () => {
  const ctx = { requireAdmin_: () => { throw new Error('admin required'); }, supabaseConnectionStatus_: () => assert.fail('must not reach'), databaseStorageStats_: () => assert.fail('must not reach') };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), ctx);
  // Code.gs defines requireAdmin_; mock services so it rejects an empty token.
  for (const action of ['supabaseConnectionStatus', 'databaseStorageStats']) assert.throws(() => ctx.dispatch_(action, {}, ''), /관리자/);
});
