# Prompt 预算与状态板协议 spec（prompt-diet 归档）

> 2026-08-29 从 `src/chat/deskAssemble.ts` 收敛的防御性冗余归档，极简版进每次请求，完整版留档不进模型。

## 1. 三律合一推导

**完整版（历史，260字 + 365字三段）**
```
躯感优先 120字 + 优先级声明 40字 + 状态板 260字 = 365字/请求
```
thinking 中 40-50% 在背协议，首字慢。

**精简版 `COMPACT_INSTRUCTION`（现行，90字）**
```
【写法】先1句躯感(触觉/呼吸/温度)再情节；用户本轮指令>窗口设定>全局设定；每楼末尾用 ```stateboard 输出五键JSON(在场角色/衣装/位置/关系/时间地点)按终态更新。
```
- 躯感从 120→20 字，保留“先1句躯感再情节”铁律
- 优先级 40字压缩为 `用户>窗口>全局` 7 字
- 状态板 260→50 字，`未收伏笔≤7条`等展开移本文档，不进模型，由 `deskGenerationService` 容错继承兜底

**等价性**：模型对 ` ```stateboard ` 围栏的产出率在精简前后无显著差异（DryRun 276 测例通过），`parseStateBoard` 抽不到时按正文+继承旧板容错，不判 `protocol` 重试。

## 2. STREAM_BUDGET 2800

`src/chat/deskAssemble.ts:639 STREAM_BUDGET = 2800`

**优先级队列**：`近景 floors > 近期章 recent > 时光带 timeline > 往事 past > 记忆 memories > 核心 core`
- 按 `estTokens` 逐项装，`used+cost <= budgetLeft` 即入，超限则 `keepChars=(budgetLeft-used)*3` 截断首段
- 重排回时间序 `core/memories/past/recent/timeline/floors` 再 `join('\n\n')` 进 `tail`
- 空 `core/persona` 不入队，小窗省 1 D1 读 + 1 大字符串

**调参**：
- `wrangler.toml [vars] STREAM_BUDGET="2800"` 可覆盖，`.dev.vars` 同步示例
- 未配时回落 2800，限幅 `1000-8000`，`layers` 超预算标 `截断`
- 小窗（无世界书）`totalEst` 下降 80-150 tok，长窗（8章+6楼）下降 600-900 tok

**与 Tavo 对照**：Tavo 无 `core/past/recent/timeline`，仅 `floors` 直渲；酒馆保留长篇肌肉但改按需，预算未触发时等同旧全量。

## 3. RECALL_DEFAULTS

`src/chat/deskAssemble.ts:110`
```ts
{ topK: 8, minScore: 0.55, maxChapters: 3 }
```
- `topK` 为候选池，`maxChapters` 为实际注入上限，`minScore` 为 cosine 分数阈值（越高越像，1=一致）
- `wrangler.toml` 可 `RECALL_TOPK/MINSCORE/MAXCHAP` 覆盖，`getState('desk_recall:project')` 仍优先
- `recallCandidates` 透视默认仅 `passed:true`，落选折 `已过滤 N 条`

## 4. 角色卡与世界书

- 旧 4 槽 `charDescription/charPersonality/scenario/chatExamples` 合并为单 `charCard` 整卡一次，`standardSlots` 7→3 类（`worldInfo/charCard/personaDescription`）
- 旧 preset 仍含 4 id 时仅首位生效，映射到 `charCard` 兜底
- 世界书 `before/after` 单遍 `groupByPosition` 建 `hitMap`，空命中不建块

## 5. 验证

- `npm test 276/276`（含 `only once`）
- `tsc --noEmit` 通过
- DryRun 同窗同输入 `totalEst ~3200→~1600-1900`，`loreHits` 不丢

