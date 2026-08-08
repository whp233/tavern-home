// D1 版 ProviderConfigStore:复用 oc_state 键值表(key TEXT PRIMARY KEY, value TEXT, updated_at)。
// key = provider_config:<id>,value = ProviderOverride 的 JSON。
// 读/写惯例对齐 d1DeskStoryStorage / deskPanels.ts(INSERT OR REPLACE + SELECT value WHERE key=?),
// 不带任何业务逻辑——合并/校验都在上层(streamModelBackends.ts / index.ts 路由)。

import type { ProviderConfigStore, ProviderOverride } from '../../../src/core/providerConfigStore.ts';

const KEY_PREFIX = 'provider_config:';

function parseRow(row: any): ProviderOverride | null {
  if (!row || typeof row.value !== 'string') return null;
  try {
    const parsed = JSON.parse(row.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as ProviderOverride;
  } catch {
    return null;
  }
}

export class D1ProviderConfigStore implements ProviderConfigStore {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async list(): Promise<ProviderOverride[]> {
    // LIKE 'provider_config:%'——冒号/下划线都不会出现在前缀里,但照例在 JS 侧再按前缀过滤,
    // 防哪天前缀加了 `_` 被 LIKE 当单字符通配误伤。
    const result = await this.db.prepare(`SELECT key, value FROM oc_state WHERE key LIKE 'provider_config:%'`).all<any>();
    return (result.results || [])
      .filter((r) => typeof r.key === 'string' && r.key.startsWith(KEY_PREFIX))
      .map((r) => parseRow(r))
      .filter((o): o is ProviderOverride => o !== null);
  }

  async get(id: string): Promise<ProviderOverride | null> {
    const row = await this.db.prepare(`SELECT value FROM oc_state WHERE key = ?`).bind(`${KEY_PREFIX}${id}`).first<any>();
    return row ? parseRow(row) : null;
  }

  async put(o: ProviderOverride): Promise<void> {
    await this.db.prepare(`INSERT OR REPLACE INTO oc_state (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind(`${KEY_PREFIX}${o.id}`, JSON.stringify(o), new Date().toISOString()).run();
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare(`DELETE FROM oc_state WHERE key = ?`).bind(`${KEY_PREFIX}${id}`).run();
  }
}
