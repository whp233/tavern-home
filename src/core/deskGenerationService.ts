import type { DeskTurnCommit, DeskTurnStorage } from './storage.ts';
import type { DeskFloor } from './types.ts';
import type { ModelBackend, ModelStreamEvent } from './modelBackend.ts';
import { parseStateBoard } from './stateBoard.ts';
import { normalizeErrorKind, decideRetry, failureNotice, type RetryPolicy, DEFAULT_RETRY_POLICY } from './generationRetry.ts';

function unwrapContentTag(text: string): string {
  let value = String(text || ''); const open = '<content>'; const close = '</content>';
  if (value.trim().startsWith(open)) { const lead = value.length - value.trimStart().length; let cut = lead + open.length; if (value.startsWith('\r\n', cut)) cut += 2; else if (value.startsWith('\n', cut)) cut++; value = value.slice(0, lead) + value.slice(cut); }
  if (value.trim().endsWith(close)) { const trail = value.length - value.trimEnd().length; const end = value.length - trail; let cut = end - close.length; if (value.slice(0, cut).endsWith('\r\n')) cut -= 2; else if (value.slice(0, cut).endsWith('\n')) cut--; value = value.slice(0, cut) + value.slice(end); }
  return value;
}

export interface GenerateDeskTurnInput {
  windowId: string;
  mode: 'normal' | 'roll';
  floorId: string;
  userFloor?: DeskFloor;
  expectedFloor?: DeskFloor;
  system: Array<{ text: string; cache: boolean }>;
  prompt: string;
  model: string;
  report: Record<string, unknown>;
  stateBoard: Record<string, unknown>;
  boardBeforeTrusted: boolean;
  committedAt: string;
  // 可选注入段：参考风格块（task-19）等生成期附加 system 文本；只进本次模型调用，不回写 input.system。
  styleRefBlock?: string;
  signal?: AbortSignal;
  onEvent?: (event: ModelStreamEvent) => void | Promise<void>;
  // task-57：失败自动重生成策略（可选，缺省 DEFAULT_RETRY_POLICY：最多 2 次 + 指数退避，绝不无限重试）。
  retryPolicy?: RetryPolicy;
  // 失败可见：每次决定重试/放弃时回调（前端据此显示提示，不静默吞错）。
  onRetryNotice?: (notice: string, attempt: number) => void;
}

// ===== 参考小说/风格（task-19）：配置清洗与提示词装配 =====
// 纯 prompt 注入，不做 RAG 不做微调。配置持久化在 oc_state（D1 方言 d1DeskChapterMemoryStorage）。
export interface StyleRefConfig {
  enabled: boolean;
  bookTitle: string; // 参考书目（书名，仅作风格指向）
  styleNotes: string; // 风格要点描述
  excerpt: string; // 样例段落（用户自备、尊重版权的短节选）
}

export const STYLE_REF_NOTES_MAX = 2000;
export const STYLE_REF_EXCERPT_MAX = 2000;

export function sanitizeStyleRefConfig(raw: Partial<StyleRefConfig> | null | undefined): StyleRefConfig {
  if (!raw || typeof raw !== 'object') return { enabled: false, bookTitle: '', styleNotes: '', excerpt: '' };
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  return {
    enabled: (raw as any).enabled === true || (raw as any).enabled === 'true',
    bookTitle: str(raw.bookTitle).slice(0, 200),
    styleNotes: str(raw.styleNotes).slice(0, STYLE_REF_NOTES_MAX),
    excerpt: str(raw.excerpt).slice(0, STYLE_REF_EXCERPT_MAX),
  };
}

// 有内容才算配置生效；enabled 开着但三字段全空 → 渲染为空串（不注入空壳）。
export function renderStyleRefBlock(config: StyleRefConfig): string {
  if (!config || !config.enabled) return '';
  const segs: string[] = [];
  if (config.bookTitle) segs.push(`参考书目：《${config.bookTitle}》`);
  if (config.styleNotes) segs.push(`风格要点：${config.styleNotes}`);
  if (config.excerpt) segs.push(`风格样例（仅学其笔法，不要照抄情节与文字）：\n${config.excerpt}`);
  if (!segs.length) return '';
  return [
    '【参考风格】行文、氛围、节奏向下面参考靠拢；只影响描写方式，不改变既有人设、设定与剧情走向。',
    ...segs,
  ].join('\n');
}

export class DeskGenerationService {
  private readonly backend: ModelBackend; private readonly turns: DeskTurnStorage;
  constructor(backend: ModelBackend, turns: DeskTurnStorage) { this.backend = backend; this.turns = turns; }
  async generate(input: GenerateDeskTurnInput) {
    if (input.mode === 'roll' && !input.expectedFloor) return { success: false, error: 'Roll target is required.' };
    if (input.mode === 'normal' && !input.userFloor) return { success: false, error: 'User floor is required.' };
    if (input.signal?.aborted) return { success: false, error: 'aborted' }; // 26C: aborted 不落库，悬浮球隐藏
    const system = input.styleRefBlock && input.styleRefBlock.trim()
      ? [...input.system, { text: input.styleRefBlock.trim(), cache: false }]
      : input.system;
    // task-57：失败自动重生成——只重试「瞬时故障」（http/timeout/fetch/protocol/empty），
    // 且**有上限**（默认 ≤2 次 + 指数退避）。config/limit/aborted/conflict 一律不重放（重放坏结果 = 烧 token 无收益）。
    const retryPolicy = input.retryPolicy ?? DEFAULT_RETRY_POLICY;
    let attempt = 0;
    let generated: Awaited<ReturnType<ModelBackend['streamChat']>>;
    let content = '';
    let parsed: ReturnType<typeof parseStateBoard> = { board: null, content: '' };
    for (;;) {
      generated = await this.backend.streamChat({ system, prompt: input.prompt, model: input.model, signal: input.signal, onEvent: input.onEvent });
      if (!generated.ok) {
        attempt += 1;
        const kind = normalizeErrorKind(generated.kind);
        const decision = decideRetry(kind, attempt, retryPolicy);
        input.onRetryNotice?.(failureNotice(kind, attempt, retryPolicy), attempt);
        if (decision.action === 'give_up') return { success: false, error: generated.kind, detail: generated.detail, usage: generated.usage };
        if (decision.delayMs > 0) await new Promise((r) => setTimeout(r, decision.delayMs));
        if (input.signal?.aborted) return { success: false, error: 'aborted' };
        continue;
      }
      if (input.signal?.aborted) return { success: false, error: 'aborted', usage: generated.usage };
      if (generated.stopReason && generated.stopReason !== 'end_turn' && generated.stopReason !== 'stop') {
        const truncated = generated.stopReason === 'max_tokens' || generated.stopReason === 'length';
        // prompt-diet: 非截断的未知 stopReason 按完成处理，不再判 protocol 重试，减少 thinking 规划负担
        if (truncated) return { success: false, error: 'limit', detail: generated.stopReason, usage: generated.usage };
        // 其它未知原因(如 tool_calls)按完成容错，不中断
      }
      parsed = parseStateBoard(generated.text);
      const rawContent = parsed.content ?? generated.text;
      content = unwrapContentTag(rawContent);
      if (content.trim()) break;
      // 空回复：按瞬时故障处理（可退避重试，但有上限，绝不死循环）。
      attempt += 1;
      const emptyDecision = decideRetry('empty', attempt, retryPolicy);
      input.onRetryNotice?.(failureNotice('empty', attempt, retryPolicy), attempt);
      if (emptyDecision.action === 'give_up') return { success: false, error: 'empty', usage: generated.usage };
      if (emptyDecision.delayMs > 0) await new Promise((r) => setTimeout(r, emptyDecision.delayMs));
      if (input.signal?.aborted) return { success: false, error: 'aborted' };
    }
    const stateBoard = parsed.board ?? input.stateBoard;
    const { boardBefore: _boardBefore, boardAfter: _boardAfter, stateBoardStale: _stateBoardStale, commitToken: _commitToken, ...safeReport } = input.report;
    const commit: DeskTurnCommit = { content, thinking: generated.thinking.trim() || null,
      report: { ...safeReport, stateBoardStale: parsed.board === null,
        ...(input.boardBeforeTrusted ? { boardBefore: input.stateBoard } : {}), boardAfter: stateBoard }, stateBoard,
        committedAt: input.committedAt };
    const floor = input.mode === 'normal'
      ? await this.turns.commitAssistantFloor(input.windowId, input.floorId, commit)
      : await this.turns.rollAssistantFloor({ windowId: input.windowId, floorId: input.floorId, expected: input.expectedFloor!, commit });
    return floor ? { success: true, floor, usage: generated.usage } : { success: false, error: 'conflict', usage: generated.usage };
  }
}
