// tests/trpg.test.ts
// TRPG 剧情模式（task-21）纯函数层：剧本装载 / GM 输出解析 / 骰子 / 状态机。

import test from 'node:test';
import assert from 'node:assert/strict';
import { listScenarioSummaries, getScenario } from '../src/core/trpg/scenarioData.ts';
import { parseGmOutput } from '../src/core/trpg/parseGmOutput.ts';
import { evaluateDice } from '../src/core/trpg/dice.ts';
import {
  createInitialState,
  getAvailableActions,
  getAction,
  resolveActionStep,
  checkEndings,
} from '../src/core/trpg/trpgRuntime.ts';

test('TRPG 剧本装载：registry 与内置示范剧本存在', () => {
  const list = listScenarioSummaries();
  assert.ok(list.length >= 1);
  assert.equal(list[0].id, 'isekai-demon-lord');
  assert.ok(getScenario('isekai-demon-lord'));
});

test('初始化状态：从剧本 initialState 建 state，可用动作来自起始地点', () => {
  const scenario = getScenario('isekai-demon-lord')!;
  const state = createInitialState(scenario);
  assert.equal(state.locationId, 'village');
  assert.equal(state.stamina, 100);
  assert.equal(state.phase, 'active');
  const actions = getAvailableActions(scenario, state);
  assert.ok(actions.some((a) => a.id === 'travel_forest'));
  assert.ok(actions.some((a) => a.id === 'rest_village'));
});

test('parseGmOutput：从代码块提取 JSON，旁白留在正文', () => {
  const raw = '你走进村庄。村民们投来期待的目光。\n```json\n{"requires_dice":true,"difficulty":8,"action_type":"check","narration":"你走进村庄。","state_changes":{"stamina":-5,"addItem":{"id":"herb","quantity":1}}}\n```';
  const parsed = parseGmOutput(raw);
  assert.equal(parsed.ok, true);
  assert.match(parsed.narration, /村民/);
  assert.equal(parsed.data?.requiresDice, true);
  assert.equal(parsed.data?.difficulty, 8);
  assert.equal(parsed.data?.stateChanges?.stamina, -5);
});

test('parseGmOutput：无 JSON 时降级为纯叙述不判定', () => {
  const parsed = parseGmOutput('GM 只是描写了一段气氛。');
  assert.equal(parsed.ok, false);
  assert.match(parsed.warning || '', /JSON/);
});

test('D20 判定：20 大成功、1 大失败、总分过 DC 成功', () => {
  assert.deepEqual(evaluateDice(20, 0, 30), { d20: 20, bonus: 0, total: 20, target: 30, success: true, critical: 'success' });
  assert.deepEqual(evaluateDice(1, 5, 10), { d20: 1, bonus: 5, total: 6, target: 10, success: false, critical: 'failure' });
  assert.equal(evaluateDice(12, 2, 14).success, true);
  assert.equal(evaluateDice(11, 2, 14).success, false);
});

test('resolveActionStep：动作扣体力、成功触发关键事件并应用奖励', () => {
  const scenario = getScenario('isekai-demon-lord')!;
  let state = createInitialState(scenario);
  const travel = getAction(scenario, 'village', 'travel_forest')!;
  const moved = resolveActionStep(scenario, state, travel, {
    gmOutput: { requiresDice: false, narration: '你踏上前往森林的路。' },
    demo: true,
  });
  assert.equal(moved.state.locationId, 'forest');
  assert.equal(moved.state.stamina, 90);
  assert.ok(moved.events.some((e) => e.type === 'LOCATION_CHANGED'));

  state = moved.state;
  const search = getAction(scenario, 'forest', 'search_hermit')!;
  const success = resolveActionStep(scenario, state, search, {
    gmOutput: { requiresDice: true, difficulty: 10, narration: '雾中传来苍老的声音。' },
    demo: true,
    forcedDice: { d20: 12, bonus: 0, total: 12, target: 10, success: true, critical: 'none' },
  });
  assert.equal(success.state.items['old_sword'], 1);
  assert.ok(success.events.some((e) => e.type === 'KEY_EVENT_TRIGGERED'));
});

test('checkEndings：满足胜利条件返回对应结局', () => {
  const scenario = getScenario('isekai-demon-lord')!;
  const state = createInitialState(scenario);
  state.flags.defeated_demon_lord = true;
  const ending = checkEndings(scenario, state);
  assert.ok(ending);
  assert.equal(ending!.id, 'victory');
});