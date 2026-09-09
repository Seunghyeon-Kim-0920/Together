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
    if ($patterns.Count -lt 52) { throw 'Incomplete parser pattern inventory.' }

    # Prove that the gate catches the exact old class-initialization failure.
    $oldPattern = '(?iuU)\b(?:available\s+credit|credit\s+(?:available|remaining))\b'
    $oldStatus = 0
    $oldExpression = [NotificationIcuGate]::uregex_open($oldPattern, $oldPattern.Length, 0, [IntPtr]::Zero, [ref]$oldStatus)
    if ($oldExpression -ne [IntPtr]::Zero) { [NotificationIcuGate]::uregex_close($oldExpression) }
    if ($oldStatus -ne 66315) { throw "The negative-control expression did not fail as expected: $oldStatus" }

    # Native-ICU matching also covers French Unicode boundaries and Korean text;
    # these are regression fixtures, never user transaction content.
    $cases = @(
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
        @('REVERSAL', 'Paiement annulé', $true)
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
