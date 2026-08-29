# 角色卡精简 · 7 字段 Lite

> 26E 删繁就简：把 V2/V3 的 10+ 字段压到 7 字段，够写、够省 token、够让模型一次看懂。

## 7 字段

| 字段 | key | 必填 | 说明 |
|------|-----|------|------|
| 角色名 | name | 是 | 唯一硬校验，空则整卡拒识 |
| 设定 | description | 否 | 人设/外貌/身份一句话画像 |
| 性格 | personality | 否 | 说话风格、行为模式 |
| 场景 | scenario | 否 | 当前所处场景/关系/前情 |
| 系统提示 | system_prompt | 否 | 额外 system 行为约束 |
| 首条消息 | first_mes | 否 | 开场白范例，决定口吻 |
| 对话示例 | mes_example | 否 | 多轮示例，四句以内最优 |

其余字段（alternate_greetings / post_history_instructions / character_book / tags 等）归扩展，按需 via `extensions` 携带，不进 Lite 主体。Lite 卡 JSON 仍用 `chara_card_v2` 壳：

```json
{
  "spec": "chara_card_v2",
  "data": {
    "name": "露",
    "description": "银发、轻盈、爱笑的旅人",
    "personality": "温柔但捉摸不透，说话带轻笑",
    "scenario": "雨后书店重逢，你是她的旧友",
    "system_prompt": "",
    "first_mes": "...哎呀，又见面了。",
    "mes_example": "{{user}}: 你还记得我吗？\n{{char}}: 怎么会忘..."
  }
}
```

## 小纸条唯一注入

Lite 卡 7 字段只入 `charDescription/charPersonality/scenario` 三槽位，不重复铺。导演小纸条（desk_windows.note）为唯一动态注入位，其余便签/世界书冗余入口降级为草稿，不入 tail。

## 校验

`src/core/characterCard.ts:parseCharacterCard` 照旧全量兼容，Lite 只是“推荐子集”——多给的字段忽略不报错，少给的按空串兜底，仅 name 为硬错误。
