@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM ============================================
REM   tavern-home · 酒馆书房 一键启动
REM ============================================
REM 已知修复记录：
REM  1) AUTH_TOKEN 为空：若不开延迟扩展，if(...) 块内整块解析时 %AUTH_TOKEN% 已被展开，
REM     导致 .dev.vars 写入空 token。现在块内一律用 !AUTH_TOKEN!。
REM  2) 本机系统 HTTP_PROXY/HTTPS_PROXY 指向坏代理（127.0.0.1:10809），npm install 会挂；
REM     npm registry 又指向 npmmirror（对新包 404）。npm install 前清代理 + 指定官方 registry。
REM  3) wrangler.toml 的 [ai] 绑定已注释，本地 dev 不再需要 CLOUDFLARE_API_TOKEN。
echo.
echo ============================================
echo   tavern-home · 酒馆书房 一键启动
echo ============================================
echo.

REM ========== 1/5 检查依赖 ==========
REM 清掉坏代理（子窗口会继承此清空后的环境）
set HTTP_PROXY=
set HTTPS_PROXY=

if not exist node_modules (
    echo [1/5] 安装根目录依赖（首次运行，可能需要几分钟）...
    call npm install --registry=https://registry.npmjs.org
    if errorlevel 1 goto :fail
) else (
    echo [1/5] 根目录依赖已就绪
)

if not exist frontend\node_modules (
    echo [1/5] 安装前端依赖...
    pushd frontend
    call npm install --registry=https://registry.npmjs.org
    if errorlevel 1 ( popd & goto :fail )
    popd
) else (
    echo [1/5] 前端依赖已就绪
)

REM ========== 2/5 生成 .dev.vars（本地 secrets） ==========
if not exist .dev.vars (
    echo [2/5] 首次运行：生成 .dev.vars 配置模板...
    for /f "delims=" %%a in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set "AUTH_TOKEN=%%a"
    (
        echo ANTHROPIC_API_KEY=在此填入你的 Anthropic API Key
        echo AUTH_TOKEN=!AUTH_TOKEN!
        echo OWNER_TOKEN=在此填入一个强口令
        echo COMPANION_TOKEN=
    ) > .dev.vars
    echo   已生成 .dev.vars，AUTH_TOKEN 已自动填好。
    echo   请打开 .dev.vars 填入 ANTHROPIC_API_KEY 和 OWNER_TOKEN 后重新运行本脚本。
    echo   提示：本地聊天需要 ANTHROPIC_API_KEY，否则打字桌会报「未配置」。
) else (
    echo [2/5] .dev.vars 已存在，跳过
)

REM ========== 3/5 初始化本地数据库（仅首次） ==========
if not exist .local-db-initialized (
    echo [3/5] 初始化本地数据库...
    call npm run db:init:local
    if errorlevel 1 goto :fail
    type nul > .local-db-initialized
) else (
    echo [3/5] 本地数据库已初始化，跳过
)

REM ========== 4/5 生成 frontend/.env.local（指向本地 worker） ==========
if not exist frontend\.env.local (
    echo [4/5] 生成 frontend/.env.local...
    for /f "tokens=2 delims==" %%a in ('findstr /b "AUTH_TOKEN=" .dev.vars') do set "AUTH_TOKEN=%%a"
    (
        echo NEXT_PUBLIC_WORKER_URL=http://localhost:8787
        echo NEXT_PUBLIC_AUTH_TOKEN=!AUTH_TOKEN!
    ) > frontend\.env.local
    echo   已生成 frontend/.env.local，AUTH_TOKEN 与 .dev.vars 保持一致。
    echo   注意：AUTH_TOKEN 在构建时内联进前端产物，改了之后要重新构建才生效。
) else (
    echo [4/5] frontend/.env.local 已存在，跳过
)

REM ========== 5/5 启动服务 ==========
echo [5/5] 启动服务...
echo   后端 Worker: http://localhost:8787
echo   前端界面:   http://localhost:3000
echo.

start "tavern-home worker" cmd /k "cd /d %~dp0 && npm run dev"
start "tavern-home frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 8 /nobreak >nul
start http://localhost:3000

echo.
echo 启动完成！两个服务窗口请不要关闭。
echo 前端 http://localhost:3000  后端 http://localhost:8787
goto :end

:fail
echo.
echo [错误] 上一步执行失败，请查看上方报错信息。
echo 常见原因：网络问题导致依赖安装失败、.dev.vars 未填 key。
goto :end

:end
endlocal
