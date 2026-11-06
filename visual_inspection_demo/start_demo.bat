@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 启动本地静态服务并打开浏览器（讲解模式）
start "vision-demo-server" /min cmd /c "python -m http.server 8123 --bind 127.0.0.1"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8123/"

echo 服务已启动：http://127.0.0.1:8123/
echo 关闭本窗口不会停止服务，停止服务请关闭最小化的 vision-demo-server 窗口。
timeout /t 3 /nobreak >nul
