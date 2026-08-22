// src/core/trpg/dice.ts
// D20 判定：20 大成功 / 1 大失败；道具 diceBonus 加值由状态机调用方注入。

import type { TrpgDiceResult } from './types.ts';

export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

export function evaluateDice(d20: number, bonus: number, target: number): TrpgDiceResult {
  const total = d20 + (Number.isFinite(bonus) ? bonus : 0);
  const success = d20 === 20 ? true : d20 === 1 ? false : total >= target;
  const critical = d20 === 20 ? 'success' : d20 === 1 ? 'failure' : 'none';
  return { d20, bonus, total, target, success, critical };
}

export function rollDice(bonus: number, target: number): TrpgDiceResult {
  return evaluateDice(rollD20(), bonus, target);
}