@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 启动本地静态服务并直接进入轮播模式（大屏无人值守）
start "vision-demo-server" /min cmd /c "python -m http.server 8123 --bind 127.0.0.1"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8123/?kiosk=1"

echo 已进入轮播模式。按 Esc 退出轮播。
timeout /t 3 /nobreak >nul
