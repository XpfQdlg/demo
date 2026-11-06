@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 用法：
rem   start_live_demo.bat                      使用摄像头 0，不加载模型
rem   start_live_demo.bat 视频路径              循环播放视频，不加载模型
rem   start_live_demo.bat 视频路径 模型路径     循环播放视频并加载模型

set "SOURCE=%~1"
if "%SOURCE%"=="" set "SOURCE=0"

set "MODEL=%~2"

echo 输入源：%SOURCE%
if "%MODEL%"=="" (
    python tools\live_server.py --source "%SOURCE%" --loop
) else (
    echo 模型：%MODEL%
    python tools\live_server.py --source "%SOURCE%" --loop --model "%MODEL%"
)

pause
