param(
  [string]$AppUrl = $env:MPC_HR_URL,
  [string]$Version = "1.0.0"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not $AppUrl) { $AppUrl = "https://mpc-hr.vercel.app" }
if ($AppUrl -and $AppUrl -notmatch '^https://') { throw "AppUrl нь HTTPS хаяг байх ёстой." }
if (-not (Get-Command nuget -ErrorAction SilentlyContinue)) { throw "NuGet CLI-г суулгаж PATH-д нэмнэ үү." }
flutter pub get
if ($LASTEXITCODE -ne 0) { throw "flutter pub get амжилтгүй." }
flutter build windows --release --build-name=$Version --dart-define="APP_URL=$AppUrl"
if ($LASTEXITCODE -ne 0) { throw "Windows Release бүтээлт амжилтгүй." }
$iscc = Get-Command iscc -ErrorAction SilentlyContinue
if (-not $iscc) { throw "Inno Setup 6 суулгаж, ISCC.exe-г PATH-д нэмнэ үү." }
& $iscc.Source "/DAppVersion=$Version" "installer.iss"
if ($LASTEXITCODE -ne 0) { throw "Суулгагч бүтээлт амжилтгүй." }
$zip = Join-Path $PSScriptRoot "build\installer\MPC-HR-$Version-Windows.zip"
Compress-Archive -Path (Join-Path $PSScriptRoot "build\installer\MPC-HR-Setup.exe") -DestinationPath $zip -Force
Write-Host "Админ хуудсанд оруулах ZIP: $zip"
