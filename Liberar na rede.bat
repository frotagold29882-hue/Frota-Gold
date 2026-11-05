@echo off
chcp 65001 >nul
title Gold Frota - liberar acesso pela rede
echo.
echo  Este atalho deixa os colegas da MESMA REDE abrirem o painel em modo
echo  SOMENTE VISUALIZACAO, pelo endereco deste computador (porta 8765).
echo  Alteracoes continuam possiveis apenas neste computador.
echo.
net session >nul 2>&1
if errorlevel 1 (
  echo  Precisa ser executado como ADMINISTRADOR:
  echo  clique com o botao direito neste arquivo e escolha "Executar como administrador".
  echo.
  pause
  exit /b 1
)
netsh http add urlacl url=http://+:8765/ sddl=D:(A;;GX;;;WD)
netsh advfirewall firewall add rule name="Gold Frota (porta 8765)" dir=in action=allow protocol=TCP localport=8765 profile=domain,private
echo.
echo  Pronto. Feche e abra de novo o "Abrir Painel.bat": a janela vai mostrar
echo  o endereco para os colegas (ex.: http://192.168.0.10:8765/).
echo.
echo  Para desfazer depois:
echo    netsh http delete urlacl url=http://+:8765/
echo    netsh advfirewall firewall delete rule name="Gold Frota (porta 8765)"
echo.
pause
