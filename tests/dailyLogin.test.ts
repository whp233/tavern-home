import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DAILY_LOGIN_CONFIG, DEFAULT_DAILY_LOGIN_STATE,
  dailyLoginDateKey, parseDailyLoginDateKey,
  evaluateDailyLogin, nextDailyLoginState,
} from '../src/core/loreTrigger.ts';
import type { DailyLoginConfig, DailyLoginState } from '../src/core/loreTrigger.ts';

test('dailyLoginDateKey produces local YYYY-MM-DD for a fixed date', () => {
  assert.equal(dailyLoginDateKey(new Date(2026, 7, 3)), '2026-08-03');
  assert.equal(dailyLoginDateKey(new Date(2026, 0, 9)), '2026-01-09');
  assert.match(dailyLoginDateKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test('parseDailyLoginDateKey accepts YYYY-MM-DD and rejects everything else', () => {
  assert.equal(parseDailyLoginDateKey('2026-08-03'), '2026-08-03');
  assert.equal(parseDailyLoginDateKey('2026-8-3'), null);
  assert.equal(parseDailyLoginDateKey('2026/08/03'), null);
  assert.equal(parseDailyLoginDateKey(''), null);
  assert.equal(parseDailyLoginDateKey(null), null);
  assert.equal(parseDailyLoginDateKey(20260803), null);
});

test('evaluateDailyLogin: first-ever login triggers', () => {
  const verdict = evaluateDailyLogin(DEFAULT_DAILY_LOGIN_CONFIG, DEFAULT_DAILY_LOGIN_STATE, '2026-08-22');
  assert.equal(verdict.shouldTrigger, true);
  assert.equal(verdict.reason, 'ok');
});

test('evaluateDailyLogin: same day does not re-trigger (already_triggered)', () => {
  const state: DailyLoginState = { lastTriggerDate: '2026-08-22', triggerCount: 1 };
  const verdict = evaluateDailyLogin(DEFAULT_DAILY_LOGIN_CONFIG, state, '2026-08-22');
  assert.equal(verdict.shouldTrigger, false);
  assert.equal(verdict.reason, 'already_triggered');
});

test('evaluateDailyLogin: next day resets and triggers again', () => {
  const state: DailyLoginState = { lastTriggerDate: '2026-08-22', triggerCount: 1 };
  const verdict = evaluateDailyLogin(DEFAULT_DAILY_LOGIN_CONFIG, state, '2026-08-23');
  assert.equal(verdict.shouldTrigger, true);
  assert.equal(verdict.reason, 'ok');
});

test('evaluateDailyLogin: disabled switch never triggers', () => {
  const config: DailyLoginConfig = { ...DEFAULT_DAILY_LOGIN_CONFIG, enabled: false };
  assert.equal(evaluateDailyLogin(config, DEFAULT_DAILY_LOGIN_STATE, '2026-08-22').reason, 'disabled');
  // 即使从未触发过也不弹
  assert.equal(evaluateDailyLogin(config, DEFAULT_DAILY_LOGIN_STATE, '2026-08-23').shouldTrigger, false);
});

test('evaluateDailyLogin: triggerDate gates to the configured day only', () => {
  const config: DailyLoginConfig = { ...DEFAULT_DAILY_LOGIN_CONFIG, triggerDate: '2026-09-01' };
  assert.equal(evaluateDailyLogin(config, DEFAULT_DAILY_LOGIN_STATE, '2026-08-31').reason, 'not_trigger_day');
  assert.equal(evaluateDailyLogin(config, DEFAULT_DAILY_LOGIN_STATE, '2026-09-01').shouldTrigger, true);
  // 指定日触达后，同日重进不重复
  const after: DailyLoginState = { lastTriggerDate: '2026-09-01', triggerCount: 1 };
  assert.equal(evaluateDailyLogin(config, after, '2026-09-01').reason, 'already_triggered');
});

test('nextDailyLoginState records today and increments the counter', () => {
  const next = nextDailyLoginState({ lastTriggerDate: '2026-08-21', triggerCount: 3 }, '2026-08-22');
  assert.deepEqual(next, { lastTriggerDate: '2026-08-22', triggerCount: 4 });
  // 跨日多次触发会继续累加（统计口径，判定层面已由 lastTriggerDate 挡住同日重复）
  const next2 = nextDailyLoginState(next, '2026-08-23');
  assert.equal(next2.triggerCount, 5);
  assert.equal(next2.lastTriggerDate, '2026-08-23');
});

test('default config/state constants are sane', () => {
  assert.equal(DEFAULT_DAILY_LOGIN_CONFIG.enabled, true);
  assert.equal(DEFAULT_DAILY_LOGIN_STATE.lastTriggerDate, null);
  assert.equal(DEFAULT_DAILY_LOGIN_STATE.triggerCount, 0);
});