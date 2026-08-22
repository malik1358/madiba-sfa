$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$sdkPath = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not (Test-Path $sdkPath)) {
  Write-Host "Android SDK not found."
  Write-Host "Install Android Studio first: https://developer.android.com/studio"
  Write-Host "Then run: npm run cap:open:android"
  exit 1
}

$env:ANDROID_HOME = $sdkPath
$env:Path = "$sdkPath\platform-tools;$sdkPath\tools;$env:Path"

Write-Host "Syncing Capacitor..."
npm run cap:sync

Write-Host "Building debug APK..."
Set-Location android
.\gradlew.bat assembleDebug

$apkPath = Join-Path $repoRoot "android\app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkPath) {
  Write-Host ""
  Write-Host "APK ready:"
  Write-Host $apkPath
} else {
  Write-Host "Build finished but APK path was not found."
  exit 1
}
