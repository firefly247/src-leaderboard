# Indoor Rowing Erg Leaderboard

Google Spreadsheet의 기록을 읽어 500M·1000M·2000M 거리별 개인 최고기록(PB), 전체 순위, Top 3를 보여주는 정적 리더보드입니다. 서버 없이 GitHub Pages에서 실행됩니다.

## 주요 기능

- 거리별 개인 PB와 동률 순위 자동 계산
- 거리별 Top 3와 회원별 전체 PB
- 이름 검색과 모바일 반응형 화면
- Google Spreadsheet를 단일 데이터 원본으로 사용
- GitHub Pages 무료 자동 배포

## Google Spreadsheet 설정

현재 연결된 문서:

```text
https://docs.google.com/spreadsheets/d/1qF0k-jsI9gqmMvA_IjT03duBjukT56PbjVQv6PsAcm0/edit?gid=90249257
```

정적 웹사이트에서 읽을 수 있도록 Google Sheets의 `공유`에서 일반 액세스를 **링크가 있는 모든 사용자 · 뷰어**로 설정해야 합니다. 편집 권한은 공개하지 마세요.

첫 행에는 다음 영문 헤더를 권장합니다.

```text
id | member_name | event | time_ms | time_display | competition | competition_date | note | created_at
```

`이름`, `종목`, `기록`, `대회명`, `대회일자`와 같은 한글 헤더도 지원합니다. 기록은 다음 중 하나로 입력할 수 있습니다.

- `time_ms`: 밀리초 정수, 예: `92000`
- `time_display` 또는 `기록`: `1:32.0` 형식

지원 종목은 `500M`, `1000M`, `2000M`입니다. 시트 내용을 수정하면 방문자가 페이지를 새로고침할 때 바로 반영됩니다.

## 로컬 확인

브라우저의 파일 보안 정책 때문에 `index.html`을 직접 열기보다 간단한 로컬 웹 서버를 사용합니다.

```bash
python -m http.server 8000
```

그다음 `http://localhost:8000`에 접속합니다.

## GitHub Pages 배포

1. GitHub 저장소의 `Settings` → `Pages`로 이동합니다.
2. `Build and deployment`의 Source를 **GitHub Actions**로 선택합니다.
3. 변경사항을 `main` 브랜치에 push합니다.
4. 저장소의 `Actions` 탭에서 `Deploy GitHub Pages` 완료를 확인합니다.

배포 주소:

```text
https://firefly247.github.io/src-leaderboard/
```

```bash
git add .
git commit -m "Convert leaderboard to GitHub Pages"
git push
```

## 데이터 및 보안

GitHub Pages에는 비밀 환경변수나 서비스 계정 키를 넣을 수 없습니다. Spreadsheet는 읽기 전용으로만 공개하고, 기록 편집은 Google Sheets 권한을 가진 운영자가 시트에서 직접 수행합니다.

`data/records.csv`는 이전 데이터의 로컬 백업이며 웹사이트에서는 읽지 않습니다. Spreadsheet에 데이터가 모두 옮겨졌음을 확인한 뒤 필요하면 삭제할 수 있습니다.
