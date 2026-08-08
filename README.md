# tavern-home · 酒馆书房

> 开源 · 免费 · MIT
> **tavern-home** 是 [tavern-study](https://github.com/TricksterFlare/tavern-study) 的独立维护分支，专注开箱即用。

一间搬进你家的写作书房——预设、世界书、正则、角色卡直接导入就能写，推完的剧情存成连载，配一套完整记忆系统，长剧情到第 999 楼还记得第 1 楼。

还能把你的酒馆聊天转写成小说

**本分支的改进**：一键启动（`run.bat`）、更顺手的本地体验、面向新用户的快速上手文档。

---

## 🚀 快速开始（Windows）

> **必备依赖**：只要 **Node.js ≥ 18.18**（推荐 20/22 LTS；本仓在 Node 24 上开发验证）+ npm ≥ 10。wrangler/workerd 与前端构建产物都由 npm 依赖自带，不需要额外装 Python/Go/Rust 之类运行时。

双击根目录的 **`run.bat`**，自动完成：

1. 安装依赖（根目录 + 前端，首次运行会等几分钟）
2. 生成 `.dev.vars` 配置模板（首次），按下面「模型配置」填好 key 后重新运行一次
3. 初始化本地数据库
4. 启动后端（`http://localhost:8799`）+ 前端（`http://localhost:3001`）
5. 自动打开浏览器

> 之后每次双击 `run.bat` 即可一键拉起，两个服务窗口别关。

### 手动启动（等价于 run.bat 做的事）

```powershell
npm install
cd frontend && npm install && cd ..
npm run db:init:local
# 若没有 frontend/.env.local，从 frontend/.env.example 复制并填：
#   NEXT_PUBLIC_WORKER_URL=http://localhost:8787
#   NEXT_PUBLIC_AUTH_TOKEN=<与 .dev.vars 里的 AUTH_TOKEN 一致>
npm run dev            # 后端 → http://localhost:8787
cd frontend && npm run dev   # 前端 → http://localhost:3000
```

> 手动启动用 wrangler/next 的默认端口 8787/3000；`run.bat` 固定用 8799/3001（两套都行，别混着找）。

### 模型配置（必须）

在根目录 `.dev.vars` 里配置鉴权 token + 至少一个模型供应商。`.dev.vars` 不入库，首次由 `run.bat` 生成模板，把下面的键填好再重新运行一次即可：

```ini
AUTH_TOKEN=任意强口令（前端 URL 用的路径 token）
OWNER_TOKEN=另一个强口令（管理/MCP 用）

# 模型供应商（打字桌顶栏「商」按钮可切换；至少配一种）
# 推荐opencode 供应商或者任意 OpenAI 兼容渠道（DeepSeek / 硅基流动 / 自建网关都行）：
OPENAI_API_KEY=你的key
OPENAI_BASE_URL=https://api.deepseek.com/v1   # 可选：OpenAI 兼容网关 base
OPENAI_MODEL=deepseek-v4-flash                     # 可选：wire 模型名，不填走供应商缺省

# 其它供应商按需配（<前缀>_API_KEY / _BASE_URL / _MODEL 三件套）：
# DEEPSEEK_API_KEY=…        # DeepSeek 官方
# SILICONFLOW_API_KEY=…     # 硅基流动
# ANTHROPIC_API_KEY=…       # Anthropic 官方
# ANTHROPIC_BASE_URL=…      # Anthropic 兼容网关（完整 Messages 端点 URL）
```

`ANTHROPIC_BASE_URL` 配了走 Anthropic 系自建网关；`OPENAI_*`/`DEEPSEEK_*`/`SILICONFLOW_*` 走官方或任意 OpenAI 兼容网关——三条生成链（打字桌聊天/时光带折叠/状态板重算）都认这套渠道。

## ⚡ 懒人快速通道（让 AI 帮你装）

不想手动敲命令？把下面这段**原样复制**给任何一个 AI 助手（ChatGPT / Claude / opencode 等），它会帮你自动体检环境、装依赖、起服务，或一步步告诉你该点哪里：

```text
你是部署助手。任务：在 Windows 上从零安装并启动 tavern-home（酒馆书房，https://github.com/whp233/tavern-home），做环境体检 + 一键安装 + 健康检查。每步打印结果，不跳步。

【第一步 环境体检】
1. node -v（要求 ≥18.18）、npm -v（要求 ≥10）；不满足就提示先装 Node 并停止。
2. git --version 是否可用。
3. C 盘剩余空间应 ≥2GB。
4. 端口占用：netstat -ano | findstr ":8799 :3001"，有 LISTENING 就提示先释放。
5. 若源码已在本地，检查 node_modules、.dev.vars、frontend/.env.local、.local-db-initialized 是否存在并报告缺失。
6. 汇总成体检表。

【第二步 安装】
1. 无源码则 git clone https://github.com/whp233/tavern-home.git
2. 装根目录依赖（清代理 + 官方 registry，这台机器常见代理 404 坑）：
   cmd /c "set HTTP_PROXY=& set HTTPS_PROXY=& npm install --registry=https://registry.npmjs.org"
   若 npm 拦截 esbuild/workerd 的安装脚本：npm install-scripts approve esbuild workerd 后重跑 install。
3. 装前端依赖：cd frontend && 同样命令 install && cd ..
4. 若无 .dev.vars：生成模板，AUTH_TOKEN 与 OWNER_TOKEN 各一个 32 位随机 hex，并留模型渠道占位提示用户填。
5. npm run db:init:local 初始化本地库（若报 schema_versions 冲突属预期，init.sql 已含全部迁移）。
6. 若无 frontend/.env.local：写 NEXT_PUBLIC_WORKER_URL=http://localhost:8799 和 NEXT_PUBLIC_AUTH_TOKEN=<与 .dev.vars 一致>。

【第三步 启动】
1. 后端：npx wrangler dev --port 8799 --ip 0.0.0.0（另开终端）
2. 前端：cd frontend && npx next dev -p 3001 -H 0.0.0.0（另开终端）
3. 10 秒后健康检查：curl http://127.0.0.1:8799/ 返回 401 属正常；浏览器打开 http://localhost:3001 应能见页面。
4. 若还没填模型 key，提示：打字桌聊天/时光带/状态板至少需要一种供应商渠道（OPENAI_* 或 DEEPSEEK_* 或 SILICONFLOW_* 或 ANTHROPIC_*）。

【第四步 汇报】体检表、安装/启动结果、健康检查、当前缺什么配置（模型 key/token）、访问地址。
```

> 端口默认 8799（后端）/ 3001（前端）；若被占，需要同时改 `run.bat`、`frontend/.env.local`、`wrangler.toml` 的 `ALLOWED_ORIGINS` 三处。

---

## 🏠 三个房间

- **书架** 📚（私人 · 设定的家）——角色卡、世界观、大纲、散记一条条立上架，世界书长在这些条目上。
- **读书角** 📖（共读 · 剧情总结与连载）——推完的剧情整理成章、发布成连载，AI 伴侣来追更、留言。
- **打字桌** ⌨️（主战场 · AIRP 写作台）——导入预设直接开写，状态板、时光带、重摇都在桌上。

## 📖 怎么用（五分钟上手）

1. **起个项目门牌** —— project 就是一个名字（比如「雪夜行」），第一次填了以后就出现在下拉里。
2. **书架放设定** —— 角色卡、世界观、大纲立上架，配世界书进场方式：常驻 / 关键词 / 在场档。
3. **导入酒馆家当** —— 打字桌文具盒有导入口：预设、世界书、正则、角色卡（`.json` / `.png`）整包进来。
4. **写核心记忆** —— 给故事写段总纲（几百字即可），权重最高的记忆层。
5. **开写作窗，开写** —— 一楼一楼往上盖，不满意就 roll；推完收进读书角变章节连载。

## ⌨️ 打字桌：开写与工具

打字桌是主战场——导入预设直接开写，AI 把剧情往下推。

**写作窗与楼层**
- 一个「写作窗」= 一个写作会话；窗下是一楼一楼的消息（你的输入和 AI 的回复都算一层）。
- 输入框发消息 → AI 生成下一楼；不满意点 **重摇（roll）** 重新生成。
- 写太久楼层会多，「时光带」自动把老楼折成摘要（每 20 层折 16 层，有损但原文不删），长剧情不丢前情。

**记忆层（AI 写下一楼时会看到什么）**
- **核心记忆**：你手写的故事总纲，永远常驻。
- **世界书 & 角色卡**：设定条目按 常驻 / 关键词 / 在场 触发进场。
- **旧章召回**：读书角已发布章节的语义检索，写到相关剧情才想起来。
- **近景楼层**：最近几楼原文一字不落；**状态板**：谁在场/状态，每楼都带着。

**文具盒（顶栏「文」）**
- 本窗设置（配方/模型）、积木（预设里的提示词块）、正则、核心记忆、**导入**。
- 导入：预设 / 世界书 / 正则 / 角色卡（`.json` / `.png`）/ 聊天记录（SillyTavern JSONL）。
  - 聊天记录支持两种模式：**新建窗** 或 **合并到已有窗**（自动判重跳过已有消息，只追加新的）。

**供应商「商」**
- 顶栏「商」切换模型供应商（AI 走哪个渠道），选择全站通用。
- 一个供应商都没配时，书架顶部有引导横幅，点「去配置」进「商」房间填 API Key / Base URL / Model 即可。

**成书**
- 推完一段剧情，在打字桌点「收为章节 / 自动成书」把楼层整理成章节送进读书角连载（可选手法、看进度、中途停）。

## 📖 读书角：连载与追更

读书角把推完的剧情整理成章、发布成连载，AI 伴侣还能来追更留言。

**章节管理**
- 章节有 **草稿 / 已发布** 两种状态；按 chapter_no 排序，支持批量操作。
- 「去章节工坊改」直达章节编辑器，行内改标题/摘要/正文。
- 已发布章节可**整书导出**（txt）。

**回收站**
- 删除的章节先进回收站（软删，正文/评论都还在），可**恢复**；**彻底删除**才真删，删了找不回。

**自动成书**
- 打字桌的楼层可一键「收为章节」——自动切章、生成摘要，送进读书角连载；已生成的章不会重复生成。

**追更留言**
- 发布章节后，AI 伴侣（配了 `COMPANION_TOKEN` 时）可以读连载、留言，你也能看到它的追更。

**AI 伴侣怎么配（追更留言）**
- `.dev.vars` 加 `COMPANION_TOKEN=<给伴侣的 Bearer token>`（和 `OWNER_TOKEN` 分开，别共用）。
- 想让伴侣**能写评论**：把 `wrangler.toml` 的 `[vars] COMPANION_COMMENT_WRITE` 从 `"false"` 改成 `"true"`（默认只读：能看连载、不能留言）。
- 伴侣（自家 AI）拿 `COMPANION_TOKEN` 当 Bearer token，走 MCP 的 bookclub 面连上：能 `published:read`（读连载）+ `comments:read`（读评论）；`COMPANION_COMMENT_WRITE=true` 后还能发评论。
- 提醒：这是 Bearer 参考鉴权，本地用没问题，公网部署要自己加固。

**旧章召回**
- 已发布章节进入打字桌的语义召回层，长剧情里 AI 能想起前面写过的章。

## 🧠 记忆框架

> 每一楼的「前情」= **核心记忆** + **世界书&角色卡** + **旧章召回** + **时光带摘要** + **近景楼层原文** + **状态板**

| 层 | 内容 | 进不进场 |
|----|------|---------|
| 核心记忆 | 你手写的故事总纲 | 永远常驻 |
| 世界书&角色卡 | 设定，按关键词/常驻/在场档触发 | 用到才上桌 |
| 旧章召回 | 读书角已发布章节的语义检索 | 写到相关剧情才想起来 |
| 时光带 | 本窗老楼的自动摘要 | 每 20 层折 16 层（有损，原文不删） |
| 近景楼层 | 最近几楼原文一字不落 | 全自动 |
| 状态板 | 谁在场/状态的结构化数据 | 每楼带着 |

## 🔒 安全须知

1. **美化卡 iframe 会执行包内脚本**——导入不可信预设包前自己掂量。
2. **路径 token / Bearer token 只是参考鉴权**，不是生产级门禁，公网部署前自行加固。
3. **导入不做自动审查**——整包原样进库，内容是否可信由你负责。

---

## License

MIT，见 [LICENSE](LICENSE)。版权署名：**阿日 & 柒**（[tavern-study](https://github.com/TricksterFlare/tavern-study) 原作者）。

特别感谢 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 社区：预设、世界书、正则这套玩法的开创者。
