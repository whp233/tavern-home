import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { D1DeskMemoryStorage } from '../examples/cloudflare/adapters/d1DeskMemoryStorage.ts';

test('D1 desk memory storage CRUD + snapshot restore + scope/anchor', { timeout: 30_000 }, async () => {
  const wranglerConfigHome = resolve('.tmp-wrangler-test');
  await mkdir(wranglerConfigHome, { recursive: true });
  process.env.XDG_CONFIG_HOME = wranglerConfigHome;
  const { getPlatformProxy } = await import('wrangler');
  const platform = await getPlatformProxy<{ OC_DB: D1Database }>({ configPath: 'wrangler.test.toml', persist: false });
  try {
    const db = platform.env.OC_DB;
    await db.batch([
      db.prepare(`CREATE TABLE desk_memories (id TEXT PRIMARY KEY, window_id TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', char_key TEXT NOT NULL DEFAULT '', layer TEXT NOT NULL DEFAULT 'plot', theme TEXT NOT NULL DEFAULT '其他', title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
      db.prepare(`CREATE TABLE desk_memory_snapshots (id TEXT PRIMARY KEY, window_id TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', char_key TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)`),
      db.prepare(`CREATE INDEX desk_memories_window_theme ON desk_memories(window_id, theme, updated_at DESC)`),
      db.prepare(`CREATE INDEX desk_memory_snapshots_window ON desk_memory_snapshots(window_id, created_at)`),
      db.prepare(`CREATE INDEX desk_memories_scope_idx ON desk_memories(project, char_key, layer, updated_at DESC)`),
      db.prepare(`CREATE INDEX desk_memory_snapshots_scope ON desk_memory_snapshots(project, char_key, created_at)`),
    ]);
    const store = new D1DeskMemoryStorage(db);
    const m1 = { id: 'm1', windowId: 'w', project: 'P', charKey: '露', layer: 'anchor' as const, theme: '角色设定', title: '露', content: '主角', createdAt: 't0', updatedAt: 't0' };
    const m2 = { id: 'm2', windowId: 'w', project: 'P', charKey: '露', layer: 'plot' as const, theme: '故事情节', title: '', content: '去过琉璃塔', createdAt: 't1', updatedAt: 't1' };
    await store.createMemory(m1);
    await store.createMemory(m2);

    assert.equal((await store.listMemories('w')).length, 2);
    assert.equal((await store.getMemory('m1'))!.title, '露');

    const upd = await store.updateMemory('m1', { content: '主角，会用火' });
    assert.equal(upd!.content, '主角，会用火');
    // 改层：把 anchor 挪到 plot（显式编辑允许）
    const toPlot = await store.updateMemory('m1', { layer: 'plot' });
    assert.equal(toPlot!.layer, 'plot');
    const m1row = await store.getMemory('m1');
    assert.equal(m1row!.content, '主角，会用火');
    await store.updateMemory('m1', { layer: 'anchor' });

    // 作用域查询
    assert.equal((await store.listByScope({ project: 'P', charKey: '露' })).length, 2);
    assert.equal((await store.listByScope({ project: 'P', charKey: '露', layer: 'anchor' })).length, 1);
    assert.equal((await store.listByScope({ project: 'P', charKey: '' })).length, 0);

    // 快照 + 压缩后重建 + 回退（scoped）
    const before = await store.listMemories('w');
    await store.createSnapshot({ id: 's1', windowId: 'w', project: 'P', charKey: '露', title: '压缩', data: before, createdAt: 'ts' });
    await store.deleteMemory('m2');
    assert.equal((await store.listMemories('w')).length, 1);

    const snapshots = await store.listSnapshots('w');
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].title, '压缩');
    assert.equal((await store.listSnapshotsByScope('P', '露')).length, 1);

    const restored = await store.restoreSnapshot('s1');
    assert.equal(restored!.length, 2);
    assert.equal((await store.listMemories('w')).length, 2);
    assert.equal(await store.restoreSnapshot('nope'), null);

    // 窗口隔离 + truncate（按溯源窗）——用共享区 charKey 避免污染 P/露 角色区
    await store.createMemory({ ...m1, id: 'other', windowId: 'w2', charKey: '' });
    assert.equal((await store.listMemories('w2')).length, 1);
    assert.equal(await store.truncateMemories('w'), 2);
    assert.equal((await store.listMemories('w')).length, 0);

    // replaceScope：批量替换 plot，anchor 守卫（既有 anchor 不被清）
    const anchorOld = { id: 'anchor-old', windowId: 'w', project: 'P', charKey: '露', layer: 'anchor' as const, theme: '角色设定', title: '性格', content: '沉稳', createdAt: 't0', updatedAt: 't0' };
    await store.replaceScope({ project: 'P', charKey: '露', memories: [anchorOld] });
    // 再跑一次 plot 蒸馏：应只清 plot/general、保留 anchor
    await store.replaceScope({ project: 'P', charKey: '露', memories: [{ ...m2, id: 'newplot', charKey: '露', layer: 'plot' }] });
    assert.equal((await store.listByScope({ project: 'P', charKey: '露', layer: 'anchor' })).length, 1); // anchor 仍在
    assert.equal((await store.listByScope({ project: 'P', charKey: '露', layer: 'plot' })).length, 1);   // 只剩新 plot

    // 快照回退能重建到空窗
    const emptySnap = await store.listSnapshots('w2');
    assert.equal(emptySnap.length, 0);
  } finally {
    if (typeof (platform as any)?.dispose === 'function') await (platform as any).dispose();
    delete process.env.XDG_CONFIG_HOME;
  }
});
