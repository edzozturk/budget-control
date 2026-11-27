@echo off
rem Budget Control - Windows baslatici / launcher
rem Cift tiklayin: ilk seferde kurar, sonra uygulamayi acar.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. Lutfen https://nodejs.org adresinden Node.js 22 LTS kurun ve tekrar deneyin.
  start "" https://nodejs.org
  pause
  exit /b 1
)

set PORT_VALUE=4310
if defined PORT set PORT_VALUE=%PORT%

rem Onceki pencerede acik kalan sunucuyu kapat: dosyalari kilitler ve portu tutar.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort %PORT_VALUE% -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue } | Where-Object { $_.ProcessName -eq 'node' } | ForEach-Object { Write-Host 'Acik kalan Budget Control kapatiliyor...'; Stop-Process -Id $_.Id -Force; Start-Sleep -Seconds 1 }"

rem Kod degistiyse (git pull sonrasi) bagimliliklari kurup yeniden derle.
set CURRENT=
for /f %%i in ('git rev-parse HEAD 2^>nul') do set CURRENT=%%i
set BUILT=
if exist .build-stamp set /p BUILT=<.build-stamp
set REBUILD=
if not exist node_modules set REBUILD=1
if not exist server\dist\index.js set REBUILD=1
if not "%CURRENT%"=="%BUILT%" set REBUILD=1

rem Bagimliliklar yalnizca package-lock.json degistiyse yeniden kurulur.
set LOCKHASH=
for /f %%h in ('powershell -NoProfile -Command "(Get-FileHash package-lock.json).Hash"') do set LOCKHASH=%%h
set INSTALLED=
if exist node_modules\.install-stamp set /p INSTALLED=<node_modules\.install-stamp
set INSTALL=
if not exist node_modules set INSTALL=1
if not "%LOCKHASH%"=="%INSTALLED%" set INSTALL=1

if defined REBUILD (
  echo Kurulum ve derleme yapiliyor, birkac dakika surebilir...
  if defined INSTALL (
    rem npm ci kurar ama package-lock.json'a dokunmaz; boylece git pull ve dal degistirme engellenmez.
    call npm ci --no-audit --no-fund || goto :error
    if defined LOCKHASH (echo %LOCKHASH%>node_modules\.install-stamp)
  )
  call npm run build || goto :error
  if defined CURRENT (echo %CURRENT%>.build-stamp)
)
echo.
echo Budget Control aciliyor: http://localhost:%PORT_VALUE%
echo Kapatmak icin bu pencereyi kapatin.
echo.
rem Sunucu acilsin diye tarayiciyi birkac saniye sonra ac.
start "" /min cmd /c "timeout /t 4 /nobreak >nul & start "" http://localhost:%PORT_VALUE%"
call npm start
goto :eof

:error
echo.
echo Bir hata olustu. Yukaridaki mesaji Claude'a iletebilirsiniz.
pause
exit /b 1
