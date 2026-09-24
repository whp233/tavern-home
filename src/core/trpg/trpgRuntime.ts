// src/core/trpg/trpgRuntime.ts
// 程序状态机：声明式剧本 + 当前 state  行动结算、事件发射、结局判定。
// 纯函数，不碰 I/O；骰子可注入（测试用 forcedDice）。

import { evaluateCgCondition } from '../cgService.ts';
import { rollDice } from './dice.ts';
import type {
  GmParsedOutput,
  TrpgAction,
  TrpgActionResult,
  TrpgActionView,
  TrpgDiceResult,
  TrpgEnding,
  TrpgGameEvent,
  TrpgScenario,
  TrpgState,
  TrpgStateChanges,
} from './types.ts';

function cloneState(state: TrpgState): TrpgState {
  return {
    ...state,
    flags: { ...state.flags },
    items: { ...state.items },
  };
}

export function createInitialState(scenario: TrpgScenario): TrpgState {
  const init = scenario.scenario.initialState;
  const unlocked = Array.isArray(init.flags?.unlockedLocations)
    ? (init.flags.unlockedLocations as unknown[]).filter((x): x is string => typeof x === 'string')
    : [init.locationId];
  return {
    locationId: init.locationId,
    stamina: Number(init.stamina) || 100,
    time: Number(init.time) || 0,
    coins: Number(init.coins) || 0,
    affection: Number(init.affection) || 0,
    trust: Number(init.trust) || 0,
    flags: {
      ...(init.flags || {}),
      unlockedLocations: [...new Set([...unlocked, init.locationId])],
    },
    items: { ...(init.items || {}) },
    phase: 'active',
  };
}

export function getLocation(scenario: TrpgScenario, state: TrpgState) {
  return scenario.locations.find((l) => l.id === state.locationId) || null;
}

export function getAction(scenario: TrpgScenario, locationId: string, actionId: string): TrpgAction | null {
  const location = scenario.locations.find((l) => l.id === locationId);
  return location?.availableActions.find((a) => a.id === actionId) || null;
}

function unlockedArray(state: TrpgState): string[] {
  const raw = state.flags.unlockedLocations;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

export function isLocationUnlocked(scenario: TrpgScenario, state: TrpgState, locationId: string): boolean {
  const loc = scenario.locations.find((l) => l.id === locationId);
  if (!loc) return false;
  if (loc.unlocked || loc.isStart) return true;
  return unlockedArray(state).includes(locationId);
}

// ── 场景选项系统（2026-09-24 赋能）──────────────────────────────────
// 改造前这里是一条写死的谓词（只判断 requiresItem）。
// 现在拆成两档：visible（显不显示）/ enabled（能不能点）。
// 缺省值刻意做成「等价于改造前」，所以旧剧本行为逐字节不变。

/** 单个动作的可见性 / 可用性判定。 */
function viewOf(action: TrpgAction, state: TrpgState, scope: Record<string, unknown>): TrpgActionView {
  const visible = action.visibleExp ? evaluateCgCondition(action.visibleExp, scope) : true;
  const enabled = action.enableExp
    ? evaluateCgCondition(action.enableExp, scope)
    : (!action.requiresItem || (state.items[action.requiresItem] ?? 0) > 0);
  return { action, visible, enabled, locked: visible && !enabled };
}

/**
 * 该让玩家看见的动作（含「看得见但点不动」的）。
 *
 * 两档刻意分开：
 * - `visible=false` 的动作**在服务端就挡掉**，不下发客户端 —— 否则玩家从网络包里
 *   就能看见还没该出现的彩蛋，那 visibleExp 就白写了。
 * - `visible=true` 但 `enabled=false` 的**照常下发**，带 `locked` 标志。这是参考系
 *   JSK / 1room 的共同做法：未解锁的槽位不清空，让玩家看得见「这里还有东西」。
 */
export function getActionViews(scenario: TrpgScenario, state: TrpgState): TrpgActionView[] {
  const location = getLocation(scenario, state);
  if (!location) return [];
  const scope = stateForConditions(state);
  return location.availableActions
    .map((a) => viewOf(a, state, scope))
    .filter((v) => v.visible);
}

/**
 * 只出「可见 **且** 可用」的动作 —— 这是改造前 `getAvailableActions` 的语义
 * （旧实现按 requiresItem 过滤，滤掉的正是"做不了的"）。签名与行为保持不变。
 */
export function getAvailableActions(scenario: TrpgScenario, state: TrpgState): TrpgAction[] {
  return getActionViews(scenario, state)
    .filter((v) => v.enabled)
    .map((v) => v.action);
}

export function itemDiceBonus(scenario: TrpgScenario, items: Record<string, number>): number {
  let bonus = 0;
  for (const item of scenario.items) {
    const count = items[item.id] ?? 0;
    if (count > 0 && item.effect?.diceBonus) bonus += item.effect.diceBonus;
  }
  return bonus;
}

function asItemArray(value: TrpgStateChanges['addItem']): { id: string; quantity?: number }[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
}

export function applyStateChanges(
  initialState: TrpgState,
  changes: TrpgStateChanges | null | undefined,
  scenario?: TrpgScenario,
): { state: TrpgState; events: TrpgGameEvent[] } {
  if (!changes) return { state: initialState, events: [] };
  const state = cloneState(initialState);
  const events: TrpgGameEvent[] = [];
  const beforeLocation = state.locationId;

  if (typeof changes.stamina === 'number' && Number.isFinite(changes.stamina)) {
    state.stamina = Math.max(0, state.stamina + changes.stamina);
    events.push({ type: 'STATE_CHANGED', message: `体力 ${changes.stamina >= 0 ? '+' : ''}${changes.stamina}` });
  }
  if (typeof changes.time === 'number' && Number.isFinite(changes.time)) {
    state.time = Math.max(0, state.time + changes.time);
    events.push({ type: 'STATE_CHANGED', message: `时间 +${changes.time}` });
  }
  if (typeof changes.coins === 'number' && Number.isFinite(changes.coins)) {
    state.coins = Math.max(0, state.coins + changes.coins);
    events.push({ type: 'STATE_CHANGED', message: `金币 ${changes.coins >= 0 ? '+' : ''}${changes.coins}` });
  }
  if (typeof changes.affection === 'number' && Number.isFinite(changes.affection)) {
    state.affection = Math.max(0, state.affection + changes.affection);
    events.push({ type: 'STATE_CHANGED', message: `好感 ${changes.affection >= 0 ? '+' : ''}${changes.affection}` });
  }
  if (typeof changes.trust === 'number' && Number.isFinite(changes.trust)) {
    state.trust = Math.max(0, state.trust + changes.trust);
    events.push({ type: 'STATE_CHANGED', message: `信任 ${changes.trust >= 0 ? '+' : ''}${changes.trust}` });
  }

  for (const item of asItemArray(changes.addItem)) {
    if (!item?.id) continue;
    state.items[item.id] = (state.items[item.id] ?? 0) + (item.quantity ?? 1);
    events.push({ type: 'STATE_CHANGED', message: `获得道具 ${item.id} ${item.quantity ?? 1}` });
  }
  for (const item of asItemArray(changes.removeItem)) {
    if (!item?.id) continue;
    state.items[item.id] = Math.max(0, (state.items[item.id] ?? 0) - (item.quantity ?? 1));
    events.push({ type: 'STATE_CHANGED', message: `失去道具 ${item.id} ${item.quantity ?? 1}` });
  }
  if (changes.setFlag?.key) {
    state.flags[changes.setFlag.key] = changes.setFlag.value;
    events.push({ type: 'STATE_CHANGED', message: `剧情标志 ${changes.setFlag.key}` });
  }
  if (changes.flags) {
    state.flags = { ...state.flags, ...changes.flags };
    events.push({ type: 'STATE_CHANGED', message: '剧情标志更新' });
  }
  if (changes.missionState && typeof changes.missionState === 'object') {
    const prev = (state.flags.missionState && typeof state.flags.missionState === 'object' ? state.flags.missionState : {}) as Record<string, unknown>;
    state.flags.missionState = { ...prev, ...changes.missionState };
    events.push({ type: 'STATE_CHANGED', message: '任务状态更新' });
  }

  const unlockIds = changes.unlockLocation
    ? (Array.isArray(changes.unlockLocation) ? changes.unlockLocation : [changes.unlockLocation])
    : [];
  if (unlockIds.length) {
    const current = unlockedArray(state);
    const next = [...new Set([...current, ...unlockIds])];
    state.flags.unlockedLocations = next;
    for (const id of unlockIds) events.push({ type: 'STATE_CHANGED', message: `解锁地点 ${id}` });
  }
  if (changes.locationId) {
    state.locationId = changes.locationId;
    if (state.locationId !== beforeLocation) {
      events.push({ type: 'LOCATION_CHANGED', message: `移动至 ${scenario?.locations.find((l) => l.id === state.locationId)?.name ?? state.locationId}` });
    }
  }

  // 确保解锁列表始终包含当前地点
  const current = unlockedArray(state);
  if (!current.includes(state.locationId)) {
    state.flags.unlockedLocations = [...current, state.locationId];
  }

  return { state, events: dedupeEvents(events) };
}

function dedupeEvents(events: TrpgGameEvent[]): TrpgGameEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.type}:${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stateForConditions(state: TrpgState): Record<string, unknown> {
  return {
    ...state,
    ...state.flags,
    flags: state.flags,
    missionState: state.flags.missionState,
  };
}

export function checkEndings(scenario: TrpgScenario, state: TrpgState): TrpgEnding | null {
  for (const ending of scenario.endings) {
    if (evaluateCgCondition(ending.condition, stateForConditions(state))) return ending;
  }
  return null;
}

function phaseForEnding(ending: TrpgEnding): TrpgState['phase'] {
  if (ending.id === 'defeat' || /败|fail|defeat/i.test(ending.id + ending.name)) return 'failure';
  if (ending.id === 'victory' || /胜利|成|victory|success/i.test(ending.id + ending.name)) return 'victory';
  return 'ending';
}

export interface ResolveActionOptions {
  gmOutput?: GmParsedOutput | null;
  demo?: boolean;
  forcedDice?: TrpgDiceResult | null;
}

export function resolveActionStep(
  scenario: TrpgScenario,
  currentState: TrpgState,
  action: TrpgAction,
  options: ResolveActionOptions = {},
): TrpgActionResult {
  let state = currentState;
  const events: TrpgGameEvent[] = [];
  const baseChanges: TrpgStateChanges = {};
  if (action.staminaCost) baseChanges.stamina = -Math.abs(action.staminaCost);
  if (action.timeCost) baseChanges.time = Math.abs(action.timeCost);

  let applied = applyStateChanges(state, baseChanges, scenario);
  state = applied.state;
  events.push(...applied.events);

  if (action.stateChanges) {
    applied = applyStateChanges(state, action.stateChanges, scenario);
    state = applied.state;
    events.push(...applied.events);
  }

  const keyEvent = action.keyEventId ? scenario.keyEvents.find((k) => k.id === action.keyEventId) || null : null;
  const wantDice = !!(options.gmOutput?.requiresDice || action.difficulty || keyEvent?.difficulty || action.kind === 'check');
  const target = options.gmOutput?.difficulty ?? action.difficulty ?? keyEvent?.difficulty ?? 10;
  const bonus = itemDiceBonus(scenario, state.items);
  let dice: TrpgDiceResult | null = null;
  if (wantDice) {
    dice = options.forcedDice || rollDice(bonus, target);
    if (dice.success) {
      events.push({ type: 'DICE_SUCCESS', message: `D20 判定成功：${dice.d20} + ${dice.bonus} = ${dice.total}  ${dice.target}` });
      if (dice.critical === 'success') events.push({ type: 'DICE_CRITICAL_SUCCESS', message: '大成功！20 点！' });
    } else {
      events.push({ type: 'DICE_FAILURE', message: `D20 判定失败：${dice.d20} + ${dice.bonus} = ${dice.total} < ${dice.target}` });
      if (dice.critical === 'failure') events.push({ type: 'DICE_CRITICAL_FAILURE', message: '大失败1 点。' });
    }
  }

  const prevLocation = state.locationId;
  if (dice && keyEvent) {
    const changes = dice.success ? keyEvent.onSuccess : keyEvent.onFailure;
    applied = applyStateChanges(state, changes, scenario);
    state = applied.state;
    events.push(...applied.events);
    events.push({
      type: 'KEY_EVENT_TRIGGERED',
      message: `关键事件「${keyEvent.name}」：${dice.success ? '成功' : '失败'}`,
      data: { keyEventId: keyEvent.id, success: dice.success },
    });
    state.flags[`keyEvent:${keyEvent.id}`] = dice.success;
  }

  if (options.gmOutput?.stateChanges) {
    applied = applyStateChanges(state, options.gmOutput.stateChanges, scenario);
    state = applied.state;
    events.push(...applied.events);
  }

  if (state.locationId !== prevLocation && !events.some((e) => e.type === 'LOCATION_CHANGED')) {
    events.push({
      type: 'LOCATION_CHANGED',
      message: `移动至 ${scenario.locations.find((l) => l.id === state.locationId)?.name ?? state.locationId}`,
    });
  }

  let ending: TrpgEnding | null = null;
  let rewards: TrpgStateChanges | null = null;
  if (state.phase === 'active') {
    ending = checkEndings(scenario, state);
    if (ending) {
      rewards = ending.bonusReward ?? ending.penaltyReward ?? null;
      if (rewards) {
        applied = applyStateChanges(state, rewards, scenario);
        state = applied.state;
        events.push(...applied.events);
      }
      state.phase = phaseForEnding(ending);
      events.push({
        type: 'ENDING_TRIGGERED',
        message: `结局「${ending.name}」触发`,
        data: { endingId: ending.id },
      });
    }
  }

  const stateChanges: TrpgStateChanges = {
    ...baseChanges,
    ...(action.stateChanges || {}),
    ...(options.gmOutput?.stateChanges || {}),
  };

  return {
    sessionId: '',
    actionId: action.id,
    narration: options.gmOutput?.narration || '',
    demo: options.demo ?? false,
    parseWarning: options.gmOutput ? '' : (options.demo ? '未接入模型，使用演示叙述。' : undefined),
    dice,
    state,
    stateChanges,
    events,
    ending,
    rewards,
  };
}