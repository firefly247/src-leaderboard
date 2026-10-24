# 삼성조정클럽 Android 앱

기존 HTTPS 사이트를 여는 작은 WebView 앱입니다. 앱 ID는 `io.github.firefly247.srcleaderboard`, 최소 Android 8.0(API 26), 대상 Android 16(API 36)입니다. 사이트 화면·기록 변경은 온라인으로 반영되며 앱 코드 변경 시에만 APK를 다시 배포합니다.

## 빌드

JDK 17 이상, Android SDK platform 36, build-tools 36.1.0이 필요합니다. Gradle wrapper는 8.13, Android Gradle Plugin은 8.13.2로 고정했습니다.

```powershell
./android/build-apk.ps1
```

다른 JDK/SDK 경로는 `-JavaDirectory`와 `-SdkDirectory`로 지정합니다. 새 앱을 처음 빌드할 때만 `-InitializeSigning`을 사용합니다. 기존 배포 앱 업데이트에는 반드시 같은 서명키를 사용해야 합니다.

`android/keystore/release.jks`와 `android/signing.properties`는 **로컬 전용이며 Git에 포함하지 않습니다.** 두 파일을 함께 안전한 곳에 백업하세요. 키를 분실하면 기존 앱을 덮어쓰는 업데이트를 만들 수 없습니다. APK에는 비밀번호나 개인키가 포함되지 않습니다.

빌드 스크립트는 release 빌드·Android lint·이동 경로 테스트·APK 서명 검사를 거친 뒤 `downloads/samsung-rowing-club.apk`와 SHA-256을 담은 `downloads/android-release.json`을 갱신합니다. 업데이트 때 `versionCode`/`versionName`, 설치창 버전, 다운로드 링크의 버전 쿼리도 함께 올립니다.

## 동작과 검증

- 클럽 사이트만 앱 내부에서 표시하고 다른 HTTPS 링크는 외부 브라우저로 엽니다.
- 인터넷 권한만 요청합니다. 사진은 사용자가 시스템 파일 선택창에서 고릅니다.
- JS 확인창, 사진 선택, 메뉴·팝업을 먼저 닫는 뒤로가기, 화면 회전, 연결 실패 재시도를 지원합니다.
- HTTP, 파일 URL, 임의 앱 실행 URL은 앱 내부에서 열지 않습니다. 인증서 오류는 WebView 기본 차단을 유지합니다.
- 웹앱 설치 버튼은 Android 앱 내부에서 숨깁니다. 휴면회원 등 표시는 사이트 정책을 그대로 따릅니다.

실기기 확인: 설치 → 메뉴 이동 → 기록 등록의 사진 선택 → 취소 → 관리자 인증/저장 팝업 → 훈련 신청 수정 → 뒤로가기와 키보드/화면 회전을 확인합니다. 검증용 기록은 실제 운영에 제출하지 마세요.

사이트 APK 직접 배포는 Play Store 배포와 다릅니다. 기기에서 설치 출처 확인이나 Play Protect 검사가 표시될 수 있으며, 경고 없는 설치를 보장하지 않습니다.
