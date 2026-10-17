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

if not exist node_modules (
  echo Ilk kurulum yapiliyor, birkac dakika surebilir...
  call npm install || goto :error
)

if not exist server\dist\index.js (
  echo Uygulama derleniyor...
  call npm run build || goto :error
)

set PORT_VALUE=4310
if defined PORT set PORT_VALUE=%PORT%
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
