import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { D1DailyLoginStore } from '../examples/cloudflare/adapters/d1DailyLoginStore.ts';

test('D1 daily-login store: config/state round-trip + reset', { timeout: 30_000 }, async () => {
  const wranglerConfigHome = resolve('.tmp-wrangler-test');
  await mkdir(wranglerConfigHome, { recursive: true });
  process.env.XDG_CONFIG_HOME = wranglerConfigHome;
  const { getPlatformProxy } = await import('wrangler');
  const platform = await getPlatformProxy<{ OC_DB: D1Database }>({ configPath: 'wrangler.test.toml', persist: false });
  try {
    const db = platform.env.OC_DB;
    await db.prepare(`CREATE TABLE IF NOT EXISTS oc_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();

    const store = new D1DailyLoginStore(db);
    // 初始为空 → null
    assert.equal(await store.getConfig(), null);
    assert.equal(await store.getState(), null);

    // 保存配置 + 状态，回读一致
    await store.saveConfig({ enabled: true, title: '每日问候', content: '今天也来陪妹妹吧！', triggerDate: '' });
    const cfg = await store.getConfig();
    assert.equal(cfg!.enabled, true);
    assert.equal(cfg!.title, '每日问候');
    assert.equal(cfg!.content, '今天也来陪妹妹吧！');
    assert.equal(cfg!.triggerDate, '');

    await store.saveState({ lastTriggerDate: '2026-08-22', triggerCount: 1 });
    const state = await store.getState();
    assert.equal(state!.lastTriggerDate, '2026-08-22');
    assert.equal(state!.triggerCount, 1);

    // 非法 value（非 JSON）→ null，不炸
    await db.prepare(`INSERT OR REPLACE INTO oc_state (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind('daily_login:state', 'not-json', new Date().toISOString()).run();
    assert.equal(await store.getState(), null);

    // reset 清空状态（配置保留）
    await store.resetState();
    assert.equal(await store.getState(), null);
    assert.notEqual(await store.getConfig(), null);
  } finally {
    await platform.dispose();
  }
});