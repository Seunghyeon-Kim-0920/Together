param(
    [Parameter(Mandatory = $true)][string]$ClassesDirectory,
    [Parameter(Mandatory = $true)][string]$JsonJar,
    [string]$JavaHome = $env:JAVA_HOME
)
$ErrorActionPreference = 'Stop'
# Android Pattern is backed by ICU, while Gradle local unit tests use the JDK.
# This Windows-native ICU gate complements (does not replace) Android device tests.
# https://developer.android.com/reference/java/util/regex/Pattern
if (-not $JavaHome) { throw 'JavaHome or JAVA_HOME is required.' }
if (-not (Test-Path -LiteralPath $ClassesDirectory)) { throw 'Compiled notification parser classes are missing.' }
if (-not (Test-Path -LiteralPath $JsonJar)) { throw 'The org.json test JAR is missing.' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NotificationIcuGate {
 [DllImport("icu.dll", CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Unicode)]
 public static extern IntPtr uregex_open(string pattern, int length, uint flags, IntPtr parseError, ref int status);
 [DllImport("icu.dll", CallingConvention=CallingConvention.Cdecl)]
 public static extern void uregex_close(IntPtr expression);
 [DllImport("icu.dll", CallingConvention=CallingConvention.Cdecl)]
 public static extern void uregex_setText(IntPtr expression, IntPtr text, int length, ref int status);
 [DllImport("icu.dll", CallingConvention=CallingConvention.Cdecl)]
 public static extern byte uregex_find(IntPtr expression, int startIndex, ref int status);
 [DllImport("icu.dll", CallingConvention=CallingConvention.Cdecl)]
 public static extern IntPtr u_errorName(int status);
 [DllImport("icu.dll", CallingConvention=CallingConvention.Cdecl)]
 public static extern void u_getVersion([Out] byte[] versionArray);
}
'@
$taskScratch = Join-Path ([System.IO.Path]::GetTempPath()) ('wallet-icu-gate-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskScratch | Out-Null
try {
    & (Join-Path $JavaHome 'bin\javac.exe') '-encoding' 'UTF-8' '-d' $taskScratch (Join-Path $PSScriptRoot 'NotificationRegexDump.java')
    if ($LASTEXITCODE -ne 0) { throw 'Regex inventory compilation failed.' }
    $inventory = & (Join-Path $JavaHome 'bin\java.exe') '-cp' "$ClassesDirectory;$JsonJar;$taskScratch" 'NotificationRegexDump'
    if ($LASTEXITCODE -ne 0) { throw 'Parser class initialization failed on the host JVM.' }
    $patterns = @{}
    $failures = @()
    foreach ($row in $inventory) {
        $parts = $row.Split('|', 2)
        $pattern = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1]))
        $patterns[$parts[0]] = $pattern
        $status = 0
        $expression = [NotificationIcuGate]::uregex_open($pattern, $pattern.Length, 0, [IntPtr]::Zero, [ref]$status)
        if ($expression -ne [IntPtr]::Zero) { [NotificationIcuGate]::uregex_close($expression) }
        if ($status -gt 0) {
            $failures += [pscustomobject]@{ Pattern = $parts[0]; Status = $status; Error = [Runtime.InteropServices.Marshal]::PtrToStringAnsi([NotificationIcuGate]::u_errorName($status)) }
        }
    }
    $version = New-Object byte[] 4
    [NotificationIcuGate]::u_getVersion($version)
    [pscustomobject]@{ Engine = 'Windows native ICU'; Version = ($version -join '.'); Patterns = $patterns.Count; CompileFailures = $failures.Count } | ConvertTo-Json -Compress
    if ($failures.Count -gt 0) { $failures | Format-Table | Out-String | Write-Output; throw 'Android-incompatible regular expressions found.' }
    if ($patterns.Count -lt 67) { throw 'Incomplete parser/category pattern inventory.' }

    # Prove that the gate catches the exact old class-initialization failure.
    $oldPattern = '(?iuU)\b(?:available\s+credit|credit\s+(?:available|remaining))\b'
    $oldStatus = 0
    $oldExpression = [NotificationIcuGate]::uregex_open($oldPattern, $oldPattern.Length, 0, [IntPtr]::Zero, [ref]$oldStatus)
    if ($oldExpression -ne [IntPtr]::Zero) { [NotificationIcuGate]::uregex_close($oldExpression) }
    if ($oldStatus -ne 66315) { throw "The negative-control expression did not fail as expected: $oldStatus" }

    # Native-ICU matching also covers French Unicode boundaries and Korean text;
    # these are regression fixtures, never user transaction content.
    $cases = @(
        @('AUTHORIZATION_ACTION_REQUEST', '결제를 승인해 주세요', $true),
        @('AUTHORIZATION_ACTION_REQUEST', '결제를 승인해야 합니다', $true),
        @('AUTHORIZATION_ACTION_REQUEST', '승인이 필요합니다', $true),
        @('AUTHORIZATION_ACTION_REQUEST', '결제 승인을 위해 앱을 열어주세요', $true),
        @('AUTHORIZATION_ACTION_REQUEST', '결제 승인 버튼을 눌러주세요', $true),
        @('AUTHORIZATION_ACTION_REQUEST', "결제를`n승인해 주세요", $true),
        @('AUTHORIZATION_ACTION_REQUEST', '카드 결제 승인 완료', $false),
        @('AUTHORIZATION_ACTION_REQUEST', '자세한 이용 내역은 앱에서 확인하세요.', $false),
        @('AUTHORIZATION_ACTION_REQUEST', '상세 내역을 확인해 주세요.', $false),
        @('AUTHORIZATION_ACTION_REQUEST', '이용 내역 확인하기', $false),
        @('AUTHORIZATION_ACTION_REQUEST', '[승인] EUR 1.39', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Approve your payment', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Verify a payment', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Verify your online card payment', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Tap to verify', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Verification required', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Payment needs to be verified', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Payment verified', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Verify Café', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Verify receipt details in the app', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Please verify', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Please verify receipt details in the app', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'If you do not recognize this payment, please verify it with the merchant.', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Vérifiez votre paiement', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Appuyez pour vérifier', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Vérifiez les détails', $false),
        @('AUTHORIZATION_ACTION_REQUEST', "Veuillez vérifier les détails dans l’application", $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Zahlungsfreigabe erforderlich', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Überprüfen Sie Ihre Zahlung', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Zahlung prüfen', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Verifica tu pago', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Verifique o pagamento', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Verifica il pagamento', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Controleer je betaling', $true),
        @('AUTHORIZATION_NOT_REQUIRED', 'No verification required', $true),
        @('AUTHORIZATION_NOT_REQUIRED', 'Aucune vérification requise', $true),
        @('AUTHORIZATION_NOT_REQUIRED', 'Aucune vérification nécessaire', $true),
        @('AUTHORIZATION_NOT_REQUIRED', 'You do not need to verify this payment', $true),
        @('NOT_EXECUTED_PAYMENT', 'Payment request', $true),
        @('NOT_EXECUTED_PAYMENT', 'Payment requested', $true),
        @('NOT_EXECUTED_PAYMENT', 'Alex Example requests payment', $true),
        @('NOT_EXECUTED_PAYMENT', '決済承認のお願い', $true),
        @('NOT_EXECUTED_PAYMENT', 'Request to pay', $true),
        @('NOT_EXECUTED_PAYMENT', 'Alex Example requested a payment', $true),
        @('NOT_EXECUTED_PAYMENT', "You’re making an online card payment", $true),
        @('NOT_EXECUTED_PAYMENT', 'Payment Request Café', $false),
        @('NOT_EXECUTED_PAYMENT', 'Payment request paid', $false),
        @('NOT_EXECUTED_PAYMENT', 'Invoice paid', $false),
        @('NOT_EXECUTED_PAYMENT', 'Demande de virement', $true),
        @('NOT_EXECUTED_PAYMENT', 'Zahlungsanforderung', $true),
        @('NOT_EXECUTED_PAYMENT', 'Überweisungsanforderung', $true),
        @('NOT_EXECUTED_PAYMENT', 'Solicitud de transferencia', $true),
        @('NOT_EXECUTED_PAYMENT', 'Solicitação de pagamento', $true),
        @('NOT_EXECUTED_PAYMENT', 'Richiesta di bonifico', $true),
        @('NOT_EXECUTED_PAYMENT', 'Betaalverzoek', $true),
        @('NOT_EXECUTED_PAYMENT', 'Betaalverzoek Café', $false),
        @('NOT_EXECUTED_PAYMENT', '송금해주세요', $true),
        @('NOT_EXECUTED_PAYMENT', '납부 안내', $true),
        @('NOT_EXECUTED_PAYMENT', 'お支払いを承認してください', $true),
        @('NOT_EXECUTED_PAYMENT', '決済の承認が必要です', $true),
        @('NOT_EXECUTED_PAYMENT', '支払い完了', $false),
        @('NOT_EXECUTED_PAYMENT', '请确认付款', $true),
        @('NOT_EXECUTED_PAYMENT', '付款需要验证', $true),
        @('NOT_EXECUTED_PAYMENT', '請確認付款', $true),
        @('NOT_EXECUTED_PAYMENT', '付款需要驗證', $true),
        @('NOT_EXECUTED_PAYMENT', '付款完成', $false),
        @('LEAKED_AUTHORIZATION_CTA', 'Example Charity. Tap to verify', $true),
        @('LEAKED_AUTHORIZATION_CTA', 'Example Charity. Tap to verify your payment.', $true),
        @('LEAKED_AUTHORIZATION_CTA', 'Example. Tap to Verify Café', $false),
        @('LEAKED_AUTHORIZATION_CTA', 'Verify Café', $false),
        @('SMS_FINANCIAL_RECEIPT', "[예시카드]`n승인 12,000원`n예시식당", $true),
        @('SMS_FINANCIAL_RECEIPT', "Card payment`nEUR 12.34`nApproved", $true),
        @('SMS_FINANCIAL_RECEIPT', 'Your card payment of EUR 12.34 was approved', $true),
        @('SMS_FINANCIAL_RECEIPT', 'Paiement de 12,34 EUR effectué', $true),
        @('SMS_FINANCIAL_RECEIPT', 'カード決済 1,200円 完了', $true),
        @('SMS_FINANCIAL_RECEIPT', '支付12.34元成功', $true),
        @('SMS_FINANCIAL_RECEIPT', 'You owe me EUR 12.34', $false),
        @('SMS_FINANCIAL_RECEIPT', 'Verify a payment of EUR 12.34', $false),
        @('SMS_FINANCIAL_RECEIPT', 'Votre paiement de 12,34 € est à valider', $false),
        @('SMS_FINANCIAL_RECEIPT', '잔액 10,000원', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Confirm your €12.34 payment', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Confirm EUR 12.34 at Example Market', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'To approve, open your banking app', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Payment needs to be approved', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Payment awaiting your approval', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Tap to approve', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Open the app to approve', $true),
        @('AUTHORIZATION_ACTION_REQUEST', '결제를 진행하시겠습니까?', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Appuyez pour confirmer', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Payment approved', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Payment confirmed', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Confirm Café', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Validez votre paiement', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Paiement à valider', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Confirmation nécessaire', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Paiement validé', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Paiement valide', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Café Validé', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Bitte bestätigen Sie diese Zahlung', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Zahlung bestätigt', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Confirma este pago', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Pago confirmado', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Confirme o pagamento', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Conferma il pagamento', $true),
        @('AUTHORIZATION_ACTION_REQUEST', 'Pagamento confermato', $false),
        @('AUTHORIZATION_ACTION_REQUEST', 'Bevestig je betaling', $true),
        @('AUTHORIZATION_NOT_REQUIRED', 'No action required', $true),
        @('AUTHORIZATION_NOT_REQUIRED', 'Approval required', $false),
        @('AUTHORIZATION_NOT_REQUIRED', 'No further confirmation is needed', $true),
        @('AUTHORIZATION_NOT_REQUIRED', 'You do not need to approve this payment', $true),
        @('AUTHORIZATION_NOT_REQUIRED', 'Aucune confirmation nécessaire', $true),
        @('AUTHORIZATION_NOT_REQUIRED', 'Keine Freigabe erforderlich', $true),
        @('AUTHORIZATION_NOT_REQUIRED', 'Nessuna autorizzazione richiesta', $true),
        @('AUTHORIZATION_NOT_REQUIRED', 'Geen bevestiging vereist', $true),
        @('AUTHORIZATION_NOT_REQUIRED', '추가 승인이 필요하지 않습니다', $true),
        @('AUTHORIZATION_NOT_REQUIRED', '결제를 승인해주세요', $false),
        @('NEGATED_EXECUTION', 'Transfer has not been completed', $true),
        @('NEGATED_EXECUTION', 'Payment not yet approved', $true),
        @('NEGATED_EXECUTION', 'Payment approved', $false),
        @('NEGATED_EXECUTION', 'Paiement non validé', $true),
        @('NEGATED_EXECUTION', 'Paiement validé', $false),
        @('NEGATED_EXECUTION', '승인되지 않았습니다', $true),
        @('NEGATED_EXECUTION', '승인되었습니다', $false),
        @('NEGATED_EXECUTION', 'Transfer completed', $false),
        @('NEGATED_EXECUTION', 'ACH debit not posted', $true),
        @('NEGATED_EXECUTION', "Virement n'a pas été effectué", $true),
        @('NEGATED_EXECUTION', 'Überweisung nicht ausgeführt', $true),
        @('NEGATED_EXECUTION', 'Transferencia no se ha realizado', $true),
        @('NEGATED_EXECUTION', 'Transferência não foi efetuada', $true),
        @('NEGATED_EXECUTION', 'Bonifico non è stato eseguito', $true),
        @('NEGATED_EXECUTION', 'Overboeking nog niet voltooid', $true),
        @('NEGATED_EXECUTION', '이체가 완료되지 않았습니다', $true),
        @('NEGATED_EXECUTION', '이체가 완료되었습니다', $false),
        @('KOREAN_SENT', '테스트수취인님에게 보냈어요', $true),
        @('KOREAN_SENT', '테스트수취인님에게 보내세요', $false),
        @('KOREAN_RECIPIENT_BEFORE', '테스트수취인님에게 12,000원을 보냈어요', $true),
        @('KOREAN_RECIPIENT_BEFORE', '테스트발신인님께서 12,000원을 보냈어요', $false),
        @('CURRENCY_AFTER', '12,000원을 보냈어요', $true),
        @('CURRENCY_AFTER', '12,000원더하기', $false),
        @('INCOMING_SENT_NARRATIVE', 'Alex sent you USD 25.00', $true),
        @('INCOMING_SENT_NARRATIVE', 'Alex sent USD 25.00 to you', $true),
        @('INCOMING_SENT_NARRATIVE', 'You sent USD 25.00 to Alex', $false),
        @('INCOMING_SENT_NARRATIVE', 'Alex vous a envoyé 25,00 EUR', $true),
        @('INCOMING_SENT_NARRATIVE', '테스트발신인이 테스트예금주에게 12,000원을 송금했어요', $true),
        @('KOREAN_SOURCE_OWNER_LINE', '출금계좌 예금주: 테스트발신인', $true),
        @('KOREAN_SOURCE_OWNER_LINE', '받는 분: 테스트수취인', $false),
        @('INCOMING_TRANSFER', 'Virement effectué au profit de Camille', $false),
        @('INCOMING_TRANSFER', 'Virement reçu de Camille', $true),
        @('INCOMING_TRANSFER', 'Transferencia recibida', $true),
        @('OUTGOING_DESTINATION', 'Empfänger: Alex', $true),
        @('OUTGOING_DESTINATION', 'Beneficiário: Alex', $true),
        @('OUTGOING_DESTINATION', 'Ontvanger: Alex', $true),
        @('COUNTERPARTY_AFTER', 'à Camille', $true),
        @('TRANSFER_CONTEXT', 'Overboeking uitgevoerd', $true),
        @('DIRECT_DEBIT_SIGNAL', 'ACH debit posted', $true),
        @('MERCHANT_AFTER', '가맹점명: 카페 봄', $true),
        @('MERCHANT_AFTER', 'Merchant name: Blue Cafe', $true),
        @('MERCHANT_KOREAN_BEFORE', '카페 봄에서 12,000원 결제되었습니다', $true),
        @('MERCHANT_KOREAN_BEFORE', '12,000원 결제', $false),
        @('MERCHANT_PAYMENT_TO', 'You paid €12.34 to Blue Cafe', $true),
        @('MERCHANT_PAYMENT_TO', 'Paiement de 12,34 € à Blue Cafe', $true),
        @('MERCHANT_METADATA', 'Visa ending 4321', $true),
        @('MERCHANT_METADATA', 'New Balance', $false),
        @('CATEGORY_0', 'uber eats', $true),
        @('CATEGORY_2', 'pharmacie du centre', $true),
        @('CATEGORY_3', '스타벅스 강남점', $true),
        @('CATEGORY_6', 'buster example', $false),
        @('CATEGORY_8', '월세 이체', $true),
        @('CREDIT_BALANCE_LABEL', 'Available credit', $true),
        @('CREDIT_BALANCE_LABEL', 'Credit remaining', $true),
        @('INCOMING_PAYMENT', 'Paiement reçu 12,34 €', $true),
        @('INCOMING_PAYMENT', 'Payment received €12.34', $true),
        @('INCOMING_PAYMENT', '결제 대금을 받았습니다 12,000원', $true),
        @('INCOMING_PAYMENT', 'Card payment €12.34 at Lidl', $false),
        @('TRANSFER_CONTEXT', 'Prélèvement', $true),
        @('TRANSFER_CONTEXT', '자동이체 완료', $true),
        @('EXECUTED_DEBIT', 'exécuté', $true),
        @('EXECUTED_DEBIT', 'DÉBITÉ', $true),
        @('EXECUTED_DEBIT', 'upcoming', $false),
        @('DIRECT_DEBIT_SIGNAL', 'prélèvement sepa effectué', $true),
        @('OUTGOING_TRANSFER_SIGNAL', 'virement effectué vers Alice', $true),
        @('OUTGOING_TRANSFER_SIGNAL', 'virement reçu de Alice', $false),
        @('INCOMING_TRANSFER', 'Transfer received from Alice', $true),
        @('INCOMING_TRANSFER', 'Transfer sent to Alice', $false),
        @('SCHEDULED_INSTRUCTION', '예약이체', $true),
        @('BALANCE_BEFORE_AMOUNT', 'Solde disponible', $true),
        @('BALANCE_BEFORE_AMOUNT', '잔액', $true),
        @('BALANCE_BEFORE_AMOUNT', 'at New Balance', $false),
        @('KOREAN_APPROVAL_SIGNAL', '일시불 승인', $true),
        @('KOREAN_APPROVAL_SIGNAL', '승인번호 123456', $false),
        @('CURRENCY_AFTER', '- 12,34 €', $true),
        @('CURRENCY_BEFORE', 'EUR - 12.34', $true),
        @('KOREAN_LABELLED_AMOUNT', '출금12,000원', $true),
        @('KOREAN_LABELLED_AMOUNT', '잔액188,000원', $true),
        @('KOREAN_DESTINATION_LABEL', '입금은행: 테스트은행', $true),
        @('KOREAN_DESTINATION_LABEL', '거래구분: 입금', $false),
        @('KOREAN_DEBIT_CONTEXT', '출금액: 12,000원', $true),
        @('KOREAN_DEBIT_CONTEXT', '출금계좌: ***-0000', $false),
        @('EXECUTED_DEBIT', '출금계좌: ***-0000', $false),
        @('KOREAN_WITHDRAWAL_RECIPIENT', '받는 분: 테스트수취인', $true),
        @('KOREAN_WITHDRAWAL_RECIPIENT', '예금주: 테스트예금주', $false),
        @('NOT_EXECUTED_TRANSFER', '출금 요청', $true),
        @('NOT_EXECUTED_TRANSFER', '출금 대기', $true),
        @('MERCHANT_FIRST_NARRATIVE', 'Café Exemple : votre paiement de 12,34 €', $true),
        @('MERCHANT_FIRST_NARRATIVE', 'Café Exemple:paiement de 12,34 €', $true),
        @('MERCHANT_AMOUNT_TAIL', ' 일시불 승인 09/29 12:34', $true),
        @('MERCHANT_AMOUNT_TAIL', ' 서점 가을', $false),
        @('MERCHANT_AMOUNT_TAIL', ' a été validé avec succès !', $true),
        @('MERCHANT_AMOUNT_TAIL', ' validée', $true),
        @('MERCHANT_AMOUNT_TAIL', ' Validé Café', $false),
        @('STATUS_ONLY_MERCHANT', 'validé', $true),
        @('STATUS_ONLY_MERCHANT', 'validée !', $true),
        @('STATUS_ONLY_MERCHANT', 'a ete valide avec succes', $true),
        @('STATUS_ONLY_MERCHANT', 'Café Validé', $false),
        @('STATUS_ONLY_MERCHANT', 'Validé Café', $false),
        @('STATUS_ONLY_MERCHANT', 'is confirmed', $true),
        @('STATUS_ONLY_MERCHANT', 'confirmé', $true),
        @('STATUS_ONLY_MERCHANT', 'bestätigt', $true),
        @('STATUS_ONLY_MERCHANT', 'Confirmed Café', $false),
        @('MERCHANT_FIRST_NARRATIVE', 'Blue Cafe - card payment', $true),
        @('MERCHANT_DECORATION', '🥐 Café Exemple', $true),
        @('KOREAN_OWNER_FIELD', '카드명의자 김민지', $true),
        @('KOREAN_CARD_PRODUCT_LINE', '트래블페이(0000)', $true),
        @('KOREAN_CARD_PRODUCT_LINE', '하나카드(****0000)', $true),
        @('KOREAN_CARD_PRODUCT_LINE', 'MARCHE EXEMPLE', $false),
        @('KOREAN_CARD_PRODUCT_LINE', '카드 문구점', $false),
        @('NOT_EXECUTED_PAYMENT', '승인 요청', $true),
        @('NOT_EXECUTED_PAYMENT', '승인 예정', $true),
        @('NOT_EXECUTED_PAYMENT', '[승인] EUR 1.39', $false),
        @('REVERSAL', 'Paiement annulé', $true),
        @('REVERSAL', '[취소] EUR 12.34', $true),
        @('REVERSAL', '취소번호', $false)
    )
    foreach ($case in $cases) {
        $status = 0
        $pattern = $patterns[$case[0]]
        if (-not $pattern) { throw "Missing fixture pattern $($case[0])" }
        $expression = [NotificationIcuGate]::uregex_open($pattern, $pattern.Length, 0, [IntPtr]::Zero, [ref]$status)
        $inputPointer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($case[1])
        try {
            [NotificationIcuGate]::uregex_setText($expression, $inputPointer, $case[1].Length, [ref]$status)
            $matched = [NotificationIcuGate]::uregex_find($expression, 0, [ref]$status) -ne 0
            if ($status -gt 0 -or $matched -ne $case[2]) { throw "Native ICU fixture failed: $($case[0]), status $status, actual $matched, expected $($case[2])" }
        } finally {
            [NotificationIcuGate]::uregex_close($expression)
            [Runtime.InteropServices.Marshal]::FreeHGlobal($inputPointer)
        }
    }
    [pscustomobject]@{ NativeMatchFixtures = $cases.Count; NegativeControlStatus = $oldStatus; Result = 'PASS' } | ConvertTo-Json -Compress
} finally {
    # Delete only this uniquely created helper-classes directory, never a root.
    $resolvedScratch = [System.IO.Path]::GetFullPath($taskScratch)
    $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolvedScratch.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.Path]::GetFileName($resolvedScratch).StartsWith('wallet-icu-gate-')) {
        Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
    }
}
