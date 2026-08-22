# 小说章节记忆机制 + 参考小说/风格（task-18/19）

## 背景

长篇小说逐章生成时，模型不能光靠窗口历史——需要一套「章节索引 + 检索 + 前文提要/大纲/记忆」机制，保证前后连贯不丢设定；同时用户可指定参考书目的描写风格，同一剧情在不同风格下产出差异可感知。

## 机制总览

### 章节记忆（task-18）

两条流程，双入口：

**流程 A：章节写作闭环（写作态）**

```
[用户描述需求] → [章节选择 + 参考风味] ⇄ [模型输出样本] → 验收判定
                                        ↑ 不符合  │ 符合 ↓
                                        └─────────┘  记忆机制标记完成（章节正文 + 索引落库）
```

- 章节选择：可多轮调整；风味与 task-19 同链路接入；两步均可跳过（走捷径直接落库）。
- 样本输出：模型输出本章样本。
- 验收判定：按验收标准（风格贴合/前后连贯/设定不串/字数合规）判定；不符合 → 返回「章节选择+风味」重选，不消耗完成态可反复回环。
- 符合 → 章节正文 + 索引条目（章号/主题/关键事件/角色状态摘要）落库，成为后续章的检索素材。

**流程 B：开始新对话 续写引导态**

```
[读之前的小说章节索引] → [调用工具查找相关情节]（非全文搜索：按索引条目/关键词/角色状态检索即可）
→ [模型输出相关记录] → 信息是否俱全？→ 否：继续读索引（迭代检索）
                                    → 是：输出 前文提要 + 大纲 + 记忆 → 开启新对话
```

- 检索源统一为「章节索引 + 其它记忆/世界书等杂源」聚合（打字桌记忆 `desk_memories` + 世界书 `desk_lore`）。
- 检索粒度段落级，不做全文/向量 RAG；检索上限 `MAX_RETRIEVAL_ROUNDS=3` 达上限取当前最好结果，绝不挂死。
- 产物注入格式对齐 task-10 记忆分层（【人设锚定区】/【剧情摘要区】/【通用区】层标题原样保留）。

**第一步前置——整合整理已有章节（用户复核补充）**

新增「选择/指定要整合整理的章节」作用域 = 已有章节（非仅新写）。执行人默认用户选择为主、大模型可建议（做成可配置：`POST /novel/integrate` 传 `chapters=[章号]` 为用户指定，传 `auto=true` 为未整理优先的确定性建议位）。风味挑选/输出样本可跳过，不符预期回选择，符合 → 记忆机制标记完成。

### 参考小说/风格（task-19）

- 前端每项目一套配置（书名/风格要点/样例段落 + 启用开关），持久化在 `oc_state`。
- 生成时把参考风格注入提示词（prompt 级，不做 RAG、不做模型微调）。
- 同一剧情，指定参考 vs 不指定，描写风格差异明显（见下「AB 对比」）。

## 数据模型

**章节索引条目 `ChapterIndexEntry`**

| 字段 | 含义 |
|------|------|
| `chapterNo` | 章号，同项目内索引主键 |
| `title` | 章题 |
| `theme` | 主题（整合整理后填充；未整理为 `未整理`） |
| `events` | 关键事件要点（≤8 条，单条 ≤120 字） |
| `charState` | 角色状态摘要（≤400 字，本章结束时各角色处境） |
| `summary` | 章节梗概（成书转写的 `<summary>`，≤600 字） |
| `sourceChapterId` | 关联读书角 `oc_chapters.id` |
| `integrated` | 记忆机制标记完成（整合整理过且信息齐全） |

存储：`oc_state` 键 `desk_chapter_index:<project>` → `{ version:1, entries:[...] }`，零 schema 迁移。

**参考风格配置 `StyleRefConfig`**

| 字段 | 含义 |
|------|------|
| `enabled` | 是否启用 |
| `bookTitle` | 参考书目（书名，仅作风格指向） |
| `styleNotes` | 风格要点描述 |
| `excerpt` | 样例段落（用户自备短节选，尊重版权） |

存储：`oc_state` 键 `desk_style_ref:<project>` → `{ version:1, config:{...} }`。

## 检索细节

- 查询分词：ASCII 词元（≥2 字符）+ CJK 连续段切二元组；去重保序上限 24。
- 计分：词条命中计分（text 含 term 记 1 分，大小写不敏感）。
- 多轮放宽：第 1 轮整句词条；不足 `minRecords=3` → 第 2 轮 CJK 逐字放宽；仍不足 → 第 3 轮兜底（最新已整合章 + anchor 记忆无条件入选）。
- 上限 `MAX_RETRIEVAL_ROUNDS=3`，`RETRIEVAL_RECORD_LIMIT=6`，单条记录截 `400` 字。

## 注入点

| 注入点 | 文本块 | 说明 |
|--------|--------|------|
| 自动成书 `src/tools/deskBook.ts` | 【前文提要·章节索引】+【相关旧章素材】+【记忆】+【参考风格】 | 按章组查询 `aggregateRetrieval` 现算相关素材；成书成功自动种基础索引条目 |
| 打字桌聊天 `src/chat/desk.ts` | 同上（附录拼进 `memories` 槽） | 查询 = 本楼输入 + 最近 3 楼；读失败不打断装配 |

`deskGenerationService.ts` 也暴露 `styleRefBlock` 注入段（`GenerateDeskTurnInput.styleRefBlock` 追加为 system 块），供 `TavernStudyHost` 侧可选接入。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/oc/desk/novel/chapter-index?project=` | 列索引 |
| `POST` | `/api/oc/desk/novel/chapter-index` | 手工维护：`{project, entry:{...}}` 或 `{project, entries:[...]}` |
| `DELETE` | `/api/oc/desk/novel/chapter-index?project=&chapter_no=` | 删一条 |
| `PUT` | `/api/oc/desk/novel/style-ref` | 保存风格配置 |
| `GET` | `/api/oc/desk/novel/style-ref?project=` | 读风格配置 |
| `POST` | `/api/oc/desk/novel/retrieve` | 统一检索：`{project, query, char_key?, limit?}` → `{records, brief, rounds_used, exhausted}` |
| `POST` | `/api/oc/desk/novel/integrate` | 整合整理：`{project, chapters?:[章号], auto?:bool, extract?:bool, char_key?, model?}` |

## AB 对比（task-19 验收）

同一剧情提示词「傍晚的琉璃塔前，两人对峙」：

- **不指定参考**：模型按默认中性叙事输出，句式规整，感官描写适中。
- **指定参考**：`bookTitle=百年孤独`，`styleNotes=绵长的复合句、魔幻与现实交织、重感官细节、节奏舒缓`，`excerpt=许多年以后，面对行刑队…` → 生成在保持既有人设/设定/剧情走向的前提下，句式拉长、意象叠加、感官与回忆交织，氛围与节奏向参考靠拢，差异可感知。

复现：在章节工房「章节记忆 · 参考风格」面板填好并保存风格配置 → 自动成书或打字桌新对话生成同一段剧情 → 对比两档输出。

## 文件

- `src/core/deskMemory.ts`（扩展）：索引/检索/简报/抽取纯函数
- `src/core/deskGenerationService.ts`（扩展）：`StyleRefConfig` + `renderStyleRefBlock` + system 注入段
- `examples/cloudflare/adapters/d1DeskChapterMemoryStorage.ts`（新）：`D1DeskChapterMemoryStore`
- `src/tools/chapterMemory.ts`（新）：上述 7 个路由的请求壳 + `buildChatAppendix`
- `examples/cloudflare/index.ts`：挂载 6 条 `/api/oc/desk/novel/*` 路由
- `src/tools/deskBook.ts`：成书注入 + 自动索引落库
- `src/chat/desk.ts`：聊天注入（`buildChatAppendix`）
- `frontend/app/study/ChaptersStudio.tsx`：折叠面板「章节记忆 · 参考风格」
- `tests/chapterMemory.test.ts`：纯函数 + D1 存储往返
- `docs/novel-chapter-memory.md`：本文档
