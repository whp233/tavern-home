// tests/generationRetry.test.ts
// 生成失败自动重生成策略（task-57）：上限 / 退避 / 不可重试分类 / 可见提示。
// 关键回归点：**绝不无限重试**（烧 token 红线）。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RETRY_POLICY, normalizeErrorKind, isRetryable, hasBudget,
  backoffDelayMs, decideRetry, failureNotice,
} from '../src/core/generationRetry.ts';

test('错误种类归一化：已知原样，未知归 unknown', () => {
  assert.equal(normalizeErrorKind('http'), 'http');
  assert.equal(normalizeErrorKind('TIMEOUT'), 'timeout');
  assert.equal(normalizeErrorKind('  empty '), 'empty');
  assert.equal(normalizeErrorKind('whatever'), 'unknown');
  assert.equal(normalizeErrorKind(null), 'unknown');
  assert.equal(normalizeErrorKind(undefined), 'unknown');
});

test('可重试分类：瞬时故障可重试，配置/截断/取消不可重试', () => {
  for (const k of ['http', 'timeout', 'fetch', 'protocol', 'empty'] as const) {
    assert.equal(isRetryable(k), true, k + ' 应可重试');
  }
  for (const k of ['config', 'limit', 'aborted', 'conflict', 'unknown'] as const) {
    assert.equal(isRetryable(k), false, k + ' 不应重试');
  }
});

test('重试预算：默认最多 2 次额外重试（首次失败 attempt=1）', () => {
  assert.equal(DEFAULT_RETRY_POLICY.maxRetries, 2);
  assert.equal(hasBudget(1), true);  // 还有额度 → 第 1 次重试
  assert.equal(hasBudget(2), true);  // 还有额度 → 第 2 次重试
  assert.equal(hasBudget(3), false); // 额度用尽 → 放弃
});

test('退避：指数增长且封顶 maxDelayMs', () => {
  assert.equal(backoffDelayMs(1), 800);
  assert.equal(backoffDelayMs(2), 1600);
  assert.equal(backoffDelayMs(3), 3200);
  assert.equal(backoffDelayMs(4), 6400);
  assert.equal(backoffDelayMs(5), 8000); // 12800 → 封顶 8000
  assert.equal(backoffDelayMs(100), 8000);
  assert.equal(backoffDelayMs(0), 800);  // 下界保护
});

test('决策：可重试 → retry + 退避；超限 → give_up', () => {
  const r1 = decideRetry('http', 1);
  assert.equal(r1.action, 'retry');
  assert.equal(r1.action === 'retry' && r1.delayMs, 800);
  const r3 = decideRetry('http', 3);
  assert.equal(r3.action, 'give_up'); // 上限
  const rCfg = decideRetry('config', 1);
  assert.equal(rCfg.action, 'give_up'); // 不可重试类
});

test('绝无无限重试：连错 100 次一定 give_up', () => {
  let attempts = 0;
  for (let i = 1; i <= 100; i++) {
    if (decideRetry('timeout', i).action === 'retry') attempts++;
  }
  assert.equal(attempts, DEFAULT_RETRY_POLICY.maxRetries); // 恰好 2 次，不多不少
});

test('失败提示可见：重试中与放弃各有文案', () => {
  const retrying = failureNotice('http', 1);
  assert.match(retrying, /自动重试/);
  const given = failureNotice('config', 1);
  assert.match(given, /手动重试/);
  assert.match(given, /config/);
});

test('自定义策略生效：maxRetries=0 表示不重试', () => {
  const p = { ...DEFAULT_RETRY_POLICY, maxRetries: 0 };
  assert.equal(hasBudget(1, p), false);
  assert.equal(decideRetry('http', 1, p).action, 'give_up');
});
