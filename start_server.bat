@echo off
title VoiceLink - WebSocket Server
set "PHP_EXE="

where php >nul 2>nul
if not errorlevel 1 set "PHP_EXE=php"

if not defined PHP_EXE (
    for /d %%D in ("%~dp0..\..\bin\php\php-*") do if not defined PHP_EXE if exist "%%~fD\php.exe" set "PHP_EXE=%%~fD\php.exe"
)

if not defined PHP_EXE (
    echo PHP CLI tidak ditemukan. Tambahkan PHP ke PATH atau gunakan Laragon.
    pause
    exit /b 1
)

"%PHP_EXE%" -r "exit(extension_loaded('sockets') ? 0 : 1);"
if errorlevel 1 (
    echo Ekstensi sockets belum aktif pada PHP CLI yang digunakan:
    "%PHP_EXE%" --ini
    pause
    exit /b 1
)

echo Menjalankan WebSocket server di ws://127.0.0.1:8765
echo Tekan Ctrl+C untuk berhenti.
echo.
"%PHP_EXE%" "%~dp0server.php"
pause
