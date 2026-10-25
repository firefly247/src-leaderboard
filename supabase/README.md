# Supabase 연결 준비

**현재 상태: 2026-10-26에 클라우드 프로젝트에 테이블 12개와 연결 검사 함수를 적용했습니다. RLS 활성화 및 익명/일반 회원의 직접 조회 차단을 SQL로 검증했습니다. Apps Script의 서버 키 등록과 실제 서버 연결 검사는 아직 남아 있습니다. 데이터 이전·저장 경로 변경은 수행하지 않았습니다.**

프로젝트 주소: `https://rssdactzolryhfyfinon.supabase.co`

관리 화면: https://supabase.com/dashboard/project/rssdactzolryhfyfinon

현재 사이트는 Google Sheets와 GitHub CSV를 계속 사용합니다. Supabase 설정값을 등록해도 자동 전환하거나 이중 저장하지 않습니다. 카카오 로그인도 기존 구현을 유지합니다.

## 준비된 항목

- `migrations/20261025130000_prepare_club_storage.sql`: 기존 CSV 8종과 시트 4종에 대응하는 테이블 12개. `source-map.json`이 원본과의 대응표입니다.
- CSV와 선수 정보/요청 이력의 열은 원본처럼 문자열로 보존합니다. 훈련·대회 편성의 `session_json`은 JSONB로 저장합니다. 실제 이전 전에 새로운 시트 열과 중복 키를 점검해야 합니다.
- 테이블마다 RLS를 켜고 `PUBLIC`, `anon`, `authenticated`의 권한을 제거했습니다. 서버의 `service_role`만 읽기/쓰기할 수 있습니다. 회원용 읽기·쓰기 정책과 카카오 계정/선수 연결은 이번 단계에 포함하지 않습니다.
- `apps-script/SupabaseStore.gs`: 서버 전용 연결 검사. URL을 Supabase 호스팅 주소로 제한하고 리디렉션을 따르지 않으며, 응답에 비밀키나 원격 오류 본문을 노출하지 않습니다. 현재 어댑터는 연결 검사와 제한된 읽기만 지원합니다.
- `scripts/prepare_supabase.py --export-csv`: CSV 8종을 로컬 SQL로 내보냅니다. 자동 업로드하지 않으며 시트와 사진은 포함하지 않습니다. 출력은 Git에서 제외한 `.local/supabase/public-csv-import.sql`입니다.

## 프로젝트 생성 후 연결 절차

1. 위의 기존 프로젝트 관리 화면에 로그인합니다. 새 프로젝트를 만들 필요는 없습니다. DB 비밀번호는 본인이 보관합니다.
2. **해당 프로젝트에는 마이그레이션 SQL을 이미 적용했으므로 다시 실행하지 않습니다.** SQL Editor에서 수동 적용했으며 CLI의 migration 이력은 별도 등록하지 않았습니다. 추후 CLI를 도입하면 `20261025130000`의 적용 상태를 먼저 대조·기록한 뒤 후속 migration만 적용합니다. 운영 프로젝트를 `db reset --linked`로 초기화하지 않습니다.
3. 프로젝트의 Data API가 활성화되어 있는지 확인합니다. 이 구성은 기본 `public` 스키마의 `club_*` 테이블을 사용합니다. 브라우저에 데이터 읽기 권한은 주지 않습니다.
4. Apps Script **프로젝트 설정 → 스크립트 속성**에 다음 두 값을 입력합니다.

   | 속성 | 값 |
   | --- | --- |
   | `SUPABASE_URL` | `https://rssdactzolryhfyfinon.supabase.co` |
   | `SUPABASE_SECRET_KEY` | 서버 전용 `sb_secret_...` 키 |

   Secret key는 채팅·GitHub·프런트엔드에 넣지 않습니다. Publishable key는 이 서버 전용 구성에 사용하지 않습니다. 사용자 지정 도메인은 현재 허용하지 않습니다.
5. Apps Script 편집기에서 `supabaseConnectionReport` 함수를 실행합니다. `{configured:true, connected:true, activeStorage:"sheets-and-csv"}`이면 연결 확인 완료입니다. 배포된 API에서는 기존 관리자 인증으로 `supabaseConnectionStatus`를 호출해도 됩니다. 이 검사는 개인정보를 읽거나 쓰지 않습니다.

여기까지 진행해도 기존 저장 방식은 유지됩니다. **실제 저장소 전환에는 데이터 복사·원본 대조·쓰기 어댑터·권한 검증·전환 시점 결정이 별도로 필요합니다.** 연결값만 넣어 기존 화면이 Supabase로 전환되는 구성은 아닙니다.

## 검증

```powershell
python scripts/prepare_supabase.py
python scripts/prepare_supabase.py --export-csv
node --test tests/*.test.js
node scripts/verify_supabase_schema.mjs <로컬-PGlite-dist/index.js>
```

마지막 검증은 별도로 설치한 `@electric-sql/pglite`에서 실제 PostgreSQL SQL을 실행합니다. 테이블 12개·RLS·역할 권한·연결 함수·CSV 재입력·한국어 JSON 보존을 확인합니다. Supabase 클라우드 연결 테스트를 대체하지는 않습니다.

## 용량 확인

- `data/*.csv`는 실제 파일 바이트를 합산합니다.
- 사진은 DB 본문과 구분하여 파일 저장소 용량으로 집계합니다.
- Apps Script 편집기에서 `databaseStorageReport`를 실행하면 스프레드시트별 사용 행/열 및 **표시된 셀 데이터를 UTF-8 JSON으로 직렬화한 바이트**를 실행 로그로 확인할 수 있습니다. 셀 내용이나 비밀키는 로그에 쓰지 않습니다. Google의 실제 파일 저장 용량은 아닙니다.
- PostgreSQL에는 테이블·인덱스·시스템 데이터 등의 추가 용량이 있으므로 CSV 크기를 그대로 DB 사용량으로 보면 안 됩니다.

공식 문서: [마이그레이션](https://supabase.com/docs/guides/local-development/database-migrations), [API 보안](https://supabase.com/docs/guides/api/securing-your-api), [서버 키](https://supabase.com/docs/guides/getting-started/api-keys), [DB 용량](https://supabase.com/docs/guides/platform/database-size).
