# MCP Server 被控端（类 TAVO）· 接入指南（task-32）

> 目标：把酒馆作为 **MCP Server 被控端**，供外部 Agent 通过 **Streamable HTTP** 以 MCP 协议操控全量能力（角色卡/打字桌/记忆/日记/便签）。零额外依赖，手写 JSON-RPC 2.0，鉴权复用既有 `AUTH_TOKEN / OWNER_TOKEN` 体系。

---

## 1. 两种接入轨（双轨并存）

| 轨 | URL | 鉴权 | 适用 |
|----|-----|------|------|
| **Path-token 轨**（与 `/api/oc/*` 同门） | `https://<worker>/\<AUTH_TOKEN>/mcp` | URL 首段 == `AUTH_TOKEN`（`equalSecret`） | 浏览器/脚本直接调，无需 Bearer 头 |
| **Bearer 轨**（主推荐） | `https://<worker>/mcp` | `Authorization: Bearer <OWNER_TOKEN>` + `hasScope(desk:read|desk:write)` | MCP Client 标准头，owner 全量、companion 受限（无 scope 则 403） |

- `GET /mcp` 与 `GET /<AUTH_TOKEN>/mcp` 均返回 `405 method_not_allowed`（P0 仅需 POST，SSE 非必需）。
- `OPTIONS` 自动回 CORS（`ALLOWED_ORIGINS` 白名单）。
- 未鉴权 → `401 unauthorized`（Bearer 轨带 `WWW-Authenticate: Bearer`）；越权 → `403 forbidden`。

---

## 2. 支持的方法

- `initialize` → `{ protocolVersion:"2024-11-05", capabilities:{tools:{listChanged:false}}, serverInfo:{name:"tavern-study",version:"0.2.0"} }`
- `ping` → `{}`
- `tools/list` → `{ tools: TOOL_DEFINITIONS[22] }`
- `tools/call` → 按 `name + arguments` 派发（见 §3）
- `resources/list` / `prompts/list` → 空数组（占位）
- `notifications/initialized` / `notifications/cancelled` → 无 id 时回 `202`（无 body）
- 批量：JSON 数组 → 回 JSON 数组；全通知批量 → `202`

错误码：`-32700 Parse error` / `-32601 Method not found` / `-32602 Invalid params (name 必填)` / `-32603 Internal error`；工具内错误以 `{ isError:true, content:[{type:"text", text:"{success:false,...}"}] }` 形式回。

---

## 3. 22 个工具清单

| 工具 | 必填参 | 说明 |
|------|--------|------|
| `list_presets` | — | 列预设包 |
| `import_character_card` | `card` , `project?` | 导入 SillyTavern v2/v3 卡，自动 `parseCharacterCard` |
| `list_lore` | `project` | 列世界书/角色条目 |
| `create_lore` | `project, title, content` | 新建条目 |
| `update_lore` | `id` | 更新条目 |
| `delete_lore` | `id` | 删除条目 |
| `list_windows` | `project?` | 列写作窗 |
| `get_window` | `id, include_floors?` | 取窗详情，可附楼层 |
| `create_window` | `project` | 建窗（`title/char_key/recipe_id/note/vars` 可选） |
| `update_window` | `id` | 改窗（`title/char_key/vars/stateBoard`） |
| `delete_window` | `id` | 删窗 |
| `list_floors` | `window_id` | 列楼层 |
| `create_floor` | `window_id, content, role?` | 追加楼层（`user/assistant`，`system` 会收敛为 `user`） |
| `edit_floor` | `floor_id, content` | 就地改楼层 |
| `list_memories` | `project|window_id` | 按 `project+char_key+layer` 或 `window_id` 列记忆 |
| `create_memory` | `project, content` | 新建记忆（`title/theme/layer/char_key/window_id` 可选） |
| `update_memory` | `id` | 改记忆 |
| `delete_memory` | `id` | 删记忆 |
| `compact_memories` | `project|window_id` | 压缩（落快照后 `compactMemories()+replaceScope`） |
| `diary_list` | `project?, char_key?, date?, limit?` | 列日记 |
| `diary_create` | `project, date, content` | 新建日记（`YYYY/M/D`） |
| `sticky_notes_list` | `project?, char_key?` | 列便签 |
| `sticky_notes_create` | `project, content` | 新建便签 |

> 未暴露为 tool 但存在于 REST 的能力：`diary_get/update/delete/dates` / `cg*` / `sticky_notes get/update/delete` / `chapter_index/style_ref` 等，必要时可在后续 P1 追加。

---

## 4. curl 冒烟（wrangler dev 本地）

```bash
# Path-token
curl -X POST http://localhost:8799/$AUTH_TOKEN/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

curl -X POST http://localhost:8799/$AUTH_TOKEN/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

curl -X POST http://localhost:8799/$AUTH_TOKEN/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_presets","arguments":{}}}'

# Bearer 正例
curl -X POST http://localhost:8799/mcp \
  -H "Authorization: Bearer $OWNER_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_memory","arguments":{"project":"mcp-smoke","content":"hello via mcp"}}}'

# Bearer 反例（无 token 应 401）
curl -X POST http://localhost:8799/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_memories","arguments":{"project":"mcp-smoke"}}}'

# 通知应 202
curl -X POST http://localhost:8799/$AUTH_TOKEN/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' -i
```

---

## 5. MCP Client 配置示例

```json
// Claude Desktop / Cursor / mcp-inspector（Bearer 轨）
{
  "mcpServers": {
    "tavern-study": {
      "url": "https://<worker>.workers.dev/mcp",
      "headers": { "Authorization": "Bearer <OWNER_TOKEN>" }
    }
  }
}
// Path-token 轨
{
  "mcpServers": {
    "tavern-study-path": {
      "url": "https://<worker>.workers.dev/<AUTH_TOKEN>/mcp"
    }
  }
}
```

E2E 6 步（见 `drafts/task-32-closure-diagnosis.md` Phase C）：`initialize → tools/list → list_presets → import_character_card → create_window → create_floor → create_memory/compact`。

---

## 6. 限制与注意

- `create_floor` 的 `role: "system"` 会被收敛为 `user`（`mcp.ts:427`）；如需 system 楼层请走 REST。
- `compact_memories` 在 MCP 侧为简化版快照+合并，与 `index.ts` 完整路径（anchor 守卫 + 按层 replaceScope）语义一致但未做 `theme` 合并展示，生产大库建议先小库验证。
- 鉴权双轨均需 `ALLOWED_ORIGINS` 放行前端/客户端 Origin，否则 CORS 预检 403。

---

*落盘于 2026-08-29 · task-32 收口窗口 · 验证前请先跑 `npm run typecheck && npm test`（见诊断 Phase A）*
