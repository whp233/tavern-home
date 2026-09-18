// src/shared/json.ts
// 共享 JSON 容错工具。safeJsonParse 原先有 4 份、safeJsonStringify 有 3 份副本
// （chat/deskBoardRefresh.ts、tools/{deskPanels,deskWindows,deskRecipes}.ts、
//  examples/cloudflare/saveRoutes.ts、chat/desk.ts），2026-09-18 精简批次合并到这里。
//
// 语义统一说明：原副本的守卫写法不一（`!raw` / `=== undefined || === null` / `== null`），
// 且 saveRoutes 那版多一层 String() 转换。空串在 JSON.parse 下本来就会抛→回落 fallback，
// 所以几种写法行为等价；统一用 `raw == null` 守卫 + `String(raw)` 转换，覆盖面最广且无行为变化。

export function safeJsonParse(raw: unknown, fallback: any): any {
  if (raw === undefined || raw === null) return fallback;
  try { return JSON.parse(String(raw)); } catch { return fallback; }
}

// 序列化失败一律回落 '{}'（原副本行为一致）。null/undefined 落成 '{}' 而非 'null'，
// 因为调用方都是往 D1 的 JSON TEXT 列写"对象"。
export function safeJsonStringify(v: unknown): string {
  try { return JSON.stringify(v ?? {}); } catch { return '{}'; }
}
