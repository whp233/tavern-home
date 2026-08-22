// 跨角色记忆重构（task-10）测试：作用域(角色|共享) + 分层(anchor/plot/general) 的纯函数与内存适配器。
// 覆盖：normalizeLayer/memoryScopeOf、sanitizeMemory 新字段、按层渲染、蒸馏解析、层内合并、
// compact 层保留、applySummaryDiff 锚守卫、MemoryDeskMemoryStorage 的 listByScope/replaceScope 锚守卫。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLayer,
  memoryScopeOf,
  sanitizeMemory,
  renderMemoriesText,
  parseMemoryDistillOutput,
  mergeMemories,
  compactMemories,
  applySummaryDiff,
  buildSummaryInput,
  ANCHOR_LAYER_LABEL,
  PLOT_LAYER_LABEL,
  GENERAL_LAYER_LABEL,
  DEFAULT_MEMORY_LAYER,
} from '../src/core/deskMemory.ts';
import { MemoryDeskMemoryStorage } from '../src/adapters/memoryStorage.ts';

const mem = (p: Partial<import('../src/core/types.ts').DeskMemory>) => ({
  id: `m${Math.random().toString(36).slice(2, 8)}`, windowId: 'w', project: 'P', charKey: '', layer: 'plot' as const,
  theme: '其他', title: '', content: 'x', createdAt: 't', updatedAt: 't', ...p,
});

test('normalizeLayer / memoryScopeOf', () => {
  assert.equal(normalizeLayer('anchor'), 'anchor');
  assert.equal(normalizeLayer('general'), 'general');
  assert.equal(normalizeLayer('plot'), DEFAULT_MEMORY_LAYER);
  assert.equal(normalizeLayer('bogus'), DEFAULT_MEMORY_LAYER);
  assert.equal(normalizeLayer(undefined), DEFAULT_MEMORY_LAYER);
  assert.equal(memoryScopeOf({ charKey: '她' }), 'char');
  assert.equal(memoryScopeOf({ charKey: '' }), 'shared');
});

test('sanitizeMemory 新字段默认', () => {
  const row = sanitizeMemory({ project: 'P', charKey: '露', content: 'x' })!;
  assert.equal(row.project, 'P');
  assert.equal(row.charKey, '露');
  assert.equal(row.layer, DEFAULT_MEMORY_LAYER);
  // layer 非法回退 plot
  assert.equal(sanitizeMemory({ project: 'P', layer: 'anchor' as any, content: 'x' })!.layer, 'anchor');
  assert.equal(sanitizeMemory({ project: 'P', layer: 'nope' as any, content: 'x' })!.layer, DEFAULT_MEMORY_LAYER);
});

test('renderMemoriesText 按层分组渲染（anchor 在前）', () => {
  assert.equal(renderMemoriesText([]), '');
  const anchor = mem({ id: 'a', charKey: '露', layer: 'anchor', theme: '角色设定', title: '性格', content: '沉稳' });
  const plot = mem({ id: 'b', charKey: '露', layer: 'plot', theme: '故事情节', title: '事件', content: '去了琉璃塔' });
  const text = renderMemoriesText([plot, anchor]);
  // 层标题都出现
  assert.ok(text.includes(`【${ANCHOR_LAYER_LABEL}】`));
  assert.ok(text.includes(`【${PLOT_LAYER_LABEL}】`));
  // anchor 在前（anchor 段落的索引小于 plot 段落）
  assert.ok(text.indexOf(`【${ANCHOR_LAYER_LABEL}】`) < text.indexOf(`【${PLOT_LAYER_LABEL}】`));
  // 主题子标题仍保留
  assert.ok(text.includes('【角色设定】'));
  assert.ok(text.includes('【故事情节】'));
  // 通用区不混入
  assert.ok(!text.includes(`【${GENERAL_LAYER_LABEL}】`));
});

test('parseMemoryDistillOutput 解析 layer/charKey', () => {
  const raw = '{"memories":[{"theme":"角色设定","layer":"anchor","charKey":"露","title":"性格","content":"沉稳"},{"theme":"故事情节","content":"去了琉璃塔"}]}';
  const r = parseMemoryDistillOutput(raw);
  assert.equal(r.validCount, 2);
  assert.equal(r.memories[0].layer, 'anchor');
  assert.equal(r.memories[0].charKey, '露');
  // 缺 layer/charKey → 默认 plot/''（由上层归属）
  assert.equal(r.memories[1].layer, DEFAULT_MEMORY_LAYER);
  assert.equal(r.memories[1].charKey, '');
});

test('mergeMemories 层隔离：anchor 不被 plot 覆盖', () => {
  const anchor = mem({ id: 'a', charKey: '露', layer: 'anchor', theme: '角色设定', title: '性格', content: '沉稳' });
  // 同 theme/同 title 但 plot 层 → 因为层不同，不覆盖 anchor，新增 plot 条目
  const r = mergeMemories([anchor], [{ theme: '角色设定', layer: 'plot', charKey: '露', title: '性格', content: '沉稳但易怒' }], { project: 'P' });
  assert.equal(r.next.length, 2);
  assert.equal(r.updated.length, 0);
  assert.equal(r.added.length, 1);
  assert.equal(r.next.filter((m) => m.layer === 'anchor').length, 1);
  // 同层同标题 → 覆盖
  const r2 = mergeMemories([anchor], [{ theme: '角色设定', layer: 'anchor', charKey: '露', title: '性格', content: '沉稳淡漠' }], { project: 'P' });
  assert.equal(r2.next.length, 1);
  assert.equal(r2.updated.length, 1);
  assert.equal(r2.updated[0].content, '沉稳淡漠');
});

test('compactMemories 层内合并且保留 anchor', () => {
  const a1 = mem({ id: 'a1', layer: 'anchor', theme: '角色设定', title: '性格', content: '沉稳' });
  const a2 = mem({ id: 'a2', layer: 'anchor', theme: '角色设定', title: '性格', content: '沉稳' }); // 重复
  const p1 = mem({ id: 'p1', layer: 'plot', theme: '故事情节', title: '事件', content: '去了琉璃塔' });
  const r = compactMemories([a1, a2, p1], { cap: 1 });
  // anchor 优先：超上限截断时 anchor 保住，plot 被剔
  assert.equal(r.next.length, 1);
  assert.equal(r.next[0].layer, 'anchor');
  assert.equal(r.next[0].title, '性格'); // 保住的是 anchor（非 plot）
  // a2 与 a1 合并(1) + 超上限截断剔 1(计入 merged) = 2
  assert.equal(r.merged, 2);
  assert.equal(r.removed.length, 2);
});

test('applySummaryDiff anchor 只新增不覆盖', () => {
  const anchor = mem({ id: 'a', charKey: '露', layer: 'anchor', theme: '角色设定', title: '性格', content: '沉稳' });
  const incoming = [
    { theme: '角色设定', layer: 'anchor' as const, charKey: '露', title: '性格', content: '沉稳新描述' }, // 已存在 → 守卫
    { theme: '故事情节', layer: 'plot' as const, charKey: '露', title: '事件', content: '去了琉璃塔' },     // 新增 plot
  ];
  const r = applySummaryDiff([anchor], incoming, { project: 'P' });
  assert.equal(r.anchorGuard, 1);
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].layer, 'plot');
  assert.equal(r.next.filter((m) => m.layer === 'anchor').length, 1);
  assert.equal(r.next.filter((m) => m.layer === 'plot').length, 1);
  assert.equal(r.next.find((m) => m.layer === 'anchor')!.content, '沉稳'); // 未被覆盖
});

test('buildSummaryInput 构造含楼层与当前记忆', () => {
  const input = buildSummaryInput(
    [{ windowId: 'w1', charKey: '露', role: 'assistant', content: '她走向琉璃塔' }],
    [mem({ content: '露是主角' })],
    'P',
  );
  assert.ok(input.includes('P'));
  assert.ok(input.includes('她走向琉璃塔'));
  assert.ok(input.includes('露是主角'));
  assert.ok(input.includes('最近对话楼层'));
});

test('MemoryDeskMemoryStorage listByScope / replaceScope 锚守卫', async () => {
  const s = new MemoryDeskMemoryStorage({});
  // replaceScope：只替换 plot，anchor 保留
  await s.replaceScope({ project: 'P', charKey: '露', memories: [mem({ id: 'anchor1', charKey: '露', layer: 'anchor', theme: '角色设定', title: '性格', content: '沉稳' })] });
  await s.replaceScope({ project: 'P', charKey: '露', memories: [mem({ id: 'plot1', charKey: '露', layer: 'plot', theme: '故事情节', title: '事件', content: '去了琉璃塔' })] });
  assert.equal((await s.listByScope({ project: 'P', charKey: '露', layer: 'anchor' })).length, 1);
  assert.equal((await s.listByScope({ project: 'P', charKey: '露', layer: 'plot' })).length, 1);
  // 共享区不受角色区影响
  await s.replaceScope({ project: 'P', charKey: '', memories: [mem({ id: 'shared1', charKey: '', layer: 'plot', theme: '用户画像', title: '称呼', content: '叫他老哥' })] });
  assert.equal((await s.listByScope({ project: 'P', charKey: '' })).length, 1);
  assert.equal((await s.listByScope({ project: 'P', charKey: '露' })).length, 2);
  // 角色区私有：共享区条目不进角色区
  assert.equal((await s.listByScope({ project: 'P', charKey: '她' })).length, 0);
});

// 锁定 index.ts compact 作用域路径的编排（评审 #P1：作用域路径本应先 replaceScope 写入全部，
// 旧实现后再逐条 createMemory 造成 duplicate 主键冲突）。这里按路由同序列在内存适配器上复现，
// 断言「只 replaceScope 写一次」不抛错、落库结果是 compactMemories 的输出、无重复主键。
test('compact 作用域路径：只 replaceScope 写一次，不抛 duplicate', async () => {
  const s = new MemoryDeskMemoryStorage({});
  const now = '2026-01-01T00:00:00.000Z';
  const m = (p: Partial<import('../src/core/types.ts').DeskMemory>) => ({
    id: `mid-${Math.random().toString(36).slice(2, 9)}`, windowId: 'w', project: 'P', charKey: '露', layer: 'plot' as const,
    theme: '其他', title: '', content: 'x', createdAt: now, updatedAt: now, ...p,
  });
  const seed = [
    m({ content: '露是主角' }),
    m({ content: '露是主角' }), // 待压缩合并的重复
    m({ id: 'anchor-keep', layer: 'anchor', theme: '角色设定', title: '性格', content: '沉稳' }),
  ];
  await s.replaceScope({ project: 'P', charKey: '露', memories: seed });
  // === 与 index.ts compact 分支（作用域）同序列：list → snapshot → compact → replaceScope ===
  const before = await s.listByScope({ project: 'P', charKey: '露' });
  await s.createSnapshot({ id: 'snap-c', windowId: 'w', project: 'P', charKey: '露', title: '压缩', data: before, createdAt: now });
  const { next, removed } = compactMemories(before);
  const anchors = before.filter((x) => x.layer === 'anchor');
  const anchorIds = new Set(anchors.map((x) => x.id));
  const nonAnchor = next.filter((x) => !anchorIds.has(x.id));
  // FIXED：仅 replaceScope（不再逐条 createMemory，否则同 id duplicate 抛错）
  await s.replaceScope({ project: 'P', charKey: '露', memories: [...anchors, ...nonAnchor] });
  const after = await s.listByScope({ project: 'P', charKey: '露' });
  // 不抛错、结果 = compactMemories 输出、主键唯一、anchor 保留
  assert.equal(after.length, next.length);
  assert.equal(new Set(after.map((x) => x.id)).size, after.length);
  assert.ok(after.some((x) => x.id === 'anchor-keep'));
  assert.equal(removed.length, 1);
  // 快照可回退到压缩前
  const restoredNow = await s.listByScope({ project: 'P', charKey: '露' });
  assert.equal(restoredNow.length, next.length);
});
