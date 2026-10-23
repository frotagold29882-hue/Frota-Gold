@echo off
chcp 65001 >nul
title Conectar ao GitHub
cd /d "%~dp0"
echo.
echo  Crie antes um repositorio PRIVADO e vazio em https://github.com/new
echo  (sem README, sem .gitignore). Depois copie a URL dele, por exemplo:
echo  https://github.com/seu-usuario/painel-frota.git
echo.
set /p URL= Cole a URL do repositorio e tecle Enter: 
if "%URL%"=="" goto fim
git remote remove origin >nul 2>&1
git remote add origin %URL%
git push -u origin main
echo.
if errorlevel 1 (echo  O envio falhou. Confira a URL e o login do GitHub.) else (echo  Pronto! A partir de agora cada gravacao do painel tambem vai para o GitHub.)
:fim
echo.
pause
