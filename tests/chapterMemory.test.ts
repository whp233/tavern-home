// 章节记忆（task-18）+ 参考风格（task-19）纯函数 + 存储测试
// 纯函数走 node --test 直接导入（src 内部 import 均带 .ts 扩展名）；D1 存储走 wrangler platform proxy（persist:false）。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeChapterIndexEntry,
  upsertChapterIndexEntries,
  parseChapterIndexJson,
  renderChapterIndexText,
  compareChapterIndexNo,
  tokenizeQuery,
  tokenizeQueryLoose,
  scoreTextAgainstTerms,
  buildRetrievalCandidates,
  aggregateRetrieval,
  buildContinuationBrief,
  renderMemoriesText,
  buildChapterIntegrateSystem,
  buildChapterIntegrateInput,
  parseIntegrateOutput,
  MAX_RETRIEVAL_ROUNDS,
  RETRIEVAL_MIN_RECORDS,
} from '../src/core/deskMemory.ts';
import {
  sanitizeStyleRefConfig,
  renderStyleRefBlock,
} from '../src/core/deskGenerationService.ts';

// —— sanitizeChapterIndexEntry ——

test('sanitizeChapterIndexEntry：chapterNo 必填，其余宽容兜底', () => {
  assert.equal(sanitizeChapterIndexEntry({} as any), null);
  assert.equal(sanitizeChapterIndexEntry({ chapterNo: '  ' } as any), null);
  const e = sanitizeChapterIndexEntry({ chapterNo: ' 3 ', title: '  琉璃塔初探  ', summary: '  小结  ' } as any)!;
  assert.equal(e.chapterNo, '3');
  assert.equal(e.title, '琉璃塔初探');
  assert.equal(e.theme, '未整理');
  assert.deepEqual(e.events, []);
  assert.equal(e.integrated, false);
});

test('sanitizeChapterIndexEntry：事件/角色状态截断与 integrated 标记', () => {
  const e = sanitizeChapterIndexEntry({
    chapterNo: '1', theme: '身份揭穿', events: ['A', 'B', ''], charState: '主角虚弱', summary: 'S', integrated: true,
  } as any)!;
  assert.equal(e.theme, '身份揭穿');
  assert.deepEqual(e.events, ['A', 'B']);
  assert.equal(e.charState, '主角虚弱');
  assert.equal(e.integrated, true);
  // 事件条数上限与单条长度上限
  const many = Array.from({ length: 20 }, (_, i) => `事件${i}很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长`);
  const capped = sanitizeChapterIndexEntry({ chapterNo: '2', events: many } as any)!;
  assert.ok(capped.events.length <= 8);
  assert.ok(capped.events.every((s) => s.length <= 120));
});

// —— upsertChapterIndexEntries ——

test('upsertChapterIndexEntries：同章号覆盖，不同章号追加，自然序排序', () => {
  const a = sanitizeChapterIndexEntry({ chapterNo: '2', title: '第二' } as any)!;
  const b = sanitizeChapterIndexEntry({ chapterNo: '10', title: '第十' } as any)!;
  const { next } = upsertChapterIndexEntries([a, b], [sanitizeChapterIndexEntry({ chapterNo: '2', title: '第二·改' } as any)!]);
  assert.equal(next.length, 2);
  assert.equal(next.find((e) => e.chapterNo === '2')!.title, '第二·改');
  // 自然序：2 在 10 前
  assert.deepEqual(next.map((e) => e.chapterNo), ['2', '10']);
});

test('compareChapterIndexNo：空章号沉底，数字段按数值', () => {
  assert.equal(compareChapterIndexNo('2', '10') < 0, true);
  assert.equal(compareChapterIndexNo('10', '2') > 0, true);
  assert.equal(compareChapterIndexNo('', '1') > 0, true);
  assert.equal(compareChapterIndexNo('1', '') < 0, true);
});

// —— parseChapterIndexJson ——

test('parseChapterIndexJson：坏形状退空数组', () => {
  assert.deepEqual(parseChapterIndexJson(''), []);
  assert.deepEqual(parseChapterIndexJson('not json'), []);
  assert.deepEqual(parseChapterIndexJson(JSON.stringify({ version: 1, entries: [{ chapterNo: '' }] })), []);
  const good = JSON.stringify({ version: 1, entries: [{ chapterNo: '1', title: 'A' }] });
  assert.equal(parseChapterIndexJson(good).length, 1);
});

// —— renderChapterIndexText ——

test('renderChapterIndexText：空字段自动省略，integratedOnly 过滤', () => {
  const entries = [
    sanitizeChapterIndexEntry({ chapterNo: '1', title: '开端', theme: '未整理', integrated: false } as any)!,
    sanitizeChapterIndexEntry({ chapterNo: '2', title: '琉璃塔', theme: '塔内初探', events: ['遇到守卫'], charState: '主角警觉', summary: '二人进塔', integrated: true } as any)!,
  ];
  const all = renderChapterIndexText(entries);
  assert.match(all, /第1章《开端》/);
  assert.match(all, /第2章《琉璃塔》/);
  const onlyDone = renderChapterIndexText(entries, { integratedOnly: true });
  assert.equal(onlyDone.includes('第1章'), false);
  assert.equal(onlyDone.includes('第2章'), true);
  // limit
  const limited = renderChapterIndexText(entries, { limit: 1 });
  assert.equal((limited.match(/第/g) || []).length, 1);
});

// —— tokenizeQuery ——

test('tokenizeQuery：ASCII 词元 + CJK 二元组，去重上限', () => {
  const terms = tokenizeQuery('琉璃塔初探 tower hello');
  assert.ok(terms.includes('tower'));
  assert.ok(terms.includes('hello'));
  // CJK 二元组
  assert.ok(terms.includes('琉璃'));
  assert.ok(terms.includes('璃塔'));
  // 去重
  assert.equal(terms.length, new Set(terms).size);
});

test('tokenizeQueryLoose：CJK 逐字召回', () => {
  const loose = tokenizeQueryLoose('琉璃塔');
  assert.ok(loose.includes('琉'));
  assert.ok(loose.includes('璃'));
  assert.ok(loose.includes('塔'));
});

// —— scoreTextAgainstTerms ——

test('scoreTextAgainstTerms：命中计分，大小写不敏感', () => {
  assert.equal(scoreTextAgainstTerms('Hello Tower', ['hello', 'tower']), 2);
  assert.equal(scoreTextAgainstTerms('无关文本', ['hello']), 0);
  assert.equal(scoreTextAgainstTerms('', ['hello']), 0);
});

// —— aggregateRetrieval ——

test('aggregateRetrieval：多轮检索，关键词命中排前，兜底轮带入已整合章', () => {
  const entries = [
    sanitizeChapterIndexEntry({ chapterNo: '1', title: '开端', theme: '琉璃塔前', summary: '琉璃塔外的闲聊', integrated: true } as any)!,
    sanitizeChapterIndexEntry({ chapterNo: '2', title: '入塔', theme: '塔内初探', events: ['遇到守卫'], summary: '二人进入琉璃塔', integrated: true } as any)!,
    sanitizeChapterIndexEntry({ chapterNo: '3', title: '深处', theme: '地下祭坛', summary: '无关', integrated: false } as any)!,
  ];
  const memories = [
    { id: 'm1', windowId: 'w', project: 'P', charKey: '', layer: 'plot' as const, theme: '故事情节', title: '伏笔', content: '琉璃塔里有祭坛', createdAt: 't', updatedAt: 't' },
    { id: 'm2', windowId: 'w', project: 'P', charKey: '', layer: 'anchor' as const, theme: '角色设定', title: '主角', content: '主角胆小', createdAt: 't', updatedAt: 't' },
  ] as any;
  const r1 = aggregateRetrieval({ query: '琉璃塔', indexEntries: entries, memories, lore: [] });
  // 琉璃塔相关的索引/记忆应被检索到
  assert.ok(r1.records.length >= 2);
  assert.ok(r1.records.some((rec) => rec.source === 'chapter_index'));
  assert.equal(r1.roundsUsed, 1);
  assert.equal(r1.exhausted, false);
});

test('aggregateRetrieval：无命中时走多轮放宽，仍不足则 exhausted', () => {
  const entries = [
    sanitizeChapterIndexEntry({ chapterNo: '1', title: '开端', summary: '无关', integrated: false } as any)!,
  ];
  const r = aggregateRetrieval({ query: '完全不相关的查询词xyz123', indexEntries: entries, memories: [], lore: [], minRecords: 5 });
  // 无整合章 + 无 anchor 记忆 + 查询无命中 → 兜底后仍不足 minRecords
  assert.equal(r.exhausted, true);
  assert.equal(r.roundsUsed, MAX_RETRIEVAL_ROUNDS);
});

test('aggregateRetrieval：limit 截断与跨轮去重', () => {
  const entries = Array.from({ length: 10 }, (_, i) =>
    sanitizeChapterIndexEntry({ chapterNo: String(i + 1), title: `章${i + 1}`, summary: '琉璃塔', integrated: true } as any)!);
  const r = aggregateRetrieval({ query: '琉璃塔', indexEntries: entries, memories: [], lore: [], limit: 3 });
  assert.equal(r.records.length, 3);
});

// —— buildContinuationBrief ——

test('buildContinuationBrief：前文提要 + 相关记录 + 记忆原文拼接', () => {
  const entries = [sanitizeChapterIndexEntry({ chapterNo: '1', title: '开端', theme: '塔前', summary: '进塔前夜', integrated: true } as any)!];
  const records = [{ source: 'chapter_index' as const, id: 'idx:1', title: '第1章《开端》', text: '塔前夜的闲聊', score: 2 }];
  const memoriesText = renderMemoriesText([
    { id: 'm', windowId: 'w', project: 'P', charKey: '', layer: 'anchor' as const, theme: '角色设定', title: '主角', content: '胆小但善良', createdAt: 't', updatedAt: 't' } as any,
  ]);
  const brief = buildContinuationBrief({ indexEntries: entries, records, memoriesText });
  assert.match(brief, /【前文提要·章节索引】/);
  assert.match(brief, /【相关情节记录】/);
  assert.match(brief, /人设锚定区/);
});

test('buildContinuationBrief：全空时返回空串', () => {
  assert.equal(buildContinuationBrief({ indexEntries: [], records: [], memoriesText: '' }), '');
});

// —— 整合整理抽取 ——

test('buildChapterIntegrateSystem：返回抽取提示词', () => {
  const s = buildChapterIntegrateSystem();
  assert.match(s, /索引整理器/);
  assert.match(s, /"theme"/);
});

test('parseIntegrateOutput：宽容 JSON 解析', () => {
  assert.equal(parseIntegrateOutput(''), null);
  assert.equal(parseIntegrateOutput('not json'), null);
  const ok = parseIntegrateOutput('{"theme":"身份揭穿","events":["A","B"],"char_state":"主角虚弱"}');
  assert.equal(ok!.theme, '身份揭穿');
  assert.deepEqual(ok!.events, ['A', 'B']);
  assert.equal(ok!.charState, '主角虚弱');
  // 围栏包裹
  const fenced = parseIntegrateOutput('```json\n{"theme":"塔","events":["进塔"],"char_state":"紧张"}\n```');
  assert.equal(fenced!.theme, '塔');
  // 全空字段退 null
  assert.equal(parseIntegrateOutput('{"theme":"","events":[],"char_state":""}'), null);
});

test('buildChapterIntegrateInput：节选截断', () => {
  const s = buildChapterIntegrateInput({ title: 'T', summary: 'S', content: 'C'.repeat(5000) });
  assert.ok(s.length <= 6000);
  assert.match(s, /【章节标题】/);
});

// —— 参考风格（task-19） ——

test('sanitizeStyleRefConfig：宽容兜底', () => {
  assert.deepEqual(sanitizeStyleRefConfig(null as any), { enabled: false, bookTitle: '', styleNotes: '', excerpt: '' });
  const c = sanitizeStyleRefConfig({ enabled: true, bookTitle: ' 百年孤独 ', styleNotes: '魔幻', excerpt: '节选' } as any);
  assert.equal(c.enabled, true);
  assert.equal(c.bookTitle, '百年孤独');
  assert.equal(sanitizeStyleRefConfig({ enabled: 'true' } as any).enabled, true);
});

test('renderStyleRefBlock：禁用或全空返回空串', () => {
  assert.equal(renderStyleRefBlock({ enabled: false, bookTitle: 'A', styleNotes: 'S', excerpt: '' }), '');
  assert.equal(renderStyleRefBlock({ enabled: true, bookTitle: '', styleNotes: '', excerpt: '' }), '');
  const block = renderStyleRefBlock({ enabled: true, bookTitle: '百年孤独', styleNotes: '魔幻', excerpt: '' });
  assert.match(block, /【参考风格】/);
  assert.match(block, /百年孤独/);
  const withExcerpt = renderStyleRefBlock({ enabled: true, bookTitle: '', styleNotes: '', excerpt: '许多年以后…' });
  assert.match(withExcerpt, /风格样例/);
});

// —— D1 存储往返（oc_state 键值表，零迁移） ——

test('D1 章节记忆存储往返（索引 + 风格配置）', { timeout: 30_000 }, async () => {
  const { mkdir } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const wranglerConfigHome = resolve('.tmp-wrangler-test');
  await mkdir(wranglerConfigHome, { recursive: true });
  process.env.XDG_CONFIG_HOME = wranglerConfigHome;
  const { getPlatformProxy } = await import('wrangler');
  const platform = await getPlatformProxy<{ OC_DB: D1Database }>({ configPath: 'wrangler.test.toml', persist: false });
  try {
    const db = platform.env.OC_DB;
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS oc_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)`),
      db.prepare(`DELETE FROM oc_state WHERE key LIKE 'desk_chapter_index:%' OR key LIKE 'desk_style_ref:%'`),
    ]);
    const { D1DeskChapterMemoryStore } = await import('../examples/cloudflare/adapters/d1DeskChapterMemoryStorage.ts');
    const store = new D1DeskChapterMemoryStore(db);
    const project = `test-proj-${Date.now()}`;

    // 索引空
    assert.deepEqual(await store.listIndex(project), []);

    // 写入两章
    const e1 = sanitizeChapterIndexEntry({ chapterNo: '1', title: '开端', theme: '引子', summary: '序章', integrated: true } as any)!;
    const e2 = sanitizeChapterIndexEntry({ chapterNo: '2', title: '入塔', summary: '进塔', integrated: false } as any)!;
    const r1 = await store.upsertEntries(project, [e1, e2]);
    assert.equal(r1.added, 2);
    assert.equal(r1.entries.length, 2);

    // 更新第1章
    const r2 = await store.upsertEntries(project, [sanitizeChapterIndexEntry({ chapterNo: '1', title: '开端·改', integrated: true } as any)!]);
    assert.equal(r2.updated, 1);
    assert.equal((await store.listIndex(project)).find((e) => e.chapterNo === '1')!.title, '开端·改');

    // 删除
    assert.equal(await store.deleteEntry(project, '2'), true);
    assert.equal(await store.deleteEntry(project, '9'), false);
    assert.equal((await store.listIndex(project)).length, 1);

    // 风格配置往返
    const cfg = { enabled: true, bookTitle: '百年孤独', styleNotes: '魔幻写实', excerpt: '许多年以后' };
    await store.putStyleRef(project, cfg as any);
    const got = await store.getStyleRef(project);
    assert.equal(got.enabled, true);
    assert.equal(got.bookTitle, '百年孤独');
    assert.equal(got.styleNotes, '魔幻写实');
    assert.equal(got.excerpt, '许多年以后');
  } finally {
    if (typeof (platform as any)?.dispose === 'function') await (platform as any).dispose();
    delete process.env.XDG_CONFIG_HOME;
  }
});
