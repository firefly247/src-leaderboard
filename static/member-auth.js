(() => {
  'use strict';
  const SESSION = 'srcKakaoSession', PENDING = 'srcKakaoPending';
  const button = document.querySelector('#kakaoLogin'), logout = document.querySelector('#memberLogout'), status = document.querySelector('#memberAuthStatus');
  let session = null, enabled = false;
  function render() {
    button.hidden = Boolean(session); button.disabled = !enabled;
    logout.hidden = !session;
    status.textContent = session ? `${session.member.nickname}님` : enabled ? '' : '카카오 로그인 준비 중';
  }
  function clear() { session = null; sessionStorage.removeItem(SESSION); render(); }
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const verifier = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const proofHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      const result = await api('kakaoLoginStart', { proofHash });
      const url = new URL(result.authorizeUrl);
      if (url.origin !== 'https://kauth.kakao.com' || url.pathname !== '/oauth/authorize') throw new Error('로그인 주소를 확인하지 못했습니다.');
      sessionStorage.setItem(PENDING, JSON.stringify({ state: result.state, verifier, expiresAt: Date.now() + 600000, returnHash: location.hash }));
      location.assign(url.href);
    } catch (error) { render(); status.textContent = error.message || '로그인을 시작하지 못했습니다.'; }
  });
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try { await api('kakaoLogout', { memberToken: session.memberToken }); clear(); }
    catch (_) { status.textContent = '로그아웃하지 못했습니다. 다시 눌러 주세요.'; }
    finally { logout.disabled = false; }
  });
  (async () => {
    try {
      const config = await api('kakaoAuthConfig'); enabled = config.enabled === true;
      let saved;
      try { saved = JSON.parse(sessionStorage.getItem(SESSION)); } catch (_) { sessionStorage.removeItem(SESSION); }
      if (saved && saved.memberToken) {
        const result = await api('kakaoSession', { memberToken: saved.memberToken });
        if (result.member) { session = { memberToken: saved.memberToken, ...result }; sessionStorage.setItem(SESSION, JSON.stringify(session)); }
        else sessionStorage.removeItem(SESSION);
      }
      render();
    } catch (_) { render(); status.textContent = '카카오 로그인에 연결하지 못했습니다.'; }
  })();
})();
