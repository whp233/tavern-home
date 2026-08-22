// tests/diaryREST.test.ts
// 日记 REST 数据层（src/tools/diary.ts + d1DiaryStorage.ts）落库校验（task-12）。
// 用真 D1（miniflare 本地，不落盘）：手动建一张跟 examples/cloudflare/schema/migrations/0006_diary.sql
// 同形状的 diaries 表（手法照抄 tests/study.test.ts 的 getPlatformProxy 家法）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  diaryCreate, diaryGet, diaryList, diaryDates, diaryUpdate, diaryDelete,
} from '../src/tools/diary.ts';

test('diary REST CRUD + dates + 校验', { timeout: 30_000 }, async () => {
  const wranglerConfigHome = resolve('.tmp-wrangler-diary-test');
  await mkdir(wranglerConfigHome, { recursive: true });
  process.env.XDG_CONFIG_HOME = wranglerConfigHome;
  const { getPlatformProxy } = await import('wrangler');
  const platform = await getPlatformProxy<{ OC_DB: D1Database }>({ configPath: 'wrangler.test.toml', persist: false });
  try {
    const db = platform.env.OC_DB;
    await db.batch([
      db.prepare(`CREATE TABLE diaries (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL DEFAULT '',
        char_key TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        time TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        affection INTEGER,
        conversation_id TEXT NOT NULL DEFAULT '',
        conversation_length INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE INDEX diaries_date_idx ON diaries(date, updated_at DESC)`),
    ]);
    const env = { OC_DB: db };

    // create：全字段
    const created = await diaryCreate(env, {
      date: '2026/6/27',
      title: '登塔',
      content: '【日记】\n今天去了琉璃塔……\n【日记书写时间为2026年6月27日15点】',
      charKey: '露',
      project: '琉璃塔',
      affection: 760,
      conversationId: 'conv_abc',
      conversationLength: 42,
    });
    assert.equal(created.success, true);
    assert.match(created.diary.id, /^diary_\d+_/);
    assert.equal(created.diary.date, '2026/6/27');
    assert.equal(created.diary.charKey, '露');
    assert.equal(created.diary.affection, 760);
    assert.equal(created.diary.conversationLength, 42);
    assert.match(created.diary.time, /^(上午|下午)\d{1,2}:\d{2}:\d{2}$/); // 自动填妹居风格时间

    // create：date 缺省 = 今天
    const noDate = await diaryCreate(env, { content: '今天的日记' });
    assert.equal(noDate.success, true);
    assert.match(noDate.diary.date, /^\d{4}\/\d{1,2}\/\d{1,2}$/);

    // get 全文回填（不截断）
    const got = await diaryGet(env, created.diary.id);
    assert.equal(got.success, true);
    assert.equal(got.diary.content, '【日记】\n今天去了琉璃塔……\n【日记书写时间为2026年6月27日15点】');
    assert.equal(got.diary.conversationId, 'conv_abc');

    // list 按日期精确筛 + 排序（无前导零也要数值倒序）
    await diaryCreate(env, { date: '2026/10/2', title: '十月', content: '十月二日' });
    const list = await diaryList(env, { date: '2026/6/27' });
    assert.equal(list.success, true);
    assert.equal(list.diaries.length, 1);
    assert.equal(list.diaries[0].title, '登塔');
    assert.equal(list.diaries[0].preview.includes('琉璃塔'), true);
    const all = await diaryList(env, {});
    assert.ok(all.diaries.length >= 3);
    const dates = all.diaries.map((d: any) => d.date);
    const copy = [...dates].map((d: any) => d.split('/').map(Number)).sort((x: number[], y: number[]) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2]);
    assert.deepEqual(copy.map((x: number[]) => x.join('/')), dates); // 倒了四条日期都在数值倒序

    // dates 刻度：去重 + 条数
    const scale = await diaryDates(env, {});
    assert.equal(scale.success, true);
    assert.ok(scale.dates.length >= 2);
    const june = scale.dates.find((c: any) => c.date === '2026/6/27');
    assert.equal(june.count, 1);

    // update：部分更新 + 日期归一化（"2026-06-27" → "2026/6/27"）
    const upd = await diaryUpdate(env, created.diary.id, { title: '登塔（改）', date: '2026-06-28', affection: 800 });
    assert.equal(upd.success, true);
    assert.equal(upd.diary.title, '登塔（改）');
    assert.equal(upd.diary.date, '2026/6/28');
    assert.equal(upd.diary.affection, 800);
    assert.equal(upd.diary.content, '【日记】\n今天去了琉璃塔……\n【日记书写时间为2026年6月27日15点】'); // 未动字段原样保留

    // 校验拒绝：坏日期 / 空正文 / 好感度越界 / 更新不存在
    assert.equal((await diaryCreate(env, { date: '2026/13/9', content: 'x' })).success, false);
    assert.equal((await diaryCreate(env, { content: '  ' })).success, false);
    assert.equal((await diaryCreate(env, { date: '2026/6/27', content: 'x', affection: 1001 })).success, false);
    assert.equal((await diaryList(env, { date: '不是日期' })).success, false);
    const missing = await diaryUpdate(env, 'diary_no_such', { title: 'x' });
    assert.equal(missing.success, false);
    assert.equal(missing.error, '日记不存在');

    // delete → 再 get 不存在 → 再 delete 报不存在
    assert.equal((await diaryDelete(env, created.diary.id)).success, true);
    assert.equal((await diaryGet(env, created.diary.id)).success, false);
    assert.equal((await diaryDelete(env, created.diary.id)).error, '日记不存在');
  } finally {
    if (typeof (platform as any)?.dispose === 'function') await (platform as any).dispose();
    delete process.env.XDG_CONFIG_HOME;
  }
});