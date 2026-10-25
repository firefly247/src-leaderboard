const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function fixture(configured = true) {
  const cache = new Map(), calls = [];
  const props = configured ? { KAKAO_REST_API_KEY: 'public-key', KAKAO_CLIENT_SECRET: 'private-secret' } : {};
  const ctx = {
    properties_: () => ({ getProperty: key => props[key] }),
    prop_: key => props[key],
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value), remove: key => cache.delete(key) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => crypto.randomUUID(), DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (_, value) => [...crypto.createHash('sha256').update(value).digest()] },
    UrlFetchApp: { fetch: (url, options) => { calls.push({ url, options }); return { getResponseCode: () => 200, getContentText: () => url.includes('/oauth/token') ? '{"access_token":"provider-access","refresh_token":"provider-refresh"}' : '{"id":9007199254740993123,"kakao_account":{"profile":{"nickname":"홍길동"}}}' }; } }
  };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync('apps-script/KakaoAuth.gs', 'utf8'), ctx);
  const verifier = 'a'.repeat(64), proofHash = crypto.createHash('sha256').update(verifier).digest('hex');
  return { ctx, cache, calls, verifier, proofHash };
}
test('Kakao login remains disabled without private configuration', () => {
  const { ctx, proofHash } = fixture(false);
  assert.equal(ctx.kakaoAuthConfig_().enabled, false);
  assert.throws(() => ctx.kakaoLoginStart_({ proofHash }), /준비되지/);
});
test('Kakao OAuth uses a fixed redirect and never exposes the client secret', () => {
  const { ctx, proofHash } = fixture();
  const start = ctx.kakaoLoginStart_({ proofHash });
  const url = new URL(start.authorizeUrl);
  assert.equal(url.origin, 'https://kauth.kakao.com');
  assert.equal(url.searchParams.get('redirect_uri'), ctx.kakaoAuthConfig_().redirectUri);
  assert.equal(url.searchParams.get('scope'), 'profile_nickname');
  assert.equal(JSON.stringify(start).includes('private-secret'), false);
});
test('Wrong browser proof fails before contacting Kakao; valid request is single use', () => {
  const { ctx, proofHash, verifier, calls, cache } = fixture();
  const { state } = ctx.kakaoLoginStart_({ proofHash });
  assert.throws(() => ctx.kakaoLoginComplete_({ state, verifier: 'b'.repeat(64), code: 'code' }), /일치하지/);
  assert.equal(calls.length, 0);
  const result = ctx.kakaoLoginComplete_({ state, verifier, code: 'code' });
  assert.equal(result.member.nickname, '홍길동');
  assert.equal(calls[0].options.payload.client_secret, 'private-secret');
  assert.equal(JSON.stringify(result).includes('provider-'), false);
  assert.equal(JSON.stringify(result).includes('adminToken'), false);
  const saved = [...cache.entries()].find(([key]) => key.startsWith('kakao-member:'));
  assert.equal(JSON.parse(saved[1]).providerId, '9007199254740993123');
  assert.throws(() => ctx.kakaoLoginComplete_({ state, verifier, code: 'code' }), /일치하지/);
  assert.equal(calls.length, 2);
  assert.equal(ctx.kakaoSession_({ memberToken: result.memberToken }).member.nickname, '홍길동');
  ctx.kakaoLogout_({ memberToken: result.memberToken });
  assert.equal(ctx.kakaoSession_({ memberToken: result.memberToken }).member, null);
});
test('Expired state is rejected and provider failures do not leak response bodies', () => {
  const { ctx, proofHash, verifier, cache } = fixture();
  const { state } = ctx.kakaoLoginStart_({ proofHash });
  const key = 'kakao-state:' + state, pending = JSON.parse(cache.get(key));
  pending.expires = 0; cache.set(key, JSON.stringify(pending));
  assert.throws(() => ctx.kakaoLoginComplete_({ state, verifier, code: 'code' }), /만료/);
  ctx.UrlFetchApp.fetch = () => ({ getResponseCode: () => 401, getContentText: () => 'private-secret' });
  assert.throws(() => ctx.kakaoFetch_('https://kauth.kakao.com/oauth/token', {}), error => !error.message.includes('private-secret'));
  assert.equal(ctx.kakaoSession_({ memberToken: 'invalid' }).member, null);
});

async function callback({ pending, search, response }) {
  const values = new Map(pending ? [['srcKakaoPending', JSON.stringify(pending)]] : []), calls = [], status = {};
  const location = { search, pathname: '/static/kakao-callback.html', replace: value => calls.push(value) };
  const ctx = { URLSearchParams, location, history: { replaceState: (...args) => calls.push(args) }, document: { querySelector: () => status }, sessionStorage: { getItem: k => values.get(k), removeItem: k => values.delete(k), setItem: (k, v) => values.set(k, v) }, fetch: async (_, options) => { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => response }; } };
  vm.runInNewContext(fs.readFileSync('static/kakao-callback.js', 'utf8'), ctx);
  await new Promise(resolve => setImmediate(resolve));
  return { values, calls, status };
}
test('Callback rejects cancellation and mismatched state without token exchange', async () => {
  for (const search of ['?error=access_denied', '?state=wrong&code=code']) {
    const result = await callback({ pending: { state: 'right', expiresAt: Date.now() + 10000 }, search });
    assert.equal(result.calls.length, 1); // Query removed from address bar.
    assert.ok(result.status.textContent);
    assert.equal(result.values.has('srcKakaoPending'), false);
  }
});
test('Callback stores only own member session and rejects arbitrary return destinations', async () => {
  const result = await callback({ pending: { state: 'right', verifier: 'proof', expiresAt: Date.now() + 10000, returnHash: 'https://evil.example' }, search: '?state=right&code=code', response: { ok: true, memberToken: 'own-token', member: { nickname: '회원' }, expiresAt: Date.now() + 1000 } });
  assert.equal(result.calls.at(-1), '../index.html#ergo');
  assert.equal(JSON.parse(result.values.get('srcKakaoSession')).memberToken, 'own-token');
});
