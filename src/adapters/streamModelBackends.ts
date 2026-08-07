import type { ModelBackend, ModelUsage, StreamChatArgs, StreamChatResult } from '../core/modelBackend.ts';
import { createLiteralThinkingSplitter } from '../shared/text.ts';
import { buildModelParams } from '../chat/models.ts';

const ZERO_USAGE = (): ModelUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

type Fetcher = typeof fetch;
// 共用端点闸(流式/非流式两条链同一道):只认 https、拒绝 URL 内嵌凭据。传入值语义=完整 Messages 端点 URL。
export function safeEndpoint(raw: string): string | null { try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null; } catch { return null; } }

export interface AnthropicBackendOptions { apiKey: string; baseUrl?: string; timeoutMs?: number; userId?: string; fetch?: Fetcher }

export class AnthropicStreamBackend implements ModelBackend {
  private readonly options: AnthropicBackendOptions;
  constructor(options: AnthropicBackendOptions) { this.options = options; }
  async streamChat(args: StreamChatArgs): Promise<StreamChatResult> {
    // baseUrl 只认 undefined=未配置;配了(含空串)就必须过 safeEndpoint,不许悄悄回落官方端点(codex增量审)。
    const endpoint = this.options.baseUrl === undefined ? 'https://api.anthropic.com/v1/messages' : safeEndpoint(this.options.baseUrl); if (!this.options.apiKey || !endpoint) return { ok: false, kind: 'config' };
    const controller = new AbortController(); let timedOut = false; const abort = () => controller.abort();
    args.signal?.addEventListener('abort', abort, { once: true }); if (args.signal?.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.options.timeoutMs ?? 480_000);
    let text = ''; let thinking = ''; const usage = ZERO_USAGE(); let stopReason = ''; let streamError = false; let messageStopped = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null; let naturalEof = false; const blocks = new Map<number, 'text' | 'thinking' | 'redacted'>();
    const splitter = createLiteralThinkingSplitter(args.model,
      async (chunk) => { if (!chunk) return; text += chunk; await args.onEvent?.({ type: 'text', text: chunk }); },
      async (chunk) => { if (!chunk) return; thinking += chunk; await args.onEvent?.({ type: 'thinking', text: chunk }); }, true);
    try {
      const response = await (this.options.fetch || fetch)(endpoint, { method: 'POST', headers: { 'x-api-key': this.options.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'extended-cache-ttl-2025-04-11', 'content-type': 'application/json' },
        body: JSON.stringify({ ...buildModelParams(args.model), system: args.system.map((block) => block.cache ? { type: 'text', text: block.text, cache_control: { type: 'ephemeral', ttl: '1h' } } : { type: 'text', text: block.text }), messages: [{ role: 'user', content: args.prompt }], ...(this.options.userId ? { metadata: { user_id: this.options.userId } } : {}) }), signal: controller.signal });
      if (!response.ok || !response.body) return { ok: false, kind: 'http', detail: String(response.status) };
      reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      const consume = async (line: string) => {
        const trimmed = line.trim(); if (!trimmed.startsWith('data:')) return; const raw = trimmed.slice(5).trim(); if (!raw) return;
        let event: any; try { event = JSON.parse(raw); } catch { return; }
        if (messageStopped) { streamError = true; return; }
        const index = Number(event.index); const validIndex = Number.isInteger(index) && index >= 0;
        if (event.type === 'content_block_start') { const type = event.content_block?.type; if (!validIndex || blocks.has(index)) streamError = true; else if (type === 'text' || type === 'thinking' || type === 'redacted_thinking') blocks.set(index, type === 'redacted_thinking' ? 'redacted' : type); else streamError = true; }
        else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') { if (!validIndex || blocks.get(index) !== 'text') streamError = true; else await splitter.feed(String(event.delta.text || '')); }
        else if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') { if (!validIndex || blocks.get(index) !== 'thinking') streamError = true; else { const chunk = String(event.delta.thinking || ''); thinking += chunk; await args.onEvent?.({ type: 'thinking', text: chunk }); } }
        else if (event.type === 'content_block_stop') { if (!validIndex || !blocks.delete(index)) streamError = true; }
        else if (event.type === 'message_start') { const u = event.message?.usage || {}; usage.input += Number(u.input_tokens) || 0; usage.cacheRead += Number(u.cache_read_input_tokens) || 0; usage.cacheWrite += Number(u.cache_creation_input_tokens) || 0; await args.onEvent?.({ type: 'usage', usage: { input: usage.input, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite } }); }
        else if (event.type === 'message_delta') { if (event.delta?.stop_reason) stopReason = String(event.delta.stop_reason); usage.output = Number(event.usage?.output_tokens) || usage.output; }
        else if (event.type === 'message_stop') { if (!stopReason || blocks.size) streamError = true; messageStopped = true; }
        else if (event.type === 'error') streamError = true;
      };
      while (true) { const { done, value } = await reader.read(); if (done) { naturalEof = true; break; } buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines) await consume(line); }
      buffer += decoder.decode(); if (buffer) await consume(buffer); await splitter.flush(); await args.onEvent?.({ type: 'usage', usage });
      if (args.signal?.aborted) return { ok: false, kind: 'aborted', usage };
      if (streamError || !messageStopped || !['end_turn', 'max_tokens'].includes(stopReason)) return { ok: false, kind: 'protocol', detail: stopReason || 'missing accepted stop reason', usage };
      if (!text) return { ok: false, kind: 'empty', usage };
      return { ok: true, terminal: 'clean', text, thinking, usage, stopReason };
    } catch (error: any) {
      if (args.signal?.aborted) return { ok: false, kind: 'aborted', usage };
      if (timedOut || error?.name === 'AbortError') return { ok: false, kind: 'timeout', usage };
      return { ok: false, kind: 'fetch', detail: String(error?.message || error), usage };
    } finally { if (reader && !naturalEof) try { await reader.cancel(); } catch {} clearTimeout(timer); args.signal?.removeEventListener('abort', abort); }
  }
}

// ===== OpenAI 兼容(Chat Completions)流式后端 =====
// 同一 ModelBackend 合同下的兄弟类:走 OpenAI 协议(DeepSeek / SiliconFlow / opencode 等)。
// 与 Anthropic 后端同纪律:流结束≠成功,只有观察到 [DONE] 哨兵 + 白名单 finish_reason 才算干净终态。
// 大字铁句:不碰 buildModelParams(MODEL_PROFILES 是 claude 白名单,会污染 DeepSeek 模型名、
// 带 thinking/output_config 等 OpenAI 不认识的字段、max_tokens 用 claude 的 64k 会 400)——独立轻量参数构建。

export interface OpenAIStreamBackendOptions {
  apiKey: string;
  baseUrl?: string;                 // undefined=用默认 https://api.deepseek.com/v1;配了必须过 openAiEndpoint
  timeoutMs?: number;               // 默认 480_000(对齐 Anthropic)
  model?: string;                   // 供应商模型名覆盖,如 'deepseek-chat'
  maxTokens?: number;               // 默认 8000(deepseek-chat 输出上限,别用 claude 的 64k)
  temperature?: number;             // 可选,配了才带
  streamUsage?: boolean;            // 可选,默认 true;SiliconFlow 对 stream_options 挑剔 400 时可关
  allowHttpLocalhost?: boolean;     // 可选,opencode 本地 http://localhost 用(safeEndpoint 只认 https 会拒)
  userId?: string;
  fetch?: Fetcher;
}

export interface DeskBackendEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_MAX_TOKENS?: number;
  OPENAI_ALLOW_HTTP_LOCALHOST?: boolean;
  [k: string]: any;
}

// 打字桌 userId 与 desk.ts 同名常量保持一致(避免循环 import,字面量各放一份)。
const USER_ID = 'tavern-study-desk';

const DEFAULT_OPENAI_URL = 'https://api.deepseek.com/v1/chat/completions';

// OpenAI 兼容端点闸:复刻 safeEndpoint 逻辑(只认 https、拒绝 URL 内嵌凭据),但 allowHttpLocalhost
// 时额外放开 http: 且 host ∈ {localhost,127.0.0.1,::1}(opencode serve 是本地 http 服务)。
// baseUrl===undefined = 未配置 → 默认 DeepSeek 官方端点。URL 规范化后补 /chat/completions 后缀(已含则原样)。
// 非法返回 null → 调用方按 config 错误处理,不许悄悄回落默认端点。
export function openAiEndpoint(baseUrl: string | undefined, allowHttpLocalhost = false): string | null {
  if (baseUrl === undefined) return DEFAULT_OPENAI_URL;
  let url: URL; try { url = new URL(baseUrl); } catch { return null; }
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const isLocalhost = allowHttpLocalhost && url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1' || host === '::1');
  if (url.protocol !== 'https:' && !isLocalhost) return null;
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return url.toString();
}

// 独立轻量参数构建:model 原样透传(或 options.model 覆盖)、max_tokens 可配、绝不带 thinking/output_config/effort。
// cache 标志丢弃——OpenAI 协议没有 Anthropic 的 cache_control,系统消息块按纯文本拼接。
function openAiParams(args: StreamChatArgs, options: OpenAIStreamBackendOptions): Record<string, any> {
  const body: Record<string, any> = {
    model: options.model || args.model,
    messages: [
      { role: 'system', content: args.system.map((b) => b.text).join('\n\n') },
      { role: 'user', content: args.prompt },
    ],
    stream: true,
    max_tokens: options.maxTokens ?? 8000,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.streamUsage !== false) body.stream_options = { include_usage: true };
  return body;
}

export class OpenAIStreamBackend implements ModelBackend {
  private readonly options: OpenAIStreamBackendOptions;
  constructor(options: OpenAIStreamBackendOptions) { this.options = options; }
  async streamChat(args: StreamChatArgs): Promise<StreamChatResult> {
    const endpoint = openAiEndpoint(this.options.baseUrl, this.options.allowHttpLocalhost);
    if (!this.options.apiKey || !endpoint) return { ok: false, kind: 'config' };
    const controller = new AbortController(); let timedOut = false; const abort = () => controller.abort();
    args.signal?.addEventListener('abort', abort, { once: true }); if (args.signal?.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.options.timeoutMs ?? 480_000);
    let text = ''; let thinking = ''; const usage = ZERO_USAGE(); let finishReason = ''; let streamError = false; let gotDone = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null; let naturalEof = false;
    const splitter = createLiteralThinkingSplitter(args.model,
      async (chunk) => { if (!chunk) return; text += chunk; await args.onEvent?.({ type: 'text', text: chunk }); },
      async (chunk) => { if (!chunk) return; thinking += chunk; await args.onEvent?.({ type: 'thinking', text: chunk }); }, true);
    try {
      const response = await (this.options.fetch || fetch)(endpoint, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(openAiParams(args, this.options)), signal: controller.signal });
      if (!response.ok || !response.body) return { ok: false, kind: 'http', detail: String(response.status) };
      reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      const consume = async (line: string) => {
        const trimmed = line.trim(); if (!trimmed.startsWith('data:')) return; const raw = trimmed.slice(5).trim(); if (!raw) return;
        if (raw === '[DONE]') { gotDone = true; return; }
        let event: any; try { event = JSON.parse(raw); } catch { streamError = true; return; }
        if (event.error) { streamError = true; return; }
        // usage 可能跟 finish_reason 同 chunk(DeepSeek),也可能独立成末 chunk(OpenAI 官方在
        // finish_reason 之后再发一条 choices:[] + usage 才 [DONE])——两种都先收账。
        const hasUsage = event.usage && typeof event.usage === 'object';
        if (hasUsage) {
          usage.input = Number(event.usage.prompt_tokens) || usage.input;
          usage.output = Number(event.usage.completion_tokens) || usage.output;
          usage.cacheRead = Number(event.usage.prompt_cache_hit_tokens) || 0;
          usage.cacheWrite = Number(event.usage.prompt_cache_miss_tokens) || 0;
        }
        // 收到终态(finish_reason 或 [DONE])后任何后续数据行判协议异常;唯一放行是 [DONE] 前的独立 usage 末 chunk。
        if (gotDone || finishReason) { if (!hasUsage) streamError = true; return; }
        const choice = Array.isArray(event.choices) ? event.choices[0] : undefined;
        const delta = choice?.delta ?? {};
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          const chunk = delta.reasoning_content; thinking += chunk; await args.onEvent?.({ type: 'thinking', text: chunk });
        } else if (typeof delta.reasoning === 'string' && delta.reasoning) {
          const chunk = delta.reasoning; thinking += chunk; await args.onEvent?.({ type: 'thinking', text: chunk });
        }
        if (typeof delta.content === 'string') await splitter.feed(delta.content);
        if (typeof choice?.finish_reason === 'string' && choice.finish_reason) finishReason = choice.finish_reason;
      };
      while (true) { const { done, value } = await reader.read(); if (done) { naturalEof = true; break; } buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines) await consume(line); }
      buffer += decoder.decode(); if (buffer) await consume(buffer); await splitter.flush(); await args.onEvent?.({ type: 'usage', usage });
      if (args.signal?.aborted) return { ok: false, kind: 'aborted', usage };
      if (streamError || !gotDone || !['stop', 'length'].includes(finishReason)) {
        // detail 优先级:[DONE] 前 EOF 是"流被打断",比 finish_reason 更本质,先报它。
        const detail = !gotDone ? 'eof without [DONE]' : (finishReason || 'missing accepted finish reason');
        return { ok: false, kind: 'protocol', detail, usage };
      }
      if (!text) return { ok: false, kind: 'empty', usage };
      return { ok: true, terminal: 'clean', text, thinking, usage, stopReason: finishReason };
    } catch (error: any) {
      if (args.signal?.aborted) return { ok: false, kind: 'aborted', usage };
      if (timedOut || error?.name === 'AbortError') return { ok: false, kind: 'timeout', usage };
      return { ok: false, kind: 'fetch', detail: String(error?.message || error), usage };
    } finally { if (reader && !naturalEof) try { await reader.cancel(); } catch {} clearTimeout(timer); args.signal?.removeEventListener('abort', abort); }
  }
}

// 打字桌后端工厂:OPENAI 渠道配了(有 key 或配了 baseUrl)就走 OpenAI 兼容,否则回落 Anthropic。
// 配了 baseUrl 但没 key 时 OpenAI 后端会在调用期回 config 错误,不悄悄回落 Anthropic。
export function makeDeskBackend(env: DeskBackendEnv): ModelBackend {
  if (env.OPENAI_API_KEY || env.OPENAI_BASE_URL !== undefined) {
    return new OpenAIStreamBackend({ apiKey: env.OPENAI_API_KEY ?? '', baseUrl: env.OPENAI_BASE_URL, model: env.OPENAI_MODEL, maxTokens: env.OPENAI_MAX_TOKENS, allowHttpLocalhost: env.OPENAI_ALLOW_HTTP_LOCALHOST });
  }
  return new AnthropicStreamBackend({ apiKey: env.ANTHROPIC_API_KEY ?? '', baseUrl: env.ANTHROPIC_BASE_URL, userId: USER_ID });
}
