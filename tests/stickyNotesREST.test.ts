// tests/stickyNotesREST.test.ts
// 便签 REST 数据层（src/tools/stickyNotes.ts + d1StickyNotesStorage.ts）落库校验（task-15）。
// 用真 D1（miniflare 本地，不落盘）：复用 oc_state 键值表（零 schema 迁移），
// 测试里手动建一张与 init.sql 同形状的 oc_state 表（手法照抄 diaryREST.test.ts 的 getPlatformProxy）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  stickyNotesCreate, stickyNotesGet, stickyNotesList, stickyNotesUpdate, stickyNotesDelete,
} from '../src/tools/stickyNotes.ts';

test('sticky notes REST CRUD + 筛选 + 校验', { timeout: 30_000 }, async () => {
  const wranglerConfigHome = resolve('.tmp-wrangler-sticky-test');
  await mkdir(wranglerConfigHome, { recursive: true });
  process.env.XDG_CONFIG_HOME = wranglerConfigHome;
  const { getPlatformProxy } = await import('wrangler');
  const platform = await getPlatformProxy<{ OC_DB: D1Database }>({ configPath: 'wrangler.test.toml', persist: false });
  try {
    const db = platform.env.OC_DB;
    await db.batch([
      db.prepare(`CREATE TABLE oc_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
    ]);
    const env = { OC_DB: db };

    // create：全字段
    const created = await stickyNotesCreate(env, {
      project: '琉璃塔', charKey: '露', title: '记得带灯', content: '下次进塔前先把提灯挂在门口。', color: 'pink', pinned: true,
    });
    assert.equal(created.success, true);
    assert.match(created.note.id, /^sn_/);
    assert.equal(created.note.project, '琉璃塔');
    assert.equal(created.note.charKey, '露');
    assert.equal(created.note.color, 'pink');
    assert.equal(created.note.pinned, true);

    // create：缺省字段
    const plain = await stickyNotesCreate(env, { content: '通用便签' });
    assert.equal(plain.success, true);
    assert.equal(plain.note.project, '');
    assert.equal(plain.note.charKey, '');
    assert.equal(plain.note.color, 'yellow');
    assert.equal(plain.note.pinned, false);

    // get 全文回填（不截断）
    const got = await stickyNotesGet(env, created.note.id);
    assert.equal(got.success, true);
    assert.equal(got.note.content, '下次进塔前先把提灯挂在门口。');
    assert.equal(got.note.title, '记得带灯');

    // list 筛选 + 排序（置顶优先，latest 在前）
    const all = await stickyNotesList(env, {});
    assert.equal(all.success, true);
    assert.ok(all.notes.length >= 2);
    assert.equal(all.notes[0].id, created.note.id); // pinned 置顶
    assert.equal(typeof all.notes[0].preview, 'string');
    const projectOnly = await stickyNotesList(env, { project: '琉璃塔' });
    assert.equal(projectOnly.count, 1);
    assert.equal(projectOnly.notes[0].charKey, '露');
    const charOnly = await stickyNotesList(env, { charKey: '露' });
    assert.equal(charOnly.count, 1);
    const pinnedOnly = await stickyNotesList(env, { pinned: true });
    assert.equal(pinnedOnly.count, 1);

    // update：部分更新 + pinned 翻转 + content 保留
    const upd = await stickyNotesUpdate(env, created.note.id, { title: '记得带灯（改）', pinned: false });
    assert.equal(upd.success, true);
    assert.equal(upd.note.title, '记得带灯（改）');
    assert.equal(upd.note.pinned, false);
    assert.equal(upd.note.content, '下次进塔前先把提灯挂在门口。');

    // 校验拒绝 / not found
    assert.equal((await stickyNotesCreate(env, { content: '' })).success, false);
    assert.equal((await stickyNotesCreate(env, { content: 'x', color: 'red' })).success, false);
    assert.equal((await stickyNotesUpdate(env, 'sn_no_such', { title: 'x' })).success, false);
    assert.equal((await stickyNotesGet(env, 'sn_no_such')).error, '便签不存在');

    // delete  再 get 不存在  再 delete 报不存在
    assert.equal((await stickyNotesDelete(env, created.note.id)).success, true);
    assert.equal((await stickyNotesGet(env, created.note.id)).success, false);
    assert.equal((await stickyNotesDelete(env, created.note.id)).error, '便签不存在');
  } finally {
    if (typeof (platform as any)?.dispose === 'function') await (platform as any).dispose();
    delete process.env.XDG_CONFIG_HOME;
  }
});