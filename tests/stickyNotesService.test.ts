// tests/stickyNotesService.test.ts
// 便签纯函数层（task-15）：ID / 校验 / 颜色 / 预览 / 排序。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStickyNoteId, validateStickyNoteBody, isStickyNoteColor, makeStickyNotePreview,
  compareStickyNotes, STICKY_COLORS, STICKY_TITLE_MAX, STICKY_CONTENT_MAX,
} from '../src/core/stickyNotes.ts';
import type { StickyNote } from '../src/core/stickyNotes.ts';

const note = (p: Partial<StickyNote>): StickyNote => ({
  id: 'sn_1', project: '', charKey: '', title: '', content: 'x',
  color: 'yellow', pinned: false, createdAt: 'a', updatedAt: 'a', ...p,
});

test('buildStickyNoteId: 前缀 + 不重复', () => {
  const a = buildStickyNoteId();
  const b = buildStickyNoteId();
  assert.ok(a.startsWith('sn_'));
  assert.ok(b.startsWith('sn_'));
  assert.notEqual(a, b);
});

test('isStickyNoteColor / STICKY_COLORS', () => {
  assert.equal(isStickyNoteColor('yellow'), true);
  assert.equal(isStickyNoteColor('green'), true);
  assert.equal(isStickyNoteColor('blue'), true);
  assert.equal(isStickyNoteColor('pink'), true);
  assert.equal(isStickyNoteColor('gray'), true);
  assert.equal(isStickyNoteColor('red'), false);
  assert.equal(isStickyNoteColor(null), false);
  assert.deepEqual(STICKY_COLORS, ['yellow', 'green', 'blue', 'pink', 'gray']);
});

test('validateStickyNoteBody: create 必须 content，字段边界', () => {
  assert.equal(validateStickyNoteBody(null), '请求体不对');
  assert.equal(validateStickyNoteBody([]), '请求体不对');
  assert.equal(validateStickyNoteBody({}), 'content 必填');
  assert.equal(validateStickyNoteBody({ content: '   ' }), 'content 不能为空');
  assert.equal(validateStickyNoteBody({ content: 'x' }), null);
  assert.equal(validateStickyNoteBody({ content: 'x'.repeat(STICKY_CONTENT_MAX + 1) }), `content 必须是字符串,且不超过${STICKY_CONTENT_MAX}字`);
  assert.equal(validateStickyNoteBody({ content: 'x', title: '长'.repeat(101) }), `title 必须是字符串,且不超过${STICKY_TITLE_MAX}字`);
  assert.equal(validateStickyNoteBody({ content: 'x', color: 'red' }), 'color 必须是 yellow/green/blue/pink/gray 之一');
  assert.equal(validateStickyNoteBody({ content: 'x', pinned: 'yes' }), 'pinned 必须是布尔值');
  assert.equal(validateStickyNoteBody({ content: 'x', pinned: true, color: 'pink', project: 'P', charKey: '露' }), null);
});

test('validateStickyNoteBody: partial 只校验给出的字段', () => {
  assert.equal(validateStickyNoteBody({ title: '新标题' }, { partial: true }), null);
  assert.equal(validateStickyNoteBody({ content: '' }, { partial: true }), null); // 更新允许先清空再整体替换
  assert.equal(validateStickyNoteBody({ content: 123 }, { partial: true }), `content 必须是字符串,且不超过${STICKY_CONTENT_MAX}字`);
  assert.equal(validateStickyNoteBody({ pinned: false }, { partial: true }), null);
});

test('makeStickyNotePreview: 换行拍平 + 截断', () => {
  assert.equal(makeStickyNotePreview('第一行\n第二行\n第三行', 10), '第一行 第二行 第三…');
  assert.equal(makeStickyNotePreview('短', 120), '短');
  assert.equal(makeStickyNotePreview(null), '');
  assert.equal(makeStickyNotePreview('x'.repeat(200), 120).length, 121); // 含省略号
});

test('compareStickyNotes: 置顶优先 + 更新时间倒序', () => {
  const pinned = note({ id: 'p', pinned: true, updatedAt: 't1' });
  const fresh = note({ id: 'f', pinned: false, updatedAt: 't2' });
  const older = note({ id: 'o', pinned: false, updatedAt: 't1' });
  const sorted = [older, fresh, pinned].sort(compareStickyNotes);
  assert.deepEqual(sorted.map((n) => n.id), ['p', 'f', 'o']);
});