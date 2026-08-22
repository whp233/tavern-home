// D1 版每日登录触发存储（task-17）：复用 oc_state 键值表(key TEXT PRIMARY KEY, value TEXT, updated_at)。
// 两个键：daily_login:config（DailyLoginConfig 的 JSON）、daily_login:state（DailyLoginState 的 JSON）。
// 不带业务逻辑——判定/状态推进在 src/core/loreTrigger.ts 纯函数，路由在 index.ts。
// 零 schema 变更：oc_state 从 init.sql 起就存在，不需要迁移。

import type { DailyLoginConfig, DailyLoginState } from '../../../src/core/loreTrigger.ts';

const CONFIG_KEY = 'daily_login:config';
const STATE_KEY = 'daily_login:state';

function parseRow(row: any): any {
  if (!row || typeof row.value !== 'string') return null;
  try {
    const parsed = JSON.parse(row.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export class D1DailyLoginStore {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async getConfig(): Promise<DailyLoginConfig | null> {
    const row = await this.db.prepare(`SELECT value FROM oc_state WHERE key = ?`).bind(CONFIG_KEY).first<any>();
    const parsed = parseRow(row);
    if (!parsed || typeof parsed.enabled !== 'boolean') return null;
    return {
      enabled: parsed.enabled,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      content: typeof parsed.content === 'string' ? parsed.content : '',
      triggerDate: typeof parsed.triggerDate === 'string' ? parsed.triggerDate : '',
    };
  }

  async saveConfig(config: DailyLoginConfig): Promise<void> {
    await this.db.prepare(`INSERT OR REPLACE INTO oc_state (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind(CONFIG_KEY, JSON.stringify({
        enabled: config.enabled,
        title: config.title,
        content: config.content,
        triggerDate: config.triggerDate ?? '',
      }), new Date().toISOString()).run();
  }

  async getState(): Promise<DailyLoginState | null> {
    const row = await this.db.prepare(`SELECT value FROM oc_state WHERE key = ?`).bind(STATE_KEY).first<any>();
    const parsed = parseRow(row);
    if (!parsed) return null;
    const count = Number(parsed.triggerCount);
    return {
      lastTriggerDate: typeof parsed.lastTriggerDate === 'string' ? parsed.lastTriggerDate : null,
      triggerCount: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0,
    };
  }

  async saveState(state: DailyLoginState): Promise<void> {
    await this.db.prepare(`INSERT OR REPLACE INTO oc_state (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind(STATE_KEY, JSON.stringify({
        lastTriggerDate: state.lastTriggerDate,
        triggerCount: state.triggerCount,
      }), new Date().toISOString()).run();
  }

  /** 状态清空（管理/测试用）：跨日模拟可以走它，让「每日首次」判定重新生效。 */
  async resetState(): Promise<void> {
    await this.db.prepare(`DELETE FROM oc_state WHERE key = ?`).bind(STATE_KEY).run();
  }
}