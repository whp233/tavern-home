// tests/conditionExpr.test.ts
// 白名单表达式求值器（2026-09-24）。
//
// 为什么值得单独一个测试文件：它替掉的是 **在 Cloudflare Workers 上从来不工作** 的
// `new Function` 实现。TRPG 结局、自定义 CG 解锁、动作门禁全都挂在它身上。

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition, CONDITION_MAX_LENGTH } from '../src/core/conditionExpr.ts';

test('空串恒真（沿用旧约定：没写条件就是不设限）', () => {
  assert.equal(evaluateCondition('', {}), true);
  assert.equal(evaluateCondition('   ', {}), true);
  assert.equal(evaluateCondition(undefined as unknown as string, {}), true);
});

test('比较运算：数字 / 字符串 / === !==', () => {
  const s = { stamina: 10, name: 'yuki', alive: true, nothing: null };
  assert.equal(evaluateCondition('stamina >= 10', s), true);
  assert.equal(evaluateCondition('stamina > 10', s), false);
  assert.equal(evaluateCondition('stamina <= 10', s), true);
  assert.equal(evaluateCondition('stamina < 10', s), false);
  assert.equal(evaluateCondition('stamina === 10', s), true);
  assert.equal(evaluateCondition('stamina !== 10', s), false);
  assert.equal(evaluateCondition('name === "yuki"', s), true);
  assert.equal(evaluateCondition("name !== 'yuki'", s), false);
  assert.equal(evaluateCondition('alive === true', s), true);
  assert.equal(evaluateCondition('nothing === null', s), true);
});

test('逻辑运算与括号，优先级正确', () => {
  const s = { a: 1, b: 0, c: 1 };
  assert.equal(evaluateCondition('a && c', s), true);
  assert.equal(evaluateCondition('a && b', s), false);
  assert.equal(evaluateCondition('b || c', s), true);
  assert.equal(evaluateCondition('!b', s), true);
  assert.equal(evaluateCondition('!a', s), false);
  // && 优先级高于 ||
  assert.equal(evaluateCondition('b && c || a', s), true);
  assert.equal(evaluateCondition('a || b && c', s), true);
  assert.equal(evaluateCondition('(b || c) && a', s), true);
  assert.equal(evaluateCondition('!(b || c)', s), false);
});

test('成员访问：点号链、只走自有属性', () => {
  const s = { flags: { trial_passed: true, nested: { deep: 7 } }, items: { herb: 2 } };
  assert.equal(evaluateCondition('flags.trial_passed === true', s), true);
  assert.equal(evaluateCondition('flags.nested.deep === 7', s), true);
  assert.equal(evaluateCondition('items.herb >= 1', s), true);
  assert.equal(evaluateCondition('items.sword >= 1', s), false);
  // 原型链上的东西取不到 —— 顺手堵住 __proto__ / constructor 一类取值
  assert.equal(evaluateCondition('flags.constructor === undefined', s), true);
  assert.equal(evaluateCondition('flags.__proto__ === undefined', s), true);
});

test('未定义变量与空值：一律 fail-closed，不抛', () => {
  assert.equal(evaluateCondition('nope >= 1', {}), false);
  assert.equal(evaluateCondition('a.b.c >= 1', {}), false, '在 undefined 上取属性也不炸');
  assert.equal(evaluateCondition('missing === true', {}), false);
  // null/undefined 参与序比较 → false（不是 true，这一步是刻意的）
  assert.equal(evaluateCondition('x <= 1', { x: null }), false);
  assert.equal(evaluateCondition('x >= 0', { x: undefined }), false);
});

test('语法错误 → 假，不抛（表达式是用户写的）', () => {
  for (const bad of ['a &&', '(a', 'a ===', 'a b', '@#$', 'a = 1', 'f()', 'a[0]', 'a + 1']) {
    assert.equal(evaluateCondition(bad, { a: 1 }), false, `应判假: ${bad}`);
  }
  assert.equal(evaluateCondition('x'.repeat(CONDITION_MAX_LENGTH + 1), {}), false, '超长直接判假');
});

// ── 真实用例：这些是项目里 / 参照系里实际写着的表达式 ──────────────

test('真实用例：项目内置剧本的结局条件', () => {
  // src/core/trpg/scenarios/isekai-demon-lord.json
  assert.equal(evaluateCondition('flags.defeated_demon_lord === true', { flags: { defeated_demon_lord: true } }), true);
  assert.equal(evaluateCondition('flags.defeated_demon_lord === true', { flags: {} }), false);
  assert.equal(evaluateCondition('stamina <= 0', { stamina: 0 }), true);
  assert.equal(evaluateCondition('stamina <= 0', { stamina: 1 }), false);
});

test('真实用例：uiEvents 的大成功 / 大失败条件', () => {
  // condition: "dice.critical === 'success'"
  assert.equal(evaluateCondition("dice.critical === 'success'", { dice: { critical: 'success' } }), true);
  assert.equal(evaluateCondition("dice.critical === 'failure'", { dice: { critical: 'success' } }), false);
});

test('真实用例：cgService 文档里的 yuki_power >= 50', () => {
  assert.equal(evaluateCondition('yuki_power >= 50', { yuki_power: 60 }), true);
  assert.equal(evaluateCondition('yuki_power >= 50', { yuki_power: 40 }), false);
});

test('真实用例：1room《ActMenuItem》里最复杂的一条', () => {
  // 逆向文档 §10.2 原文；日文标识符必须能解析
  const expr = '(足閉じ==0||足閉じ挿入==1)&&パンツ!=3&&ゴム==0&&(挿入ＯＫ==1||ローション==1)&&挿入==0&&(眠り==0||進行度>=1)&&残り汁==0';
  const ok = { 足閉じ: 0, 足閉じ挿入: 0, パンツ: 1, ゴム: 0, 挿入ＯＫ: 1, ローション: 0, 挿入: 0, 眠り: 0, 進行度: 0, 残り汁: 0 };
  assert.equal(evaluateCondition(expr, ok), true);
  assert.equal(evaluateCondition(expr, { ...ok, 挿入: 2 }), false, '插进去了就不该再显示「插入」');
  assert.equal(evaluateCondition(expr, { ...ok, パンツ: 3 }), false, '裤子脱到 3 就不适用');
});

test('真实用例：我们给内置剧本写的门禁', () => {
  const passed = { flags: { trial_passed: true } };
  const notYet = { flags: { trial_passed: false } };
  assert.equal(evaluateCondition('flags.trial_passed === true', passed), true);
  assert.equal(evaluateCondition('flags.trial_passed === true', notYet), false);
  // 这里就是线上那个 bug 的现场：flag 为 true 时旧实现仍然判假
  assert.equal(evaluateCondition('flags.trial_passed === true', { flags: { trial_passed: true } }), true);
});

test('真实用例：三态进度约定 progress.x ∈ {0,1,2}', () => {
  assert.equal(evaluateCondition('progress.a >= 1', { progress: { a: 0 } }), false);
  assert.equal(evaluateCondition('progress.a >= 1', { progress: { a: 1 } }), true);
  assert.equal(evaluateCondition('progress.a == 2', { progress: { a: 1 } }), false);
  assert.equal(evaluateCondition('progress.a == 2', { progress: { a: 2 } }), true);
});

test('注入面：函数调用 / 赋值 / 下标都不在语法集里', () => {
  const scope = { a: 1 };
  // 这些在旧实现里是「服务端任意 JS 执行」，现在是语法错误 → 判假
  assert.equal(evaluateCondition('(function(){return true})()', scope), false);
  assert.equal(evaluateCondition('globalThis', scope), false, '取不到 globalThis（不在 scope 里）');
  assert.equal(evaluateCondition('a.toString', scope), false, '原型方法取不到');
});
