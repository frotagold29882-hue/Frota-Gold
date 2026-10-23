@echo off
title Painel da Frota
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor\servidor.ps1"
pause
