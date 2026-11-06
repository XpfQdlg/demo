@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   智慧巡检联动指挥演示
echo ============================================
echo.

if not exist "node_modules\vite" (
  echo 首次运行，正在安装依赖，请稍候...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo 依赖安装失败，请检查网络或 npm 源。
    pause
    exit /b 1
  )
)

set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

start "巡检演示 本地服务" cmd /k "npm run dev"
ping -n 5 127.0.0.1 >nul

if exist "%EDGE%" (
  start "" "%EDGE%" "http://localhost:5179/"
) else (
  start "" "http://localhost:5179/"
)

echo.
echo 服务已在另一个窗口启动，关闭那个窗口即停止服务。
echo 演示地址： http://localhost:5179/
echo.
pause
