/** Member authentication only. Never grants administrator privileges. */
const KAKAO_CALLBACK_ = 'https://firefly247.github.io/src-leaderboard/static/kakao-callback.html';
function kakaoAuthConfig_() {
  const props = properties_();
  return { enabled: Boolean(props.getProperty('KAKAO_REST_API_KEY') && props.getProperty('KAKAO_CLIENT_SECRET')), redirectUri: KAKAO_CALLBACK_ };
}
function kakaoHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function kakaoRandom_() { return Utilities.getUuid() + Utilities.getUuid(); }
function kakaoLoginStart_(p) {
  if (!kakaoAuthConfig_().enabled) throw new Error('카카오 로그인 설정이 준비되지 않았습니다.');
  if (!/^[a-f0-9]{64}$/.test(String(p.proofHash || ''))) throw new Error('로그인 요청이 올바르지 않습니다.');
  const state = kakaoRandom_();
  CacheService.getScriptCache().put('kakao-state:' + state, JSON.stringify({ hash: p.proofHash, expires: Date.now() + 600000 }), 600);
  const query = { response_type: 'code', client_id: prop_('KAKAO_REST_API_KEY'), redirect_uri: KAKAO_CALLBACK_, state: state, scope: 'profile_nickname' };
  return { state: state, authorizeUrl: 'https://kauth.kakao.com/oauth/authorize?' + Object.keys(query).map(function (k) { return k + '=' + encodeURIComponent(query[k]); }).join('&') };
}
function kakaoFetch_(url, options) {
  let response;
  try { response = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true }, options)); }
  catch (_) { throw new Error('카카오 서버에 연결하지 못했습니다. 다시 로그인해 주세요.'); }
  if (response.getResponseCode() !== 200) throw new Error('카카오 인증에 실패했습니다. 다시 로그인해 주세요.');
  try {
    // Preserve provider IDs beyond JavaScript's safe integer range.
    return JSON.parse(response.getContentText().replace(/("id"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"'));
  } catch (_) { throw new Error('카카오 인증 응답을 확인하지 못했습니다.'); }
}
function kakaoLoginComplete_(p) {
  if (!/^[a-f0-9-]{72}$/.test(String(p.state || '')) || !/^[a-f0-9]{64}$/.test(String(p.verifier || '')) || typeof p.code !== 'string' || !p.code || p.code.length > 2048)
    throw new Error('로그인 요청이 올바르지 않습니다.');
  const cache = CacheService.getScriptCache(), key = 'kakao-state:' + p.state;
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const raw = cache.get(key), pending = raw ? JSON.parse(raw) : null;
    if (!pending || pending.expires < Date.now() || pending.hash !== kakaoHash_(p.verifier)) throw new Error('로그인 요청이 만료되었거나 일치하지 않습니다. 다시 로그인해 주세요.');
    cache.remove(key);
  } finally { lock.releaseLock(); }
  const tokens = kakaoFetch_('https://kauth.kakao.com/oauth/token', { method: 'post', payload: {
    grant_type: 'authorization_code', client_id: prop_('KAKAO_REST_API_KEY'), client_secret: prop_('KAKAO_CLIENT_SECRET'), redirect_uri: KAKAO_CALLBACK_, code: p.code
  } });
  if (!tokens.access_token) throw new Error('카카오 인증을 완료하지 못했습니다.');
  const user = kakaoFetch_('https://kapi.kakao.com/v2/user/me', { method: 'get', headers: { Authorization: 'Bearer ' + tokens.access_token } });
  if (!/^\d+$/.test(String(user.id || ''))) throw new Error('카카오 회원 정보를 확인하지 못했습니다.');
  const nickname = String(((user.kakao_account || {}).profile || {}).nickname || '카카오 회원').slice(0, 80);
  const memberToken = kakaoRandom_(), expiresAt = Date.now() + 21600000;
  cache.put('kakao-member:' + kakaoHash_(memberToken), JSON.stringify({ providerId: String(user.id), nickname: nickname, expiresAt: expiresAt }), 21600);
  return { memberToken: memberToken, member: { nickname: nickname }, expiresAt: expiresAt };
}
function kakaoSession_(p) {
  if (!/^[a-f0-9-]{72}$/.test(String(p.memberToken || ''))) return { member: null };
  const raw = CacheService.getScriptCache().get('kakao-member:' + kakaoHash_(p.memberToken));
  const session = raw ? JSON.parse(raw) : null;
  return session && session.expiresAt > Date.now() ? { member: { nickname: session.nickname }, expiresAt: session.expiresAt } : { member: null };
}
function kakaoLogout_(p) {
  if (/^[a-f0-9-]{72}$/.test(String(p.memberToken || ''))) CacheService.getScriptCache().remove('kakao-member:' + kakaoHash_(p.memberToken));
  return { member: null };
}
