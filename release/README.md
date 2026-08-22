# 지갑의 일기 v1.0.0

- `Wallet-Diary-v1.0.0.apk`: Android 기기에 직접 설치하는 서명 APK
- `Wallet-Diary-v1.0.0.aab`: Google Play Console 제출용 서명 Android App Bundle
- 패키지 ID: `com.seunghyeonkim.walletdiary`
- 버전: `1.0.0` (version code 100)
- 최소 Android: 7.0 / API 24
- target/compile SDK: 36

APK는 v2 서명 검증을, AAB는 JAR 서명 검증을 통과했습니다. SHA-256 파일 해시는 `SHA256SUMS.txt`에 있습니다.

`wallet-diary-upload.jks`, `signing.properties`, `SIGNING-CREDENTIALS.txt`는 민감한 서명 자료라 Git에 포함되지 않습니다. 세 파일을 별도로 안전하게 백업하세요.

iOS 프로젝트는 준비되어 있지만 서명된 IPA는 Windows에서 생성할 수 없습니다. macOS/Xcode와 Apple Developer 배포 인증서·프로비저닝 프로파일을 연결한 뒤 archive/export해야 합니다.
