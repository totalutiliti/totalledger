@echo off
echo ============================================================
echo   SercofiRH + Total Ledger - Iniciando...
echo ============================================================
echo.

set "ROOT=D:\0000_totalutiliti\projetos\0016_total_ledger\Projeto"
cd /d "%ROOT%"

echo [0/4] Limpando processos anteriores...
echo.

REM --- Fecha janelas de execucoes anteriores (pelo titulo) ---
echo      Fechando terminal API anterior...
taskkill /F /FI "WINDOWTITLE eq TL-API" >nul 2>&1

echo      Fechando terminal Web anterior...
taskkill /F /FI "WINDOWTITLE eq TL-WEB" >nul 2>&1

REM --- Derruba containers Docker do projeto ---
echo      Derrubando containers Docker do projeto...
call docker-compose down >nul 2>&1
echo      docker-compose down: OK

REM --- Aguarda 2s para portas serem liberadas ---
ping -n 3 127.0.0.1 >nul

echo.
echo      Cleanup concluido.
echo.

echo [1/4] Docker...
call docker-compose up -d
echo      Docker: errorlevel=%errorlevel%
echo.

echo [2/4] pnpm install...
call pnpm install
echo      pnpm: errorlevel=%errorlevel%
echo.

echo [3/4] Prisma (migrate + seed)...
call pnpm --filter api run prisma:push
echo      Push: errorlevel=%errorlevel%
call pnpm --filter api run prisma:seed
echo      Seed: errorlevel=%errorlevel%
echo.

echo [4/4] Abrindo terminais dos servicos...
echo.

echo Abrindo API...
start "TL-API" cmd /k "cd /d %ROOT% && pnpm --filter api run start:dev"

echo Aguardando 5s...
ping -n 6 127.0.0.1 >nul

echo Abrindo Web...
start "TL-WEB" cmd /k "cd /d %ROOT% && pnpm --filter web run dev"

echo.
echo ============================================================
echo   Pronto! 2 terminais foram abertos.
echo   API:       http://localhost:3000
echo   Web:       http://localhost:3001
echo ============================================================
echo.
echo Pressione qualquer tecla para fechar esta janela...
pause >nul
