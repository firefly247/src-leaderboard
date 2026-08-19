# Google Apps Script 자동 배포

`apps-script/` 변경이 `main`에 병합되면 GitHub Actions가 동일한 웹앱 배포를 새 버전으로 갱신합니다. 따라서 아래 웹앱 URL은 바뀌지 않습니다.

`https://script.google.com/macros/s/AKfycbwxHRgWZWMisQzVIK8KogLwU2ri5EfhCnY2FqqBLm7Nb8Oo9DYNIF_L28UgMfwO9q2f/exec`

## 최초 1회 설정

1. Apps Script 설정에서 **Apps Script API**를 활성화합니다.
2. 로컬 컴퓨터에서 `npx @google/clasp login`으로 Google 계정에 로그인합니다.
3. 생성된 `~/.clasprc.json` 파일의 전체 내용을 복사합니다. 이 파일에는 Google 인증 토큰이 있으므로 저장소에 커밋하지 않습니다.
4. GitHub 저장소에서 `Settings → Secrets and variables → Actions → New repository secret`을 선택합니다.
5. 이름을 `CLASPRC_JSON`으로 하고, 값에 위 JSON 전체를 넣습니다.
6. `Actions → Deploy Google Apps Script → Run workflow`를 한 번 실행해 연결을 확인합니다.

이후 `apps-script/Code.gs` 또는 `apps-script/appsscript.json` 변경은 자동으로 같은 Deployment ID에 재배포됩니다.
