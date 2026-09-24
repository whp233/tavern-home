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
  getActionViews,
  getAction,
  resolveActionStep,
  checkEndings,
} from '../src/core/trpg/trpgRuntime.ts';
import type { TrpgAction, TrpgScenario, TrpgStateChanges } from '../src/core/trpg/types.ts';
import { evaluateCondition } from '../src/core/conditionExpr.ts';

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

// ── 场景选项系统（2026-09-24 赋能）：visibleExp / enableExp 双档判定 ──
// 参考 1room《ActMenuItem》：「显不显示」与「能不能点」是两件事。

// 合成最小剧本，用来精确控制表达式。
function makeScenario(actions: TrpgAction[]): TrpgScenario {
  return {
    id: 'test', name: '测试', info: '', difficulty: '', estimatedTime: '', tags: [],
    paths: { config: '', gmPrompt: '' },
    scenario: {
      title: '测试', intro: '',
      initialState: { locationId: 'room', stamina: 10, time: 0, coins: 0, affection: 0, trust: 0 },
    },
    locations: [{ id: 'room', name: '房间', description: '', isStart: true, availableActions: actions }],
    items: [],
    keyEvents: [],
    endings: [],
  };
}

test('getActionViews：无表达式时与改造前行为逐字一致（回归守卫）', () => {
  const scenario = makeScenario([
    { id: 'free', label: '随手做', description: '' },
    { id: 'needs_herb', label: '用药草', description: '', requiresItem: 'herb' },
  ]);
  const state = createInitialState(scenario);

  // 旧函数：只出 free —— 与改造前完全一致
  assert.deepEqual(getAvailableActions(scenario, state).map((a) => a.id), ['free']);

  // 新函数：两个都在，needs_herb 是「未開放」
  const views = getActionViews(scenario, state);
  assert.deepEqual(views.map((v) => v.action.id), ['free', 'needs_herb']);
  assert.deepEqual(views.map((v) => v.visible), [true, true]);
  assert.deepEqual(views.map((v) => v.enabled), [true, false]);
  assert.deepEqual(views.map((v) => v.locked), [false, true]);

  // 拿到道具后自动解锁
  state.items['herb'] = 1;
  const after = getActionViews(scenario, state);
  assert.equal(after.find((v) => v.action.id === 'needs_herb')!.enabled, true);
  assert.equal(after.find((v) => v.action.id === 'needs_herb')!.locked, false);
});

test('visibleExp 为假：动作不出现（玩家不该知道有这东西）', () => {
  const scenario = makeScenario([
    { id: 'secret', label: '秘密动作', description: '', visibleExp: 'progress.secret >= 1' },
  ]);
  const state = createInitialState(scenario);
  assert.deepEqual(getAvailableActions(scenario, state).map((a) => a.id), []);
  assert.deepEqual(getActionViews(scenario, state), [], '服务端就挡掉，不下发客户端');
});

test('enableExp 为假：可见但点不动 —— 这就是「未開放」槽位', () => {
  const scenario = makeScenario([
    { id: 'gate', label: '上锁的动作', description: '', visibleExp: 'true', enableExp: 'stamina >= 100' },
  ]);
  const state = createInitialState(scenario); // stamina = 10
  const v = getActionViews(scenario, state)[0];
  assert.equal(v.visible, true, '看得见');
  assert.equal(v.enabled, false, '点不动');
  assert.equal(v.locked, true, '灰 + 锁标，但槽位不清空');
  // 旧函数语义是「能做的」→ 锁着的仍不在其中（与改造前一致）
  assert.deepEqual(getAvailableActions(scenario, state).map((a) => a.id), []);
});

test('三态进度约定：flags.progress 的 0/1/2 直接写进表达式，不需要新机制', () => {
  const scenario = makeScenario([
    { id: 'a1', label: 'A1', description: '', visibleExp: 'progress.a >= 1' },
    { id: 'a2', label: 'A2', description: '', visibleExp: 'progress.a == 2' },
  ]);
  const state = createInitialState(scenario);

  state.flags.progress = { a: 0 }; // 未开放
  assert.deepEqual(getAvailableActions(scenario, state).map((a) => a.id), []);

  state.flags.progress = { a: 1 }; // 已解锁、还没做
  assert.deepEqual(getAvailableActions(scenario, state).map((a) => a.id), ['a1']);

  state.flags.progress = { a: 2 }; // 已完成
  assert.deepEqual(getAvailableActions(scenario, state).map((a) => a.id), ['a1', 'a2']);
});

test('表达式支持 && / || / 括号 复合条件', () => {
  const scenario = makeScenario([
    {
      id: 'complex', label: '复合', description: '',
      visibleExp: '(progress.a == 2 || coins >= 100) && stamina > 0',
    },
  ]);
  const state = createInitialState(scenario); // stamina 10, coins 0
  state.flags.progress = { a: 0 };
  assert.deepEqual(getActionViews(scenario, state), []);
  state.coins = 100;
  assert.equal(getActionViews(scenario, state).length, 1);
});

test('契约：表达式引用未定义的变量会静默判假（fail-closed）', () => {
  // 白名单求值器把未定义变量解析成 undefined 而不抛（旧实现是抛了被 try/catch 吞）。
  // 对剧本作者的含义不变：visibleExp 里用到的变量必须先在 initialState.flags 里初始化，
  // 否则该动作会永远不显示 —— 是"静默隐藏"，不是报错。
  const scenario = makeScenario([
    { id: 'typo', label: '拼错的变量', description: '', visibleExp: 'progres.a >= 1' }, // 少个 s
  ]);
  const state = createInitialState(scenario);
  assert.deepEqual(getActionViews(scenario, state), [], '静默隐藏 = 列表里根本没有它');
  assert.equal(evaluateCondition('progres.a >= 1', { progress: { a: 5 } }), false, '变量名拼错 → 假');
  assert.equal(evaluateCondition('progress.a >= 1', { progress: { a: 5 } }), true, '写对了 → 真');
});
test('契约：visible 与 enabled 缺省时互不干扰（不会因为没写表达式就互相污染）', () => {
  const scenario = makeScenario([
    { id: 'only_visible', label: '只给可见性', description: '', visibleExp: 'true' },
    { id: 'only_enable', label: '只给可用性', description: '', enableExp: 'stamina > 0' },
    { id: 'neither', label: '都不给', description: '' },
  ]);
  const state = createInitialState(scenario);
  const by = Object.fromEntries(getActionViews(scenario, state).map((v) => [v.action.id, v]));
  assert.deepEqual([by['only_visible'].visible, by['only_visible'].enabled], [true, true]);
  assert.deepEqual([by['only_enable'].visible, by['only_enable'].enabled], [true, true]);
  assert.deepEqual([by['neither'].visible, by['neither'].enabled], [true, true]);
});

test('★ M3 试金石：同一套代码 + 两份剧本 = 两种玩法（数据驱动，零代码改动）', () => {
  // 剧本 A：三个动作全无条件 —— 一上来都能点。
  const openScenario = makeScenario([
    { id: 'a', label: 'A', description: '' },
    { id: 'b', label: 'B', description: '' },
    { id: 'c', label: 'C', description: '' },
  ]);
  // 剧本 B：**同样的动作 id**，但用 visibleExp / progress 三态串成一条解锁链。
  // 差别全在数据里 —— 引擎代码一行没变。
  const gatedScenario = makeScenario([
    {
      id: 'a', label: 'A', description: '',
      visibleExp: 'progress.ch >= 1',
      stateChanges: { flags: { progress: { ch: 2 } } },
    },
    {
      id: 'b', label: 'B', description: '',
      visibleExp: 'progress.ch >= 2',
      stateChanges: { flags: { progress: { ch: 3 } } },
    },
    { id: 'c', label: 'C', description: '', visibleExp: 'progress.ch >= 3' },
  ]);

  // A：三个都出
  const s1 = createInitialState(openScenario);
  assert.deepEqual(getAvailableActions(openScenario, s1).map((a) => a.id), ['a', 'b', 'c']);

  // B：起点只有 a（ch=1）；b、c 连「看得见」都做不到
  const s2 = createInitialState(gatedScenario);
  s2.flags.progress = { ch: 1 };
  assert.deepEqual(getAvailableActions(gatedScenario, s2).map((a) => a.id), ['a']);
  assert.deepEqual(
    getActionViews(gatedScenario, s2).map((v) => v.action.id),
    ['a'],
    'b、c 服务端就挡掉，不下发',
  );

  // 做完 a → ch 推到 2 → b 自动出现（代码没改一行）
  const afterA = resolveActionStep(gatedScenario, s2, getAction(gatedScenario, 'room', 'a')!, { demo: true });
  assert.deepEqual(getAvailableActions(gatedScenario, afterA.state).map((a) => a.id), ['a', 'b']);

  // 再做完 b → ch 推到 3 → c 出现，链走通
  const afterB = resolveActionStep(gatedScenario, afterA.state, getAction(gatedScenario, 'room', 'b')!, { demo: true });
  assert.deepEqual(getAvailableActions(gatedScenario, afterB.state).map((a) => a.id), ['a', 'b', 'c']);
});

test('内置剧本：travel_throne 在试炼通过前锁着（未開放），通过后解锁', () => {
  const scenario = getScenario('isekai-demon-lord')!;
  let state = createInitialState(scenario);

  // 走到洞窟
  state = resolveActionStep(scenario, state, getAction(scenario, 'village', 'travel_forest')!, { demo: true }).state;
  state = resolveActionStep(scenario, state, getAction(scenario, 'forest', 'travel_cave')!, { demo: true }).state;
  assert.equal(state.locationId, 'cave');

  // 没通过试炼 → 看得见，但点不动（enableExp 门禁）
  let throne = getActionViews(scenario, state).find((v) => v.action.id === 'travel_throne')!;
  assert.equal(throne.visible, true, '看得见 —— 玩家知道前面还有路');
  assert.equal(throne.enabled, false, '点不动');
  assert.equal(throne.locked, true, '灰 + 🔒');
  assert.deepEqual(getAvailableActions(scenario, state).map((a) => a.id), ['trial_cave', 'rest_cave']);

  // 通过试炼 → 自动解锁（数据驱动，代码没改）
  state.flags.trial_passed = true;
  throne = getActionViews(scenario, state).find((v) => v.action.id === 'travel_throne')!;
  assert.equal(throne.locked, false);
  assert.equal(throne.enabled, true);
  assert.ok(getAvailableActions(scenario, state).some((a) => a.id === 'travel_throne'));
});

test('内置剧本：talk_demon_lord 在试炼通过前压根不出现（visibleExp 门禁）', () => {
  const scenario = getScenario('isekai-demon-lord')!;
  const state = createInitialState(scenario);
  state.flags.trial_passed = false;

  // 假想已在魔王城
  const atThrone = { ...state, locationId: 'throne_room' };
  const ids = getActionViews(scenario, atThrone).map((v) => v.action.id);
  assert.ok(!ids.includes('talk_demon_lord'), '条件不满足时它不该出现在列表里');
  assert.ok(ids.includes('attack_demon_lord'), '同地点其他动作不受影响');

  const unlocked = { ...atThrone, flags: { ...atThrone.flags, trial_passed: true } };
  assert.ok(getActionViews(scenario, unlocked).some((v) => v.action.id === 'talk_demon_lord'));
});