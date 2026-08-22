# 角色卡写作铁律 + 润色检核清单

> 配套 `SKILL.md`。这是写卡/润卡时的依据，所有规范与字段来自权威来源（见 `references.md`），不臆造。

## 一、写作铁律（无论生成还是润色都遵守）

1. **Token 预算（首要）**：永久字段 = name+description+personality+scenario，每次请求都发。description 目标几百 token 量级。**卡太大 ≈ 模型"失忆"**——历史被挤出上下文。token 预算参考（per-field 大概量级）：
   - description：200–400 token 为佳（几百 token ∈ 够定义 + 不挤对话）
   - personality：几句行为化 traits
   - scenario：1–3 句
   - mes_example：2–3 条交换
   - 全卡（含 first_mes/mes_example）越轻越好；kingbri 示例 1300→599 token。
   - **token 估算**：没有现成工具时粗略估即可——中文正文约 **1.5–2 字/token**、英文约 **3–4 字/token**（英文单词≈1 token/词，写整句省得多）。写了字段后用这个折算，超了就砍，别靠"感觉"。精确可用 SillyTavern 卡编辑器/在线 tokenizer，但估算足够先落地。
2. **description 当"人物信息表"，不是短篇小说**。只写会影响行为的信息：年龄区间/身份/定特征/说话风格/关键关系/想要什么。对话里永远不会提的背景故事 → 砍。
3. **personality 写成行为，不写形容词**。「受挫时用玩笑搪塞」「高兴时先嘴硬再服软」 > 「她是个幽默又口是心非的人」。覆盖四问：如何说话 / 压力下如何反应 / 看重什么 / 回避什么。
4. **用 `{{char}}`/`{{user}}` 宏**，不硬编码名字 → 卡片可移植（跨 persona 不崩）。
5. **first message 是最高杠杆字段**：它"展示"而非"讲述"——决定句长/词汇量/叙事密度/对 user 的态度。必须：角色口吻 + 铺场景 + 给 user 可接的话。一句开场 = 一句回复的上限。
6. **用 mes_example 锁声音**：2–3 条 `<START>` 分隔的交换，`{{char}}:`/`{{user}}:` 前缀。这是修"不对味"最直接的手段。
7. **scenario 具体化**：一句到三句，写明地点/当下动作/情绪处境，用宏。
8. **避免矛盾与嵌套重复**：不要相邻写两个意思互含的 trait（如"雌小鬼"别再堆"嚣张/顽劣"）；"Shy and reserved"别配"loves being center of attention"。
9. **extensions 保全**：`extensions` mandatory、默认 `{}`；绝不销毁未知 k-v。
10. **JSON 多行字段用 `\n`**，否则导不进。

## 二、V2 / V3 字段核对

### chara_card_v2（主流，兼容面最广）
顶层必含：`spec:'chara_card_v2'` `spec_version:'2.0'` `data:{...}`。
`data` 内字段：
- 核心：`name`(唯一必填) `description` `personality` `scenario` `first_mes` `mes_example`
- 扩展：`creator_notes` `system_prompt` `post_history_instructions` `alternate_greetings[]` `character_book?`
- 5-8 新增：`tags[]` `creator` `character_version` `extensions{}`

### chara_card_v3（向后兼容 v2）
在 v2 基础上新增：`assets[]` `nickname` `creator_notes_multilingual{}` `source[]` `group_only_greetings[]` `creation_date`(unix 秒 UTC) `modification_date`。
`character_book.entries[].use_regex`（v3 新增）、`constant` 由可选变必实现。
> 无特殊需求默认出 v2（最通用）；用户点名或需要 assets/中文多语备注时再出 v3。

### 字段类型口径（tavern-study `characterCard.ts` 兼容）
- 缺字段 = 正常 ≠ 错误；类型不对 → 该字段按没给处理（warn）。
- `name` 缺失/类型不对/全空白 = 唯一硬错误。
- `character_book.entries` 允许数组或 `{uid: entry}` 对象两种形状。

## 三、润色检核清单（polish 逐项过）

对一张现存卡，逐项检查并在必要时修订：

1. 【硬性】能通过 `tavern-study` 的 `parseCharacterCard`（name 必须有且非空白；字段类型正确）。
2. 【一致性】有无矛盾设定（害羞配爱当焦点 / 冷酷配过度热心）？
3. 【具体度】description 是"信息表"还是"散文墙"？泛泛形容词是否可换成行为性 traits？
4. 【声音】first_mes 是否平铺、平等于一句开场？改用角色口吻 + 铺场景 + 给 user 可接的话。
5. 【可移植】是否硬编码了名字？改用 `{{char}}`/`{{user}}`。
6. 【示例】有没有 mes_example？没有就补 2–3 条锁声音；说话风格不对就重写示例。
7. 【token 预算】永久字段是否超标？砍背景故事墙/冗余 lore。
8. 【完整性】`extensions` 是否存在且 `{}`；多行字段是否 `\n` 转义；是否碰了未知扩展字段（不能删）。
9. 【可选】是否补 `alternate_greetings` / `character_book`（场景/世界观需要时）。
10. 【编号】若 v3：`creation_date`/`modification_date` 是否正确 unix 秒（UTC），不破坏已有值。

## 四、自查红牌（看到即停，先改再交）

- description 有个明明可以更短却写得很长的背景故事。
- personality 是一堆形容词列表，不带任何行为/反应。
- first_mes 只有一句，或语气和 desired 文体相反。
- 卡里写着真名，没走宏。
- 不知道这张卡会不会把 model 带偏——那就补示例锁一下。

## 五、几种常见文体的 first_mes 参考（中文）

- **小说直写**（tavern-study「默认·小说直写」体裁）：第一人称代入 + 动作/感官描写开头，直接推进场景。
  成稿示范（已经 skill 验证过可解析的写法）：
  ```
  *雨声稠密，把整条巷子封成一片青色。{{char}} 刚拧暗门口那盏灯，拢着光往回走，门就在这时被推开了。水汽裹着冷气涌进来，门槛上立刻积起一小滩。*

  「打烊了。」她没抬头，声音慢，像在陈述一件早就知道的事。……「不过你身上的水太满，要走也走不了。」她搁下擦了一半的酒盏，朝柜后那只还温着的炉子偏了偏头。

  *她没急着问你是谁，先搁了一只干净的旧木碗在吧台上，碗沿磕出一声轻响。*
  ```
  结构拆解：`*动作/感官铺场景*` + `"一句话打出态度和角色调子"` + `*再一个动作留钩子，让 {{user}} 有得回应*`。凡"小说直写"，照这个三段走。
- **对白向**：从一句"中段感"的话开场（不像自我介绍），一句话里带态度和关系。
- **群像/世界观向**：先描环境 + 次要角色反应，再落到 {{char}} 的动作，给 user 两个可回应的钩子。
> 铁律：无论文体，都要"展示"——用场面和动作带出性格，不靠旁白贴标签。
