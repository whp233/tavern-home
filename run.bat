@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM ============================================
REM   tavern-home one-click launcher
REM ============================================
REM Known fixes in this repo:
REM  1) AUTH_TOKEN empty: inside if(...) blocks %AUTH_TOKEN% expands too early,
REM     so use !AUTH_TOKEN! (delayed expansion) inside blocks.
REM  2) Local HTTP_PROXY/HTTPS_PROXY point to a broken proxy (127.0.0.1:10809)
REM     which hangs npm install; npm registry is npmmirror (404 for new pkgs).
REM     So: clear proxy + use official registry before npm install.
REM  3) [ai] binding in wrangler.toml is commented out, so local dev does not
REM     need CLOUDFLARE_API_TOKEN.
echo.
echo ============================================
echo   tavern-home one-click launcher
echo ============================================
echo.

REM ========== 1/5 check dependencies ==========
REM child windows inherit the cleared proxy env
set HTTP_PROXY=
set HTTPS_PROXY=

if not exist node_modules (
    echo [1/5] Installing root dependencies, first run, may take a few minutes...
    call npm install --registry=https://registry.npmjs.org
    if errorlevel 1 goto :fail
) else (
    echo [1/5] Root dependencies ready
)

if not exist frontend\node_modules (
    echo [1/5] Installing frontend dependencies...
    pushd frontend
    call npm install --registry=https://registry.npmjs.org
    if errorlevel 1 ( popd & goto :fail )
    popd
) else (
    echo [1/5] Frontend dependencies ready
)

REM ========== 2/5 generate .dev.vars (local secrets) ==========
if not exist .dev.vars (
    echo [2/5] First run: generating .dev.vars template...
    for /f "delims=" %%a in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set "AUTH_TOKEN=%%a"
    echo ANTHROPIC_API_KEY=put-your-Anthropic-API-Key-here> .dev.vars
    echo AUTH_TOKEN=!AUTH_TOKEN!>> .dev.vars
    echo OWNER_TOKEN=put-a-strong-password-here>> .dev.vars
    echo COMPANION_TOKEN=>> .dev.vars
    echo   Generated .dev.vars, AUTH_TOKEN filled automatically.
    echo   Edit .dev.vars to fill ANTHROPIC_API_KEY and OWNER_TOKEN, then re-run.
    echo   Note: local chat needs ANTHROPIC_API_KEY or an OPENAI_* vendor, otherwise
    echo   the writing desk reports not configured.
) else (
    echo [2/5] .dev.vars already exists, skipping
)

REM ========== 3/5 initialize local database (first run only) ==========
if not exist .local-db-initialized (
    echo [3/5] Initializing local database...
    call npm run db:init:local
    if errorlevel 1 goto :fail
    type nul > .local-db-initialized
) else (
    echo [3/5] Local database already initialized, skipping
)

REM ========== 4/5 generate frontend/.env.local (points to local worker) ==========
if not exist frontend\.env.local (
    echo [4/5] Generating frontend/.env.local...
    for /f "tokens=2 delims==" %%a in ('findstr /b "AUTH_TOKEN=" .dev.vars') do set "AUTH_TOKEN=%%a"
    echo NEXT_PUBLIC_WORKER_URL=http://localhost:8799> frontend\.env.local
    echo NEXT_PUBLIC_AUTH_TOKEN=!AUTH_TOKEN!>> frontend\.env.local
    echo   Generated frontend/.env.local, AUTH_TOKEN matches .dev.vars.
    echo   Note: AUTH_TOKEN is inlined into the frontend build at build time;
    echo   re-build after changing it.
) else (
    echo [4/5] frontend/.env.local already exists, skipping
)

REM ========== 5/5 start services ==========
echo [5/5] Starting services...

REM local access uses localhost (LAN IP is blocked by firewall, phone not usable)
set "LANIP=localhost"

REM if service already running (3001 listening), just open browser, don't restart
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo   Service already running, opening browser...
    start "" "http://%LANIP%:3001"
    goto :end
)

echo   Backend worker: http://%LANIP%:8799
echo   Frontend UI:   http://%LANIP%:3001
echo.

start "tavern-home worker" cmd /k "cd /d %~dp0 && npx wrangler dev --port 8799 --ip 0.0.0.0"
start "tavern-home frontend" cmd /k "cd /d %~dp0frontend && .\node_modules\.bin\next dev -p 3001 -H 0.0.0.0"

timeout /t 10 /nobreak >nul
start "" "http://%LANIP%:3001"

echo.
echo Done! Keep the two service windows open.
echo Frontend http://%LANIP%:3001   Backend http://%LANIP%:8799
goto :end

:fail
echo.
echo [ERROR] A previous step failed, check the messages above.
echo Common causes: network issue during dependency install, or .dev.vars missing keys.
goto :end

:end
endlocal
