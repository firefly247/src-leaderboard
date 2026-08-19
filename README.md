# 실내 조정 에르고 리더보드

GitHub Pages의 공개 UI, 저장소의 CSV를 최종 승인 기록 저장소, Google Apps Script를 요청·관리 API로 사용하는 리더보드입니다.

## 구조

- data/records.csv: 승인된 기록의 최종 저장소입니다. 기존 이름·종목·기록·대회·날짜·메모 구조를 유지하고 정확한 삭제를 위한 record_id를 추가했습니다.
- data/events.csv: event_id, event_name으로 관리되는 동적 종목 목록입니다. 기본값은 500m, 1000m, 2000m입니다.
- apps-script/Code.gs: 비밀번호 인증, 요청 이력, Drive 사진 저장, GitHub API 커밋을 처리하는 서버 코드입니다.
- GitHub Pages: CSV를 읽어 리더보드, 신청, 관리자 화면을 제공합니다. 민감정보는 포함하지 않습니다.

## Apps Script 배포

1. 새 Apps Script 프로젝트를 만들고 apps-script/Code.gs를 붙여 넣습니다.
2. 비공개 Google Spreadsheet를 하나 만들고, 해당 ID와 Drive 증빙사진 폴더 ID를 준비합니다. 이 시트는 요청 및 처리 이력 전용이며 공개 기록 저장소가 아닙니다.
3. 프로젝트 설정의 Script Properties에 다음 값을 등록합니다.

| 키 | 값 |
| --- | --- |
| ADMIN_PASSWORD | 관리자 비밀번호 |
| GITHUB_TOKEN | Contents 읽기/쓰기 권한이 있는 GitHub Fine-grained PAT |
| GITHUB_OWNER | 예: firefly247 |
| GITHUB_REPO | 예: src-leaderboard |
| GITHUB_BRANCH | 선택값, 기본 main |
| REQUEST_SHEET_ID | 비공개 이력 Spreadsheet ID |
| PROOF_DRIVE_FOLDER_ID | 증빙사진 Drive 폴더 ID |

4. Apps Script를 웹 앱으로 배포합니다. 실행 주체는 배포자, 액세스 권한은 신청자가 API에 접근할 수 있는 범위로 설정합니다.
5. 배포된 /exec URL을 static/leaderboard.js의 API_URL에 넣습니다. 이 URL은 공개되어도 되며, 비밀번호·PAT는 절대 프런트엔드에 넣지 않습니다.
6. GitHub Pages 설정에서 이 저장소의 기본 브랜치를 배포 원본으로 지정합니다.

## 동작 및 보안

- 공개 사용자는 사진을 브라우저에서 JPEG로 자동 리사이즈/압축한 뒤(500KB 이하) 기록을 요청합니다. 요청은 승인 전 records.csv를 변경하지 않습니다.
- 신규 회원은 첫 기록이 승인되는 시점에 records.csv에 나타나므로 이후 회원 목록에 가나다순으로 자동 표시됩니다.
- 관리자는 단일 비밀번호로 인증하고, 승인 시 Apps Script가 GitHub Contents API로 CSV를 수정하고 commit합니다. 거절은 CSV를 변경하지 않습니다.
- 삭제 승인에는 항상 record_id를 사용합니다. 요청 원본, 요청/처리 시각, 상태, 결과, 사유는 이력 시트에서 삭제하지 않고 보관합니다.
- 종목 이름 변경은 event_id를 유지합니다. 연결 기록이 하나라도 있으면 종목 삭제가 거부됩니다.
- Drive 사진은 링크가 있는 누구나 볼 수 있게 저장되며, 승인된 기록 숫자만 사진 팝업 링크가 됩니다.

## 로컬 확인

~~~powershell
python -m http.server 8000
~~~

브라우저에서 http://localhost:8000을 엽니다. 기록 신청/관리 API는 Apps Script URL을 설정한 배포 환경에서 검증합니다.

## 검증 시나리오

1. 새 회원의 기록·사진을 신청하고 관리자에서 승인합니다. records.csv의 GitHub commit과 리더보드 반영을 확인합니다.
2. 회원 상세에서 삭제 요청을 만들고 승인합니다. 해당 record_id 한 건만 사라지는지 확인합니다.
3. 종목을 추가·이름 수정하고, 기록이 없는 종목만 삭제되는지 확인합니다.
4. 사진이 있는 승인 기록의 시간 숫자를 눌러 Drive 사진 모달이 열리는지 모바일/데스크톱에서 확인합니다.
