@echo off
REM 一键构建安卓双 ABI（双击可用）— 内部调用 ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-android.ps1"
pause
