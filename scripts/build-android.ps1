param(
    [string]$JavaHome = "$env:LOCALAPPDATA\TogetherToolchain\jdk21\jdk-21.0.12.1+1",
    [string]$AndroidSdk = "$env:LOCALAPPDATA\TogetherToolchain\android-sdk"
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath "$repoRoot\package.json" -Raw | ConvertFrom-Json).version
$buildRoot = Join-Path "$env:LOCALAPPDATA\TogetherBuild" ("wallet-v$version-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (!(Test-Path -LiteralPath "$JavaHome\bin\java.exe")) { throw 'JDK missing: pass -JavaHome pointing to a JDK 21 directory.' }
if (!(Test-Path -LiteralPath "$AndroidSdk\platforms\android-36")) { throw 'Android SDK platform 36 missing: pass -AndroidSdk.' }
if (!(Test-Path -LiteralPath "$repoRoot\release\signing.properties") -or !(Test-Path -LiteralPath "$repoRoot\release\wallet-diary-upload.jks")) { throw 'Existing release signing key/configuration required; do not generate a replacement key.' }
if (!(Test-Path -LiteralPath "$repoRoot\node_modules")) { throw 'Run npm ci before this script.' }
New-Item -ItemType Directory -Path $buildRoot | Out-Null
Start-Transcript -Path "$buildRoot\build.log" | Out-Null
$priorJava = $env:JAVA_HOME; $priorAndroid = $env:ANDROID_HOME; $priorSdk = $env:ANDROID_SDK_ROOT; $priorPath = $env:Path
try {
    $env:JAVA_HOME = $JavaHome; $env:ANDROID_HOME = $AndroidSdk; $env:ANDROID_SDK_ROOT = $AndroidSdk
    $env:Path = "$JavaHome\bin;$env:Path"
    Set-Location -LiteralPath $repoRoot
    & npm.cmd test | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    & npm.cmd run lint | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Lint failed.' }
    # Build outside OneDrive and the non-ASCII checkout path. No global tool
    # installation or global environment-variable changes are necessary.
    foreach ($folder in @('src', 'public', 'tests', 'docs')) {
        Copy-Item -LiteralPath "$repoRoot\$folder" -Destination $buildRoot -Recurse -Force
    }
    foreach ($name in @('package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'index.html', 'capacitor.config.ts')) {
        Copy-Item -LiteralPath "$repoRoot\$name" -Destination $buildRoot
    }
    New-Item -ItemType Junction -Path "$buildRoot\node_modules" -Target "$repoRoot\node_modules" | Out-Null
    $androidRoot = "$repoRoot\android"
    foreach ($file in Get-ChildItem -LiteralPath $androidRoot -File -Recurse -Force) {
        $relative = $file.FullName.Substring($androidRoot.Length + 1)
        if ($relative -match '(^|\\)(build|\.gradle|\.kotlin)(\\|$)' -or $relative -eq 'local.properties' -or $relative.StartsWith('app\src\main\assets\public\')) { continue }
        $destination = Join-Path "$buildRoot\android" $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $destination
    }
    New-Item -ItemType Directory -Path "$buildRoot\release" | Out-Null
    Copy-Item -LiteralPath "$repoRoot\release\signing.properties", "$repoRoot\release\wallet-diary-upload.jks" -Destination "$buildRoot\release"
    Set-Location -LiteralPath $buildRoot
    & npm.cmd run build | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Typecheck/web build failed.' }
    & "$buildRoot\node_modules\.bin\cap.cmd" sync android | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Android sync failed.' }
    Set-Location -LiteralPath "$buildRoot\android"
    & .\gradlew.bat :app:testReleaseUnitTest :app:assembleRelease :app:bundleRelease --no-daemon --max-workers=2 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Android tests or release build failed.' }
    Write-Output "WALLET_BUILD_SUCCEEDED $version"
    Write-Output "BuildDirectory: $buildRoot"
    # Release artifacts are copied only after a separate signature, version,
    # packaged-assets and bundle verification. Keep failed builds in scratch.
} finally {
    $env:JAVA_HOME = $priorJava; $env:ANDROID_HOME = $priorAndroid; $env:ANDROID_SDK_ROOT = $priorSdk; $env:Path = $priorPath
    Set-Location -LiteralPath $repoRoot
    Stop-Transcript | Out-Null
}
