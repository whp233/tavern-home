// src/core/generationRetry.ts
// 酒馆之家「生成失败自动重生成」纯函数层（task-57）。
//
// 为什么单独抽一层：后台化/自动重生成如果散在各调用点，很容易写成"无限重试烧 token"。
// 这里把「哪些错可重试 / 上限 / 退避 / 何时放弃」定成**纯函数 + 常量**，
// 调用方（deskGenerationService / 前端后台任务）只消费结论，不各自发明策略。
//
// 硬性约束（任务书验收）：
//   1. 自动重生成**必须有上限**（默认 ≤2 次）；
//   2. **不得无限重试烧 token**；
//   3. 失败必须**可见**（返回原因，不静默吞错）；
//   4. 截断(limit)/配置(config)/取消(aborted) **不自动重放**（重放坏结果 = 烧 token 无收益）。

/** 生成失败的分类（对齐 ModelBackend 的 kind + deskGenerationService 的 error）。 */
export type GenerationErrorKind =
  | 'http' | 'timeout' | 'fetch' | 'protocol' | 'empty'   // 可能是瞬时故障 → 可重试
  | 'config' | 'limit' | 'aborted' | 'conflict' | 'unknown'; // 重试无收益 → 不重试

export interface RetryPolicy {
  /** 最多额外重试几次（不含首次）。默认 2。 */
  maxRetries: number;
  /** 退避基数（毫秒），实际等待 = baseDelayMs * 2^(attempt-1)，封顶 maxDelayMs。默认 800。 */
  baseDelayMs: number;
  /** 退避封顶（毫秒）。默认 8000。 */
  maxDelayMs: number;
  /** 允许重试的错误种类。默认 = 瞬时类。 */
  retryable: ReadonlySet<GenerationErrorKind>;
}

export const DEFAULT_RETRYABLE: ReadonlySet<GenerationErrorKind> = new Set<GenerationErrorKind>([
  'http', 'timeout', 'fetch', 'protocol', 'empty',
]);

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 800,
  maxDelayMs: 8000,
  retryable: DEFAULT_RETRYABLE,
};

/** 把任意错误字符串/对象归一化成已知种类；未知归 'unknown'（不重试，保守）。 */
export function normalizeErrorKind(raw: unknown): GenerationErrorKind {
  const s = String(raw ?? '').trim().toLowerCase();
  switch (s) {
    case 'http': case 'timeout': case 'fetch': case 'protocol': case 'empty':
    case 'config': case 'limit': case 'aborted': case 'conflict':
      return s as GenerationErrorKind;
    default:
      return 'unknown';
  }
}

/** 该错误是否值得自动重生成。 */
export function isRetryable(kind: GenerationErrorKind, policy: RetryPolicy = DEFAULT_RETRY_POLICY): boolean {
  return policy.retryable.has(kind);
}

/** 是否还有重试额度。attempt = 已失败次数（首次失败为 1）。 */
export function hasBudget(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): boolean {
  return attempt < 1 + Math.max(0, policy.maxRetries);
}

/** 第 attempt 次失败后的退避等待（毫秒）；封顶 maxDelayMs。attempt 从 1 起。 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  const n = Math.max(1, Math.floor(attempt));
  const raw = policy.baseDelayMs * Math.pow(2, n - 1);
  return Math.min(policy.maxDelayMs, Math.max(0, raw));
}

export type RetryDecision =
  | { action: 'retry'; delayMs: number; reason: string }
  | { action: 'give_up'; reason: string };

/**
 * 决策：这次失败要不要重试。
 * @param kind   失败种类
 * @param attempt 已失败次数（首次失败 = 1）
 */
export function decideRetry(kind: GenerationErrorKind, attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): RetryDecision {
  if (!isRetryable(kind, policy)) return { action: 'give_up', reason: `${kind} 不可重试（重放无收益）` };
  if (!hasBudget(attempt, policy)) return { action: 'give_up', reason: `已达重试上限 ${policy.maxRetries} 次` };
  return { action: 'retry', delayMs: backoffDelayMs(attempt, policy), reason: `瞬时故障 ${kind}，第 ${attempt} 次退避重试` };
}

/** 给前端的可见提示文案（失败必须可见，不静默吞错）。 */
export function failureNotice(kind: GenerationErrorKind, attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): string {
  const d = decideRetry(kind, attempt, policy);
  if (d.action === 'retry') return `生成失败（${kind}），${Math.round(d.delayMs / 1000 * 10) / 10}s 后自动重试（${attempt}/${policy.maxRetries}）…`;
  return `生成失败（${kind}）：${d.reason}，请手动重试。`;
}
