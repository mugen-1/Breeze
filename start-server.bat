@echo off
chcp 65001 >nul
title Gucci Shop Server - DUNG DONG cua so nay khi dang xem web
cd /d "%~dp0server"

echo ============================================================
echo    GUCCI SHOP - Khoi dong server backend...
echo ------------------------------------------------------------
echo    - Trinh duyet se tu mo trang san pham sau vai giay.
echo    - DE YEN cua so nay chay trong luc xem web.
echo    - Muon TAT server: bam Ctrl + C, hoac dong cua so nay.
echo ============================================================
echo.

rem Lan dau chua cai thu vien thi tu cai
if not exist "node_modules" (
    echo [*] Chua co node_modules - dang cai dat lan dau, cho chut...
    call npm install
    echo.
)

rem Mo trinh duyet sau 3 giay (cho server san sang) - chay song song
start "" cmd /c "timeout /t 3 >nul && start http://localhost:3000/ao-nam.html"

rem Chay server (lenh nay giu cua so mo)
call npm start

echo.
echo [!] Server da dung.
pause >nul
