# 每日登录触发机制（task-17 复现：「每天登录弹一次」）

> 研究产出 + 复现方案文档（task-17）。妹居参照见 `~/.agents/team/drafts/meiju-implementation-analysis.md` §5/§6（日期状态 + 事件条件组件引擎）。实现代码：`src/core/loreTrigger.ts`（纯函数）、`examples/cloudflare/adapters/d1DailyLoginStore.ts`（D1 落库）、`examples/cloudflare/index.ts`（路由）、`frontend/app/study/DailyLoginEvent.tsx`（弹窗/提醒入口）、`frontend/app/study/page.tsx`（挂载）。

## 1. 机制原理

「每天首次登录弹一次特定剧情/事件」在各类游戏/AI 应用里是同一个通用模式，拆开只有三件事：

1. **状态记录**：持久化「上次触发日期」（有的还带累计次数）。妹居里是 `current-date` 日期系统 +「今日行动 (3/3)」每日限额这类**每日状态增量**；落到我们的栈里就是一个键值（`oc_state` 表 `daily_login:state`）。
2. **登录/启动钩子**：在每天首次进入应用的位置挂一个检查点（前端进书房页、后端 `/claim` 路由）。妹居在登录/天切换时检测「日期变化」走事件条件引擎；我们就是页面挂载时发一次 claim。
3. **触发判定**（纯逻辑，与存储解耦）：`today != lastTriggerDate` → 触发；`today == lastTriggerDate` → 不重复触发（同日去重）；跨日（第二天再来）→ `lastTriggerDate` 落后于 today，自动恢复触发——这就是**跨日重置**，不需要定时器/任务调度。

妹居的附加维度（事件→条件→组件规则表、`priority`、`preload`）属于「命中后演什么」的**组件引擎**；本任务按任务书 P2 的轻量要求，把「弹什么」做成**可配置的一段预设剧情/提醒**（标题 + 正文），命中后前端弹层展示，不再引组件引擎（task-14 若接入可在此扩展）。

## 2. 复现架构（本仓库）

```
前端 DailyLoginEvent.tsx（进书房挂载）
   │ POST /api/oc/desk/daily-login/claim  { today: 'YYYY-MM-DD' }   ← 登录钩子（带本地日期）
   ▼
index.ts 路由 ──► loreTrigger.ts 纯函数（判定 + 状态推进）
                     ▲
                     │ oc_state 键值
   d1DailyLoginStore.ts（daily_login:config / daily_login:state）
```

- **日期键**：一律 `YYYY-MM-DD`（本地时区）。claim 时前端传本地日期，避免 Worker 所在时区与用户时区不一致导致「跨日」判错；非法/缺省回落服务端日期。
- **判定（`evaluateDailyLogin`）**：`enabled=false` → 不开；`triggerDate` 配了且 != today → 不到那天；`state.lastTriggerDate === today` → 今天已弹；否则弹。
- **状态推进（`nextDailyLoginState`）**：弹完写 `lastTriggerDate=today`、`triggerCount+1`。
- **落库**：复用 `oc_state` 键值表（`init.sql` 起就有），**零 schema 变更、零迁移**，不与 task-12 的 `0006_diary.sql` 等并行迁移冲突。

## 3. API 契约

全部挂在 `/{AUTH_TOKEN}/api/oc/...` 路径 token 之下（与既有 /api/oc 同闸）。

| 方法 | 路径 | body | 返回 |
|---|---|---|---|
| GET | `/api/oc/desk/daily-login` | — | `{ success, config, state }`（配置与状态，设置面板初始化用） |
| POST | `/api/oc/desk/daily-login/claim` | `{ today?: 'YYYY-MM-DD' }` | 命中：`{ success, triggered:true, reason:'ok', today, event:{title,content}, state }`；未命中：`{ success, triggered:false, reason:'disabled'|'not_trigger_day'|'already_triggered', today, state }` |
| PUT | `/api/oc/desk/daily-login/config` | `{ enabled?, title?, content?, triggerDate? }` | `{ success, config }`；`triggerDate` 非空时必须 `YYYY-MM-DD` |
| POST | `/api/oc/desk/daily-login/reset` | — | `{ success, state }`（清空触发状态＝模拟跨日重置，管理/测试用） |

## 4. 可配置项

| 配置 | 含义 | 默认 |
|---|---|---|
| `enabled` | 总开关 | `true` |
| `triggerDate` | 指定哪天弹（`YYYY-MM-DD`）；留空 = 每天首次登录都弹 | `''`（每天） |
| `title` | 剧情/提醒标题 | `每日问候` |
| `content` | 剧情正文（一段式独白/提醒，弹层 `pre-wrap` 展示） | `''`（空时前端提示去设置） |

配置落 `daily_login:config`，前端弹窗内「⚙ 设置每日剧情」即可改（开关 + 日期 + 标题 + 正文），并带「重置今日状态」用于验证。

## 5. 验证

- 判定逻辑：`npm test`（`tests/dailyLogin.test.ts` 9 条 + `tests/d1DailyLoginStore.test.ts` 1 条，覆盖首次/同日重复/跨日重置/开关/指定日期/状态推进/落库回读）。
- 功能走查：进书房 → 弹剧情 → 关掉再进（刷新）不再弹 → 重置今日状态再刷新 → 又弹；配置关掉后不再弹；指定 `triggerDate` 只在当天弹。
- 工程门：`npm run typecheck` 0 错、`npm test` 全绿、前端 `npm run build` 通过；新文件全部 UTF-8 无 BOM；未提交 git，等用户验收。

> ⚠️ 并行窗口提示：task-12 窗口正在同仓加日记（`src/core/diaryService.ts` 等）——若 `typecheck`/wrangler `build` 出现该文件的 TS2588 报错，属 task-12 在途代码，需其窗口修复（本任务窗口不越界改它）。