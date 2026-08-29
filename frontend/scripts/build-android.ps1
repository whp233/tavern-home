# 一键构建安卓双 ABI 安装包（task-33）
# 用法：在任意终端执行 powershell -ExecutionPolicy Bypass -File frontend/scripts/build-android.ps1
# 或进入 frontend 后直接 .\scripts\build-android.ps1

$ErrorActionPreference = "Stop"
$frontend = "C:\Users\whp18\dev\tavern-study\frontend"
Set-Location $frontend

Write-Host "==> frontend: $frontend" -ForegroundColor Cyan
Write-Host "==> 1/4 npm install" -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }

Write-Host "==> 2/4 next build (产出 out/)" -ForegroundColor Yellow
# 确保线上 Worker 地址已配置（若未设则用本地 192.168 调试地址）
if (-not $env:NEXT_PUBLIC_WORKER_URL) {
  Write-Host "  未检测到 NEXT_PUBLIC_WORKER_URL，使用 .env.local 现有值" -ForegroundColor Gray
}
npm run build
if ($LASTEXITCODE -ne 0) { throw "next build 失败" }

Write-Host "==> 3/4 cap sync" -ForegroundColor Yellow
# 首次需要 cap add android，若 android 目录不存在则自动生成
if (-not (Test-Path "$frontend\android")) {
  Write-Host "  android/ 不存在，执行 npx cap add android" -ForegroundColor Gray
  npx cap add android
  if ($LASTEXITCODE -ne 0) { throw "cap add android 失败" }
  # 覆盖后需重新应用双 ABI 补丁（已在 build.gradle 中，此处提示）
  Write-Host "  已生成 android/，请确认 android/app/build.gradle 含 abiFilters/splits.abi（见 android/README.md）" -ForegroundColor Gray
}
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw "cap sync 失败" }

Write-Host "==> 4/4 gradle 打包（需 Android Studio / JDK17 / SDK）" -ForegroundColor Yellow
if (-not (Test-Path "$frontend\android\gradlew.bat")) {
  Write-Host "  未找到 gradlew.bat，请先安装 Android Studio 并执行 npx cap add android" -ForegroundColor Red
  throw "gradlew 缺失"
}
Set-Location "$frontend\android"
.\gradlew assembleRelease
if ($LASTEXITCODE -ne 0) { throw "assembleRelease 失败" }
Write-Host "==> 完成！产物：" -ForegroundColor Green
Get-ChildItem "app\build\outputs\apk\release\*.apk" | ForEach-Object { Write-Host "  $($_.FullName)  $($_.Length/1MB) MB" }
Get-ChildItem "app\build\outputs\bundle\release\*.aab" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.FullName)" }

Write-Host "==> 安装到手机：adb install app\build\outputs\apk\release\app-arm64-v8a-release.apk" -ForegroundColor Cyan
