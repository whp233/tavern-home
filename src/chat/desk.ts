// 打字桌聊天机：SSE、零工具、一次性无 resume，直接生成小说正文。
// 跟 editorial.ts 最大的结构性差异:editorial 用"system两块+多轮消息history"的对话式装配,
// desk 用 chat/deskAssemble.ts 产出的"system队列块+单段tail长文本"——一整窗的近景/状态板/
// 时光带/本楼输入全部揉进 tail 一段字符串里,所以这里发给模型的永远是【单条 user 消息】
// (content=tail),不维护多轮 messages 数组,也就没有"history 数组"这个概念——跟打字桌手套
// "一次性无resume,每轮全量装配"的设计是同一件事的两个说法。
//
// 两种轮次(body.roll,传或不传=普通轮):
//   普通轮:存新的 user 楼层 → 从"此楼之前"的近景重装配 → 生成 → 存新的 assistant 楼层。
//   roll:不存新楼层,找最后一楼(必须是 assistant)→ 从"此楼之前"重装配(近景到那条assistant
//     之前最近一条user为止)→ 生成 → 追加成那条楼层的新 variant,active切过去。
// continue 已退役；收到旧请求必须 400 拒绝，不能误落空 user 楼。
//
// 状态板协议、楼层/窗口原子提交和时光带折叠触发都在此收尾。

import { MODEL_PROFILES } from './models.ts';
import { makeD1UsageSink } from '../storage/usageSink.ts';
import { assembleDesk } from './deskAssemble.ts';
import { loadDeskTimelineState, renderTimelineText, parseDeskTimelineCutoff, maybeFoldDeskTimeline, invalidateDeskTimelineIfFolded, fenceDeskTimelineAfterWrite } from './deskTimeline.ts';
import type { Ai, VectorizeIndex } from '../storage/vectorize.ts';
import { parseStateBoard as parseCoreStateBoard, STATEBOARD_MAX_BYTES as CORE_STATEBOARD_MAX_BYTES } from '../core/stateBoard.ts';
import type { DeskAssetStorage, DeskMemoryStorage, DeskStorage, DeskStoryStorage, DeskTurnStorage, SemanticSearchAdapter } from '../core/storage.ts';
import type { DeskMemory, MemoryLayer } from '../core/types.ts';
import { buildDistillationInput, buildMemoryDistillSystem, buildSummaryInput, applySummaryDiff, mergeMemories, parseMemoryDistillOutput, renderMemoriesText, type MergeMemoryInput, type DistillMemory } from '../core/deskMemory.ts';
import { makeDeskBackend, resolveDeskProvider } from '../adapters/streamModelBackends.ts';
import type { ProviderOverride } from '../core/providerConfigStore.ts';
import { isTextOnlyModel, type DeskImageAttachment, type StreamChatResult } from '../core/modelBackend.ts';
import { validateDeskChannelConfig } from '../core/deskChannelConfig.ts';
import { buildChatAppendix, parseRefBookIds } from '../tools/chapterMemory.ts';
import { renderDiaryIndexText, buildOpeningContext, isFirstTurn } from '../core/contextInjector.ts';

interface DeskChatEnv {
  OC_DB: D1Database;
  OC_VECTORIZE: VectorizeIndex;
  AI: Ai;
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_BASE_URL?: string; // 可选:Anthropic 兼容网关的完整 Messages 端点 URL;校验在 AnthropicStreamBackend 的 safeEndpoint
  OPENAI_API_KEY?: string;     // OpenAI 兼容渠道(DeepSeek/SiliconFlow/opencode);配了优先于 Anthropic
  OPENAI_BASE_URL?: string;    // 可选:OpenAI 兼容网关 base(如 https://api.deepseek.com/v1);校验在 OpenAIStreamBackend 的 openAiEndpoint
  OPENAI_MODEL?: string;       // 可选:供应商模型名覆盖,如 'deepseek-chat'
  OPENAI_MAX_TOKENS?: number;  // 可选:默认 8000(deepseek-chat 输出上限)
  OPENAI_ALLOW_HTTP_LOCALHOST?: boolean; // 可选:opencode 本地 http://localhost 用
  // 多供应商(「商」切换):每组 = <PREFIX>_API_KEY / <PREFIX>_BASE_URL / <PREFIX>_MODEL / <PREFIX>_MAX_TOKENS,
  // 注册表与解析都在 streamModelBackends.ts 的 DESK_PROVIDER_DEFS / resolveDeskProvider。
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_MAX_TOKENS?: number;
  SILICONFLOW_API_KEY?: string;
  SILICONFLOW_BASE_URL?: string;
  SILICONFLOW_MODEL?: string;
  SILICONFLOW_MAX_TOKENS?: number;
  [k: string]: any;
}

// D1/CF-specific storage instances are the caller's job (examples/cloudflare/index.ts wires
// the D1 adapters from env.OC_DB/env.OC_VECTORIZE); this module only knows the StorageAdapter
// interfaces so it never reaches into examples/cloudflare/ itself. semantic is optional the
// same way TavernStudyHost treats it — recall simply stays empty without it.
export interface DeskChatStorage {
  deskStorage: DeskStorage;
  turnStorage: DeskTurnStorage;
  deskAssets: DeskAssetStorage;
  deskStory: DeskStoryStorage;
  semantic?: SemanticSearchAdapter;
  memory?: DeskMemoryStorage;
  diary?: import('../core/storage.ts').DiaryStorage;
}

// 把模型层结构化失败/截断转成用户能看懂的中文文案。SSE 的 error 事件会原文透传到前端横幅，
// 这里的用词就是「截断原因提示」的第一道落点：不再只给干巴巴的 kind 或「重试」。
function deskModelErrorMessage(result: StreamChatResult): string {
  if (!result.ok) {
    switch (result.kind) {
      case 'limit': return '生成达到输出上限被截断（上下文不足或超过输出上限），这轮没有存档，点「重试」可继续';
      case 'timeout': return '生成超时未完成，这轮没有存档，点「重试」可继续';
      case 'empty': return '模型没有返回内容，这轮没有存档，点「重试」可继续';
      case 'protocol': return `生成流异常中断${result.detail ? `（${result.detail}）` : ''}，这轮没有存档，点「重试」可继续`;
      case 'http': return `模型接口报错${result.detail ? `（${result.detail}）` : ''}，这轮没有存档，点「重试」可继续`;
      case 'fetch': return `网络连接失败${result.detail ? `（${result.detail}）` : ''}，这轮没有存档，点「重试」可继续`;
      case 'config': return '模型渠道未配置或不可用，这轮没有存档';
      case 'aborted': return '发送已中止';
      default: return `模型渠道未正常收尾（${result.kind}），这轮没有存档，点「重试」可继续`;
    }
  }
  if (result.stopReason === 'max_tokens' || result.stopReason === 'length') {
    return '生成达到输出上限被截断（上下文不足或超过输出上限），这轮没有存档，点「重试」可继续';
  }
  if (result.stopReason && result.stopReason !== 'end_turn' && result.stopReason !== 'stop') {
    return `生成未正常收尾（${result.stopReason}），这轮没有存档，点「重试」可继续`;
  }
  return '';
}
interface DeskChatParams {
  window_id: string;
  message?: string;
  model?: string;
  provider?: string; // 多供应商 id(见 streamModelBackends.ts DESK_PROVIDER_DEFS);空/未传=老渠道自动选择
  roll?: boolean;
  continue?: boolean; // 仅识别旧客户端续写请求，收到即400拒绝
  attachments?: unknown; // 附件数组(image/text)，形状在 normalizeAttachments 校验
}

// 文本附件：前端把 txt/md/json 读成文本随消息提交，后端拼进 user 楼层内容落库（作为上下文保留）。
export interface DeskTextAttachment { kind: 'text'; name: string; content: string }
export type DeskAttachment = DeskImageAttachment | DeskTextAttachment;

const DESK_DEFAULT_MODEL = 'claude-sonnet-4-5'; // 工单"model default follow editorial's"——同一个值,字面量各放一份(避免循环import)
const MESSAGE_MAX = 50000; // 同 editorial.ts message 上限口径
// 近景回喂上限独立于折叠阈值，给后台延迟/失败保留安全重叠。
const HISTORY_CAP = 40;

// ── 附件形状校验(纯函数,便于测试) ──
// 图片:data 是 base64、mime 白名单,只当次请求传递不落库。
// 文本:上限 TEXT_ATTACHMENT_MAX(500KB);≤TEXT_PERSIST_MAX(50KB) 的小文件拼进楼层永久落库
// (成为之后每轮都带的长期上下文),更大的文件仅当次传给模型、不落库——避免大文本每轮重复吃
// token / 爆上下文,对齐 ChatBox"当次解析"的用法。
// 上限:单图 base64 ≤8MB、单个文本 ≤500KB、每次总数 ≤8 个且 base64 总长 ≤30MB。
const IMAGE_MIME_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const TEXT_ATTACHMENT_MAX = 500 * 1024;
const TEXT_PERSIST_MAX = 50 * 1024;
const ATTACHMENT_COUNT_MAX = 8;
const ATTACHMENT_TOTAL_MAX = 30 * 1024 * 1024;

export function normalizeAttachments(
  raw: unknown,
): { ok: true; texts: DeskTextAttachment[]; images: DeskImageAttachment[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, texts: [], images: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'attachments 必须是数组' };
  if (raw.length > ATTACHMENT_COUNT_MAX) return { ok: false, error: `一次最多 ${ATTACHMENT_COUNT_MAX} 个附件` };
  const texts: DeskTextAttachment[] = [];
  const images: DeskImageAttachment[] = [];
  let totalBytes = 0;
  for (let i = 0; i < raw.length; i++) {
    const a: any = raw[i];
    if (!a || typeof a !== 'object') return { ok: false, error: `第 ${i + 1} 个附件不是对象` };
    if (a.kind === 'text') {
      const name = String(a.name || '附件');
      const content = typeof a.content === 'string' ? a.content : '';
      if (!content) return { ok: false, error: `第 ${i + 1} 个附件是空文本` };
      if (content.length > TEXT_ATTACHMENT_MAX) return { ok: false, error: `第 ${i + 1} 个附件文本太长(上限 ${TEXT_ATTACHMENT_MAX} 字)` };
      texts.push({ kind: 'text', name, content });
      totalBytes += content.length;
    } else if (a.kind === 'image') {
      const mime = typeof a.mime === 'string' ? a.mime : '';
      if (!IMAGE_MIME_ALLOWED.has(mime)) return { ok: false, error: `第 ${i + 1} 个图片格式不支持: ${mime || '未知'}` };
      const data = typeof a.data === 'string' ? a.data : '';
      if (!data) return { ok: false, error: `第 ${i + 1} 个图片数据为空` };
      if (data.length > IMAGE_MAX_BYTES) return { ok: false, error: `第 ${i + 1} 张图片太大(上限 8MB)` };
      images.push({ kind: 'image', name: String(a.name || '图片'), mime, data });
      totalBytes += data.length;
    } else {
      return { ok: false, error: `第 ${i + 1} 个附件类型不认识: ${String(a.kind)}` };
    }
  }
  if (totalBytes > ATTACHMENT_TOTAL_MAX) return { ok: false, error: '附件总大小超限(30MB)' };
  return { ok: true, texts, images };
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function errJson(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// ===== 状态板 in-band 解析 =====
// ```stateboard 围栏只有锚定在全文末尾（其后仅空白）才算协议指令；
// 埋在正文中间、后面还跟着别的正文的围栏是虚构(角色在故事里写了一段长得像围栏的文字),纯粹当
// 故事正文处理——不strip不parse,content原样返回,board留null。理由:desk是小说续写场景,模型
// 完全可能在叙事里描述"一段代码块"或引用别的格式化文本,不能见到```stateboard字样就当协议吃掉。
// 终态围栏命中后即从正文剥离；JSON 失败、非对象或序列化后超 8KB 都按畸形处理，
// 处理(board=null),不截断JSON本身凑合解析——半截JSON比没有更危险。
// 导出给 deskWindows 手改路径共享，保证两处使用同一字节上限。
export const STATEBOARD_MAX_BYTES = CORE_STATEBOARD_MAX_BYTES;

// Existing desk callers now exercise the same pure parser covered by core fixtures.
export const parseStateBoard = parseCoreStateBoard;

// ===== <content>最外层包裹剥离 =====
// 只处理最外层
// 包裹】——trim 后以 <content> 开头才剥开标签(连同紧随的至多一个换行),trim 后以 </content>
// 结尾才剥闭标签(连同紧前的至多一个换行),开闭各自独立判断(max_tokens 腰斩时可能只剥出开没有
// 闭,也照剥)。正文中段出现的字面 <content>/</content>(可能是剧情引用)一律不动——判据只看
// trim 后的首尾,不做全文替换。trim 只用于"要不要剥"的判断,不 trim 落库内容本身：
// trim结果落库会啃掉Markdown尾部双空格硬换行/新段前导缩进这类有效空白),所以这里剥的是"标签+
// 紧邻的一个换行",两侧原有的其余空白原样保留。
export function unwrapContentTag(text: string): string {
  const OPEN = '<content>';
  const CLOSE = '</content>';
  let s = String(text || '');

  // 开标签:trim视图判断"要不要剥",实剥只挖掉标签本身+紧随的至多一个换行,标签前面原有的
  // 前导空白(trim时被晾在一边的那部分)原样拼回去,不陪绑一起剥。
  const trimmed = s.trim();
  if (trimmed.startsWith(OPEN)) {
    const leadWs = s.length - s.trimStart().length;
    let cut = leadWs + OPEN.length;
    if (s.startsWith('\r\n', cut)) cut += 2;
    else if (s.startsWith('\n', cut)) cut += 1;
    s = s.slice(0, leadWs) + s.slice(cut);
  }

  // 闭标签:用剥完开标签之后的最新 s 重新取 trim 视图判断(开标签那刀不会碰到尾部,这里重新
  // trim只是让两段逻辑各自独立、不用互相假设谁先跑、跑没跑过)。同理,标签后面原有的尾随空白
  // 原样保留,只挖标签本身+紧前的至多一个换行。
  const trimmed2 = s.trim();
  if (trimmed2.endsWith(CLOSE)) {
    const trailWs = s.length - s.trimEnd().length;
    const tagEnd = s.length - trailWs;
    let cut = tagEnd - CLOSE.length;
    if (s.slice(0, cut).endsWith('\r\n')) cut -= 2;
    else if (s.slice(0, cut).endsWith('\n')) cut -= 1;
    s = s.slice(0, cut) + s.slice(tagEnd);
  }

  return s;
}

// ===== 记忆自动蒸馏(后台 best-effort)=====
// 普通轮落库成功后触发：取最近若干楼层 → 调模型提炼 JSON → 解析 → 并入该窗所属作用域（角色区
// 或共享区）的 plot/general 层。全程吞异常：蒸馏失败绝不影响已完成的聊天与存档。
// 仅在有 memory storage 与已配置供应商时跑。
async function runMemoryDistill(
  env: DeskChatEnv,
  storage: DeskChatStorage,
  windowId: string,
  provider: string,
  providerOverrides: ProviderOverride[],
): Promise<void> {
  const memoryStore = storage.memory;
  if (!memoryStore) return;
  // 未配置任何供应商就跳过（蒸馏也要模型，不能裸跑）。
  const resolved = provider ? resolveDeskProvider(env, provider, providerOverrides) : null;
  const hasChannel = resolved ? true : !validateDeskChannelConfig(env);
  if (!hasChannel) return;
  try {
    const { deskStorage } = storage;
    const win = await deskStorage.getWindow(windowId);
    if (!win) return;
    const project = String(win.project);
    const charKey = String(win.charKey || (win.vars && win.vars.char) || '');
    const floors = await deskStorage.listFloors(windowId);
    const input = buildDistillationInput(floors);
    if (!input) return;
    const system = [{ text: buildMemoryDistillSystem(), cache: true }];
    const backend = makeDeskBackend(env, provider || undefined, providerOverrides);
    let distillText = '';
    const result = await backend.streamChat({
      system,
      prompt: input,
      model: DESK_DEFAULT_MODEL,
      signal: AbortSignal.timeout(90_000),
      onEvent: (event) => { if (event.type === 'text') distillText += event.text; },
    });
    if (!result.ok) return;
    const parsed = parseMemoryDistillOutput(distillText);
    if (!parsed.memories.length) return;
    // 归属：自动蒸馏统一写进该窗作用域（窗口声明的 charKey，缺省共享区）。**不使用模型输出的
    // charKey**——它与 replaceScope 的强制作用域会不一致（模型给 A 而窗是 B，row 带着 A 却按 B
    // 落库），且注入只读窗口 charKey 作用域，模型 charKey 无消费端。统一"只用窗口 charKey"消除
    // 归属与实际落库的错位。强制非 anchor：自动路径绝不写人设锚定区。
    const incoming: MergeMemoryInput[] = parsed.memories.map((inc) => ({
      theme: inc.theme,
      layer: inc.layer === 'anchor' ? 'plot' : inc.layer,
      charKey,
      title: inc.title,
      content: inc.content,
    }));
    const existing = await memoryStore.listByScope({ project, charKey });
    const { next } = mergeMemories(existing, incoming, { project, charKey, windowId });
    // 按作用域批量落库：anchor 守卫在 replaceScope 内部保证既有 anchor 不被剧情蒸馏清除。
    await memoryStore.replaceScope({ project, charKey, memories: next });
  } catch (e) {
    console.error('[desk] 记忆自动蒸馏失败(不拖垮聊天)', e);
  }
}

// ===== 手动总结（角色级 / 项目级，POST /memories/summarize 后端调用）=====
// 取某作用域关联各窗最近楼层 + 当前记忆 → 模型总结 → 落到各层。
// 角色级 charKey 非空：只汇总该角色；项目级 charKey 空：汇总该项目所有角色 + 共享区 plot/general。
// anchor 策略：applySummaryDiff 只新增 anchor，不覆盖既有 anchor。
export async function runMemorySummarize(
  env: DeskChatEnv,
  storage: DeskChatStorage,
  opts: { project: string; charKey?: string; windowLimit?: number; layer?: 'anchor' | 'plot' | 'general' },
  provider: string,
  providerOverrides: ProviderOverride[],
): Promise<{ added: number; updated: number; dropped: number; anchorGuard: number } | { error: string }> {
  const memoryStore = storage.memory;
  if (!memoryStore) return { error: 'memory storage 未接' };
  const project = opts.project || '';
  if (!project) return { error: 'project 必填' };
  const resolved = provider ? resolveDeskProvider(env, provider, providerOverrides) : null;
  const hasChannel = resolved ? true : !validateDeskChannelConfig(env);
  if (!hasChannel) return { error: '未配置模型供应商，无法总结' };
  try {
    const { deskStorage } = storage;
    // 收集该作用域下的窗口：charKey 非空 → 该角色所有窗；空 → 项目内所有窗。
    const windows = await deskStorage.listWindows(project);
    const charKey = opts.charKey || '';
    const scopeWindows = charKey
      ? windows.filter((w) => String(w.charKey || (w.vars && w.vars.char) || '') === charKey)
      : windows;
    const limit = opts.windowLimit && opts.windowLimit > 0 ? opts.windowLimit : 20;
    // 汇总各窗最近楼层（限流）
    const floors: Array<{ windowId: string; charKey: string; role: 'user' | 'assistant'; content: string }> = [];
    for (const w of scopeWindows.slice(0, 40)) {
      const fl = await deskStorage.listFloors(w.id);
      for (const f of fl.slice(-limit)) {
        floors.push({ windowId: w.id, charKey: String(w.charKey || w.vars?.char || ''), role: f.role, content: f.content });
      }
    }
    if (!floors.length) return { added: 0, updated: 0, dropped: 0, anchorGuard: 0 };
    const current = await memoryStore.listByScope({ project, charKey });
    const input = buildSummaryInput(floors, current, project);
    const system = [{ text: buildMemoryDistillSystem(), cache: true }];
    const backend = makeDeskBackend(env, provider || undefined, providerOverrides);
    let summaryText = '';
    const result = await backend.streamChat({
      system,
      prompt: input,
      model: DESK_DEFAULT_MODEL,
      signal: AbortSignal.timeout(120_000),
      onEvent: (event) => { if (event.type === 'text') summaryText += event.text; },
    });
    if (!result.ok) return { error: `模型未正常收尾(${result.kind})` };
    const parsed = parseMemoryDistillOutput(summaryText);
    if (!parsed.memories.length) return { added: 0, updated: 0, dropped: 0, anchorGuard: 0 };
    // 仅当 layer='anchor' 时允许手动补锚；否则强制非 anchor（剧情总结不动锚）。
    const allowAnchor = opts.layer === 'anchor';
    const incoming: DistillMemory[] = parsed.memories.map((inc) => ({
      ...inc,
      layer: (allowAnchor && inc.layer === 'anchor') ? ('anchor' as MemoryLayer) : (inc.layer === 'anchor' ? ('plot' as MemoryLayer) : inc.layer),
      charKey: inc.charKey || charKey,
    }));
    const { next, added, updated, dropped, anchorGuard } = applySummaryDiff(current, incoming, { project, charKey, windowId: '' });
    await memoryStore.replaceScope({ project, charKey, memories: next });
    return { added: added.length, updated: updated.length, dropped, anchorGuard };
  } catch (e: any) {
    console.error('[desk] 手动总结失败', e);
    return { error: e.message || '总结失败' };
  }
}

// ===== handleDeskChat =====
export async function handleDeskChat(
  env: DeskChatEnv,
  params: DeskChatParams,
  storage: DeskChatStorage,
  signal?: AbortSignal,
  waitUntil?: (promise: Promise<unknown>) => void,
  providerOverrides: ProviderOverride[] = []
): Promise<Response> {
  // deskReadJsonLimited(index.ts)只挡"不是合法JSON"和"超10MB",合法JSON的 null/数组/字符串
  // 照样会被当成 body 传进来——这里补一道形状闸,同 tools/desk.ts 系列 handler 的开头习惯。
  if (!params || typeof params !== 'object') return errJson('请求体不对');
  // 旧 continue 请求必须拒绝，不能按 normal 落一条空 user 楼。
  if (params.continue) return errJson('续写功能已下线', 400);
  const windowId = typeof params.window_id === 'string' ? params.window_id.trim() : '';
  if (!windowId) return errJson('window_id 必填');
  const roll = !!params.roll;

  const message = typeof params.message === 'string' ? params.message.trim() : '';
  // 附件先归一化:message 为空但带附件(纯图片/纯文本附件)也允许发——ChatBox 支持"只发附件不发文本"。
  const att = normalizeAttachments(params.attachments);
  if (!att.ok) return errJson(att.error, 400);
  const textAttachments = att.texts;
  const imageAttachments = att.images;
  if (!roll) {
    if (!message && textAttachments.length === 0 && imageAttachments.length === 0) return errJson('message 不能为空');
    if (message.length > MESSAGE_MAX) return errJson(`message 太长了(上限${MESSAGE_MAX}字)`);
  }
  // 渠道校验:显式 provider 时验供应商配置(不存在/没配 → 明确报错,不悄悄回落老渠道),老渠道不传
  // provider 走 validateDeskChannelConfig(ANTHROPIC/OPENAI 任一)。
  const provider = typeof params.provider === 'string' ? params.provider.trim() : '';
  const resolvedProvider = provider ? resolveDeskProvider(env, provider, providerOverrides) : null;
  if (provider && !resolvedProvider) return errJson(`模型供应商未配置或不存在: ${provider}`, 500);
  const channelError = provider ? null : validateDeskChannelConfig(env);
  if (channelError) return errJson(channelError, 500);

  const usageSink = makeD1UsageSink(env);
  const { deskStorage, turnStorage, deskAssets, deskStory, semantic, memory } = storage;
  // 模型选择:OpenAI 兼容供应商的 model 是 wire 模型名(deepseek-chat 之类),不在 claude 白名单
  // MODEL_PROFILES 里,不能过那个闸否则会被夹回 DESK_DEFAULT_MODEL;anthropic/老渠道才走白名单。
  // OpenAI 渠道实际 wire 模型仍以 env 的 <PREFIX>_MODEL 覆盖优先(openAiParams 的 options.model)。
  const isOpenAiProvider = !!resolvedProvider && resolvedProvider.protocol === 'openai';
  const model = isOpenAiProvider
    ? (typeof params.model === 'string' && params.model ? params.model : DESK_DEFAULT_MODEL)
    : (params.model && MODEL_PROFILES[params.model] ? params.model : DESK_DEFAULT_MODEL);

  // 纯文本模型 + 图片 → 明确报错，不悄悄吞附件（与"不悄悄回落"的渠道纪律一致）。
  if (imageAttachments.length && isTextOnlyModel(model)) {
    return errJson(`当前模型 ${model} 不支持图片，请切换到支持视觉的模型（qwen-vl / gpt-4o / claude 等）`, 400);
  }

  // 1) 载入写作窗
  let win: any;
  try {
    win = await deskStorage.getWindow(windowId);
  } catch (e: any) {
    return errJson(e.message, 500);
  }
  if (!win) return errJson('写作窗不存在', 404);

  const project = String(win.project);
  const recipeId = String(win.recipeId);
  const note = String(win.note || '');
  const noteDepth = Number(win.noteDepth);
  const stateBoard = win.stateBoard;
  const windowVars = win.vars;

  // 2) roll 要落在"最后一楼且是assistant"上——先查清楚,不合规矩当场拒
  let lastFloor: any = null;
  if (roll) {
    try {
      const all = await deskStorage.listFloors(windowId);
      lastFloor = all.length ? all[all.length - 1] : null;
    } catch (e: any) {
      return errJson(e.message, 500);
    }
    if (!lastFloor || lastFloor.role !== 'assistant') {
      return errJson('最后一楼不是模型的回复,不能重roll');
    }
  }

  // 3) 时光带:读状态→渲染正文→算 cutoff,给下面查"未折叠楼层"用
  let timelineState: any = null;
  try {
    timelineState = await loadDeskTimelineState(env as any, windowId);
  } catch (e) {
    console.error('[desk] 读时光带状态失败,按无时光带走', e);
  }
  const timelineText = renderTimelineText(timelineState);
  const cutoff = timelineState?.cutoff ? parseDeskTimelineCutoff(timelineState.cutoff) : null;
  let afterCutoffFloors: any[] = [];
  let allFloors: any[] = [];
  try {
    // report 列也要select上:roll模式要从里头挖上一楼的 boardAfter 快照(见下方 mode==='roll' 分支)。
    allFloors = await deskStorage.listFloors(windowId);
    afterCutoffFloors = cutoff ? allFloors.filter((floor) => floor.createdAt > cutoff.t || (floor.createdAt === cutoff.t && floor.id > cutoff.id)) : allFloors;
  } catch (e: any) {
    return errJson(e.message, 500);
  }

  // 4) 普通轮存楼层，并按模式拼装 floors/input。
  let userFloorId: string | null = null;
  let assembleFloors: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let assembleInput = '';
  const mode: 'normal' | 'roll' = roll ? 'roll' : 'normal';
  // roll 优先使用目标楼当初的 boardBefore；老数据再回溯前一 assistant 的 boardAfter。
  let rollStateBoard: any = null;
  let foundRollBoard = false;

  if (mode === 'normal') {
    // 文本附件拼进用户消息：既落库（后续楼层组装上下文带上）、也进本楼输入（这次模型立刻看到）。
    const attachText = textAttachments.map((t) => `[文件: ${t.name}]\n${t.content}`).join('\n\n');
    const fullMessage = attachText ? `${message}\n\n${attachText}` : message;
    userFloorId = genId('fl');
    const now0 = new Date().toISOString();
    try {
      await deskStorage.createFloor({ id: userFloorId, windowId, role: 'user', content: fullMessage, variants: [fullMessage], activeVariant: 0, thinking: null, report: {}, createdAt: now0 });
    } catch (e: any) {
      return errJson(`存用户楼层失败: ${e.message}`, 500);
    }
    // afterCutoffFloors 是存这条之前查的,天然不含它——正好是"此楼之前的近景"
    assembleFloors = afterCutoffFloors.slice(-HISTORY_CAP).map((f: any) => ({ role: f.role, content: f.content }));
    assembleInput = fullMessage;
  } else if (mode === 'roll') {
    // 去掉待重roll的那条assistant自己;再往前若紧跟着一条user楼层,摘出来当input(那条assistant
    // 本来就是在回答它),没有就input留空(理论edge case:窗口首楼就是assistant,靠手改楼层造出来的)
    const beforeLast = afterCutoffFloors.filter((f: any) => f.id !== lastFloor.id);
    // 重生成必须使用目标楼当初实际装配的输入板，不能使用已被该楼推进后的窗口现状。
    // boardBefore 是权威快照；缺失时才沿旧楼 boardAfter 回溯。只接受纯对象，畸形值继续向前找。
    const lastRep = lastFloor.report;
    const bb = lastRep && typeof lastRep === 'object' && !Array.isArray(lastRep) ? (lastRep as any).boardBefore : undefined;
    if (bb && typeof bb === 'object' && !Array.isArray(bb)) {
      rollStateBoard = bb; // 空对象{}也是合法快照(首楼无预置时它就是{}),truthy 判断放得进来
      foundRollBoard = true;
    } else {
      // 老楼没有 boardBefore 时回溯前一 assistant 的 boardAfter；再无则退回窗口现状。
      for (let i = beforeLast.length - 1; i >= 0; i--) {
        const f = beforeLast[i];
        if (f.role !== 'assistant') continue;
        const rep = f.report;
        if (!rep || typeof rep !== 'object' || Array.isArray(rep) || !Object.prototype.hasOwnProperty.call(rep, 'boardAfter')) {
          break; // 旧数据没有 boardAfter 字段:回溯到此为止,老口径回退 window.state_board
        }
        const ba = rep.boardAfter;
        if (ba && typeof ba === 'object' && !Array.isArray(ba)) {
          rollStateBoard = ba;
          foundRollBoard = true;
          break; // 命中有效板
        }
        // boardAfter 键在,但值是 null/数组/字符串等畸形:这楼当时也没有有效板,继续往前找上一条assistant楼
      }
    }
    let hist = beforeLast;
    if (beforeLast.length && beforeLast[beforeLast.length - 1].role === 'user') {
      assembleInput = beforeLast[beforeLast.length - 1].content;
      hist = beforeLast.slice(0, -1);
    }
    assembleFloors = hist.slice(-HISTORY_CAP).map((f: any) => ({ role: f.role, content: f.content }));
  }

  // 5) 装配产出 system、tail 与 report。roll 使用可信快照，normal 使用窗口现状。
  const effectiveStateBoard: Record<string, any> =
    mode === 'roll' && foundRollBoard
      ? (rollStateBoard && typeof rollStateBoard === 'object' ? rollStateBoard : {})
      : stateBoard;
  // 记忆注入（跨角色重构）：装配携带「项目共享区 + 当前角色区」的记忆（非 roll），供 AI 引用。
  // 当前角色 = 窗口声明的 charKey，回落 windowVars.char（{{char}}）；为空的窗只进共享区。
  // 读失败不打断装配。
  // 记忆特指 deskMemory；仅开局一次性注入记忆 + 近2-3条日记索引（task-26B）
  const memCharKey = String(win.charKey || (win.vars && win.vars.char) || '');
  // task-30 多选记忆：优先读 vars.selected_char_keys，否则回退单 charKey
  const selectedForMemory: string[] = (() => {
    const v: any = (win.vars as any)?.selected_char_keys ?? (win.vars as any)?.selectedCharKeys ?? (win.vars as any)?.selected_charkeys;
    if (Array.isArray(v)) return v.filter((x: any) => typeof x === 'string' && String(x).trim()).map((x: string) => String(x).trim());
    if (typeof v === 'string' && String(v).trim()) return [String(v).trim()];
    return [];
  })();
  const memoryCharKeys = selectedForMemory.length ? selectedForMemory : (memCharKey ? [memCharKey] : []);
  const opening = isFirstTurn(allFloors);
  let memoriesText = '';
  let diaryIndexText = '';
  let chapterAppendix = '';
  let styleAppendix = '';
  if (opening) {
    if (memory) {
      try {
        const scopeRows: DeskMemory[] = [];
        const sharedRows = await memory.listByScope({ project, charKey: '' });
        scopeRows.push(...sharedRows);
        for (const ck of memoryCharKeys) {
          const charRows = await memory.listByScope({ project, charKey: ck });
          scopeRows.push(...charRows);
        }
        const prunedRows = [...scopeRows].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 30);
        const rawMemText = renderMemoriesText(prunedRows);
        memoriesText = rawMemText.length > 6000 ? rawMemText.slice(0, 6000) + '\n…（记忆已截断，仅展示最新相关）' : rawMemText;
      } catch (e) {
        console.error('[desk] 读记忆失败,按无记忆继续', e);
      }
    }
    // 近 2-3 条日记索引作为额外信息（小记：确保记得最近几次发生的事 + 日记重要事）
    const diaryStore = storage.diary as any;
    if (diaryStore) {
      try {
        const diaryCharKey = memoryCharKeys[0] || memCharKey || undefined;
        const entries = await diaryStore.listEntries({ project, charKey: diaryCharKey, limit: 3 });
        diaryIndexText = renderDiaryIndexText(entries as any, 3);
      } catch (e) {
        console.error('[desk] 读日记索引失败,按无索引继续', e);
      }
    } else if (project) {
      // 回退：直接读 D1 diaries 表（适配未显式传 diary storage 的旧调用）
      try {
        const db: any = (env as any).OC_DB;
        if (db) {
          const diaryCK2 = memoryCharKeys[0] || memCharKey;
          const q = diaryCK2
            ? await (db.prepare(`SELECT date, title, content FROM diaries WHERE project = ? AND char_key = ? ORDER BY created_at DESC LIMIT 3`).bind(project, diaryCK2) as any).all()
            : await (db.prepare(`SELECT date, title, content FROM diaries WHERE project = ? ORDER BY created_at DESC LIMIT 3`).bind(project) as any).all();
          const rows = (q.results || []) as any[];
          diaryIndexText = renderDiaryIndexText(rows as any, 3);
        }
      } catch {}
    }
    if (project) {
      try {
        const recentQuery = [assembleInput, ...assembleFloors.slice(-3).map((f: any) => f.content)]
          .filter(Boolean).join('\n').slice(0, 800);
        const refBookIds = parseRefBookIds(windowVars.refBookIds ?? windowVars.ref_book_ids ?? '');
        // 26E 显式参考书：未选书不注入，仅对选书注入
        if (refBookIds.length === 0) {
          chapterAppendix = '';
          styleAppendix = '';
        } else {
          const appx = await buildChatAppendix(env as any, { project, query: recentQuery, charKey: memoryCharKeys[0] || memCharKey, refBookIds });
          chapterAppendix = appx.appendix;
          styleAppendix = appx.styleBlock;
        }
      } catch (e) {
        console.error('[desk] 章节记忆/参考风格注入失败,按无注入继续', e);
      }
    }
  } else {
    // 非开局：不重复注入记忆/日记/章节附录，避免上下文污染（task-26B）
  }
  const openingMemories = opening ? buildOpeningContext({ memoriesText, diaryIndexText, chapterAppendix, styleAppendix }) : '';
  const assembled = await assembleDesk({ deskAssets, deskStory, semantic }, {
    project, recipeId, input: assembleInput,
    floors: assembleFloors, note, noteDepth,
    stateBoard: effectiveStateBoard, vars: windowVars, timeline: timelineText,
    memories: openingMemories,
    selectedCharKeys: memoryCharKeys,
    selected_char_keys: memoryCharKeys,
  });
  if (!assembled.success) return errJson(assembled.error || '装配失败', 500);
  const systemBlocks: Array<{ text: string; cache: boolean }> = assembled.system;
  const tail: string = assembled.tail;
  const report: any = assembled.report;

  // ===== SSE 骨架(照 editorial.ts 原样克隆)=====
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let clientGone = false;

  const send = async (obj: any) => {
    if (clientGone) return;
    try { await writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); }
    catch { clientGone = true; }
  };

  if (signal) {
    if (signal.aborted) clientGone = true;
    else signal.addEventListener('abort', () => { clientGone = true; }, { once: true });
  }

  // ===== 落库收尾(状态板剥离+楼层写入,两种轮次分支)=====
  // 返回落到的 floorId；只有 roll 撞上并发改动才返回 conflict，普通提交失败按存档异常上抛。
  // 楼层变更与窗口板必须在同一 D1 batch 原子提交；roll 的窗口写还须由楼层 CAS 后置状态守卫。
  // roll 绑定请求起点的楼层快照；生成期间若被切版本、重生成或手改，整轮结果与状态板一并作废。
  // 所有楼层变更都须先 invalidate 时光带、写后再 fence；busy 直接报冲突。
  async function finalizeDeskTurn(allText: string, allThinking: string): Promise<{ floorId: string } | { conflict: true }> {
    const { content: rawContent, board } = parseStateBoard(allText);
    // 先剥状态板，再于落库前剥正文最外层 <content> 壳。
    const content = unwrapContentTag(rawContent);
    const now = new Date().toISOString();
    // appliedBoard 是本轮实际生效板：解析成功用新板，否则继承装配输入板。
    // report.boardAfter 与 window.state_board 必须使用同一值；stale 仍以 board===null 判定。
    const appliedBoard: Record<string, any> = board !== null ? board : effectiveStateBoard;
    // 每次提交生成唯一 commitToken，供 roll 窗口 UPDATE 确认是本次楼层写入。
    // boardBefore 只保存可信输入快照；老楼 roll 回退的推测板不得升格成权威档案。
    const boardBeforeTrusted = mode === 'normal' || foundRollBoard;
    const reportOut = { ...report, stateBoardStale: board === null, ...(boardBeforeTrusted ? { boardBefore: effectiveStateBoard } : {}), boardAfter: appliedBoard };
    let floorId = '';

    // 楼层写与窗口板 UPDATE 同事务；任一失败整批回滚，禁止半截态。
    if (mode === 'normal') {
      floorId = genId('fl');
      // normal的INSERT不是CAS语句(没有WHERE碰撞条件),窗口UPDATE不需要额外EXISTS守卫——只要
      // INSERT没抛错(主键冲突/瞬时故障会抛错,批内抛错整批回滚,两条都不落),批内第二条必然执行
      // 且必然命中(WHERE id=?只按主键定位,这一行在1)载入写作窗时已经查到过,请求处理期间不会
      // 被并发删除窗口)。
      const committed = await turnStorage.commitAssistantFloor(windowId, floorId, { content, thinking: allThinking.trim() || null, report: reportOut, stateBoard: appliedBoard, committedAt: now });
      if (!committed) throw new Error('写作窗已不存在或提交冲突');
    } else if (mode === 'roll') {
      floorId = String(lastFloor.id);
      const inv = await invalidateDeskTimelineIfFolded(env as any, windowId, String(lastFloor.createdAt), floorId);
      if (inv === 'busy') throw new Error('时光带正在被后台折叠,稍等几秒再试');

      // 窗口 UPDATE 的 EXISTS 必须验证楼层后置状态中的唯一 commitToken，不能只验 variant 形状；
      // 并发 roll 可能产生相同形状。冲突仍以第一条楼层 CAS 的 changes 判定。
      const committed = await turnStorage.rollAssistantFloor({ windowId, floorId, expected: lastFloor, commit: { content, thinking: allThinking.trim() || null, report: reportOut, stateBoard: appliedBoard, committedAt: now } });
      if (!committed) return { conflict: true };

      await fenceDeskTimelineAfterWrite(env as any, windowId, inv.rev, { createdAt: String(lastFloor.createdAt), id: floorId });
    }

    return { floorId };
  }

  // ===== 模型泵:makeDeskBackend 按渠道(Anthropic / OpenAI 兼容)选后端,单条 user 消息(content=tail),
  // 零工具——不像 editorial.ts 的 pump 那样要跑 MAX_TURNS 工具回合循环,一次请求打到底,一次流读到底。=====
  const pumpBackend = async () => {
    if (mode === 'normal') await send({ type: 'user_saved', id: userFloorId });
    const controller = new AbortController();
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const backend = makeDeskBackend(env, provider || undefined, providerOverrides);
    let failed = false;
    const result = await backend.streamChat({ system: systemBlocks, prompt: tail, model, ...(mode === 'normal' && imageAttachments.length ? { images: imageAttachments } : {}), signal: controller.signal, onEvent: async (event) => {
      if (clientGone) { controller.abort(); return; }
      if (event.type === 'text') await send({ type: 'text', text: event.text });
      else if (event.type === 'thinking') await send({ type: 'thinking', text: event.text });
      else if (event.type === 'ping') await send({ type: 'ping' });
      else if (event.type === 'usage') await send({ type: 'usage', input: event.usage.input || 0, cache_read: event.usage.cacheRead || 0, cache_write: event.usage.cacheWrite || 0 });
    } });
    signal?.removeEventListener('abort', abort);
    if (!result.ok) {
      failed = result.kind !== 'aborted';
      if (!clientGone && result.kind !== 'aborted') {
        const msg = deskModelErrorMessage(result);
        if (msg) await send({ type: 'error', error: msg });
      }
    } else if (result.stopReason && result.stopReason !== 'end_turn' && result.stopReason !== 'stop') {
      failed = true;
      const msg = deskModelErrorMessage(result);
      if (!clientGone && msg) await send({ type: 'error', error: msg });
    } else {
      try {
        const saved = await finalizeDeskTurn(result.text, result.thinking);
        if ('conflict' in saved) { failed = true; await send({ type: 'error', error: '这一楼在生成期间被改动过,本次结果已丢弃,请重试' }); }
        else {
          await send({ type: 'done', id: saved.floorId });
          // 普通轮落库成功后后台自动提炼记忆（best-effort，失败不打断）。
          if (mode === 'normal' && memory) {
            const distill = () => runMemoryDistill(env, storage, windowId, provider, providerOverrides);
            if (waitUntil) waitUntil(distill()); else distill();
          }
        }
      } catch (error: any) { failed = true; await send({ type: 'error', error: `存档失败: ${error.message}` }); }
    }
    const usage = result.usage || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    try { const log = () => usageSink.logUsage('desk', model, { input: usage.input, output: usage.output, cache_read: usage.cacheRead, cache_write: usage.cacheWrite }, failed ? 'failed' : 'ok'); if (waitUntil) waitUntil(log()); else await log(); } catch (error) { console.error('[desk] 记账失败(不拖垮存档)', error); }
    try { await writer.close(); } catch {}
    if (waitUntil) waitUntil(maybeFoldDeskTimeline(env as any, windowId)); else maybeFoldDeskTimeline(env as any, windowId);
  };

  const chosen = pumpBackend;
  if (waitUntil) waitUntil(chosen());
  else chosen();

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', ...CORS },
  });
}
