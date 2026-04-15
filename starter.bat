@echo off
setlocal

set "VPS_USER=root"
set "VPS_HOST=135.181.101.165"
set "SSH_KEY=%USERPROFILE%\.ssh\pentablocks_ed25519"
set "APP_DIR=/opt/pentablocks"

:menu
cls
echo ==========================================
echo        PentaBlocks VPS Starter
echo ==========================================
echo Host : %VPS_USER%@%VPS_HOST%
echo Key  : %SSH_KEY%
echo.
echo [1] VPS'e baglan (SSH)
echo [2] Deploy (git pull + build + restart)
echo [3] API durumu
echo [4] API loglari (son 100 satir)
echo [5] Cikis
echo.
set /p CHOICE=Seciminiz: 

if "%CHOICE%"=="1" goto connect
if "%CHOICE%"=="2" goto deploy
if "%CHOICE%"=="3" goto status
if "%CHOICE%"=="4" goto logs
if "%CHOICE%"=="5" goto end
goto menu

:connect
if exist "%SSH_KEY%" (
  ssh -i "%SSH_KEY%" %VPS_USER%@%VPS_HOST%
) else (
  echo [WARN] SSH key bulunamadi. Varsayilan key'lerle baglaniliyor...
  ssh %VPS_USER%@%VPS_HOST%
)
pause
goto menu

:deploy
if exist "%SSH_KEY%" (
  ssh -i "%SSH_KEY%" %VPS_USER%@%VPS_HOST% "cd %APP_DIR% && git pull && npm ci && npm run build && systemctl restart pentablocks-api && systemctl reload nginx"
) else (
  echo [WARN] SSH key bulunamadi. Varsayilan key'lerle deploy denenecek...
  ssh %VPS_USER%@%VPS_HOST% "cd %APP_DIR% && git pull && npm ci && npm run build && systemctl restart pentablocks-api && systemctl reload nginx"
)
pause
goto menu

:status
if exist "%SSH_KEY%" (
  ssh -i "%SSH_KEY%" %VPS_USER%@%VPS_HOST% "systemctl status pentablocks-api --no-pager"
) else (
  ssh %VPS_USER%@%VPS_HOST% "systemctl status pentablocks-api --no-pager"
)
pause
goto menu

:logs
if exist "%SSH_KEY%" (
  ssh -i "%SSH_KEY%" %VPS_USER%@%VPS_HOST% "journalctl -u pentablocks-api -n 100 --no-pager"
) else (
  ssh %VPS_USER%@%VPS_HOST% "journalctl -u pentablocks-api -n 100 --no-pager"
)
pause
goto menu

:end
endlocal
exit /b 0

