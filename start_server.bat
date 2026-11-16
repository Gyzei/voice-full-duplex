@echo off
setlocal EnableDelayedExpansion
title VoiceLink - WebSocket Server
set "PROJECT_DIR=%~dp0"

cd /d "%PROJECT_DIR%"

if not exist "server.php" (
    echo [ERROR] File server.php tidak ditemukan di folder launcher:
    echo %PROJECT_DIR%
    pause
    exit /b 1
)

set "PHP_EXE="
set "PHP_ARGS="
set "PHP_SOURCE="

rem 1. Prioritaskan PHP Laragon 8.3 (lokasi standar yang diketahui)
if exist "C:\laragon\bin\php\php-8.3.26-Win32-vs16-x64\php.exe" (
    set "PHP_EXE=C:\laragon\bin\php\php-8.3.26-Win32-vs16-x64\php.exe"
    set "PHP_SOURCE=Laragon PHP 8.3 (Fixed)"
)

rem 2. Cari versi PHP lain di folder C:\laragon\bin\php\
if not defined PHP_EXE (
    for /f "delims=" %%D in ('dir /b /ad /o-n "C:\laragon\bin\php\php-*" 2^>nul') do (
        if not defined PHP_EXE (
            if exist "C:\laragon\bin\php\%%D\php.exe" (
                set "PHP_EXE=C:\laragon\bin\php\%%D\php.exe"
                set "PHP_SOURCE=Laragon bin (%%D)"
            )
        )
    )
)

rem 3. Cari di folder PHP Laragon relatif proyek (..\..\bin\php)
if not defined PHP_EXE (
    for /f "delims=" %%D in ('dir /b /ad /o-n "%PROJECT_DIR%..\..\bin\php\php-*" 2^>nul') do (
        if not defined PHP_EXE (
            if exist "%PROJECT_DIR%..\..\bin\php\%%D\php.exe" (
                set "PHP_EXE=%PROJECT_DIR%..\..\bin\php\%%D\php.exe"
                set "PHP_SOURCE=Laragon relatif (%%D)"
            )
        )
    )
)

rem 4. Fallback: Gunakan PHP dari system PATH jika Laragon tidak ditemukan
if not defined PHP_EXE (
    where.exe php >nul 2>nul
    if not errorlevel 1 (
        for /f "delims=" %%P in ('where.exe php 2^>nul') do (
            if not defined PHP_EXE (
                set "PHP_EXE=%%P"
                set "PHP_SOURCE=System PATH"
            )
        )
    )
)

if not defined PHP_EXE (
    echo [ERROR] PHP CLI tidak ditemukan.
    echo Pastikan Laragon terinstal di C:\laragon atau tambahkan folder PHP ke PATH Windows.
    echo Lokasi yang dicari: C:\laragon\bin\php\php-8.3.26-Win32-vs16-x64\php.exe
    pause
    exit /b 1
)

rem Dapatkan direktori instalasi PHP untuk mendeteksi ekstensi bundled
set "PHP_DIR="
for %%D in ("!PHP_EXE!") do set "PHP_DIR=%%~dpD"

rem Uji apakah ekstensi sockets sudah aktif secara default pada executable ini
set "SOCKETS_ACTIVE=0"
"!PHP_EXE!" -r "exit(extension_loaded('sockets') ? 0 : 1);"
if not errorlevel 1 (
    set "SOCKETS_ACTIVE=1"
) else (
    rem Coba muat dengan opsi -d extension=sockets
    set "PHP_ARGS=-d extension=sockets"
    "!PHP_EXE!" !PHP_ARGS! -r "exit(extension_loaded('sockets') ? 0 : 1);"
    if not errorlevel 1 (
        set "SOCKETS_ACTIVE=1"
    ) else (
        rem Coba dengan path file dll absolut
        if exist "!PHP_DIR!ext\php_sockets.dll" (
            set "PHP_ARGS=-d extension=""!PHP_DIR!ext\php_sockets.dll"""
            "!PHP_EXE!" !PHP_ARGS! -r "exit(extension_loaded('sockets') ? 0 : 1);"
            if not errorlevel 1 (
                set "SOCKETS_ACTIVE=1"
            )
        )
    )
)

if "!SOCKETS_ACTIVE!"=="0" (
    echo ==========================================================
    echo [ERROR] Ekstensi sockets GAGAL dimuat pada PHP CLI terpilih:
    echo Executable: !PHP_EXE!
    echo Sumber    : !PHP_SOURCE!
    echo ==========================================================
    echo Ekstensi 'sockets' diperlukan untuk menjalankan server WebSocket.
    echo Periksa file php.ini atau pastikan php_sockets.dll ada di folder ext.
    pause
    exit /b 1
)

rem Periksa apakah port 8765 sudah digunakan oleh proses lain
set "PORT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8765 .*LISTENING" 2^>nul') do (
    set "PORT_PID=%%P"
)
if defined PORT_PID (
    echo ==========================================================
    echo [PERINGATAN] Port 8765 saat ini sudah digunakan oleh PID !PORT_PID!.
    echo ==========================================================
    echo Kemungkinan server.php sebelumnya masih berjalan di background.
    echo Untuk menghentikan proses tersebut, jalankan perintah:
    echo   taskkill /F /PID !PORT_PID!
    echo ==========================================================
    echo.
)

echo ==========================================================
echo   VoiceLink - WebSocket Server
echo   PHP CLI   : !PHP_EXE! (!PHP_SOURCE!)
echo   Sockets   : Aktif (OK)
echo   Direktori : %PROJECT_DIR%
echo   Listening : ws://0.0.0.0:8765 (Semua interface LAN & Localhost)
echo ==========================================================
echo.
echo URL Akses Aplikasi:
echo   * Laptop Localhost   : http://localhost/voice-full-duplex-master/
echo   * HP / Perangkat LAN :
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=1 delims= " %%B in ("%%A") do (
        if not "%%B"=="127.0.0.1" (
            echo       - http://%%B/voice-full-duplex-master/
            echo         (atau https://%%B/voice-full-duplex-master/ jika SSL aktif)
        )
    )
)
echo.
echo Catatan Firewall:
echo   Pastikan Windows Defender Firewall mengizinkan port 8765 dan 80/443 di Private Network.
echo.
echo Menjalankan server... Tekan Ctrl+C untuk menghentikan.
echo.

"!PHP_EXE!" !PHP_ARGS! "server.php"
if errorlevel 1 (
    echo.
    echo Server berhenti dengan kode error !errorlevel!.
)
pause
