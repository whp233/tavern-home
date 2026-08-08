# tavern-home · 酒馆书房

> 开源 · 免费 · MIT
> **tavern-home** 是 [tavern-study](https://github.com/TricksterFlare/tavern-study) 的独立维护分支，专注开箱即用。

一间搬进你家的写作书房——预设、世界书、正则、角色卡直接导入就能写，推完的剧情存成连载，配一套完整记忆系统，长剧情到第 999 楼还记得第 1 楼。

**本分支的改进**：一键启动（`run.bat`）、更顺手的本地体验、面向新用户的快速上手文档。

---

## 🚀 快速开始（Windows）

> **必备依赖**：只要 **Node.js ≥ 18.18**（推荐 20/22 LTS；本仓在 Node 24 上开发验证）+ npm ≥ 10。wrangler/workerd 与前端构建产物都由 npm 依赖自带，不需要额外装 Python/Go/Rust 之类运行时。

双击根目录的 **`run.bat`**，自动完成：

1. 安装依赖（根目录 + 前端，首次运行会等几分钟）
2. 生成 `.dev.vars` 配置模板（首次），填好 `ANTHROPIC_API_KEY` 后重新运行一次
3. 初始化本地数据库
4. 启动后端（`http://localhost:8787`）+ 前端（`http://localhost:3000`）
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

### 模型配置（必须）

在根目录 `.dev.vars` 里配置鉴权 token + 至少一个模型供应商。`.dev.vars` 不入库，首次由 `run.bat` 生成模板，把下面的键填好再重新运行一次即可：

```ini
AUTH_TOKEN=任意强口令（前端 URL 用的路径 token）
OWNER_TOKEN=另一个强口令（管理/MCP 用）

# 模型供应商（打字桌顶栏「商」按钮可切换；至少配一种）
# opencode 供应商 = 任意 OpenAI 兼容渠道（DeepSeek / 硅基流动 / 自建网关都行）：
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
