# 카카오 로그인 설정

회원 로그인과 기존 운영진 비밀번호 인증은 별개입니다. 카카오 닉네임으로 운영진 권한이나 선수 명단의 실명을 자동 연결하지 않습니다. 현재는 로그인 상태와 닉네임을 표시하며 기존 참가 신청/조회는 로그인 없이도 사용할 수 있습니다.

## 카카오 디벨로퍼스

1. 클럽용 앱을 만들고 웹 사이트 도메인에 `https://firefly247.github.io`를 등록합니다.
2. 카카오 로그인을 활성화합니다.
3. REST API 키의 Redirect URI에 다음 주소를 정확히 등록합니다.

   `https://firefly247.github.io/src-leaderboard/static/kakao-callback.html`

4. 동의항목에서 닉네임(`profile_nickname`)을 설정합니다. 이메일, 생일, 친구 목록 등의 권한은 요청하지 않습니다.
5. REST API 키와 Client Secret을 확인합니다. Client Secret은 활성화한 상태로 유지합니다.

## Apps Script

프로젝트 설정 → 스크립트 속성에 아래 값을 추가합니다. 비밀키는 채팅, 저장소, 브라우저 코드에 입력하지 않습니다.

| 속성 | 값 |
| --- | --- |
| `KAKAO_REST_API_KEY` | 카카오 앱의 REST API 키 |
| `KAKAO_CLIENT_SECRET` | 해당 REST API 키의 Client Secret |

`Code.gs`의 카카오 액션 라우트와 `KakaoAuth.gs`를 Apps Script에 반영하고, 기존 웹 앱 배포를 새 버전으로 업데이트해야 합니다. `CLASPRC_JSON`이 없는 현재 CI에서는 서버 코드 배포가 자동으로 수행되지 않습니다.

두 속성이 모두 있으면 로그인 버튼이 활성화됩니다. 배포 후 휴대전화에서 로그인 → 동의 → 원래 화면 복귀 → 닉네임 표시 → 회원 로그아웃을 확인하세요. 동의 취소와 새로 로그인도 확인해야 합니다. 키 미설정 상태나 모의 테스트 통과만으로 실제 로그인이 검증된 것은 아닙니다.

사이트 세션은 최대 6시간 유지되며 서버 캐시가 비워지면 다시 로그인해야 합니다. 회원 로그아웃은 이 사이트의 세션을 종료하며 카카오 계정 자체를 로그아웃하지는 않습니다. 카카오 access/refresh token은 브라우저에 전달하거나 저장하지 않습니다.

공식 문서: [REST API](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [설정](https://developers.kakao.com/docs/en/kakaologin/prerequisite).
