# 카카오 로그인 설정

회원 로그인과 기존 운영진 비밀번호 인증은 별개입니다. 카카오 닉네임으로 운영진 권한이나 선수 명단의 실명을 자동 연결하지 않습니다. 공개 기록과 참가 명단은 로그인 없이 조회하며, 참가 신청은 카카오 로그인과 선수 연결 승인이 필요합니다.

## 카카오 디벨로퍼스

1. 클럽용 앱을 만들고 웹 사이트 도메인에 `https://firefly247.github.io`를 등록합니다.
2. 카카오 로그인을 활성화합니다.
3. REST API 키의 Redirect URI에 다음 주소를 정확히 등록합니다.

   `https://rssdactzolryhfyfinon.supabase.co/auth/v1/callback`

4. 동의항목에서 닉네임(`profile_nickname`)을 설정합니다. 이메일(`account_email`)과 프로필 사진(`profile_image`)은 사용 안 함으로 유지합니다. 로그인 요청에 `queryParams: { scope: 'profile_nickname' }`을 지정하여 Supabase의 기본 세 항목 요청을 닉네임만으로 대체합니다. `options.scopes`는 기본 항목에 추가하므로 이 목적으로 쓰지 않습니다. 실제 Supabase → 카카오 인가 URL에서 닉네임만 요청하는 것을 확인했습니다. 이메일 없는 가입 허용은 반환 이메일을 필수로 검사하지 않게 하는 별도 설정입니다. 현재 OAuth 방식에는 OpenID Connect 활성화가 필수는 아닙니다.
5. REST API 키와 Client Secret을 확인합니다. Client Secret은 활성화한 상태로 유지합니다.

## Supabase

Authentication → Sign In / Providers → Kakao에서 아래 값을 저장합니다. 비밀키는 채팅, 저장소, 브라우저 코드에 입력하지 않습니다.

| 속성 | 값 |
| --- | --- |
| Kakao enabled | ON |
| REST API Key | 카카오 앱의 REST API 키 |
| Client Secret Code | 해당 REST API 키의 Client Secret |
| Allow users without an email | ON |

2026-10-26에 두 키의 저장 여부와 두 스위치 ON을 새로 불러와 확인했습니다. 카카오 로그인 페이지까지 이동은 확인했으며 실제 계정 로그인·동의·복귀는 별도 확인이 필요합니다.

Site URL은 `https://firefly247.github.io/src-leaderboard/`, Redirect allow list는 정확히 `https://firefly247.github.io/src-leaderboard/static/auth-callback.html`입니다.

첫 로그인 → 본인 선수 이름 검색·선택 → **가입 신청** → 운영진 승인 순서입니다. 이름 선택만으로 요청이 저장되지 않습니다. 다음 로그인에는 승인 대기 상태를 표시하며 이미 연결된 회원은 가입 단계를 건너뜁니다. 운영진은 관리자 → 기준정보 관리 → 회원 계정 연결에서 승인·거절합니다.

공식 Supabase SDK의 PKCE로 동일 브라우저에서 인증을 완료하고 사이트 세션을 저장합니다. 가입·로그인 후에는 홈으로 돌아오며 주말 훈련으로 자동 이동하지 않습니다. 홈에서 최초 선수 선택과 가입 신청만 진행합니다. 주말 훈련 투표는 로그인과 선수 연결 승인이 모두 유효할 때만 활성화되며 서버에서도 동일하게 검사합니다. 회원 로그아웃은 사이트 세션을 종료하며 카카오 계정 자체를 로그아웃하지는 않습니다. 기존 Android APK는 외부 브라우저 이동에 따른 PKCE 호환성 확인이 별도로 필요합니다.

이전 Apps Script 카카오 인증과 `static/kakao-callback.html`은 새 로그인 경로에 사용하지 않습니다. 기존 웹 앱은 실제 새 로그인 확인 후 보관 처리해야 합니다. [독립 API 이전 상태](../supabase/INDEPENDENT-API.md)를 참고하세요.

공식 문서: [REST API](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [설정](https://developers.kakao.com/docs/en/kakaologin/prerequisite).
