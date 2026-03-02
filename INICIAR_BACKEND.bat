@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File ".\ops\start_backend.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Ocurrio un error al iniciar el backend.
  echo Revisa los logs en .\ops\runtime\
)

pause
exit /b %EXIT_CODE%
