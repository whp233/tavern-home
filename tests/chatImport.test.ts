import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatJsonl, mergeFloors } from '../src/core/chatImport.ts';

test('parses a legal user/assistant alternating JSONL with swipes', () => {
  const raw = [
    JSON.stringify({ name: '我', is_user: true, mes: '你好', send_date: 1000 }),
    JSON.stringify({ name: '露', is_user: false, mes: '嗯。', swipes: ['嗯。', '嗯？'], swipe_id: 1, send_date: 2000 }),
    JSON.stringify({ name: '我', is_user: true, mes: '今天去哪？', send_date: 3000 }),
  ].join('\n');
  const result = parseChatJsonl(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.floors.length, 3);
  assert.equal(result.floors[0].role, 'user');
  assert.equal(result.floors[0].content, '你好');
  assert.deepEqual(result.floors[0].variants, ['你好']);
  assert.equal(result.floors[0].activeVariant, 0);
  assert.equal(result.floors[1].role, 'assistant');
  assert.equal(result.floors[1].content, '嗯？'); // swipe_id 1 激活
  assert.deepEqual(result.floors[1].variants, ['嗯。', '嗯？']);
  assert.equal(result.floors[1].activeVariant, 1);
  assert.equal(result.floors[2].role, 'user');
  assert.equal(result.warnings.length, 0);
  assert.equal(result.skipped_lines, 0);
});

test('uses role string when is_user is missing', () => {
  const raw = [
    JSON.stringify({ name: '我', role: 'user', mes: 'a', send_date: 100 }),
    JSON.stringify({ name: '露', role: 'assistant', mes: 'b', send_date: 200 }),
  ].join('\n');
  const result = parseChatJsonl(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.floors[0].role, 'user');
  assert.equal(result.floors[1].role, 'assistant');
  assert.equal(result.warnings.length, 0);
});

test('skips bad lines with a warning and keeps going', () => {
  const raw = [
    JSON.stringify({ is_user: true, mes: 'ok' }),
    '{ 这不是 JSON',
    '42',
    JSON.stringify({ is_user: false, mes: 'after' }),
  ].join('\n');
  const result = parseChatJsonl(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.floors.length, 2);
  assert.equal(result.skipped_lines, 2);
  assert.ok(result.warnings.some((w) => w.includes('JSON 解析失败')));
  assert.ok(result.warnings.some((w) => w.includes('不是合法的消息对象')));
});

test('skips is_system / is_event lines', () => {
  const raw = [
    JSON.stringify({ is_user: true, mes: 'a' }),
    JSON.stringify({ is_system: true, mes: '**系统提示**' }),
    JSON.stringify({ is_event: true, mes: '角色入场' }),
    JSON.stringify({ is_user: false, mes: 'b' }),
  ].join('\n');
  const result = parseChatJsonl(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.floors.length, 2);
  assert.equal(result.skipped_lines, 2);
});

test('skips lines whose mes is missing or wrong type', () => {
  const raw = [
    JSON.stringify({ is_user: true }),           // 缺 mes
    JSON.stringify({ is_user: false, mes: 123 }), // mes 类型不对
    JSON.stringify({ is_user: true, mes: 'real' }),
  ].join('\n');
  const result = parseChatJsonl(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.floors.length, 1);
  assert.equal(result.skipped_lines, 2);
  assert.equal(result.floors[0].content, 'real');
});

test('falls back to assistant and warns when role cannot be determined', () => {
  const raw = JSON.stringify({ mes: '没有角色标记的消息' });
  const result = parseChatJsonl(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.floors.length, 1);
  assert.equal(result.floors[0].role, 'assistant');
  assert.ok(result.warnings.some((w) => w.includes('按 assistant 落')));
});

test('warns and drops non-array swipes, falling back to mes', () => {
  const raw = JSON.stringify({ is_user: false, mes: '正文', swipes: '不是数组' });
  const result = parseChatJsonl(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.floors[0].content, '正文');
  assert.deepEqual(result.floors[0].variants, ['正文']);
  assert.equal(result.floors[0].activeVariant, 0);
  assert.ok(result.warnings.some((w) => w.includes('swipes')));
});

test('enforces strictly increasing created_at when send_date repeats', () => {
  const raw = [
    JSON.stringify({ is_user: true, mes: 'a', send_date: 1000 }),
    JSON.stringify({ is_user: false, mes: 'b', send_date: 1000 }),
    JSON.stringify({ is_user: true, mes: 'c', send_date: 2000 }),
  ].join('\n');
  const result = parseChatJsonl(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.floors[0].createdAt, new Date(1000).toISOString());
  assert.equal(result.floors[1].createdAt, new Date(1001).toISOString()); // 顺延 +1ms
  assert.equal(result.floors[2].createdAt, new Date(2000).toISOString());
  const times = result.floors.map((f) => new Date(f.createdAt).getTime());
  assert.ok(times[1] > times[0]);
  assert.ok(times[2] > times[1]);
});

test('falls back to continuous time when send_date is missing', () => {
  const raw = [
    JSON.stringify({ is_user: true, mes: 'a' }),
    JSON.stringify({ is_user: false, mes: 'b' }),
  ].join('\n');
  const result = parseChatJsonl(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.floors.length, 2);
  const t0 = new Date(result.floors[0].createdAt).getTime();
  const t1 = new Date(result.floors[1].createdAt).getTime();
  assert.ok(t1 > t0);
  assert.equal(t1, t0 + 1); // 第二行无 send_date → 连续兜底 +1ms
});

test('guarantees content === variants[activeVariant] even with messy swipe_id', () => {
  const raw = [
    JSON.stringify({ is_user: false, mes: 'fallback', swipes: ['v0', 'v1', 'v2'], swipe_id: 99 }), // 越界 → clamp 到 2
    JSON.stringify({ is_user: false, mes: 'm', swipes: ['x'], swipe_id: -5 }),                     // 负数 → clamp 到 0
  ].join('\n');
  const result = parseChatJsonl(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const f of result.floors) {
    assert.equal(f.content, f.variants[f.activeVariant]);
  }
  assert.equal(result.floors[0].activeVariant, 2);
  assert.equal(result.floors[0].content, 'v2');
  assert.equal(result.floors[1].activeVariant, 0);
  assert.equal(result.floors[1].content, 'x');
});

test('truncates overlong mes with a warning', () => {
  const long = 'x'.repeat(60000);
  const raw = JSON.stringify({ is_user: true, mes: long });
  const result = parseChatJsonl(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Array.from(result.floors[0].content).length, 50000);
  assert.ok(result.warnings.some((w) => w.includes('截断')));
});

test('rejects empty input', () => {
  const r = parseChatJsonl('');
  assert.equal(r.ok, false);
  const r2 = parseChatJsonl('   \n  \n');
  assert.equal(r2.ok, false);
});

test('rejects non-string input', () => {
  const r = parseChatJsonl(null as any);
  assert.equal(r.ok, false);
  const r2 = parseChatJsonl(123 as any);
  assert.equal(r2.ok, false);
});

// ===== mergeFloors:合并判重(方案A:role+content 完全一致算重复,只追加不删除)=====

function floor(role: 'user' | 'assistant', content: string, createdAt = '2000-01-01T00:00:00.000Z'): any {
  return { role, content, variants: [content], activeVariant: 0, createdAt };
}

test('mergeFloors: keeps existing, adds only non-duplicate incoming, in order', () => {
  const existing = [floor('user', 'a'), floor('assistant', 'b')];
  const incoming = [
    floor('user', 'a'),      // 重复 → 跳过
    floor('assistant', 'b'), // 重复 → 跳过
    floor('user', 'c'),      // 新 → 保留
    floor('assistant', 'd'), // 新 → 保留
  ];
  const r = mergeFloors(existing, incoming);
  assert.equal(r.skipped, 2);
  assert.equal(r.floors.length, 2);
  assert.equal(r.floors[0].content, 'c');
  assert.equal(r.floors[1].content, 'd');
});

test('mergeFloors: dedupes within the incoming batch itself', () => {
  const incoming = [
    floor('user', 'same'),
    floor('user', 'same'),   // 同批重复 → 只落一条
    floor('assistant', 'x'),
  ];
  const r = mergeFloors([], incoming);
  assert.equal(r.skipped, 1);
  assert.equal(r.floors.length, 2);
  assert.deepEqual(r.floors.map((f) => f.content), ['same', 'x']);
});

test('mergeFloors: role matters for dedup (same content, different role is NOT a duplicate)', () => {
  const existing = [floor('user', 'hi')];
  const incoming = [
    floor('user', 'hi'),      // 同 role 同内容 → 重复
    floor('assistant', 'hi'), // 不同 role → 新
  ];
  const r = mergeFloors(existing, incoming);
  assert.equal(r.skipped, 1);
  assert.equal(r.floors.length, 1);
  assert.equal(r.floors[0].role, 'assistant');
});

test('mergeFloors: empty existing keeps all incoming; empty incoming adds nothing', () => {
  assert.equal(mergeFloors([], [floor('user', 'a')]).floors.length, 1);
  const r = mergeFloors([floor('user', 'a')], []);
  assert.equal(r.floors.length, 0);
  assert.equal(r.skipped, 0);
});

test('mergeFloors: preserves createdAt of kept floors (new messages keep their timestamp)', () => {
  const existing = [floor('user', 'old')];
  const incoming = [
    floor('user', 'old'),
    floor('assistant', 'new', '2026-08-08T10:00:00.000Z'),
  ];
  const r = mergeFloors(existing, incoming);
  assert.equal(r.floors.length, 1);
  assert.equal(r.floors[0].createdAt, '2026-08-08T10:00:00.000Z');
});
