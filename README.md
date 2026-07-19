# Swim Leaderboard

Google Sheets를 데이터 저장소로 사용하는 Flask 기반 수영 기록 리더보드입니다. 관리자 화면에서 기록을 직접 입력하거나 CSV로 일괄 업로드할 수 있고, 500M·1000M·2000M 종목별 개인 최고기록(PB)과 Top 3를 자동 계산합니다.

## 주요 기능

- 종목별 Top 3와 전체 순위
- 회원별 500M·1000M·2000M PB
- 관리자 비밀번호 로그인
- 웹 기록 직접 입력·삭제
- CSV 업로드, 형식 검증, 중복 제외
- Google Sheets 또는 로컬 CSV 저장소
- 모바일 반응형 화면

## 1. 로컬 실행

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env   # Windows
# cp .env.example .env   # macOS/Linux
python app.py
```

`http://localhost:5000`에 접속합니다. 초기 설정은 `DATA_BACKEND=csv`이며 샘플 기록이 표시됩니다. 관리자 초기 비밀번호는 `.env`의 `ADMIN_PASSWORD`로 변경해야 합니다.

## 2. Google Sheets 준비

새 스프레드시트를 만든 뒤 서비스 계정 이메일을 **편집자**로 공유합니다. `Records` 시트는 비어 있어도 되며 앱이 첫 행 헤더를 자동 생성합니다. 기존 시트에 직접 헤더를 만들 경우 아래 순서를 정확히 사용합니다.

```text
id | member_name | event | time_ms | time_display | competition | competition_date | note | created_at
```

기존 스프레드시트의 URL에서 `/d/`와 `/edit` 사이 문자열이 `SPREADSHEET_ID`입니다.

## 3. Google 서비스 계정 만들기

1. Google Cloud Console에서 프로젝트를 생성합니다.
2. Google Sheets API와 Google Drive API를 활성화합니다.
3. 서비스 계정을 만들고 JSON 키를 발급합니다.
4. JSON의 `client_email` 값을 스프레드시트 편집자로 공유합니다.
5. JSON 키 파일은 GitHub에 절대 커밋하지 않습니다.

로컬 `.env` 예시:

```env
DATA_BACKEND=sheets
FLASK_SECRET_KEY=충분히-긴-임의문자열
ADMIN_PASSWORD=강한-관리자-비밀번호
SPREADSHEET_ID=스프레드시트_ID
WORKSHEET_NAME=Records
GOOGLE_SERVICE_ACCOUNT_FILE=service-account.json
```

배포 환경에서는 파일 대신 JSON 전체를 `GOOGLE_SERVICE_ACCOUNT_JSON` 환경변수에 넣는 방식을 권장합니다.

## 4. CSV 형식

UTF-8 CSV를 사용합니다. 한글·영문 헤더를 모두 지원합니다.

```csv
이름,종목,기록,대회명,대회일자,비고
권철희,500M,1:32.0,용인대회,2026-02-07,
김기현,1000M,3:24.5,용인실내대회,2026-03-14,
```

필수 열은 `이름`, `종목`, `기록`입니다. 종목은 `500M`, `1000M`, `2000M`, 기록은 `1:32.0` 또는 `92.0`, 날짜는 `YYYY-MM-DD` 형식입니다. 동일한 이름·종목·기록·대회명·대회일 조합은 중복으로 제외됩니다.

## 5. GitHub 업로드

```bash
git init
git add .
git commit -m "Initial swim leaderboard"
git branch -M main
git remote add origin https://github.com/YOUR_ID/YOUR_REPOSITORY.git
git push -u origin main
```

`.env`와 서비스 계정 JSON은 `.gitignore`에 포함되어 있습니다. GitHub 저장소에 인증정보가 올라가지 않았는지 반드시 확인합니다.

## 6. Render 배포

저장소에 포함된 `render.yaml`을 사용하거나 Render에서 Web Service를 생성합니다.

- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app`
- 환경변수: `DATA_BACKEND=sheets`, `ADMIN_PASSWORD`, `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`

무료 인스턴스는 일정 시간 사용하지 않으면 휴면 상태가 될 수 있습니다. 데이터는 Google Sheets에 저장되므로 서버 재시작 시에도 유지됩니다.

## 보안 주의사항

관리자 비밀번호와 서비스 계정 JSON을 코드에 직접 작성하지 마세요. 공개 운영 시에는 관리자 비밀번호를 충분히 길게 설정하고, Render/Vercel/Railway 등의 환경변수 저장소를 사용해야 합니다.

## 테스트

```bash
pip install -r requirements-dev.txt
pytest -q
```

GitHub Actions 워크플로가 포함되어 있어 push와 pull request 때 기록 시간 변환 테스트를 자동 실행합니다.
