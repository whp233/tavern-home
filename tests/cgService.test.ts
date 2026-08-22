// tests/cgService.test.ts
// 自定义 CG 纯函数层（task-14）：ID / 校验 / 条件求值 / 解锁判断。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCgId, validateCgBody, evaluateCgCondition, isCgUnlocked,
  CG_TITLE_MAX,
} from '../src/core/cgService.ts';

test('buildCgId: 前缀 + 基本不重复', () => {
  const a = buildCgId();
  const b = buildCgId();
  assert.ok(a.startsWith('cg_'));
  assert.ok(b.startsWith('cg_'));
  assert.notEqual(a, b);
});

test('validateCgBody: create 必须 title，字段边界与 partial 语义', () => {
  assert.equal(validateCgBody({ title: '初见' }), null);
  assert.match(validateCgBody({}), /title 必填/);
  assert.match(validateCgBody({ title: '' }), /title 不能为空/);
  assert.match(validateCgBody({ title: 'x'.repeat(CG_TITLE_MAX + 1) }), /不超过/);
  assert.match(validateCgBody({ title: 'x', enabled: 'yes' }), /enabled 必须是布尔值/);
  assert.equal(validateCgBody({}, { partial: true }), null);
  assert.match(validateCgBody({ title: '' }, { partial: true }), /title 不能为空/);
});

test('evaluateCgCondition: 空串恒真，表达式对 state 求值', () => {
  assert.equal(evaluateCgCondition('', { yuki_power: 50 }), true);
  assert.equal(evaluateCgCondition('yuki_power >= 50', { yuki_power: 60 }), true);
  assert.equal(evaluateCgCondition('yuki_power >= 50', { yuki_power: 40 }), false);
  assert.equal(evaluateCgCondition('state.位置 === "琉璃塔"', { 位置: '琉璃塔' }), true);
  // 非法表达式不抛，按未解锁处理
  assert.equal(evaluateCgCondition('yuki_power >=== 50', { yuki_power: 60 }), false);
});

test('isCgUnlocked: enabled + 场景键 + 条件三层都过才解锁', () => {
  const state = { 场景: '琉璃塔', yuki_power: 60 };
  assert.equal(isCgUnlocked({ enabled: true, sceneKey: '', condition: '' }, state), true);
  assert.equal(isCgUnlocked({ enabled: false, sceneKey: '', condition: '' }, state), false);
  assert.equal(isCgUnlocked({ enabled: true, sceneKey: '别的塔', condition: '' }, state), false);
  assert.equal(isCgUnlocked({ enabled: true, sceneKey: '琉璃塔', condition: '' }, state), true);
  assert.equal(isCgUnlocked({ enabled: true, sceneKey: '琉璃', condition: '' }, state), true);
  assert.equal(isCgUnlocked({ enabled: true, sceneKey: '琉璃塔', condition: 'yuki_power >= 50' }, state), true);
  assert.equal(isCgUnlocked({ enabled: true, sceneKey: '琉璃塔', condition: 'yuki_power >= 80' }, state), false);
});