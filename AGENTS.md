# AGENTS.md — tavern-home（酒馆书房）

SillyTavern 生态本地写作工具：后端 Cloudflare Workers + 前端 Next.js 16（App Router）。全部用户数据落在本地 D1（SQLite）。
README 和 `docs/`（data-model.md、wiring.md）是正式文档；下面只写文档里没有、不查就会踩的坑。

## 开发命令（从仓库根目录）
- `npm run dev` — 后端 `wrangler dev`（默认 8787）
- 实际日常端口：后端 `npx wrangler dev --port 8799 --ip 0.0.0.0`；前端 `cd frontend && .\node_modules\.bin\next dev -p 3001 -H 0.0.0.0`（run.bat 就是这两条）
- `npm test` — `node --test tests/*.test.ts`（无测试框架，root 跑）
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — wrangler deploy dry-run 到 `dist/`
- 前端：`cd frontend && npm run build`（**注意带 `--webpack` flag**）、`npm run lint`
- 全量校验：`npm run release:check`（typecheck + test + build + 发布卫生检查）；CI（`.github/workflows/ci.yml`，push/PR→main，Node 24）跑同一套
- 本地数据库：`npm run db:init:local`（init.sql 全量建表）、`npm run db:migrate:local`（增量迁移）。**run.bat 首次只跑 init.sql**；迁移要显式跑 `db:migrate:local`，不自动应用

## ⚠️ 工作树当前状态（改文件前必看，2026-08-08）
- **AGENTS.md 本身是未跟踪文件**（`git status` 显示 `??`），还没提交。
- **win5 正在做「打字桌上传图片附件」**，5 个源文件是未提交改动，**别碰 / 别 checkout / 别顺手提交**：
  `examples/cloudflare/index.ts`、`frontend/app/study/TypingDesk.tsx`、`src/adapters/streamModelBackends.ts`、`src/chat/desk.ts`、`src/core/modelBackend.ts`（新增 `DeskImageAttachment` / `isTextOnlyModel`）。
- 动手改任何共享文件前，先看团队板 `~/.agents/team/board.md` 确认当前 owner。

## run.bat 启动器 —— 改它之前必读（硬经验，2026-08-08 踩出来的）
一键启动脚本，**必须是纯 ASCII**：
- 不能有 UTF-8 BOM、不能有中文。中文 Windows 的 cmd 按 GBK 解析 .bat，UTF-8+BOM 会把 `@echo off` 顶掉导致整个脚本秒炸。
- 生成 `frontend/.env.local` 时 `NEXT_PUBLIC_WORKER_URL` 必须是 `http://localhost:8799`（worker 端口），写 8787 前端连不上后端。
- cmd 块解析陷阱：`if (...)` 块内**同时**出现 `for /f` + 内层 `( ... ) > file` 重定向 + 含 ASCII 半角括号的 `echo` 行 → 括号配对崩（exit 255、输出乱序）。规避：写文件用逐行 `>>` 追加，块内 echo 行不要带 `(`/`)`。

## 配置与密钥（全部 gitignored，run.bat 首次运行自动生成）
- 根目录 `.dev.vars`：`AUTH_TOKEN` / `OWNER_TOKEN` / `COMPANION_TOKEN`（读书角 AI 伴侣）+ 模型供应商 key（`<PREFIX>_API_KEY` / `_BASE_URL` / `_MODEL`）。
  **占位 key 陷阱**：模板里的 `put-your-...-here` 非空，后端会误判"已配置"。任何"无供应商"判定必须排除占位值。
- `COMPANION_COMMENT_WRITE` 在 `wrangler.toml [vars]`（默认 `"false"` 只读；改 `"true"` 才允许 AI 伴侣写读书角评论）。
- `frontend/.env.local`：`NEXT_PUBLIC_WORKER_URL` + `NEXT_PUBLIC_AUTH_TOKEN`。AUTH_TOKEN 在构建时内联进前端产物，改后要重新 build。
- `.local-db-initialized` 空标记：存在则 run.bat 跳过建库。
- 本地 D1 在 `.wrangler/state/v3/d1/`。删掉 `.wrangler\` + `.dev.vars` + `.env.local` + `.local-db-initialized` 再跑 run.bat = 全新安装。
- 根目录 `.tmp-*` 目录是测试垃圾，gitignored，可随手删。
- 当前状态（2026-08-08）：D1 是**恢复后的真实数据**（win6 按备份还原：31 记忆 / 92 章 / 1025 楼 / 1 预设 / 2 配方），不是空库；恢复实例里**没有** `pk_default`（0003 播种只在全新库有，需要就手动种）。备份在 `Downloads\tavern-home-书房配置备份-20260808-202901\`（含恢复说明）。

## 架构速览
- 后端入口：`examples/cloudflare/index.ts`。**所有路由都挂在 `/{AUTH_TOKEN}/api/oc/...` 路径 token 下**，URL 不带 token 会 401。
- 纯函数在 `src/core/`，打字桌工具在 `src/tools/`，模型供应商适配在 `src/adapters/streamModelBackends.ts`，D1 参考实现适配在 `examples/cloudflare/adapters/`。
- Schema：`examples/cloudflare/schema/init.sql` + `schema/migrations/0001_initial` / `0002_desk_chapter_floors` / `0003_default_preset_seed`。
- 前端全在 `frontend/app/study/`：`page.tsx`（书房首页/房间切换）、`TypingDesk.tsx`（打字桌+「商」供应商切换）、`DeskDrawers.tsx`（导入抽屉）、`ReadingCorner.tsx`（读书角）、`ChaptersStudio.tsx`（章节编辑）。
- 数据模型：`memories`（书房笔记/世界书/角色卡）、`oc_chapters`/`oc_comments`（读书角连载）、`oc_state`（键值状态）、`desk_presets/blocks/recipes/regex/windows/floors`（打字桌资产与消息）。
- 所有新代码走 `StorageAdapter`/`DeskStorage` 风格（`src/core/storage.ts` 定义契约），D1 只是参考方言。

## 模型供应商
- 静态注册表 `DESK_PROVIDER_DEFS`（`src/adapters/streamModelBackends.ts`）：opencode/anthropic/deepseek/siliconflow，按 env 前缀探测。Provider 不传 = 老行为（OPENAI 渠道优先，否则 Anthropic）。
- 未配置供应商时打字桌报 500「未配置」，**不悄悄回落**其他供应商（别改成静默回退）。
- 供应商选择持久化在浏览器 `localStorage.oc_desk_provider`；`GET /api/oc/desk/providers` 拉列表。
- Web 端运行时配置层（「商」房间 + 书架首次引导 + 自定义 Anthropic 兼容网关）已提交（ee0facd）。

## 本机环境坑
- 系统 `HTTP_PROXY`/`HTTPS_PROXY` 指向坏代理，**npm install 必须先清代理 + `--registry=https://registry.npmjs.org`**（run.bat 里已做）。
- 需要 Node ≥ 18.18（本仓在 Node 24 验证，CI 也是 24）。
- 前端文案全中文，新增 UI 保持中文。

## 协作
- 开工前读团队板：`~/.agents/team/board.md` + `~/.agents/team/briefs/tavern-study.md`。当前：win5 正在做打字桌图片附件（上面 5 个文件未提交），win6 恢复书房原配置（D1/keys/env 还原 + 重启服务）。
- 写团队板/简报文件必须显式 UTF-8 无 BOM（PS 默认写会变 GBK 乱码）。机器级背景看 `C:\Users\whp18\CLAUDE.md`。
