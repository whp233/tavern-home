// tests/diaryService.test.ts
// 日记纯函数层（task-12）：日期归一化 / 时间格式化 / 校验 / 排序 / 预览。
// 数据形状对齐妹居存档实测（date "2026/6/27"、time "下午3:35:11"、affection 0-1000）。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDiaryDate, todayDiaryDate, formatDiaryTime, diaryTimeNow,
  validateDiaryBody, buildDiaryId, makeDiaryPreview, compareDiaryDesc,
  DIARY_CONTENT_MAX, DIARY_AFFECTION_MAX,
} from '../src/core/diaryService.ts';
import type { DiaryEntry } from '../src/core/types.ts';

const entry = (p: Partial<DiaryEntry>): DiaryEntry => ({
  id: 'd1', project: '', charKey: '', date: '2026/6/27', time: '下午3:35:11',
  title: '', content: 'x', affection: null, conversationId: '', conversationLength: null,
  createdAt: 't', updatedAt: 't', ...p,
});

test('normalizeDiaryDate: 各种合法写法都归一化成 YYYY/M/D（无前导零）', () => {
  assert.equal(normalizeDiaryDate(new Date(2026, 5, 27)), '2026/6/27');
  assert.equal(normalizeDiaryDate(new Date('2026-06-27T07:35:11.680Z')), '2026/6/27');
  assert.equal(normalizeDiaryDate('2026/6/27'), '2026/6/27');
  assert.equal(normalizeDiaryDate('2026-06-27'), '2026/6/27');
  assert.equal(normalizeDiaryDate('2026年6月27日'), '2026/6/27');
  assert.equal(normalizeDiaryDate('2026/06/27'), '2026/6/27');
  assert.equal(normalizeDiaryDate('2026-6-7'), '2026/6/7');
  assert.equal(normalizeDiaryDate(' 2026/6/27 '), '2026/6/27');
  assert.equal(normalizeDiaryDate('2026-06-27T07:35:11.680Z'), '2026/6/27');
});

test('normalizeDiaryDate: 非法形状一律 null（不猜不默认）', () => {
  assert.equal(normalizeDiaryDate(''), null);
  assert.equal(normalizeDiaryDate('2026/13/1'), null);   // 月超界
  assert.equal(normalizeDiaryDate('2026/2/30'), null);   // 日超界
  assert.equal(normalizeDiaryDate('2025/2/29'), null);   // 平年 2/29
  assert.equal(normalizeDiaryDate('2024/2/29'), '2024/2/29'); // 闰年 2/29 合法
  assert.equal(normalizeDiaryDate('2026/0/1'), null);    // 月 0
  assert.equal(normalizeDiaryDate('26/6/27'), null);     // 两位年份拒收
  assert.equal(normalizeDiaryDate('abc'), null);
  assert.equal(normalizeDiaryDate(null), null);
  assert.equal(normalizeDiaryDate(undefined), null);
  assert.equal(normalizeDiaryDate({}), null);
  assert.equal(normalizeDiaryDate(NaN), null);
  assert.equal(normalizeDiaryDate(new Date('nope')), null);
});

test('todayDiaryDate / diaryTimeNow 形状', () => {
  assert.match(todayDiaryDate(), /^\d{4}\/\d{1,2}\/\d{1,2}$/);
  assert.match(diaryTimeNow(), /^(上午|下午)\d{1,2}:\d{2}:\d{2}$/);
});

test('formatDiaryTime: 妹居风格 12 小时制中文', () => {
  assert.equal(formatDiaryTime(new Date(2026, 5, 27, 15, 35, 11)), '下午3:35:11');
  assert.equal(formatDiaryTime(new Date(2026, 5, 27, 9, 30, 0)), '上午9:30:00');
  assert.equal(formatDiaryTime(new Date(2026, 5, 27, 12, 0, 0)), '下午12:00:00');
  assert.equal(formatDiaryTime(new Date(2026, 5, 27, 0, 5, 9)), '上午12:05:09');
});

test('validateDiaryBody: create 必填 content，date 缺省可（工具层置今天）', () => {
  assert.equal(validateDiaryBody(null), '请求体不对');
  assert.equal(validateDiaryBody([]), '请求体不对');
  assert.equal(validateDiaryBody({}), 'content 必填');
  assert.equal(validateDiaryBody({ content: '   ' }), 'content 不能为空（空日记没有保存意义）');
  assert.equal(validateDiaryBody({ content: 'x', date: '2026/13/1' }), 'date 必须是合法日期（如 2026/6/27）');
  assert.equal(validateDiaryBody({ content: 'x', date: '2026/6/27' }), null);
  assert.equal(validateDiaryBody({ content: 'x', date: '2026/6/27', title: '标题', charKey: 'Yuki', project: 'P', affection: 760, conversationId: 'c1', conversationLength: 42, time: '下午3:35:11' }), null);
});

test('validateDiaryBody: 字段边界', () => {
  assert.equal(validateDiaryBody({ content: 'x'.repeat(DIARY_CONTENT_MAX + 1) }), `content 必须是字符串,且不超过${DIARY_CONTENT_MAX}字`);
  assert.equal(validateDiaryBody({ content: 'x', title: '长'.repeat(201) }), 'title 必须是字符串,且不超过200字');
  assert.equal(validateDiaryBody({ content: 'x', affection: DIARY_AFFECTION_MAX + 1 }), `affection 必须是 0-${DIARY_AFFECTION_MAX} 的整数或 null`);
  assert.equal(validateDiaryBody({ content: 'x', affection: -1 }), `affection 必须是 0-${DIARY_AFFECTION_MAX} 的整数或 null`);
  assert.equal(validateDiaryBody({ content: 'x', affection: 1.5 }), `affection 必须是 0-${DIARY_AFFECTION_MAX} 的整数或 null`);
  assert.equal(validateDiaryBody({ content: 'x', affection: null }), null);
  assert.equal(validateDiaryBody({ content: 'x', conversationLength: -1 }), 'conversationLength 必须是不小于 0 的整数或 null');
  assert.equal(validateDiaryBody({ content: 'x', conversationLength: null }), null);
  assert.equal(validateDiaryBody({ content: 'x', charKey: '名'.repeat(101) }), 'charKey 必须是字符串,且不超过100字');
  assert.equal(validateDiaryBody({ content: 'x', project: '名'.repeat(101) }), 'project 必须是字符串,且不超过100字');
});

test('validateDiaryBody: partial 更新只校验给出的字段', () => {
  assert.equal(validateDiaryBody({ title: '新标题' }, { partial: true }), null);
  assert.equal(validateDiaryBody({ title: 123 }, { partial: true }), 'title 必须是字符串,且不超过200字');
  assert.equal(validateDiaryBody({ content: '' }, { partial: true }), 'content 不能为空（空日记没有保存意义）');
  assert.equal(validateDiaryBody({ date: '2026/6/27' }, { partial: true }), null);
});

test('buildDiaryId: 前缀 + 不重复', () => {
  const a = buildDiaryId();
  const b = buildDiaryId();
  assert.match(a, /^diary_\d+_/);
  assert.notEqual(a, b);
});

test('makeDiaryPreview: 换行拍平 + 截断不带全文', () => {
  assert.equal(makeDiaryPreview('第一行\n第二行\n【日记书写时间为…】', 10), '第一行 第二行 【日');
  assert.equal(makeDiaryPreview('第一行\n第二行\n【日记书写时间为…】', 120), '第一行 第二行 【日记书写时间为…】');
  assert.equal(makeDiaryPreview('短', 120), '短');
  assert.equal(makeDiaryPreview(null), '');
});

test('compareDiaryDesc: 日期数值倒序（无前导零词法陷阱）+ 同日按 updatedAt 倒序', () => {
  const a = entry({ date: '2026/9/2', updatedAt: 't1' });
  const b = entry({ date: '2026/10/2', updatedAt: 't2' });
  const c = entry({ date: '2026/10/2', updatedAt: 't3' });
  const d = entry({ date: '2025/12/31', updatedAt: 't0' });
  const bad = entry({ date: '垃圾', updatedAt: 't5' });
  const sorted = [a, b, c, d, bad].sort(compareDiaryDesc);
  assert.deepEqual(sorted.map((e) => e.id), ['d1', 'd1', 'd1', 'd1', 'd1']);
  // 用 distinct id 断言顺序
  const [x, y] = [entry({ id: 'x', date: '2026/10/2', updatedAt: 't2' }), entry({ id: 'y', date: '2026/9/2', updatedAt: 't1' })];
  assert.equal([x, y].sort(compareDiaryDesc)[0].id, 'x'); // 10月排在9月前（最新在前）
  const [p, q] = [entry({ id: 'p', date: '2026/10/2', updatedAt: 't3' }), entry({ id: 'q', date: '2026/10/2', updatedAt: 't9' })];
  assert.equal([p, q].sort(compareDiaryDesc)[0].id, 'q'); // 同日最新改动的在前
  assert.equal([bad, x].sort(compareDiaryDesc)[0].id, 'x'); // 非法日期沉底
});