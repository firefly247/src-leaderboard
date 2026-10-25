(() => {
  'use strict';
  const endpoint = 'https://script.google.com/macros/s/AKfycbwxHRgWZWMisQzVIK8KogLwU2ri5EfhCnY2FqqBLm7Nb8Oo9DYNIF_L28UgMfwO9q2f/exec';
  const params = new URLSearchParams(location.search);
  history.replaceState(null, '', location.pathname);
  const status = document.querySelector('#authResult');
  (async () => {
    try {
      const pending = JSON.parse(sessionStorage.getItem('srcKakaoPending') || 'null');
      sessionStorage.removeItem('srcKakaoPending');
      if (params.has('error')) throw new Error('카카오 로그인이 취소되었습니다.');
      if (!pending || pending.expiresAt < Date.now() || params.get('state') !== pending.state || !params.get('code')) throw new Error('로그인 요청이 만료되었거나 일치하지 않습니다. 리더보드에서 다시 로그인해 주세요.');
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'kakaoLoginComplete', payload: { code: params.get('code'), state: pending.state, verifier: pending.verifier } }) });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.memberToken || !result.member) throw new Error(result.message || '로그인에 실패했습니다.');
      sessionStorage.setItem('srcKakaoSession', JSON.stringify({ memberToken: result.memberToken, member: result.member, expiresAt: result.expiresAt }));
      const allowed = ['#ergo', '#competition', '#athletes', '#training', '#race-lineup', '#request', '#admin'];
      location.replace('../index.html' + (allowed.includes(pending.returnHash) ? pending.returnHash : '#ergo'));
    } catch (error) { status.textContent = error.message || '로그인하지 못했습니다. 다시 시도해 주세요.'; }
  })();
})();
