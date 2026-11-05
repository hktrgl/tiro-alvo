@echo off
setlocal
cd /d "%~dp0"
title Tiro ao Alvo Premiado - Dash Skins

where node >nul 2>&1
if errorlevel 1 (
  echo Instale o Node.js 24 ou superior em https://nodejs.org
  echo Depois, feche esta janela e abra este arquivo novamente.
  pause
  exit /b 1
)

node -e "if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
if errorlevel 1 (
  echo Este projeto precisa do Node.js 24 ou superior.
  echo Atualize em https://nodejs.org e tente novamente.
  pause
  exit /b 1
)

echo Preparando o jogo. Na primeira vez, e necessario acesso a internet.
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo Nao foi possivel instalar as dependencias. Confira o erro acima.
  pause
  exit /b 1
)

call npm run local
if errorlevel 1 (
  echo Nao foi possivel iniciar o jogo. Confira o erro acima.
  pause
  exit /b 1
)
endlocal
