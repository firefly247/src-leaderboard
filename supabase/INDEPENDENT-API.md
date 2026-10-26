# Apps Script 없는 운영 서버로 이전

## 실제 상태 (2026-10-26)

- 업무 DB와 운영 사이트의 요청 처리는 Supabase입니다. 최초 전환 `65414c9` 및 역할 기반 관리자 화면 `ed8d1c5`의 GitHub Pages 배포 성공을 확인했습니다. 활성 Apps Script 웹 앱 네 개(버전 23/3/2/1)를 모두 보관 처리했으며 활성 배포가 없음을 확인했습니다. 네 URL 모두 읽기 요청에 HTTP 404로 응답하여 이전 익명/비밀번호 API 우회 경로가 중지됐습니다. 프로젝트 소스와 원본 백업은 보존합니다.
- 독립 Edge Function `club-api`를 배포했습니다. 공개 조회 및 인증 없는 신청/관리자 접근 차단을 실제 API로 확인했습니다.
- 신규 SQL `20261026090000`, `20261026093000`, `20261026101500`, `20261026170000`을 실제 프로젝트에 적용했습니다. 수동 SQL 적용이므로 CLI migration 이력에 자동 등록되지는 않습니다.
- 기존 관리자 비밀번호는 서버 간 직접 전달 후 bcrypt로 보관했습니다. 브라우저 코드·Git·출력에는 비밀번호와 서버 키를 넣지 않았습니다. 새 API에서 관리자 로그인 및 선수 61명/대회 1개/훈련 2개 조회를 실제 확인했습니다.
- 기존 사진 54개를 `club-proofs`에 업로드하고 SHA-256을 대조했습니다. **10:08 KST에 운영 DB 사진 주소를 실제 Supabase Storage로 전환했습니다.** DB 버전은 2입니다. 공개 기록의 GitHub 사진 참조는 0개, 실제 이미지 다운로드와 해시도 확인했습니다.
- 카카오 앱 생성·콜백 등록 후 Supabase의 제공자 ON, REST API 키/Client Secret 저장, 이메일 없는 사용자 허용 ON을 새로 불러와 확인했습니다. 카카오 로그인 페이지까지 연결도 확인했습니다.
- 후속 요청에 따라 관리자 비밀번호 UI와 Edge의 `adminLogin` 경로를 없앴습니다. 기존 `adminToken`은 관리 권한으로 인정하지 않습니다. 모든 관리 액션은 검증된 카카오 Auth 사용자와 `club_accounts.role=admin`을 요구합니다. 사용자가 지정한 장진구 선수의 연결된 카카오 계정을 확인하고 최초 관리자 역할을 부여했습니다. 기준정보 → 회원 관리에서 전체 카카오 인증 회원을 조회하고 역할을 설정합니다. DB 함수가 마지막 관리자 해제를 직렬화하여 차단합니다.
- `static/backend-config.js`를 `ready:true`로 바꾸어 새 화면을 개통했습니다. 실제 사이트의 공개 대회 기록·기존 참가 명단 조회, 로그인 전 신청 차단, 카카오 버튼으로 인증 페이지까지 이동을 확인했습니다. 실제 장진구 선수의 카카오 인증 및 선수 연결이 저장된 것을 확인했고, 새 역할 권한을 최초 부여했습니다. 관리자 로그인/로그아웃에 따른 메뉴 표시·숨김과 회원 관리 화면은 격리된 UI 미리보기로 검증했습니다. 기존 Apps Script 없이 공개 조회와 보호 API 차단도 실제 엔드포인트에서 확인했습니다. 실제 회원의 훈련 투표 쓰기는 허위 운영 데이터를 만들지 않고 테스트로 검증합니다.

## 로그인 설명

회원은 Supabase 관리 사이트에 가입하지 않습니다. 클럽 사이트의 카카오 로그인 버튼으로 카카오가 본인 계정을 확인하고 Supabase Auth가 로그인 세션을 관리합니다.

첫 로그인 → 본인 선수 선택 → 가입 신청 → 운영진의 연결 승인 → 본인 이름으로 참가 신청 순서입니다. 공개 기록과 참가 명단은 로그인 없이 조회합니다. 이름/닉네임이 같아도 자동 연결하거나 관리자 권한을 부여하지 않습니다. 연결 요청은 운영진이 승인/거절합니다.

서버가 Supabase Auth의 사용자 API로 토큰을 검증하고, 서비스 전용 `club_accounts`에서 선수와 권한을 읽습니다. 클라이언트가 보낸 사용자 ID·선수 이름·role은 권한 근거로 쓰지 않습니다. 브라우저별 기존 신청 수정키는 운영진이 선수 연결을 승인한 뒤 해당 본인 신청에 한해서 이전합니다.

## 구성

- `club_public_read`: 공개 8개 데이터셋만 반환하는 RPC. 브라우저의 공개 키로 한 번 조회합니다. 실제 측정 0.10초/0.53초는 API 시간이며 전체 화면 표시 시간을 보장하는 수치는 아닙니다.
- `functions/club-api`: Google 서비스 호출 없이 기존 신청·승인·훈련·대회 편성 규칙을 실행합니다. 요청별 메모리 상태와 기존 행 단위 원자적 커밋/저장 버전 검사를 사용합니다. 공개 첫 화면 이외의 일부 기능은 아직 전체 업무 스냅샷을 서버 내부에서 읽습니다.
- `club_accounts`: Auth user ID, 연결된 선수, 요청한 선수, 역할, 카카오 표시 이름. 클라이언트가 직접 수정하지 못합니다.
- `club_api_limits`: 서버 전용 요청 제한. 과거 비밀번호 방식의 `club_admin_config`, `club_admin_sessions`는 비공개로 보존하지만 새 사이트/API에서는 사용하지 않습니다.
- Edge Function의 `verify_jwt=false`: 공개 조회에는 회원 JWT가 없습니다. 각 보호 액션은 함수 내부에서 검증하며, 회원 JWT는 Supabase Auth로 검증합니다. 단순한 role 문자열이나 anon 키, 예전 관리자 토큰으로 관리자 권한을 얻을 수 없습니다.
- `club-proofs`: 기존 GitHub 사진과 같은 공개 범위의 실제 이미지 저장소. 서버만 업로드하며 JPEG 150KiB 상한, SHA-256 파일명으로 중복 저장을 피합니다. 기존 비공개 백업 버킷은 변경하지 않았습니다.
- `static/vendor/supabase-2.118.0.js`: 버전을 고정한 공식 SDK 브라우저 번들. PKCE, 세션 갱신, 로그아웃을 SDK로 처리합니다. 서버 Secret/service_role 키는 포함하지 않습니다.

## 남은 개통 순서

1. 카카오 개발자 등록과 앱 생성은 사용자가 완료했습니다.
2. 카카오 OAuth redirect URI: `https://rssdactzolryhfyfinon.supabase.co/auth/v1/callback`.
3. 카카오 REST API Key와 활성화된 Client Secret을 Supabase Kakao provider에 등록합니다. 이메일이 불필요한 클럽 로그인은 `Allow users without an email` 설정을 사용할 수 있습니다. 비밀키를 채팅이나 Git에 기록하지 않습니다.
4. Supabase Site URL: `https://firefly247.github.io/src-leaderboard/`. Redirect allow list에는 정확한 `https://firefly247.github.io/src-leaderboard/static/auth-callback.html`을 등록합니다. 이 두 주소는 실제 프로젝트에 저장하고 목록에 등록된 것을 확인했습니다.
5. 카카오 제공자 설정이 완료된 뒤 새 화면을 개통하고 실제 로그인·회원 연결을 확인합니다. 테스트용 허위 훈련이나 기록을 운영 명단에 임의로 추가하지 않습니다. 신청/편성 동작은 먼저 격리된 기능 테스트로 검증하고, 실제 개설된 훈련이 있을 때 본인 계정으로 확인합니다.
6. **기존 Android APK는 외부 인증 페이지를 별도 브라우저로 여는 정책입니다. PKCE 세션이 다른 브라우저로 분리되지 않게 APK의 인증 이동을 수정·검증하거나, 개통 시 모바일 브라우저/PWA를 사용해야 합니다.** 웹 화면만 바꿔 기존 APK의 로그인까지 검증 완료했다고 간주하지 않습니다.
7. 전환 직전 추가 업로드 사진이 있는지 다시 복사·대조합니다. `IndependentSetup.gs` 최신 버전을 사용하면 새 Git blob만 추가 확인할 수 있습니다. 운영 DB는 다시 Google 원본으로 덮어쓰지 않습니다.
8. `ready:true`로 변경한 새 화면을 배포하고 실제 사이트에서 재검증합니다. 기존 관리자 Google 세션은 새 API에서 사용할 수 없어 한 번 다시 인증합니다.
9. **기존 Apps Script 웹 앱 배포를 보관 처리해 호출을 중지합니다.** 화면만 새 API로 바꾸고 기존 익명 쓰기 API를 계속 열어두면 카카오 필수 신청을 우회할 수 있습니다. 기존 자동 Apps Script 배포도 기본 비활성화하는 변경을 포함했습니다. 보관 및 차단 완료 전에는 제거 완료로 보고하지 않습니다.

이전 DB와 GitHub 사진/원본 ZIP/비공개 백업은 보존합니다. 운영 DB를 옛 원본으로 되돌리는 자동 동작은 없습니다.

## 빌드·검증·배포

```powershell
# 초기 도메인 규칙 추출 도구: Google 서비스를 호출하지 않는 독립 엔진을 생성합니다.
python scripts/build_edge_engine.py
node --test tests/*.test.js
node scripts/verify_edge_schema.mjs <PGlite-dist/index.js>
```

PGlite 검증은 실제 pgcrypto의 bcrypt, 세션 검증, 익명 접근 차단, 공개 8종 제한, 요청 횟수 제한, 기존 기록에만 있는 선수 연결을 확인합니다. 현재 Node 테스트는 140개 통과했습니다. 로컬 미리보기에서도 새 SDK의 직접 조회로 기록 150개가 표시되고, Supabase Storage 이미지가 실제로 로딩되는 것을 확인했습니다.

SDK 및 대시보드 단일 파일 배포 번들을 다시 만들려면 별도 빌드 폴더에 `@supabase/supabase-js@2.118.0`, `esbuild@0.25.12`, `@noble/hashes@1.8.0`을 설치하고 `node scripts/build_edge_assets.mjs <node_modules 경로>`를 실행합니다. 생성된 `.local/club-api-deploy.ts`는 서버 비밀키를 포함하지 않으며 대시보드 Code 편집기로 배포합니다. CLI 배포는 원본 `functions/club-api/index.ts`를 사용합니다.

`.github/workflows/deploy-supabase.yml`은 테스트 후 main에서 Edge Function만 배포합니다. `SUPABASE_ACCESS_TOKEN`은 아직 GitHub에 등록하지 않았으므로 자동 배포는 활성화되지 않았습니다. 현재 클라우드 배포는 대시보드로 수행했습니다. DB 초기 migration 이력이 정리되기 전 `db push/reset`을 자동 실행하지 않습니다.

`apps-script/IndependentSetup.gs`, `IndependentVerify.gs`는 이전 시점의 소유자 전용 일회성 도구이며 새 운영 API의 의존성이 아닙니다. 기존 Google 프로젝트와 원본은 보관할 수 있지만 새 사이트의 일반 요청은 호출하지 않도록 준비했습니다.
