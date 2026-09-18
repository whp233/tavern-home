// src/shared/ids.ts
// 共享 ID 工具。genId 原先在 chat/desk.ts、tools/{desk,deskWindows,deskPanels,deskRecipes}.ts
// 各有一份逐字相同的副本（5 份），2026-09-18 精简批次合并到这里，逻辑一行未改。

// 生成「前缀_时间戳_随机后缀」形式的本地 ID。随机段取 base36 的 9 位，够本地单机去重。
export function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
