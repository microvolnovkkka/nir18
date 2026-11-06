@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-deepseek.ps1" %*
if errorlevel 1 (
    echo.
    echo Could not start DeepSeek playground. Copy the error above for troubleshooting.
    pause
)
