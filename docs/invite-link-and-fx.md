# 초대 링크 · 웹 참여 · 환산 정산

업데이트: 2026-11-17. 웹 Hosting 배포와 Android 스토어 게시는 별개입니다.
모두 무료 구성입니다. Firestore 보안 규칙과 공동 여행 데이터 구조는 바꾸지 않았습니다.

## 1. 무엇이 달라지나

### 초대 링크
- 공동 여행의 `초대 링크 만들기`(이전 `초대 코드 만들기`)를 누르면 링크가 만들어집니다. 코드는 접힌 영역에 함께 보입니다.
  `https://wallet-diary-c2a1a.web.app/join#<초대 코드>`
- 초대 토큰은 링크의 `#` 뒤에 있어 Hosting 요청에는 포함되지 않습니다. 예외적으로 Android에서 설치 후 초대를 이어받는 경우 Google Play 설치 리퍼러에 전달됩니다. 기존 24시간 만료·취소 동작은 그대로입니다.
- 받는 사람의 기기에 따라 이렇게 열립니다.

| 받는 사람 | 동작 |
| --- | --- |
| Android, 앱 있음 | 앱이 열리고 `여행 초대` 시트가 뜹니다. 이름과 동의만 입력하면 새 여행 탭이 만들어집니다. |
| Android, 앱 없음 | 초대 페이지 → Play 스토어 설치 → 첫 실행 때 초대 시트가 자동으로 뜹니다(Play 설치 리퍼러). |
| iPhone | 초대 페이지가 웹 버전(`/app/`)으로 넘어가 브라우저에서 참여합니다. |
| PC 등 | 초대 페이지에서 `웹에서 참여하기`를 누릅니다. |

- 기존 초대 코드 입력도 남아 있고, 입력 칸에 링크나 공유 메시지 전체를 붙여 넣어도 됩니다.
- 예전처럼 "빈 여행 가계부를 먼저 만들기"는 링크 참여에는 필요 없습니다.

### 웹 버전 (`/app/`)
- 같은 앱 코드를 브라우저용으로 빌드한 것입니다. 초대받은 공동 여행만 쓸 수 있고, 새 가계부 만들기·명세서 가져오기 버튼은 숨깁니다.
- 생활 가계부를 웹에서 막은 이유: 브라우저 저장소는 지워질 수 있고, 서버에 사본이 있는 공동 여행만 복구할 수 있기 때문입니다.
- 앱과 같은 Firebase 프로젝트·익명 인증·실시간 동기화를 그대로 사용합니다.

### 한 화폐로 환산해 정산
- 여행 가계부 `내역` 또는 `정산`에서 환산 표시를 켜고 원하는 통화를 고릅니다. 지출별 원금액, 환산 금액, 여행 합계 및 정산을 확인할 수 있습니다. 켜기 전에는 환율 요청이 없습니다.
- 지출마다 **지출일의 기준환율**로 환산하고, 한 화폐 기준으로 누가 누구에게 얼마를 보내는지 계산합니다. 기존 통화별 정산은 그대로 위에 있습니다.
- 환율 출처: Frankfurter v2(`api.frankfurter.dev`, 키 없음). 응답이 없으면 currency-api(`cdn.jsdelivr.net`, `currency-api.pages.dev`)를 임시로 씁니다.
- 주말·공휴일은 직전 공시 환율을 씁니다. 이틀 지난 날짜의 환율은 확정으로 보고 기기에 계속 보관하고, 최근 날짜는 6시간(예비 출처는 24시간) 뒤 다시 받습니다.
- 서버에 환율을 저장하지 않습니다. 각 기기의 선택 통화·수동 환율·캐시·예비 출처에 따라 참고액은 달라질 수 있습니다. 원통화 지출과 원통화 정산은 그대로 유지합니다. 환율이 하나라도 없으면 부분 합계를 전체 환산액처럼 표시하지 않습니다.
- 화폐별로 환율을 직접 입력할 수 있습니다(환전 영수증·카드 명세서 기준). 직접 입력값은 그 기기에만 저장되므로, 동행과 맞추려면 `환산 결과 공유`로 결과를 보내세요.
- 전송되는 것은 화폐 코드와 날짜뿐입니다. 금액·내용·이름은 보내지 않습니다.

## 2. 배포 순서

1. **(권장) Play 앱 서명 지문 추가**
   Play Console → 테스트 및 출시 → 앱 무결성 → 앱 서명 → `SHA-256 인증서 지문`을 복사해
   `hosting/.well-known/assetlinks.json`의 `sha256_cert_fingerprints` 배열에 둘째 값으로 넣습니다.
   지금은 업로드 키 지문만 들어 있습니다(직접 설치한 APK용). 이 단계를 건너뛰어도 링크는 동작하며,
   다만 Play에서 설치한 앱은 링크가 초대 페이지를 한 번 거친 뒤 `앱에서 열기` 버튼으로 열립니다.
2. **Hosting 배포**
   ```powershell
   firebase use wallet-diary-c2a1a
   firebase deploy --only hosting
   ```
   `predeploy`가 `npm run build:hosting`(웹 버전 빌드 + `hosting-dist/` 조립)을 실행합니다.
   `--only hosting`을 붙여 Firestore 규칙이 함께 배포되지 않게 하세요(규칙은 바뀌지 않았습니다).
3. **배포 확인** (브라우저에서)
   - `https://wallet-diary-c2a1a.web.app/` : 개인정보처리방침이 그대로 열리는지
   - `/delete-account.html` : 삭제 요청 페이지
   - `/join` : "초대 링크를 확인해 주세요" 안내
   - `/.well-known/assetlinks.json` : JSON이 보이는지
   - `/app/` : 웹 버전 첫 화면
4. **앱 새 버전 게시**
   `package.json`·`android/app/build.gradle`의 버전을 올린 뒤 기존 절차(`scripts/build-android.ps1` → 검증 → Play 업로드)로 진행합니다.
   새 Gradle 의존성 `com.android.installreferrer:installreferrer:2.2`를 처음 받을 때 인터넷이 필요합니다.
5. **Play Console 검토**
   - 개인정보처리방침은 같은 주소에서 내용만 갱신됩니다(초대 링크, 웹 버전, 환율 조회 항목 추가).
   - `docs/play-store-privacy-checklist.md`의 추가 항목을 Data safety와 대조하세요.

Hosting을 앱보다 먼저 배포해도 안전합니다. 기존 버전 앱은 링크를 만들지 않으므로 영향이 없습니다.

## 3. 실제 기기에서 확인할 것

개발 PC가 아닌 환경에서 작성해, 아래는 실행해 보지 못했습니다.

- [ ] `npm run build:hosting` 과 `scripts/build-android.ps1` 빌드 성공 (새 Java 파일 `InviteLinkPlugin.java` 컴파일 포함)
- [ ] Android 두 대: 초대 링크 공유 → 받은 기기에서 링크 탭 → 앱 열림 → 참여 → 지출 동기화
- [ ] 앱 없는 Android: 초대 페이지 → 설치(내부 테스트 트랙) → 첫 실행에 초대 시트. Play를 통한 설치에서만 리퍼러가 전달됩니다.
- [ ] iPhone Safari: 링크 → 웹 버전 → 참여 → Android 쪽과 실시간 반영
- [ ] 카카오톡 채팅방에서 링크를 눌렀을 때(인앱 브라우저) 안내와 `기본 브라우저에서 열기`
- [ ] 환산 정산: 실제 네트워크에서 환율이 받아지는지, 주말 날짜, 오프라인, 직접 입력
- [ ] Google Cloud Console의 Firebase API 키에 HTTP 리퍼러 제한이 있다면 `wallet-diary-c2a1a.web.app` 허용 여부

## 4. 알려진 한계

- 웹 참여자가 브라우저 데이터를 지우거나 다른 브라우저로 옮기면 익명 연결을 잃고, 다시 초대받으면 **새 참가자**로 추가됩니다.
  앱 재설치 때와 같은 기존 제약입니다. 웹 버전은 이를 화면에 안내하고 홈 화면 추가를 권합니다.
- 메신저 인앱 브라우저의 저장소는 Safari·Chrome과 분리되어 있습니다. 초대 페이지가 기본 브라우저로 열도록 안내합니다.
- 환율은 참고용 기준환율입니다. 카드 청구액·환전 금액과 다를 수 있어 직접 입력을 함께 제공합니다.
- 예비 출처는 2024-03-02 이전 날짜를 제공하지 않습니다. 그보다 오래된 지출은 Frankfurter가 응답해야 합니다.
- 환산 결과는 화면과 `환산 결과 공유`(텍스트)에만 있습니다. PDF에는 기존 통화별 정산만 들어갑니다.
- 무료 한도: Firebase Spark 요금제의 Hosting 전송량·Firestore 일일 한도는 프로젝트 전체에 적용됩니다.
  웹 참여자가 크게 늘면 Firebase 콘솔의 사용량을 확인하세요. 자동 유료 전환은 없습니다.

## 5. 관련 파일

| 구분 | 파일 |
| --- | --- |
| 링크 생성·해석 | `src/lib/inviteLink.ts`, `src/lib/inviteLinkI18n.ts`, `src/lib/nativeInviteLink.ts`, `src/lib/webCompanion.ts` |
| 참여 화면 | `src/components/InviteJoin.tsx`, `src/App.tsx`, `src/components/SharedTravelPanel.tsx`, `src/components/LedgerTabs.tsx` |
| Android | `android/app/src/main/AndroidManifest.xml`, `InviteLinkPlugin.java`, `MainActivity.java`, `android/app/build.gradle` |
| Hosting | `hosting/invite/index.html`, `hosting/.well-known/assetlinks.json`, `scripts/build-hosting.mjs`, `firebase.json` |
| 환산 정산 | `src/lib/exchangeRates.ts`, `src/lib/convertedSettlement.ts`, `src/lib/fxSettings.ts`, `src/lib/fxSummary.ts`, `src/lib/fxI18n.ts`, `src/components/ConvertedSettlement.tsx`, `src/components/TravelLedgerView.tsx` |
| 테스트 | `tests/wallet-invite-link.test.ts`, `tests/wallet-exchange-rates.test.ts`, `tests/wallet-converted-settlement.test.ts`, `tests/wallet-privacy.test.ts` |

링크 주소·패키지 이름·스킴은 `inviteLink.ts`, `AndroidManifest.xml`, `hosting/invite/index.html`,
`assetlinks.json` 네 곳에 있으며 `tests/wallet-invite-link.test.ts`가 서로 일치하는지 검사합니다.

## 6. 이 변경만 되돌리기

커밋하지 않은 상태로 작업 트리에 반영되어 있습니다. 이 기능들의 변경분만 모은 패치가
`Claude outputs/invite-link-fx-2026-11-15.patch`에 있습니다(수정 15개, 새 파일 20개).

```powershell
git apply -R --check "Claude outputs/invite-link-fx-2026-11-15.patch"   # 되돌릴 수 있는지 확인
git apply -R "Claude outputs/invite-link-fx-2026-11-15.patch"           # 되돌리기
```

이후 이 파일들을 더 고치면 패치가 맞지 않을 수 있습니다.
