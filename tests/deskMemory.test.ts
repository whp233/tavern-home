// 打字桌记忆模块测试：纯函数（渲染 / 蒸馏解析 / 合并 / 压缩）+ MemoryDeskMemoryStorage 适配器。
// deskMemory.ts 内部 import 均带 .ts 扩展名，`node --test` 可直接导入，无需 resolve-ext 挂载。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MEMORY_THEME,
  MEMORY_CAP,
  compactMemories,
  mergeMemories,
  normalizeTheme,
  parseMemoryDistillOutput,
  renderMemoriesText,
  sanitizeMemory,
  buildMemoryDistillSystem,
  buildDistillationInput,
} from '../src/core/deskMemory.ts';
import { MemoryDeskMemoryStorage } from '../src/adapters/memoryStorage.ts';

const mem = (p: Partial<import('../src/core/types.ts').DeskMemory>) => ({ id: 'm1', windowId: 'w', theme: '其他', title: '', content: 'x', createdAt: 't', updatedAt: 't', ...p });

test('normalizeTheme 清洗与兜底', () => {
  assert.equal(normalizeTheme('  角色设定  '), '角色设定');
  assert.equal(normalizeTheme(''), DEFAULT_MEMORY_THEME);
  assert.equal(normalizeTheme(undefined), DEFAULT_MEMORY_THEME);
  assert.equal(normalizeTheme(null), DEFAULT_MEMORY_THEME);
  assert.equal(normalizeTheme(123), DEFAULT_MEMORY_THEME);
});

test('sanitizeMemory 空内容不落库', () => {
  assert.equal(sanitizeMemory({ content: '   ' }), null);
  assert.equal(sanitizeMemory({ content: 'hello', title: 't', theme: '角色设定' } as any)!.theme, '角色设定');
  const m = sanitizeMemory({ content: 'hello' } as any)!;
  assert.ok(m.id.startsWith('mem_'));
});

test('renderMemoriesText 分组渲染', () => {
  assert.equal(renderMemoriesText([]), '');
  const rows = [
    mem({ id: 'a', title: 'A', theme: '角色设定', content: '露是主角' }),
    mem({ id: 'b', theme: '角色设定', content: '寻是配角' }),
    mem({ id: 'c', theme: '故事情节', content: '去过琉璃塔' }),
  ];
  const text = renderMemoriesText(rows);
  assert.match(text, /【角色设定】/);
  assert.match(text, /【故事情节】/);
  // 标题存在的带标题前缀
  assert.match(text, /A：露是主角/);
  // 无标题的原样内容
  assert.match(text, /寻是配角/);
  assert.match(text, /去过琉璃塔/);
});

test('parseMemoryDistillOutput 宽容解析', () => {
  assert.deepEqual(parseMemoryDistillOutput(''), { memories: [], validCount: 0 });
  assert.deepEqual(parseMemoryDistillOutput('not json'), { memories: [], validCount: 0 });
  // 直接 JSON
  const r = parseMemoryDistillOutput('{"memories":[{"theme":"角色设定","title":"露","content":"主角"}]}');
  assert.equal(r.validCount, 1);
  assert.equal(r.memories[0].theme, '角色设定');
  // ```json 围栏
  const f = parseMemoryDistillOutput('```json\n{"memories":[{"theme":"","title":"t","content":"c"}]}\n```');
  assert.equal(f.validCount, 1);
  assert.equal(f.memories[0].theme, '其他'); // 空 theme 兜底
  // 畸形条目被丢弃
  const bad = parseMemoryDistillOutput('{"memories":[{"content":""},{"theme":"x","content":"ok"}]}');
  assert.equal(bad.validCount, 1);
  assert.equal(bad.memories.length, 1);
});

test('mergeMemories 去重合并', () => {
  const existing = [mem({ id: 'a', theme: '角色设定', title: '露', content: '主角' })];
  // 同主题同标题覆盖
  const r1 = mergeMemories(existing, [{ theme: '角色设定', title: '露', content: '主角，会用火' }], { windowId: 'w' });
  assert.equal(r1.next.length, 1);
  assert.equal(r1.next[0].content, '主角，会用火');
  assert.equal(r1.updated.length, 1);
  // 新增
  const r2 = mergeMemories(existing, [{ theme: '故事情节', title: '事件', content: '去了琉璃塔' }], { windowId: 'w' });
  assert.equal(r2.next.length, 2);
  assert.equal(r2.added.length, 1);
  // 全空输入
  const r3 = mergeMemories(existing, [], { windowId: 'w' });
  assert.equal(r3.next.length, 1);
  assert.equal(r3.dropped, 0);
});

test('mergeMemories 超上限丢弃', () => {
  const existing = [];
  const out = mergeMemories(existing, Array.from({ length: 300 }, (_, i) => ({ theme: '其他', title: `t${i}`, content: `c${i}` })), { windowId: 'w', cap: 10 });
  assert.equal(out.next.length, 10);
  assert.equal(out.dropped, 290);
});

test('compactMemories 合并重复并截断', () => {
  const a = mem({ id: 'a', theme: '角色设定', content: '露是主角' });
  const b = mem({ id: 'b', theme: '角色设定', content: '露是主角' }); // 重复内容
  const c = mem({ id: 'c', theme: '故事情节', content: '去过琉璃塔' });
  const r = compactMemories([a, b, c]);
  assert.equal(r.merged, 1);
  assert.equal(r.next.filter((x) => x.theme === '角色设定').length, 1);
  assert.equal(r.next.filter((x) => x.theme === '故事情节').length, 1);
  // 截断
  const many = Array.from({ length: MEMORY_CAP + 20 }, (_, i) => mem({ id: `id${i}`, content: `c${i}` }));
  const capped = compactMemories(many);
  assert.ok(capped.next.length <= MEMORY_CAP);
  assert.ok(capped.removed.length >= 20);
});

test('compactMemories 空集', () => {
  const r = compactMemories([]);
  assert.equal(r.next.length, 0);
});

test('buildMemoryDistillSystem 与 buildDistillationInput', () => {
  const sys = buildMemoryDistillSystem();
  assert.match(sys, /JSON/);
  assert.match(sys, /memories/);
  assert.equal(buildDistillationInput(undefined), '');
  assert.equal(buildDistillationInput([]), '');
  const input = buildDistillationInput([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]);
  assert.match(input, /用户：hi/);
  assert.match(input, /模型：hello/);
});

// ===== MemoryDeskMemoryStorage 适配器 =====
test('MemoryDeskMemoryStorage CRUD + 快照回退', async () => {
  const store = new MemoryDeskMemoryStorage();
  await store.createMemory(mem({ id: 'm1', windowId: 'w', theme: '角色设定', title: '露', content: '主角' }));
  await store.createMemory(mem({ id: 'm2', windowId: 'w', content: '去过琉璃塔' }));
  await store.createMemory(mem({ id: 'other', windowId: 'w2', content: '别的窗' }));

  const list = await store.listMemories('w');
  assert.equal(list.length, 2);
  assert.equal((await store.getMemory('m1'))!.title, '露');

  const updated = await store.updateMemory('m1', { content: '主角，会用火' });
  assert.equal(updated!.content, '主角，会用火');

  // 快照 + 回退
  const before = await store.listMemories('w');
  await store.createSnapshot({ id: 's1', windowId: 'w', title: '压缩', data: before, createdAt: 'tS' });
  await store.deleteMemory('m2');
  assert.equal((await store.listMemories('w')).length, 1);
  const restored = await store.restoreSnapshot('s1');
  assert.equal(restored!.length, 2);
  assert.equal((await store.listMemories('w')).length, 2);

  // 回退到不存在的快照 → null
  assert.equal(await store.restoreSnapshot('nope'), null);

  // truncate
  assert.equal(await store.truncateMemories('w'), 2);
  assert.equal((await store.listMemories('w')).length, 0);
});

test('MemoryDeskMemoryStorage 隔离不同窗口', async () => {
  const store = new MemoryDeskMemoryStorage();
  await store.createMemory(mem({ id: 'a', windowId: 'w', content: 'x' }));
  assert.equal((await store.listMemories('other')).length, 0);
  assert.equal((await store.deleteMemory('a')), true);
  assert.equal((await store.deleteMemory('a')), false);
});
