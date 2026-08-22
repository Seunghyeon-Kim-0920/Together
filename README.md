# 지갑의 일기

여행 정산과 일상 소비를 한 앱에서 관리하는 오프라인 우선 모바일 가계부입니다. 웹사이트 배포 없이 Capacitor 기반 Android/iOS 앱으로 제공됩니다.

## 주요 기능

- 삼성 인터넷의 탭처럼 여러 가계부를 가로로 전환하고 추가·이름 변경·삭제
- 새 가계부를 여행 가계부 또는 일반 가계부로 선택
- 여행 가계부: 여러 현지 화폐, 참가자, 결제자, 균등 N분의1, 통화별 정산, 파일 공유, PDF 내보내기
- 일반 가계부: 식비·교통비 등 카테고리 입력, 전월 대비 증감률, 월별·연도별·카테고리별 통계
- 한국어·영어·프랑스어
- 로그인 없이 SQLite에 기기 내부 저장
- 첫 실행 시 예시 사람이나 지출이 없는 완전한 빈 상태

## 개발

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

Android 동기화:

```bash
npm run android:sync
```

iOS 동기화는 macOS와 Xcode가 필요합니다.

```bash
npm run ios:sync
```

## 데이터와 공유

앱 데이터는 Android/iOS의 로컬 SQLite 데이터베이스에 저장됩니다. 여행 가계부 공유는 개인의 `본인 선택` 정보를 제외한 `.walletdiary` 파일을 만들어 운영체제 공유 시트를 엽니다. 받은 파일은 앱 상단의 가져오기 버튼으로 새 탭에 추가할 수 있습니다. PDF 역시 네이티브 공유 시트를 통해 파일 앱·Drive·메신저 등으로 저장하거나 전송할 수 있습니다.

앱을 삭제하면 로컬 데이터가 사라질 수 있으므로 중요한 여행 가계부는 `.walletdiary` 파일 또는 PDF로 백업해야 합니다.

## 배포

- Android/iOS application ID: `com.seunghyeonkim.walletdiary`
- Android version: `1.0.0` / code `100`
- Android min SDK: 24, target SDK: 36
- iOS 프로젝트: `ios/App/App.xcodeproj`
- Android APK/AAB: `release/`

서명 키와 비밀번호는 Git에서 제외됩니다. `release/wallet-diary-upload.jks`와 `release/SIGNING-CREDENTIALS.txt`를 안전한 별도 장소에 함께 백업해야 합니다.

서명된 IPA 생성에는 macOS, Xcode, Apple Developer Team, 배포 인증서와 App Store 프로비저닝 프로파일이 필요합니다.
