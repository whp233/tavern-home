---
name: character-card-writing
description: Use when 需要写一张新的 SillyTavern / 酒馆角色卡（chara_card_v2/v3），或对现有角色卡做修改、润色、一致性检查。产出可直接导入的标准角色卡 JSON。适用于 tavern-study / 打字桌项目中所有角色卡相关的生成与润色需求。
---

# 角色卡写作 Skill（Character Card Writing）

## 概览

核心原则：**每一 token 都要挣它的位子。** 角色卡所有永久字段（name/description/personality/scenario）每次请求都被发给模型，卡太大就会挤掉聊天历史——模型"失忆"的常见真因。好卡 = 具体、一致、精简。产出物永远是**标准 `chara_card_v2`/`v3` JSON**（tavern-study 的 `src/core/characterCard.ts` 能直接解析）。

## 两种模式

- **generate（生成）**：给一段设定/几句话，生成一张完整、可直接导入的角色卡。
- **polish（润色）**：给一张现存卡，检查一致性、具体度、token 预算，按需改进字段（可只改单字段），保底给一份修订后的完整 JSON。

## 生成流程

1. 摸清用户想要的：身份/外貌/性格/说话风格/与 {{user}} 的关系/初始场景/文体。
2. 按「写作铁律」填字段（见 `checklist.md`），落进 `templates/card-v2-empty.json` 骨架。
3. **重点打磨 first message**——它是最省杠杆字段，决定整场 RP 的基调与文体（见 checklist 铁律 5）。
4. 加 2–3 条 `mes_example` 锁声音（`<START>` 分隔、`{{char}}:`/`{{user}}:` 前缀）。
5. 复核 token 预算与一致性，给用户一张干净 JSON。

## 润色流程

1. 读现存卡，逐字段对照 `checklist.md` 的检核清单。
2. 按「Match the Form」对症改进：矛盾设定→删/改；泛泛形容词→具体 traits；开场平→重写 first message；硬编码名字→换 `{{char}}`/`{{user}}`；缺示例→补 mes_example；token 超标→精简。
3. 输出修订版完整 JSON（保留未知扩展字段，绝不销毁 `extensions`）。
4. 简单改动（只调一字段）也保持整卡可用，别把结构改坏。

## 快速参考

| 字段 | 作用 | 是否永久注入 | 写法要点 |
|------|------|------------|---------|
| `name` | 名字 | 是 | 唯一必填；示例里用 `{{char}}` 宏而非硬编码 |
| `description` | 人物信息表 | 是 | 具体事实：身份/外貌/定特征/说话风格/关键关系/想要什么；几百 token，别写背景故事墙 |
| `personality` | 行为化 traits | 是 | "用玩笑搪塞" > "她幽默"；覆盖如何说话、压力下如何反应、看重/回避什么 |
| `scenario` | 开局处境 | 是 | 1–3 句，`{{char}}`/`{{user}}`，地点+当下+情绪 |
| `first_mes` | 开场白 | 开头注入 | **最高杠杆**；定句长/词汇/叙事密度；用角色口吻铺场景、给 user 可接的话 |
| `mes_example` | 示例对话 | 有余量才注入 | 2–3 条，`<START>` 分隔，`{{char}}:`/`{{user}}:` 前缀，锁声音 |
| `character_book` | 世界书/lore | 触发注入 | 条目 keys/content/enabled/constant/position，见 `templates/lorebook.json` |
| `system_prompt`/`post_history_instructions` | 覆盖系统提示 | 是 | 留空或按需；`{{original}}` 插入原默认 |
| `alternate_greetings` | 备用开场 | 开头 | 群聊随机/可 swipes |

## 常见错误（写作时主动规避）

- **矛盾设定**："害羞内向"配"爱当焦点"——模型会挑着用，不稳定。
- **背景故事墙**：对话永远不提的历史，纯占 token。
- **泛泛开场**：一句话开场教会模型写一句话回复；开场要铺场景+给动作+让 user 有得接。
- **硬编码名字**：不用宏，跨 persona 就崩。
- **无示例对话**：没有声音样本，模型长对话里靠猜，越写越偏。
- **personality 写人群标签**（"雌小鬼"里的嚣张/顽劣等嵌套重复的意思）。

## 配套文件

- `checklist.md` — 写作铁律 + 润色检核清单（V2/V3 双版本字段核对 + token 预算表 + 常见错自查）。
- `templates/card-v2-empty.json` — chara_card_v2 空白骨架（生成时填）。
- `templates/lorebook.json` — character_book（世界书）骨架。
- `templates/archetypes.md` — 4 种常见 archetype 的字段级写法骨架（romantic companion / mentor / rival / mysterious stranger）。
- `references.md` — 规范与教程来源清单（写卡依据，可溯源）。
- `examples/linwan.json` — 一张经本 skill 生成并通过 tavern-study `parseCharacterCard` 的完整示范卡（"林晚·酿酒师"，小说直写文体），作成品参考。

## 注意

- 产出一定是标准 JSON 且多行字段用 `\n` 转义（否则导不进）。
- 保留未知的 `extensions` k-v，别销毁；`extensions` 必须默认 `{}`。
- 文体/语言：默认中文好文笔示例（含中文示例对话）；若用户带 Source/原文再对应该文体。
- 与 tavern-study 打通（`src/core/characterCard.ts` / 打字桌导入）已验证格式兼容；本 skill 只产卡，不碰项目运行时代码。
