param(
    [string]$OutputDirectory = ""
)

# Source-only delivery. Never reads environment variables, signing directories,
# local data, git history, build products, or arbitrary untracked files.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskRootPrefix = $taskRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $taskRoot 'release' }
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$manifest = Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid source version.' }

# Tracked public source plus an explicit list of this implementation's new files.
# No glob includes untracked folders or private statement fixtures.
$tracked = @(& git -C $taskRoot -c core.quotepath=false ls-files -- src public ios tests docs/privacy)
if ($LASTEXITCODE -ne 0) { throw 'Cannot read tracked source allowlist.' }
$explicit = @(
    'package.json', 'package-lock.json', 'capacitor.config.ts', 'vite.config.ts',
    'tsconfig.json', 'eslint.config.mjs', 'index.html', '.gitignore',
    'firebase.json', 'firebase.rules',
    # A public version metadata file needed by wallet-ios-project.test.ts only.
    # The Android application and release/signing.properties are NOT included.
    'android/app/build.gradle',
    'docs/IOS_PERSONAL_INSTALL_KO.md', 'scripts/check-ios.sh',
    'scripts/package-ios-source.ps1',
    'src/components/IosAutomationSetup.tsx',
    'src/lib/iosAutomationI18n.ts', 'src/lib/iosTransactionInput.ts',
    'src/lib/merchantDescriptions.ts', 'tests/wallet-merchant-descriptions.test.ts',
    'tests/wallet-ios-transaction-input.test.ts',
    'tests/wallet-ios-automation-bridge.test.ts', 'tests/wallet-ios-documents.test.ts',
    'ios/App/App/CardAutomationPlugin.swift', 'ios/App/App/DocumentFilesPlugin.swift',
    'ios/App/App/IOSAutomationInbox.swift', 'ios/App/App/WalletBridgeViewController.swift',
    'ios/App/App/WalletShortcutIntents.swift',
    'ios/App/App/ko.lproj/Localizable.strings', 'ios/App/App/en.lproj/Localizable.strings',
    'ios/App/App/fr.lproj/Localizable.strings',
    'ios/Tests/IOSAutomationInboxChecks.swift', 'ios/Tests/README.md'
)
$paths = @(@($tracked) + $explicit | Sort-Object -Unique)
# The npm test command is part of the Mac hand-off. Refuse a source bundle that
# omits a newly added test just because that file is not tracked by Git yet.
foreach ($test in [regex]::Matches([string]$manifest.scripts.test, '(?:^|\s)(tests/[^\s]+\.test\.ts)(?=\s|$)')) {
    if ($paths -notcontains $test.Groups[1].Value) { throw "Test script references a file outside the archive allowlist: $($test.Groups[1].Value)" }
}
$entries = [Collections.Generic.List[object]]::new()
foreach ($relative in $paths) {
    $relative = $relative.Replace('\', '/')
    if ($relative -match '(^|/)(\.git|node_modules|build|DerivedData|Pods|output|xcuserdata|release|tmp|\.env[^/]*)(/|$)' -or
        $relative -match '(?i)\.(p12|p8|pem|key|jks|keystore|mobileprovision|ipa|apk|aab|log|csv|xlsx?|pdf|walletdiary)$' -or
        $relative -match '^ios/App/App/(public/|capacitor\.config\.json$|config\.xml$)' -or
        $relative -match '^ios/capacitor-cordova-ios-plugins/') {
        throw "Forbidden source archive entry: $relative"
    }
    if ($relative -match '(^|/)\.\.(/|$)' -or [IO.Path]::IsPathRooted($relative)) { throw 'Invalid archive path.' }
    $fullPath = [IO.Path]::GetFullPath((Join-Path $taskRoot $relative))
    if (-not $fullPath.StartsWith($taskRootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source path escaped workspace.' }
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Missing source file: $relative" }
    $sourceItem = Get-Item -LiteralPath $fullPath
    if (($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Symlink source refused: $relative" }
    $cursor = $sourceItem.Directory
    while ($cursor -and $cursor.FullName -ne $taskRoot) {
        if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Symlink/junction source refused: $relative" }
        $cursor = $cursor.Parent
    }
    if ($null -eq $cursor) { throw 'Cannot validate source ancestry.' }
    if ((Get-Item -LiteralPath $fullPath).Length -gt 15MB) { throw "Unexpected oversized source: $relative" }
    $bytes = [IO.File]::ReadAllBytes($fullPath)
    if ($relative -notmatch '(?i)\.(png|jpg|jpeg|webp|ico|woff2?|ttf|otf)$') {
        $text = [Text.Encoding]::UTF8.GetString($bytes)
        # Firebase web configuration is public app configuration, not an admin key.
        # Reject common private credentials without printing their values.
        if ($text -match '-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----' -or
            $text -match '"type"\s*:\s*"service_account"' -or
            $text -match '(?i)(?:AI_GATEWAY_API_KEY|OPENAI_API_KEY)\s*[:=]\s*["''][^"''\s]{12,}' -or
            $text -match '\b(?:ghp_|github_pat_|sk_live_)[A-Za-z0-9_]{20,}') {
            throw "Potential private credential in $relative; archive not created."
        }
        # Windows-created shell files must remain runnable with bash on a Mac.
        if ($relative.EndsWith('.sh', [StringComparison]::OrdinalIgnoreCase)) {
            $bytes = [Text.UTF8Encoding]::new($false).GetBytes($text.Replace("`r`n", "`n").Replace("`r", "`n"))
        }
    }
    $entries.Add([pscustomobject]@{ Path = $relative; Bytes = $bytes })
}

$archivePath = Join-Path $outputRoot "Wallet-Diary-v$version-iOS-source.zip"
if (Test-Path -LiteralPath $archivePath) { throw 'Source archive already exists. Choose a new output directory; existing files are never overwritten.' }
[IO.Directory]::CreateDirectory($outputRoot) | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($item in $entries) {
        $entry = $archive.CreateEntry("Wallet-Diary-iOS/$($item.Path)", [IO.Compression.CompressionLevel]::Optimal)
        $stream = $entry.Open()
        try { $stream.Write($item.Bytes, 0, $item.Bytes.Length) } finally { $stream.Dispose() }
    }
    $notice = @"
Wallet Diary $version - iOS SOURCE ONLY

This archive is NOT a signed IPA and cannot be installed directly on an iPhone.
Mac/Xcode compilation and iPhone behavior have not been verified on this Windows PC.
No signing keys, Apple accounts, API secrets or private financial records are included.
The Firebase client configuration is public app configuration, not an admin credential.

Open docs/IOS_PERSONAL_INSTALL_KO.md first.
On the Mac: npm run ios:check; npx cap open ios.
ios:check installs dependencies, runs JS and native inbox checks, then builds unsigned.
Sign with the iPhone owner's Personal Team and install using Xcode.
No GitHub download is required. This local source may be newer than GitHub.

The Android build.gradle file is present ONLY for cross-platform version tests.
This archive does not contain a buildable Android project.
Shortcuts capture is opt-in. The app processes queued inputs when opened;
this is not the same as Android's immediate background ledger processing.
"@
    $entry = $archive.CreateEntry('Wallet-Diary-iOS/READ-ME-FIRST.txt')
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try { $writer.Write($notice.Replace("`r`n", "`n")) } finally { $writer.Dispose() }
} finally { $archive.Dispose() }

$check = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    if ($check.Entries.Count -ne $entries.Count + 1) { throw 'Source archive entry-count verification failed.' }
    $names = @($check.Entries | ForEach-Object { $_.FullName })
    $requiredPaths = @($explicit) + @(
        'ios/App/App.xcodeproj/project.pbxproj', 'ios/App/App/Info.plist',
        'ios/App/App/AppDelegate.swift', 'ios/App/App/SceneDelegate.swift',
        'ios/App/App/Base.lproj/Main.storyboard', 'ios/App/CapApp-SPM/Package.swift',
        'ios/App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift',
        'tests/wallet-ios-project.test.ts', 'src/lib/nativeCardAutomation.ts',
        'src/lib/documentFiles.ts', 'src/lib/wallet.ts', 'src/lib/types.ts'
    )
    foreach ($required in $requiredPaths) {
        if ($names -notcontains "Wallet-Diary-iOS/$required") { throw "Archive missing required entry: $required" }
    }
    foreach ($item in $entries) {
        $entry = $check.GetEntry("Wallet-Diary-iOS/$($item.Path)")
        if (-not $entry -or $entry.Length -ne $item.Bytes.Length) { throw "Archive content length mismatch: $($item.Path)" }
        $stream = $entry.Open()
        $hasher = [Security.Cryptography.SHA256]::Create()
        try {
            $expected = [Convert]::ToBase64String($hasher.ComputeHash([byte[]]$item.Bytes))
            $actual = [Convert]::ToBase64String($hasher.ComputeHash($stream))
            if ($actual -ne $expected) { throw "Archive content checksum mismatch: $($item.Path)" }
        } finally { $stream.Dispose(); $hasher.Dispose() }
    }
} finally { $check.Dispose() }
$digest = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
Write-Output "Source archive: $archivePath"
Write-Output "Files: $($entries.Count + 1)"
Write-Output "SHA256: $($digest.Hash)"
Write-Output 'SOURCE ONLY. No signed IPA. Mac/iPhone validation is still required.'
