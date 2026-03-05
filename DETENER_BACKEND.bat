@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=5000"
for %%A in (%*) do (
  set "ARG=%%~A"
  if /I "!ARG:~0,7!"=="--port=" set "PORT=!ARG:~7!"
)

powershell -NoProfile -ExecutionPolicy Bypass -File ".\ops\stop_backend.ps1" --force %*
set "EXIT_CODE=%ERRORLEVEL%"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  taskkill /F /PID %%P >nul 2>&1
  if !errorlevel! EQU 0 (
    echo Backend detenido por fallback en puerto %PORT% (PID %%P).
    set "EXIT_CODE=0"
  )
)

echo.
pause
exit /b %EXIT_CODE%
