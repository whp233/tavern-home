// tests/readingTrash.test.ts
// 读书角章节的软删/回收站数据层校验(src/tools/reading.ts)。
// 用真 D1(miniflare 本地,不落盘)起一张跟 examples/cloudflare/schema/init.sql + 迁移 0002
// 同形状的 oc_chapters(含 deleted_at)表和 oc_comments 表——手法照抄 tests/study.test.ts /
// tests/d1DeskAdapters.test.ts(同一套 getPlatformProxy 起 D1 的家法)。
//
// 覆盖:软删后默认列表消失+进回收站、已删章拒绝 get/update/publish/unpublish、
// restore 恢复且 status 保持原样、permanent 彻底删(评论级联删)、trashed 列表、status 校验。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { register } from 'node:module';

// reading.ts 的依赖链会拖进 src/tools/desk.ts(embedChapterSummary),而 desk 链的相对导入
// 不带扩展名(src/tools/desk.ts → '../storage/vectorize'、→ './deskWindows' → '../chat/deskTimeline'…),
// 裸 `node --test` 的 ESM 解析不认——这是 desk 链的既有状态,不在本次改动范围里,别去动那些文件。
// 这里先用 node:module.register 挂一个只在默认解析失败时补扩展名的 resolve 钩子(resolve-ext.mjs),
// 再动态 import reading.ts,让测试能跑起来又不碰 desk 链的代码。
register(new URL('./resolve-ext.mjs', import.meta.url));
const reading: any = await import('../src/tools/reading.ts');
const {
  chapterCreate, chaptersList, chapterGet, chapterUpdate, chapterPublish, chapterUnpublish,
  chapterDelete, chapterRestore, chapterDeletePermanent, chaptersExport,
} = reading;

// 跟 init.sql:29 + 迁移 0002(deleted_at)同形状。OC_VECTORIZE/AI 没接:
// create/publish 里的向量钩子会在各自 try/catch 里留痕,不影响 D1 这条主线。
const OC_CHAPTERS_DDL = `CREATE TABLE oc_chapters (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  chapter_no TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  published_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;
const OC_COMMENTS_DDL = `CREATE TABLE oc_comments (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  reply_to TEXT,
  author_id TEXT NOT NULL,
  author_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
)`;

function ids(list: any[]): string[] {
  return list.map((c: any) => c.id);
}

test('chapter soft delete / restore / permanent delete / trashed list', { timeout: 30_000 }, async () => {
  const wranglerConfigHome = resolve('.tmp-wrangler-trash-test');
  await mkdir(wranglerConfigHome, { recursive: true });
  process.env.XDG_CONFIG_HOME = wranglerConfigHome;
  const { getPlatformProxy } = await import('wrangler');
  const platform = await getPlatformProxy<{ OC_DB: D1Database }>({ configPath: 'wrangler.test.toml', persist: false });
  try {
    const db = platform.env.OC_DB;
    await db.batch([
      db.prepare(OC_CHAPTERS_DDL),
      db.prepare(OC_COMMENTS_DDL),
    ]);
    const env = { OC_DB: db } as any;

    // 建两条:一条直接发布,一条留草稿
    const a = await chapterCreate(env, { project: 'P', chapter_no: '1', title: 'A', content: 'body A', status: 'published' });
    const b = await chapterCreate(env, { project: 'P', chapter_no: '2', title: 'B', content: 'body B' });
    assert.equal(a.success, true);
    assert.equal(b.success, true);
    assert.equal(a.status, 'published');
    assert.equal(b.status, 'draft');

    // 默认列表两条都在(排除已删的)
    let list = await chaptersList(env, { project: 'P', limit: 50 });
    assert.equal(list.count, 2);

    // 给 A 留一条评论:软删不该带走它(恢复后评论原样在)
    await db.prepare(
      `INSERT INTO oc_comments (id, chapter_id, author_id, author_type, display_name, content, created_at)
       VALUES (?, ?, 'owner', 'owner', 'Owner', 'hi', ?)`
    ).bind('cm_1', a.id, new Date().toISOString()).run();

    // ── 软删 A ──
    const del = await chapterDelete(env, a.id);
    assert.equal(del.success, true);
    // 再删一次(已进回收站)→ 报"没有这一章"
    assert.equal((await chapterDelete(env, a.id)).success, false);
    // 默认列表只剩 B
    list = await chaptersList(env, { project: 'P', limit: 50 });
    assert.deepEqual(ids(list.chapters), [b.id]);
    // published 视角也看不到已删的 A
    list = await chaptersList(env, { project: 'P', status: 'published', limit: 50 });
    assert.deepEqual(ids(list.chapters), []);
    // 回收站列表出现 A,status 保持 published(软删不改状态)
    list = await chaptersList(env, { project: 'P', status: 'trashed', limit: 50 });
    assert.deepEqual(ids(list.chapters), [a.id]);
    assert.equal(list.chapters[0].status, 'published');
    assert.equal(list.chapters[0].deleted_at != null, true);

    // ── 已删的章拒绝 get/update/publish/unpublish ──
    assert.equal((await chapterGet(env, a.id)).success, false);
    assert.equal((await chapterUpdate(env, a.id, { title: 'X' })).success, false);
    assert.equal((await chapterPublish(env, a.id)).success, false);
    assert.equal((await chapterUnpublish(env, a.id)).success, false);

    // ── 恢复 A:回到默认列表,status 保持原样,评论还在 ──
    const restored = await chapterRestore(env, a.id);
    assert.equal(restored.success, true);
    list = await chaptersList(env, { project: 'P', limit: 50 });
    assert.equal(list.count, 2);
    assert.deepEqual(ids(list.chapters).sort(), [a.id, b.id].sort());
    const got = await chapterGet(env, a.id);
    assert.equal(got.success, true);
    assert.equal(got.status, 'published'); // status 保持原样
    const comments = await db.prepare(`SELECT COUNT(*) AS n FROM oc_comments WHERE chapter_id = ?`).bind(a.id).first<any>();
    assert.equal(comments.n, 1);
    // 回收站空了
    list = await chaptersList(env, { project: 'P', status: 'trashed', limit: 50 });
    assert.equal(list.count, 0);

    // ── 彻底删除:评论级联删 + 章真删,不可恢复 ──
    const p = await chapterDeletePermanent(env, a.id);
    assert.equal(p.success, true);
    assert.equal(p.comments_deleted, 1);
    assert.equal((await chapterGet(env, a.id)).success, false);
    assert.equal((await chapterRestore(env, a.id)).success, false); // 行没了,恢复不到
    assert.equal((await chapterDeletePermanent(env, a.id)).success, false);
    const commentsAfter = await db.prepare(`SELECT COUNT(*) AS n FROM oc_comments WHERE chapter_id = ?`).bind(a.id).first<any>();
    assert.equal(commentsAfter.n, 0);

    // ── 不存在的 id ──
    assert.equal((await chapterDelete(env, 'ch_nope')).success, false);
    assert.equal((await chapterRestore(env, 'ch_nope')).success, false);
    assert.equal((await chapterDeletePermanent(env, 'ch_nope')).success, false);

    // ── status 校验:trashed 合法,别的非法值拒绝 ──
    assert.equal((await chaptersList(env, { status: 'trashed' })).success, true);
    assert.equal((await chaptersList(env, { status: 'bogus' })).success, false);
    assert.equal((await chaptersList(env, { status: 'draft' })).success, true);
    assert.equal((await chaptersList(env, { status: 'published' })).success, true);

    // ── B(未删的草稿)照常可操作,软删不影响活章 ──
    assert.equal((await chapterPublish(env, b.id)).success, true);
    const bAfter = await chapterGet(env, b.id);
    assert.equal(bAfter.status, 'published');
  } finally {
    await platform.dispose();
  }
});

test('chaptersExport:整书导出(自然序/空号沉底/排除软删/缺project报错)', { timeout: 30_000 }, async () => {
  const wranglerConfigHome = resolve('.tmp-wrangler-export-test');
  await mkdir(wranglerConfigHome, { recursive: true });
  process.env.XDG_CONFIG_HOME = wranglerConfigHome;
  const { getPlatformProxy } = await import('wrangler');
  const platform = await getPlatformProxy<{ OC_DB: D1Database }>({ configPath: 'wrangler.test.toml', persist: false });
  try {
    const db = platform.env.OC_DB;
    await db.batch([
      db.prepare(OC_CHAPTERS_DDL),
      db.prepare(OC_COMMENTS_DDL),
    ]);
    const env = { OC_DB: db } as any;

    // 缺 project/空串/纯空白 → 报错
    assert.deepEqual(await chaptersExport(env, {}), { success: false, error: '缺 project' });
    assert.equal((await chaptersExport(env, { project: '' })).success, false);
    assert.equal((await chaptersExport(env, { project: '   ' })).success, false);

    // 故意打乱插入顺序(2/10/38/7/空号),导出必须按自然序 2/7/10/38、空号沉底
    await chapterCreate(env, { project: 'P', chapter_no: '10', title: 'T10', content: 'body 10' });
    await chapterCreate(env, { project: 'P', chapter_no: '2', title: 'T2', content: 'body 2' });
    await chapterCreate(env, { project: 'P', chapter_no: '38', title: 'T38', content: 'body 38' });
    await chapterCreate(env, { project: 'P', chapter_no: '7', title: 'T7', content: 'body 7' });
    await chapterCreate(env, { project: 'P', chapter_no: '', title: 'TNo', content: 'body no' });
    // 另一项目的不该混进来
    await chapterCreate(env, { project: 'Q', chapter_no: '1', title: 'Q1', content: 'q body' });
    // 一条软删的:排除
    const delRow = await chapterCreate(env, { project: 'P', chapter_no: '1', title: 'T1', content: 'body 1' });
    await chapterDelete(env, delRow.id);

    const r = await chaptersExport(env, { project: 'P' });
    assert.equal(r.success, true);
    assert.equal(r.filename, 'P.txt');
    assert.equal(r.text, [
      '第2章 T2\n\nbody 2',
      '第7章 T7\n\nbody 7',
      '第10章 T10\n\nbody 10',
      '第38章 T38\n\nbody 38',
      'TNo\n\nbody no', // 空章号只用标题当行首
    ].join('\n\n'));
  } finally {
    await platform.dispose();
  }
});
