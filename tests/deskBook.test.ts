// tests/deskBook.test.ts
// 自动成书(deskBook.ts / deskBookSplit.ts)的测试——零模型调用。
//
// 纯内核(deskBookSplit.ts)是纯计算(楼层数组 → 章组),node --test 原生可 import。
// desk 链(deskBook.ts → deskWindows/reading)有无扩展名导入,跟 readingTrash.test.ts 同款
// 处理:先 node:module.register 挂 tests/resolve-ext.mjs(默认解析失败时补 .ts 扩展名),
// 再动态 import deskBook.ts。切章的确定性、每章收在 assistant 楼、空楼过滤、孤儿 user 并入、
// 幂等续跑、fake D1 端到端都在这里断言。

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolve-ext.mjs', import.meta.url));
const deskBook: any = await import('../src/tools/deskBook.ts');
const {
  deskBookSplitFloors, parseEnvelope, normalizeChapterTitle, groupFullyMapped, DESK_BOOK_BUDGET_DEFAULT,
  deskBookSplit, deskBookGenerate, deskBookAuto, CHAPTERS_PER_REQUEST,
} = deskBook;

function floor(id: string, role: 'user' | 'assistant', content: string, created = '2026-01-01T00:00:00.000Z'): any {
  return { id, role, content, created_at: created };
}

// ===== 切章：空楼过滤 =====

test('split: filters empty floors and refuses all-empty windows', () => {
  const empty = deskBookSplitFloors([
    floor('f1', 'user', ''),
    floor('f2', 'assistant', ''),
  ]);
  assert.equal(empty.success, false);
  assert.match(String(empty.error), /非空楼层/);

  const ok = deskBookSplitFloors([
    floor('f1', 'user', ''),
    floor('f2', 'assistant', '正文内容'),
    floor('f3', 'assistant', ''),
  ], { budgetChars: 1 });
  assert.equal(ok.success, true);
  for (const g of ok.chapter_groups!) {
    assert.ok(!g.floor_ids.includes('f1'));
    assert.ok(!g.floor_ids.includes('f3'));
  }
});

test('split: refuses a window with no assistant floors', () => {
  const r = deskBookSplitFloors([
    floor('u1', 'user', '导演指令'),
    floor('u2', 'user', '再来一条'),
  ]);
  assert.equal(r.success, false);
  assert.match(String(r.error), /没有模型写过的楼层/);
});

// ===== 切章：每章收在 assistant 楼 =====

test('split: every chapter closes on an assistant floor (assistant is always end_floor)', () => {
  const floors = [
    floor('u1', 'user', '指令一'),
    floor('a1', 'assistant', '正文一正文一正文一'),
    floor('u2', 'user', '指令二'),
    floor('a2', 'assistant', '正文二正文二正文二'),
    floor('a3', 'assistant', '正文三正文三正文三'),
    floor('u3', 'user', '指令三'),
    floor('a4', 'assistant', '正文四正文四正文四'),
  ];
  const r = deskBookSplitFloors(floors, { budgetChars: 6 });
  assert.equal(r.success, true);
  const groups = r.chapter_groups!;
  assert.ok(groups.length >= 2);
  for (const g of groups) {
    const last = floors.find((f) => f.id === g.end_floor_id)!;
    assert.equal(last.role, 'assistant', `chapter ending at ${g.end_floor_id} must be assistant`);
  }
});

test('split: a single assistant floor over budget becomes its own chapter', () => {
  const big = '大'.repeat(200);
  const r = deskBookSplitFloors([
    floor('a1', 'assistant', big),   // 200 字 > 预算 100
    floor('a2', 'assistant', '小正文'),
  ], { budgetChars: 100 });
  assert.equal(r.success, true);
  const groups = r.chapter_groups!;
  assert.equal(groups[0].start_floor_id, 'a1');
  assert.equal(groups[0].end_floor_id, 'a1');
  assert.equal(groups[0].assistant_count, 1);
  assert.equal(groups[0].floor_ids.length, 1);
  assert.equal(groups[1].floor_ids.includes('a2'), true);
});

test('split: user floors ride along with their assistant into the same chapter', () => {
  const r = deskBookSplitFloors([
    floor('u1', 'user', '导演说朝左边走'),
    floor('a1', 'assistant', '正文正文正文'),
    floor('u2', 'user', '导演说加快节奏'),
    floor('a2', 'assistant', '后文后文后文'),
  ], { budgetChars: 3 });
  assert.equal(r.success, true);
  const groups = r.chapter_groups!;
  // u1 跟随 a1, u2 跟随 a2
  assert.deepEqual(groups[0].floor_ids, ['u1', 'a1']);
  assert.deepEqual(groups[1].floor_ids, ['u2', 'a2']);
  assert.equal(groups[0].start_floor_id, 'u1');
  assert.equal(groups[0].end_floor_id, 'a1');
});

test('split: trailing orphan user floors merge into the previous chapter', () => {
  const r = deskBookSplitFloors([
    floor('u1', 'user', '指令'),
    floor('a1', 'assistant', '正文正文正文正文'),  // 8 字 ≥ 预算 8 → 闭章
    floor('u2', 'user', '孤儿的导演指令(没有后续assistant)'),
  ], { budgetChars: 8 });
  assert.equal(r.success, true);
  const groups = r.chapter_groups!;
  assert.equal(groups.length, 1);
  // 孤儿 user 并入前章：start=u1, end=u2
  assert.deepEqual(groups[0].floor_ids, ['u1', 'a1', 'u2']);
  assert.equal(groups[0].end_floor_id, 'u2');
});

// ===== 切章：预算边界的确定性 =====

test('split: budget accumulates assistant text and cuts deterministically', () => {
  const mk = (id: string, n: number) => floor(id, 'assistant', '字'.repeat(n));
  const r = deskBookSplitFloors([
    mk('a1', 2000),
    mk('a2', 2000),
    mk('a3', 2000),
  ], { budgetChars: 4000 });
  assert.equal(r.success, true);
  const groups = r.chapter_groups!;
  assert.deepEqual(groups[0].floor_ids, ['a1', 'a2']); // 2000+2000=4000 ≥ 4000
  assert.deepEqual(groups[1].floor_ids, ['a3']);
  assert.equal(groups[0].assistant_count, 2);
  assert.equal(groups[0].est_chars > 0, true);
});

test('split: default budget is the exported constant and is honored when opts are omitted', () => {
  // 5000 字不触发(4999 < 5000) → 一章
  const under = deskBookSplitFloors([floor('a1', 'assistant', '字'.repeat(DESK_BOOK_BUDGET_DEFAULT - 1))]);
  assert.equal(under.success, true);
  assert.equal(under.chapter_groups!.length, 1);
  // 两楼各 5000 字 → 每楼闭一章 → 两章
  const over = deskBookSplitFloors([
    floor('a1', 'assistant', '字'.repeat(DESK_BOOK_BUDGET_DEFAULT)),
    floor('a2', 'assistant', '字'.repeat(DESK_BOOK_BUDGET_DEFAULT)),
  ]);
  assert.equal(over.chapter_groups!.length, 2);
});

// ===== 信封解析 =====

test('parseEnvelope extracts title/summary/content and rejects missing tags', () => {
  const good = parseEnvelope(
    '<title>第1章 初见</title>\n<summary>他遇到了她。</summary>\n<content>正文正文正文</content>',
  );
  assert.deepEqual(good, { title: '第1章 初见', summary: '他遇到了她。', content: '正文正文正文' });

  assert.equal(parseEnvelope('<title>只有标题</title>'), null);
  assert.equal(parseEnvelope('<summary>x</summary><content>y</content>'), null);
  assert.equal(parseEnvelope(''), null);
  // content 内嵌的标签字面量不应腰斩解析（懒匹配取第一枚闭标签）
  const nested = parseEnvelope('<title>t</title><summary>s</summary><content>正文<content>内嵌</content>尾巴</content>');
  assert.ok(nested);
  assert.equal(nested!.content, '正文<content>内嵌');
});

// ===== 标题编号归一：剥掉模型标题里自带的编号，只留纯标题 =====

test('normalizeChapterTitle strips any leading 第…章 prefix (wrong numbers included)', () => {
  // 模型编错的号：阿拉伯/中文/占位符/字母，一律剥掉
  assert.equal(normalizeChapterTitle('第1章 初见', '1'), '初见');
  assert.equal(normalizeChapterTitle('第29章 水乳交融', '12'), '水乳交融');
  assert.equal(normalizeChapterTitle('第四章 凡尘修习', '10'), '凡尘修习');
  assert.equal(normalizeChapterTitle('第十八章 三千年的回望', '11'), '三千年的回望');
  assert.equal(normalizeChapterTitle('第N章 晨炊初试', '9'), '晨炊初试');
  assert.equal(normalizeChapterTitle('第x章 购物', '22'), '购物');
  // 无编号的纯标题原样保留
  assert.equal(normalizeChapterTitle('初临凡世', '1'), '初临凡世');
  assert.equal(normalizeChapterTitle('  晨炊初试  ', '9'), '晨炊初试');
  // 标题只有编号没有正题 → 回退到系统钦定的正确章号
  assert.equal(normalizeChapterTitle('第29章', '12'), '第12章');
  assert.equal(normalizeChapterTitle('', '7'), '第7章');
});

// ===== 幂等判定：groupFullyMapped =====

test('groupFullyMapped: a chapter group is done only when all its floors are already mapped', () => {
  const groups = deskBookSplitFloors([
    floor('u1', 'user', '指令'),
    floor('a1', 'assistant', '正文正文正文'),
    floor('u2', 'user', '指令二'),
    floor('a2', 'assistant', '后文后文后文'),
  ], { budgetChars: 3 }).chapter_groups!;
  assert.equal(groups.length, 2);

  // 全部映射 → 已生成
  assert.equal(groupFullyMapped(groups[0], new Set(['u1', 'a1'])), true);
  // 缺一楼 → 未生成(要续跑)
  assert.equal(groupFullyMapped(groups[0], new Set(['u1'])), false);
  assert.equal(groupFullyMapped(groups[0], new Set()), false);
  // 组间楼层不串
  assert.equal(groupFullyMapped(groups[0], new Set(['a2'])), false);
});

// ===== 最小 fake D1 =====

// 只实现 deskBook 链路会踩到的查询：desk_windows(first)、desk_floors(all)、
// desk_chapter_floors(all/count)、oc_state(first)、oc_chapters(all)。
function makeFakeDb(tables: {
  desk_windows?: any[];
  desk_floors?: any[];
  desk_chapter_floors?: any[];
  oc_state?: any[];
  oc_chapters?: any[];
}) {
  const t = {
    desk_windows: tables.desk_windows || [],
    desk_floors: tables.desk_floors || [],
    desk_chapter_floors: tables.desk_chapter_floors || [],
    oc_state: tables.oc_state || [],
    oc_chapters: tables.oc_chapters || [],
  };
  const runCalls: Array<{ sql: string; args: any[] }> = [];
  const db = {
    runCalls,
    prepare(sql: string) {
      return {
        bind: (...args: any[]) => ({
          first: async () => {
            if (sql.includes('FROM desk_windows')) return t.desk_windows.find((r) => r.id === args[0]) || null;
            if (sql.includes('FROM oc_state')) return t.oc_state.find((r) => r.key === args[0]) || null;
            if (sql.includes('FROM desk_chapter_floors') && sql.includes('COUNT')) {
              return { c: t.desk_chapter_floors.filter((r) => r.window_id === args[0]).length };
            }
            return null;
          },
          all: async () => {
            if (sql.includes('FROM desk_floors')) {
              const rows = t.desk_floors.filter((r) => r.window_id === args[0]).slice();
              rows.sort((a: any, b: any) =>
                a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : (a.created_at < b.created_at ? -1 : 1),
              );
              return { results: rows };
            }
            if (sql.includes('FROM desk_chapter_floors')) {
              return { results: t.desk_chapter_floors.filter((r) => r.window_id === args[0]) };
            }
            if (sql.includes('FROM oc_chapters')) {
              return { results: t.oc_chapters.filter((r) => r.project === args[0]) };
            }
            return { results: [] };
          },
          run: async () => {
            runCalls.push({ sql, args });
            return { meta: { changes: 1 } };
          },
        }),
      };
    },
  };
  return db;
}

const WIN = { id: 'dw_1', project: 'P', title: 'W', recipe_id: 'r', note: '', note_depth: 3, state_board: '{}', timeline_state: '{}', vars: '{}', created_at: 't0', updated_at: 't0' };
const FLOORS = [
  { id: 'f1', window_id: 'dw_1', role: 'user', content: '指令一', variants: '[]', active_variant: 0, thinking: null, report: null, created_at: 't1' },
  { id: 'f2', window_id: 'dw_1', role: 'assistant', content: '正文一正文一正文一正文一', variants: '[]', active_variant: 0, thinking: null, report: null, created_at: 't2' },
  { id: 'f3', window_id: 'dw_1', role: 'user', content: '指令二', variants: '[]', active_variant: 0, thinking: null, report: null, created_at: 't3' },
  { id: 'f4', window_id: 'dw_1', role: 'assistant', content: '正文二正文二正文二正文二', variants: '[]', active_variant: 0, thinking: null, report: null, created_at: 't4' },
];

// ===== REST 包装：deskBookSplit =====

test('deskBookSplit wrapper reads window+floors through the fake D1', async () => {
  const db = makeFakeDb({ desk_windows: [WIN], desk_floors: FLOORS });
  const r = await deskBookSplit({ OC_DB: db }, 'dw_1', { budgetChars: 10 }); // f2 12字≥10 → 章1; f4 12字≥10 → 章2
  assert.equal(r.success, true);
  assert.equal(r.window_id, 'dw_1');
  assert.equal(r.total_chapters, 2);
  assert.deepEqual(r.chapter_groups[0].floor_ids, ['f1', 'f2']);
  assert.deepEqual(r.chapter_groups[1].floor_ids, ['f3', 'f4']);
});

test('deskBookSplit wrapper reports missing window', async () => {
  const db = makeFakeDb({ desk_windows: [], desk_floors: [] });
  const r = await deskBookSplit({ OC_DB: db }, 'dw_nope');
  assert.equal(r.success, false);
  assert.match(String(r.error), /不存在/);
});

// ===== 幂等：deskBookGenerate =====

test('generate: already-mapped chapters are skipped (no model call, remaining=0)', async () => {
  const db = makeFakeDb({
    desk_windows: [WIN],
    desk_floors: FLOORS,
    desk_chapter_floors: [
      { chapter_id: 'ch_deskbook_dw_1_1', window_id: 'dw_1', floor_id: 'f1', seq: 0 },
      { chapter_id: 'ch_deskbook_dw_1_1', window_id: 'dw_1', floor_id: 'f2', seq: 1 },
      { chapter_id: 'ch_deskbook_dw_1_2', window_id: 'dw_1', floor_id: 'f3', seq: 0 },
      { chapter_id: 'ch_deskbook_dw_1_2', window_id: 'dw_1', floor_id: 'f4', seq: 1 },
    ],
  });
  const r = await deskBookGenerate({ OC_DB: db }, 'dw_1', { budgetChars: 10 });
  assert.equal(r.success, true);
  assert.equal(r.already, 2);
  assert.equal(r.done, 0);
  assert.equal(r.remaining, 0);
  assert.deepEqual(r.failed, []);
  // 全程没有模型调用(没有 INSERT INTO oc_chapters)
  assert.ok(!db.runCalls.some((c: any) => c.sql.includes('INSERT INTO oc_chapters')));
});

test('generate: only pending chapters are attempted and fail cleanly when no model key is configured', async () => {
  const db = makeFakeDb({
    desk_windows: [WIN],
    desk_floors: FLOORS,
    // 只映射了第一组 → 第二组待生成
    desk_chapter_floors: [
      { chapter_id: 'ch_deskbook_dw_1_1', window_id: 'dw_1', floor_id: 'f1', seq: 0 },
      { chapter_id: 'ch_deskbook_dw_1_1', window_id: 'dw_1', floor_id: 'f2', seq: 1 },
    ],
  });
  const r = await deskBookGenerate({ OC_DB: db }, 'dw_1', { budgetChars: 10 });
  assert.equal(r.success, true);
  assert.equal(r.already, 1);
  assert.equal(r.done, 0);
  assert.equal(r.remaining, 1);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].chapter_index, 1);
  assert.match(r.failed[0].error, /模型渠道没配|no_key|转写失败/);
  // 已映射的章不被重写
  assert.ok(!db.runCalls.some((c: any) => c.sql.includes('INSERT INTO oc_chapters') && String(c.args[0]).includes('_1')));
});

// ===== 一键组合：deskBookAuto =====

test('auto: skips split and reports total chapters when mappings already exist', async () => {
  const db = makeFakeDb({
    desk_windows: [WIN],
    desk_floors: FLOORS,
    desk_chapter_floors: [
      { chapter_id: 'ch_deskbook_dw_1_1', window_id: 'dw_1', floor_id: 'f1', seq: 0 },
      { chapter_id: 'ch_deskbook_dw_1_1', window_id: 'dw_1', floor_id: 'f2', seq: 1 },
      { chapter_id: 'ch_deskbook_dw_1_2', window_id: 'dw_1', floor_id: 'f3', seq: 0 },
      { chapter_id: 'ch_deskbook_dw_1_2', window_id: 'dw_1', floor_id: 'f4', seq: 1 },
    ],
  });
  const r = await deskBookAuto({ OC_DB: db }, 'dw_1', { budgetChars: 10 });
  assert.equal(r.success, true);
  assert.equal(r.total_chapters, 2);
  assert.equal(r.done, 0);
  assert.equal(r.remaining, 0);
});

test('auto: fresh window splits then tries the first batch (fails cleanly without model key)', async () => {
  const db = makeFakeDb({ desk_windows: [WIN], desk_floors: FLOORS });
  const r = await deskBookAuto({ OC_DB: db }, 'dw_1', { budgetChars: 10 });
  assert.equal(r.success, true);
  assert.equal(r.total_chapters, 2);
  assert.equal(r.remaining, 2); // 两章都因无模型 key 失败 → 待续
  assert.equal(r.failed.length, 2);
});

test('generate: caps chapters per request to CHAPTERS_PER_REQUEST', async () => {
  // 造 9 条 assistant 楼,预算 1 字 → 每楼一章,共 9 章;max_chapters 不传 → 只处理前 4 章
  const manyFloors = Array.from({ length: 9 }, (_, i) => ({
    id: `m${i}`, window_id: 'dw_1', role: 'assistant', content: '字', variants: '[]', active_variant: 0,
    thinking: null, report: null, created_at: `t${i}`,
  }));
  const db = makeFakeDb({ desk_windows: [WIN], desk_floors: manyFloors });
  const r = await deskBookGenerate({ OC_DB: db }, 'dw_1', { budgetChars: 1 });
  assert.equal(r.success, true);
  assert.equal(r.total_chapters, 9);
  assert.equal(r.failed.length, CHAPTERS_PER_REQUEST); // 无 key → 前 4 章失败,后 5 章留待下次
  assert.equal(r.remaining, 9);
});
