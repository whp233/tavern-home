# 角色卡写作 Skill · 参考来源清单

> 写卡/润卡的依据与溯源。所有规范字段均来自以下权威来源，不臆造。检索于 2026-08-15。

## 规范（字段为准）
- **chara_card_v2 spec** — https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md
  `spec`/`spec_version`/`data{...}` 结构，全部字段类型，`character_book` 条目字段，extensions 保全铁律。
- **chara_card_v3 spec** — https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md
  相对 v2 新增字段（`assets[]`/`nickname`/`creator_notes_multilingual`/`source[]`/`group_only_greetings[]`/`creation_date`/`modification_date`），`use_regex`，`constant` 必实现。
- **SillyTavern 官方 Character Design 文档** — https://docs.sillytavern.app/usage/core-concepts/characterdesign/
  Permanent Tokens 定义、token 预算、first message / alternate greetings / prompt overrides / personality summary / scenario / character's note / talkativeness / mes_example 的正确写法、`<START>` 用法。
- **kingbri minimalistic guide**（官方文档首推的低 token 写卡法）— https://rentry.co/kingbri-chara-guide
  PLists 结构、分节化 persona（Outfit/Body/Tags/Scenario）、world info 替代膨胀的例子、token 压缩（示例 1300→599）。

## 写作方法论
- **Character Card Best Practices (2026)** — https://tavernsprite.com/blog/sillytavern-character-card-best-practices/
  具体/一致/精简三原则；description 当信息表；personality 当 traits 不当散文；first_mes 最高杠杆；宏与示例对话；token 预算；常见错误清单。
- **Character Card Creation Guide (2026)** — https://tavernsprite.com/blog/sillytavern-character-card-creation-guide/
  chara_card_v2 JSON 全字段表、五种步骤、常见错误（*供参考的二手教学，字段已与官方 spec 核对*）。
- **中文·知乎《SillyTavern 教程（四）角色卡创建》** — https://zhuanlan.zhihu.com/p/22559084644
  角色卡三区域（绿=性格/场景/描述 永久 · 蓝=首条+示例 仿写风格 · 红=character's note 动态/后期补设定）；如何把小说角色映射到卡字段。
- **中文·世界书教程 ver1.2（Scribd）** — https://www.scribd.com/document/877375531/
  YAML vs Markdown 写法差异；角色生成器模板思路；**迭代润色工作流**（先喂设定→提问收敛→单独改栏目→手工润色）；状态栏规则；正则隐藏既往状态栏。（*有二手/翻译痕迹，方法论可借鉴，字段以官方 spec 为准*）
- **SillyTavern 中文文档（人设 persona）** — https://sillytavern.wiki/usage/core-concepts/personas/
  人设与角色卡的区别、人设描述与注入位置。

## 社区现有工具 / 模板（备选参考）
- **SillyTavern-CharCardStudio**（ST 前端插件，UI 建卡与世界书）— https://github.com/MMKAVERAPPA/SillyTavern-CharCardStudio
- **Universal Character Card Creator**（System Prompt 自动生成卡，Reddit r/SillyTavernAI）— https://www.reddit.com/r/SillyTavernAI/comments/1o8kiwg/
- **角色卡质量检查器**（本地可解释，auditable rubric）— GitHub topic: https://github.com/topics/character-card-v2
- **Character Card Templates（4 种 archetype，字段级骨架）** — https://tavernsprite.com/blog/sillytavern-character-card-templates/
  （本 skill 的 `templates/archetypes.md` 由此改编并中文化，字段结构对齐官方 spec）

## 本项目（tavern-study）内部依据
- `src/core/characterCard.ts` — 三种格式（V1/V2/V3）解析契约；字段容错口径（缺字段=正常、name 缺失=唯一硬错、entries 数组/对象两形均可）。
- 产出 V2/V3 卡可直接被该项目解析落库，与打字桌导入格式打通。
