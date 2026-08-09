# Together Android v0.1.0

- `Together-v0.1.0.apk`: Android 기기 직접 설치용 서명 APK
- `Together-v0.1.0.aab`: Google Play 제출용 Android App Bundle
- 패키지 ID: `com.together.travel`
- 앱 버전: `0.1.0.0` (version code 1)

APK/AAB와 Android 서명 키는 Git에 포함하지 않습니다. 업데이트에 필요한 원본 서명 키는 이 PC의 `%LOCALAPPDATA%\TogetherSigning\v0.1.0`에 별도로 보관됩니다.

Android manifest를 직접 파싱한 결과 최소 SDK 23, target/compile SDK 36입니다. 따라서 2026년 8월 31일부터 적용되는 Google Play API 36 기준에 맞습니다. 실제 Play 제출 전에는 Play Console의 최신 정책 검사도 다시 통과해야 합니다.
