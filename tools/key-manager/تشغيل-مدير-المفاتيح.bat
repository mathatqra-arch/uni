@echo off
chcp 65001 >nul
title Uni Kasher Key Manager - Browser
cd /d "%~dp0"
echo ============================================
echo   Uni Kasher Key Manager
echo   Opening in your browser...
echo   Keep this window OPEN while using the tool
echo   (Close this window = stop the tool)
echo ============================================
start "" http://localhost:8788
python key-manager.py
pause
