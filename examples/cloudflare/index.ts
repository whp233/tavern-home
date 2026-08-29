import { authenticate, equalSecret, hasScope, type AuthContext, type AuthEnv, type Scope } from '../../src/auth.ts';
import { ReadingService } from '../../src/core/readingService.ts';
import { D1ReadingStorage } from './adapters/d1ReadingStorage.ts';
import { D1DeskStorage } from './adapters/d1DeskStorage.ts';
import { D1DeskTurnStorage } from './adapters/d1DeskTurnStorage.ts';
import { D1DeskAssetStorage } from './adapters/d1DeskAssetStorage.ts';
import { D1DeskStoryStorage } from './adapters/d1DeskStoryStorage.ts';
import { VectorizeSemanticSearch } from './adapters/vectorizeSemanticSearch.ts';
import type { Ai, VectorizeIndex } from '../../src/storage/vectorize.ts';
import type { SemanticSearchAdapter } from '../../src/core/storage.ts';
import {
  deskImportPreset, deskImportSettings, deskImportWorlds, deskImportRegexBundle, importCharacterCard, deskImportChat,
  deskListPresets, deskPresetDelete, deskListRegex, deskBackfillChapterVectors,
} from '../../src/tools/desk.ts';
import { parseCharacterCard } from '../../src/core/characterCard.ts';
import { compactMemories, normalizeTheme, normalizeLayer } from '../../src/core/deskMemory.ts';
import type { DeskMemory } from '../../src/core/types.ts';
import {
  deskPresetBlocks, deskBlockUpdate, deskLoreList, deskLoreCreate, deskLoreUpdate, deskLoreDelete,
  deskRegexUpdate, deskRegexDelete, deskRegexReorder, deskCoreGet, deskCoreUpdate, deskRecallGet, deskRecallUpdate,
} from '../../src/tools/deskPanels.ts';
import { deskRecipeList, deskRecipeExport, deskRecipeCreate, deskRecipeUpdate, deskRecipeDelete } from '../../src/tools/deskRecipes.ts';
import {
  deskWindowCreate, deskWindowList, deskWindowGet, deskWindowUpdate, deskWindowDelete,
  deskFloorEdit, deskWindowTruncate, deskFloorVariant,
} from '../../src/tools/deskWindows.ts';
import { deskBacktrackCreate, deskBacktrackList } from './deskBacktrackRoutes.ts';
import { deskBookSplit, deskBookAuto } from '../../src/tools/deskBook.ts';
import { studyList, studyGet, studyCreate, studyUpdate, studyDelete, studySearch, studyBackfill } from '../../src/tools/study.ts';
import { StudyService } from '../../src/core/studyService.ts';
import { D1StudyStorage } from './adapters/d1StudyStorage.ts';
import {
  chaptersList, chapterGet, chapterCreate, chapterUpdate, chapterDelete, chapterRestore, chapterDeletePermanent,
  chapterPublish, chapterUnpublish, chaptersExport,
  commentsList, commentPost, commentDelete,
} from '../../src/tools/reading.ts';
import { deskDryrun } from '../../src/chat/deskAssemble.ts';
import { maybeFoldDeskTimeline } from '../../src/chat/deskTimeline.ts';
import { deskBoardRefresh } from '../../src/chat/deskBoardRefresh.ts';
import { handleDeskChat, runMemorySummarize, type DeskChatStorage } from '../../src/chat/desk.ts';
  import {
    makeDeskBackend, listProviders, PROVIDER_REGISTRY_IDS, DESK_PROVIDER_DEFS, deskProviderConfigured, mergeProviderEnv,
    resolveDeskProvider, providerModelsUrl, parseProviderModels, isPlaceholderKey,
    type DeskBackendEnv,
  } from '../../src/adapters/streamModelBackends.ts';
import { D1ProviderConfigStore } from './adapters/d1ProviderConfigStore.ts';
import { D1DeskMemoryStorage } from './adapters/d1DeskMemoryStorage.ts';
import { D1DiaryStorage } from './adapters/d1DiaryStorage.ts';
import { diaryDates, diaryList, diaryGet, diaryCreate, diaryUpdate, diaryDelete } from '../../src/tools/diary.ts';
import { D1CgStorage } from './adapters/d1CgStorage.ts';
import { cgList, cgGet, cgCreate, cgUpdate, cgDelete } from '../../src/tools/cg.ts';
import { stickyNotesList, stickyNotesGet, stickyNotesCreate, stickyNotesUpdate, stickyNotesDelete } from '../../src/tools/stickyNotes.ts';
import {
  chapterIndexList, chapterIndexUpsert, chapterIndexDelete,
  styleRefGet, styleRefPut, novelContextRetrieve, chapterIntegrate,
} from '../../src/tools/chapterMemory.ts';
import { D1DailyLoginStore } from './adapters/d1DailyLoginStore.ts';
import { handleTrpgRoutes } from './trpgRoutes.ts';
import { handleSaveRoutes } from './saveRoutes.ts';
import { handleStoryRoutes } from './storyRoutes.ts';
import { handlePlotRoutes } from './plotRoutes.ts';
import { handleMcpPost } from './mcp.ts';
import { buildDiaryPrompt, demoDiary } from '../../src/core/diaryPrompt.ts';
import { todayDiaryDate, diaryTimeNow, normalizeDiaryDate } from '../../src/core/diaryService.ts';
import {
  DEFAULT_DAILY_LOGIN_CONFIG, DEFAULT_DAILY_LOGIN_STATE,
  dailyLoginDateKey, parseDailyLoginDateKey, evaluateDailyLogin, nextDailyLoginState,
} from '../../src/core/loreTrigger.ts';
import type { DailyLoginConfig } from '../../src/core/loreTrigger.ts';
import type { ProviderOverride } from '../../src/core/providerConfigStore.ts';

interface Env extends AuthEnv {
  OC_DB: D1Database;
  OC_VECTORIZE?: VectorizeIndex;
  AI?: Ai;
  ANTHROPIC_API_KEY?: string;
  // Optional plain var: full Messages endpoint URL of an Anthropic-compatible gateway
  // (e.g. "https://gateway.example.com/v1/messages"). Protocol stays Anthropic Messages;
  // https-only, credentials-in-URL rejected. Unset = api.anthropic.com.
  ANTHROPIC_BASE_URL?: string;
  // OpenAI-compatible channel (DeepSeek / SiliconFlow / opencode, etc.). When OPENAI_API_KEY is
  // set (and ANTHROPIC_API_KEY is not), the desk chat / board-refresh / timeline-fold chains use
  // the OpenAI Chat Completions protocol instead. OPENAI_BASE_URL defaults to the DeepSeek
  // endpoint; OPENAI_MODEL overrides the wire model name (e.g. 'deepseek-chat').
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_MAX_TOKENS?: number;
  OPENAI_ALLOW_HTTP_LOCALHOST?: string;
  // Multi-provider desk chat: each group is <PREFIX>_API_KEY / <PREFIX>_BASE_URL / <PREFIX>_MODEL
  // (registry lives in src/adapters/streamModelBackends.ts; the frontend "商" popover lists these).
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_MAX_TOKENS?: number;
  SILICONFLOW_API_KEY?: string;
  SILICONFLOW_BASE_URL?: string;
  SILICONFLOW_MODEL?: string;
  SILICONFLOW_MAX_TOKENS?: number;
  ALLOWED_ORIGINS?: string;
  // Path-token gate for the writer's-desk admin surface (/{AUTH_TOKEN}/api/oc/...) — a secret
  // distinct from the Bearer owner/companion tokens above, matching production's own separate
  // AUTH_TOKEN for this namespace.
  AUTH_TOKEN?: string;
}

const JSON_LIMIT = 32 * 1024;
// Prose-bearing admin routes (study entries, chapters, blocks, lore, core memory, floor edits)
// carry long free text; 256KiB keeps DoS bounded without rejecting legitimate saves.
const PROSE_LIMIT = 256 * 1024;
// Desk preset/settings/world/regex imports can be sizeable ST export files; the tiny-body cap
// below is for parameter-only writes where a legitimate body should never approach it.
const DESK_BODY_MAX = 10 * 1024 * 1024;
const DESK_TINY_BODY_MAX = 1024;

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const allowed = new Set((env.ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean));
  if (!allowed.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request: Request, env: Env, body: unknown, status = 200): Response {
  const headers = new Headers(corsHeaders(request, env));
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJson(request: Request): Promise<any> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > JSON_LIMIT) throw new Error('REQUEST_TOO_LARGE');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > JSON_LIMIT) throw new Error('REQUEST_TOO_LARGE');
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('INVALID_JSON');
  }
}

// Streaming body-size gate shared by the desk import/dryrun endpoints: counts bytes as they
// arrive instead of trusting Content-Length alone, so a chunked request can't sneak past the
// cap. opts.emptyBody lets parameter-only endpoints treat a zero-length body as `{}` instead of
// rejecting it, without loosening the cap for anyone else.
async function deskReadJsonLimited(
  request: Request,
  opts: { maxBytes?: number; emptyBody?: 'reject' | 'as-empty-object' } = {},
): Promise<{ body: any } | { resp: Response }> {
  const max = opts.maxBytes ?? DESK_BODY_MAX;
  const overLabel = max >= 1024 * 1024 ? `${Math.round(max / (1024 * 1024))}MB` : `${max} bytes`;
  const emptyOk = opts.emptyBody === 'as-empty-object';
  const lenHeader = request.headers.get('content-length');
  if (lenHeader !== null) {
    const len = Number(lenHeader);
    if (!Number.isFinite(len) || len < 0) return { resp: new Response(JSON.stringify({ success: false, error: 'invalid Content-Length' }), { status: 400 }) };
    if (len > max) return { resp: new Response(JSON.stringify({ success: false, error: `request body exceeds ${overLabel}` }), { status: 413 }) };
  }
  if (!request.body) return emptyOk ? { body: {} } : { resp: new Response(JSON.stringify({ success: false, error: 'request body is empty' }), { status: 400 }) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* cancel failing does not change the rejection */ }
      return { resp: new Response(JSON.stringify({ success: false, error: `request body exceeds ${overLabel}` }), { status: 413 }) };
    }
    chunks.push(value);
  }
  if (total === 0 && emptyOk) return { body: {} };
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return { body: JSON.parse(new TextDecoder().decode(buf)) };
  } catch {
    return { resp: new Response(JSON.stringify({ success: false, error: 'request body is not valid JSON' }), { status: 400 }) };
  }
}

function requireScope(
  request: Request,
  env: Env,
  auth: AuthContext | null,
  scope: Scope,
): Response | null {
  if (!auth) {
    const response = json(request, env, { error: 'unauthorized' }, 401);
    response.headers.set('WWW-Authenticate', 'Bearer');
    return response;
  }
  if (!hasScope(auth, scope)) return json(request, env, { error: 'forbidden' }, 403);
  return null;
}

function readingService(env: Env): ReadingService {
  return new ReadingService(new D1ReadingStorage(env.OC_DB));
}

// Shared by /api/oc/desk/chat and /api/oc/desk/dryrun — both feed assembleDesk (chat/deskAssemble.ts),
// which only accepts already-constructed storage adapters (no reverse import into this directory).
function deskAssemblyStorage(env: Env): { deskAssets: D1DeskAssetStorage; deskStory: D1DeskStoryStorage; semantic?: SemanticSearchAdapter } {
  return {
    deskAssets: new D1DeskAssetStorage(env.OC_DB),
    deskStory: new D1DeskStoryStorage(env.OC_DB),
    semantic: env.OC_VECTORIZE && env.AI ? new VectorizeSemanticSearch(env.OC_VECTORIZE, env.AI) : undefined,
  };
}

// ===== 供应商配置行(网页端 GET /provider-config 与 PUT 响应共用同一 shape)=====
// 覆盖全部"已配置"供应商:注册表项(override 有 → source:'override',否则 env 有配置 → source:'env')
// + custom:* 自定义项(source:'override')。key 的取值 = override 优先于 env(merged 已折叠),便于
// 返回 apiKeyTail 而不泄露整把 key。
interface ProviderConfigRow {
  id: string;
  name: string;
  protocol: 'openai' | 'anthropic' | 'responses';
  source: 'override' | 'env';
  hasApiKey: boolean;
  apiKeyTail: string;
  baseUrl: string | null;
  model: string | null;
  maxTokens: number | null;
}

function providerConfigRows(env: DeskBackendEnv, overrides: ProviderOverride[]): ProviderConfigRow[] {
  const merged = mergeProviderEnv(env, overrides);
  const rows: ProviderConfigRow[] = [];
  for (const def of DESK_PROVIDER_DEFS) {
    const o = overrides.find((x) => x.id === def.id);
    const configured = o ? true : deskProviderConfigured(merged, def);
    if (!configured) continue;
    const key = merged[`${def.prefix}_API_KEY`];
    const realKey = key !== undefined && key !== null && !isPlaceholderKey(String(key)) ? String(key) : '';
    rows.push({
      id: def.id,
      name: def.name,
      protocol: def.protocol,
      source: o ? 'override' : 'env',
      hasApiKey: !!realKey,
      apiKeyTail: realKey ? realKey.slice(-4) : '',
      baseUrl: merged[`${def.prefix}_BASE_URL`] || null,
      model: merged[`${def.prefix}_MODEL`] || null,
      maxTokens: merged[`${def.prefix}_MAX_TOKENS`] ?? null,
    });
  }
  for (const o of overrides) {
    if (!o.id.startsWith('custom:')) continue;
    rows.push({
      id: o.id,
      name: o.name || o.id,
      protocol: o.protocol || 'openai',
      source: 'override',
      hasApiKey: !!o.apiKey,
      apiKeyTail: o.apiKey ? String(o.apiKey).slice(-4) : '',
      baseUrl: o.baseUrl || null,
      model: o.model || null,
      maxTokens: o.maxTokens ?? null,
    });
  }
  return rows;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function enforceCommentRate(request: Request, env: Env, auth: AuthContext): Promise<boolean> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await sha256(`${auth.actorId}:${ip}:${env.OWNER_TOKEN}`);
  const now = new Date();
  const bucket = now.toISOString().slice(0, 16);
  const updatedAt = now.toISOString();
  const claim = (dimension: 'actor' | 'ip', subject: string) => env.OC_DB.prepare(
    `INSERT INTO comment_rate_buckets (dimension, subject, minute_bucket, request_count, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(dimension, subject, minute_bucket) DO UPDATE SET
       request_count = request_count + 1,
       updated_at = excluded.updated_at`,
  ).bind(dimension, subject, bucket, updatedAt);
  try {
    await env.OC_DB.batch([
      claim('actor', auth.actorId),
      claim('ip', ipHash),
      env.OC_DB.prepare(`DELETE FROM comment_rate_buckets WHERE minute_bucket < ?`).bind(
        new Date(now.getTime() - 10 * 60_000).toISOString().slice(0, 16),
      ),
    ]);
    return true;
  } catch (error) {
    if (String(error).includes('comment_rate_limited')) return false;
    throw error;
  }
}

async function createComment(request: Request, env: Env, auth: AuthContext, input: any): Promise<Response> {
  const content = boundedString(input?.content, 2000);
  const replyTo = input?.reply_to === undefined ? undefined : boundedString(input.reply_to, 80);
  if (!content?.trim() || (input?.reply_to !== undefined && replyTo === undefined)) {
    return json(request, env, { error: 'invalid_arguments' }, 400);
  }
  if (!(await enforceCommentRate(request, env, auth))) {
    return json(request, env, { error: 'rate_limited' }, 429);
  }
  const result = await readingService(env).createComment({
    chapterId: input.chapter_id,
    content,
    replyTo,
    author: { id: auth.actorId, type: auth.actorType, displayName: auth.displayName },
  });
  return json(request, env, result, result.success ? 201 : 400);
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

// Writer's-desk admin surface (project 1's /api/oc/* namespace). Gated by the single path-token
// check in handle() below, not by the Bearer/scope system (that system stays reserved for the
// MCP face and the companion-facing published/comments routes, untouched by this function).
// This mirrors production's own shape: the whole surface is one owner's private portal, so
// there is no per-route scope split once the token has been verified — same as production
// hardcoding the comment author rather than deriving it from a per-request identity.
async function handleDeskAdmin(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response | null> {
  // ----- study entries (the writer's private shelf; distinct from the read-only MCP shelf tool) -----
  if (url.pathname === '/api/oc/memories' && request.method === 'GET') {
    const params = {
      project: url.searchParams.has('project') ? url.searchParams.get('project') : undefined,
      category: url.searchParams.get('category') || undefined,
      tag: url.searchParams.get('tag') || undefined,
      keyword: url.searchParams.get('keyword') || undefined,
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
      order: url.searchParams.get('order') || undefined,
    };
    const r = await studyList(env as any, params);
    return json(request, env, r, r.success ? 200 : 500);
  }
  if (url.pathname === '/api/oc/memories' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body;
    const r = await studyCreate(env as any, body);
    return json(request, env, r, r.success ? 200 : 400);
  }
  if (url.pathname.startsWith('/api/oc/memories/')) {
    const id = url.pathname.slice('/api/oc/memories/'.length);
    if (!id) return json(request, env, { success: false, error: 'missing id' }, 400);
    if (request.method === 'GET') {
      const r = await studyGet(env as any, id);
      return json(request, env, r, r.success ? 200 : 404);
    }
    if (request.method === 'PUT') {
      const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
      if ('resp' in read) return read.resp;
      const body = read.body;
      const r = await studyUpdate(env as any, id, body);
      return json(request, env, r, r.success ? 200 : (r.error === 'Study entry not found.' ? 404 : 400));
    }
    if (request.method === 'DELETE') {
      const r = await studyDelete(env as any, id);
      return json(request, env, r, r.success ? 200 : (r.error === 'Study entry not found.' ? 404 : 400));
    }
    return json(request, env, { success: false, error: 'not_found' }, 404);
  }
  if (url.pathname === '/api/oc/search' && request.method === 'GET') {
    const q = url.searchParams.get('q');
    if (!q) return json(request, env, { success: false, error: 'q is required' }, 400);
    const r = await studySearch(env as any, {
      q, project: url.searchParams.get('project') || undefined,
      category: url.searchParams.get('category') || undefined,
      limit: url.searchParams.get('topK') ? Number(url.searchParams.get('topK')) : undefined,
    });
    return json(request, env, r, r.success ? 200 : 500);
  }
  if (url.pathname === '/api/oc/stats' && request.method === 'GET') {
    // One read-path implementation: StudyService.stats() is the same aggregate the MCP shelf
    // tool's stats action serves (src/mcp/server.ts), not a second copy of the grouping logic.
    const r = await new StudyService(new D1StudyStorage(env.OC_DB)).stats();
    return json(request, env, r, r.success ? 200 : 500);
  }
  if (url.pathname === '/api/oc/backfill-vectors' && request.method === 'POST') {
    const r = await studyBackfill(env as any);
    return json(request, env, r, r.success ? 200 : 500);
  }

  // ----- chapters and comments -----
  if (url.pathname === '/api/oc/chapters' && request.method === 'GET') {
    const r = await chaptersList(env as any, {
      project: url.searchParams.get('project') || undefined,
      status: url.searchParams.get('status') || undefined,
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
    });
    return json(request, env, r, r.success ? 200 : 500);
  }
  if (url.pathname === '/api/oc/chapters' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body;
    const r = await chapterCreate(env as any, body);
    return json(request, env, r, r.success ? 200 : 400);
  }
  if (url.pathname === '/api/oc/chapters/export' && request.method === 'GET') {
    const project = (url.searchParams.get('project') || '').trim();
    const r = await chaptersExport(env as any, { project });
    if (!r.success) return json(request, env, r, r.error === '缺 project' ? 400 : 500);
    // 裸 Response 也要带 CORS 头(跟下方 deskRecipeExport 同一个下载身位),否则跨域下载会被浏览器拦
    const headers = new Headers(corsHeaders(request, env));
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    headers.set('Content-Disposition', `attachment; filename="${r.filename}"; filename*=UTF-8''${encodeURIComponent(r.filename)}`);
    headers.set('Cache-Control', 'no-store');
    return new Response(r.text, { status: 200, headers });
  }
  if (url.pathname.startsWith('/api/oc/chapters/')) {
    const rest = url.pathname.slice('/api/oc/chapters/'.length);
    const [id, action] = rest.split('/');
    if (!id) return json(request, env, { success: false, error: 'missing id' }, 400);
    if (action === 'publish' && request.method === 'POST') {
      const r = await chapterPublish(env as any, id);
      return json(request, env, r, r.success ? 200 : 404);
    }
    if (action === 'unpublish' && request.method === 'POST') {
      const r = await chapterUnpublish(env as any, id);
      return json(request, env, r, r.success ? 200 : 404);
    }
    if (action === 'restore' && request.method === 'POST') {
      const r = await chapterRestore(env as any, id);
      return json(request, env, r, r.success ? 200 : 404);
    }
    if (action === 'delete-permanent' && request.method === 'POST') {
      const r = await chapterDeletePermanent(env as any, id);
      return json(request, env, r, r.success ? 200 : 404);
    }
    if (action) return json(request, env, { success: false, error: 'not_found' }, 404);
    if (request.method === 'GET') {
      const r = await chapterGet(env as any, id);
      return json(request, env, r, r.success ? 200 : 404);
    }
    if (request.method === 'PUT') {
      const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
      if ('resp' in read) return read.resp;
      const body = read.body;
      const r = await chapterUpdate(env as any, id, body);
      return json(request, env, r, r.success ? 200 : (r.error === 'Chapter not found.' ? 404 : 400));
    }
    if (request.method === 'DELETE') {
      const r = await chapterDelete(env as any, id);
      return json(request, env, r, r.success ? 200 : 404);
    }
    return json(request, env, { success: false, error: 'not_found' }, 404);
  }
  if (url.pathname === '/api/oc/comments' && request.method === 'GET') {
    const chapterId = url.searchParams.get('chapter_id');
    if (!chapterId) return json(request, env, { success: false, error: 'chapter_id is required' }, 400);
    const r = await commentsList(env as any, { chapter_id: chapterId, limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined });
    return json(request, env, r, r.success ? 200 : 500);
  }
  if (url.pathname === '/api/oc/comments' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body;
    // This whole surface is the owner's own portal (see handleDeskAdmin's header comment) — the
    // author is hardcoded, not derived from a per-request identity, exactly like production
    // hardcoding its REST comment author. Request-body author fields (if any) are ignored.
    const r = await commentPost(env as any, { chapter_id: body.chapter_id, content: body.content, reply_to: body.reply_to }, { authorId: 'owner', authorType: 'owner', displayName: 'Owner' });
    return json(request, env, r, r.success ? 200 : 400);
  }
  if (url.pathname.startsWith('/api/oc/comments/') && request.method === 'DELETE') {
    const id = url.pathname.slice('/api/oc/comments/'.length);
    if (!id) return json(request, env, { success: false, error: 'missing id' }, 400);
    const r = await commentDelete(env as any, id);
    return json(request, env, r, r.success ? 200 : 404);
  }

  // ----- desk import (preset / settings / worlds / regex bundle) -----
  if (url.pathname === '/api/oc/desk/import/preset' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request);
    if ('resp' in read) return read.resp;
    const name = url.searchParams.get('name') || undefined;
    const r = await deskImportPreset(env as any, read.body, name);
    return json(request, env, r, r.success ? 200 : (r.server === true ? 500 : 400));
  }
  if (url.pathname === '/api/oc/desk/import/settings' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request);
    if ('resp' in read) return read.resp;
    const r = await deskImportSettings(env as any, read.body);
    return json(request, env, r, r.success ? 200 : (r.server === true ? 500 : 400));
  }
  if (url.pathname === '/api/oc/desk/import/worlds' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request);
    if ('resp' in read) return read.resp;
    const r = await deskImportWorlds(env as any, read.body);
    return json(request, env, r, r.success ? 200 : (r.server === true ? 500 : 400));
  }
  if (url.pathname === '/api/oc/desk/import/regex' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request);
    if ('resp' in read) return read.resp;
    const targetPresetId = url.searchParams.get('target_preset_id') || undefined;
    const r = await deskImportRegexBundle(env as any, read.body, targetPresetId);
    return json(request, env, r, r.success ? 200 : (r.server === true ? 500 : 400));
  }
  if (url.pathname === '/api/oc/desk/import/card' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request);
    if ('resp' in read) return read.resp;
    const body = read.body;
    // 只吃JSON——PNG里挑出内嵌角色卡数据是前端的事(读tEXt chunk),这个端点收到的永远是解出来
    // 之后的卡JSON对象,跟其余三口"整份ST导出文件"同一个身位(JSON进JSON出,不碰二进制)。
    const parsed = parseCharacterCard(body && typeof body === 'object' ? (body as any).card : undefined);
    if (!parsed.ok) return json(request, env, { success: false, error: parsed.error }, 400);
    const projectRaw = body && typeof body === 'object' ? (body as any).project : undefined;
    const r = await importCharacterCard(env as any, parsed.card, projectRaw);
    if (r.success) r.warnings = [...parsed.warnings, ...(Array.isArray(r.warnings) ? r.warnings : [])];
    return json(request, env, r, r.success ? 200 : (r.server === true ? 500 : 400));
  }
  // 聊天记录 JSONL 导入——长聊天文件可能超 DESK_BODY_MAX(10MB),单独放宽到 32MB。
  if (url.pathname === '/api/oc/desk/import/chat' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request, { maxBytes: 32 * 1024 * 1024 });
    if ('resp' in read) return read.resp;
    const r = await deskImportChat(env as any, read.body);
    return json(request, env, r, r.success ? 200 : (r.server === true ? 500 : 400));
  }

  // ----- preset packs and their blocks -----
  if (url.pathname === '/api/oc/desk/presets' && request.method === 'GET') {
    const r = await deskListPresets(env as any);
    return json(request, env, r, r.success ? 200 : 500);
  }
  if (url.pathname.startsWith('/api/oc/desk/presets/') && url.pathname.endsWith('/blocks') && request.method === 'GET') {
    const rest = url.pathname.slice('/api/oc/desk/presets/'.length);
    const id = rest.slice(0, -'/blocks'.length);
    const r = await deskPresetBlocks(env as any, id, url.searchParams.get('full') === '1');
    return json(request, env, r, r.success ? 200 : (r.error === 'Preset pack not found.' ? 404 : 400));
  }
  if (url.pathname.startsWith('/api/oc/desk/blocks/') && request.method === 'PUT') {
    let id = '';
    try { id = decodeURIComponent(url.pathname.slice('/api/oc/desk/blocks/'.length)); }
    catch { return json(request, env, { success: false, error: 'block id is not valid URL encoding' }, 400); }
    const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body;
    const r = await deskBlockUpdate(env as any, id, body);
    return json(request, env, r, r.success ? 200 : (r.error === 'Block not found.' ? 404 : (r.server ? 500 : 400)));
  }
  if (url.pathname.startsWith('/api/oc/desk/presets/') && request.method === 'DELETE') {
    const id = url.pathname.slice('/api/oc/desk/presets/'.length);
    if (!id) return json(request, env, { success: false, error: 'missing id' }, 400);
    const r = await deskPresetDelete(env as any, id);
    return json(request, env, r, r.success ? 200 : (r.error === 'Preset pack not found.' ? 404 : (r.server === true ? 500 : 400)));
  }

  // ----- global/preset regex -----
  if (url.pathname === '/api/oc/desk/regex' && request.method === 'GET') {
    const r = await deskListRegex(env as any, { scope: url.searchParams.get('scope') || undefined, preset_id: url.searchParams.get('preset_id') || undefined });
    return json(request, env, r, r.success ? 200 : 500);
  }
  if (url.pathname === '/api/oc/desk/regex/reorder' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body;
    const r = await deskRegexReorder(env as any, body);
    return json(request, env, r, r.success ? 200 : 400);
  }
  if (url.pathname.startsWith('/api/oc/desk/regex/')) {
    const id = url.pathname.slice('/api/oc/desk/regex/'.length);
    if (!id) return json(request, env, { success: false, error: 'missing id' }, 400);
    if (request.method === 'PUT') {
      const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
      if ('resp' in read) return read.resp;
      const body = read.body;
      const r = await deskRegexUpdate(env as any, id, body);
      return json(request, env, r, r.success ? 200 : (r.error === 'Regex rule not found.' ? 404 : 400));
    }
    if (request.method === 'DELETE') {
      const r = await deskRegexDelete(env as any, id);
      return json(request, env, r, r.success ? 200 : 404);
    }
    return json(request, env, { success: false, error: 'not_found' }, 404);
  }

  // ----- world/character lore -----
  if (url.pathname === '/api/oc/desk/lore' && request.method === 'GET') {
    const r = await deskLoreList(env as any, { project: url.searchParams.get('project') || undefined });
    return json(request, env, r, r.success ? 200 : (r.error === 'project is required.' ? 400 : 500));
  }
  if (url.pathname === '/api/oc/desk/lore' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body;
    const r = await deskLoreCreate(env as any, body);
    return json(request, env, r, r.success ? 200 : 400);
  }
  if (url.pathname.startsWith('/api/oc/desk/lore/')) {
    const id = url.pathname.slice('/api/oc/desk/lore/'.length);
    if (!id) return json(request, env, { success: false, error: 'missing id' }, 400);
    if (request.method === 'PUT') {
      const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
      if ('resp' in read) return read.resp;
      const body = read.body;
      const r = await deskLoreUpdate(env as any, id, body);
      return json(request, env, r, r.success ? 200 : (r.error === 'Lore entry not found.' ? 404 : 400));
    }
    if (request.method === 'DELETE') {
      const r = await deskLoreDelete(env as any, id);
      return json(request, env, r, r.success ? 200 : 400);
    }
    return json(request, env, { success: false, error: 'not_found' }, 404);
  }

  // ----- per-project core memory and recall settings -----
  if (url.pathname === '/api/oc/desk/core' && request.method === 'GET') {
    const r = await deskCoreGet(env as any, (url.searchParams.get('project') || '').trim());
    return json(request, env, r, r.success ? 200 : (r.error === 'project is required.' ? 400 : 500));
  }
  if (url.pathname === '/api/oc/desk/core' && request.method === 'PUT') {
    const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body;
    const r = await deskCoreUpdate(env as any, body);
    return json(request, env, r, r.success ? 200 : 400);
  }
  if (url.pathname === '/api/oc/desk/recall' && request.method === 'GET') {
    const r = await deskRecallGet(env as any, (url.searchParams.get('project') || '').trim());
    return json(request, env, r, r.success ? 200 : (r.error === 'project is required.' ? 400 : 500));
  }
  if (url.pathname === '/api/oc/desk/recall' && request.method === 'PUT') {
    const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body;
    const r = await deskRecallUpdate(env as any, body);
    return json(request, env, r, r.success ? 200 : 400);
  }

  // ----- 打字桌记忆模块（DeskMemoryStorage：记忆条目 + Compact 回退快照）-----
  // 跨角色重构（task-10）：记忆作用域 = 项目×charKey + 分层(layer)。window_id 兼容为溯源查询。
  const memoryStore = () => new D1DeskMemoryStorage(env.OC_DB);
  const memId = () => `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const snapId = () => `snap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  // 作用域解析：project 必填；char_key 缺省 ''=共享区；layer 可选。
  const scopeOf = (query: URLSearchParams | Record<string, unknown>) => {
    const project = (query instanceof URLSearchParams ? query.get('project') || '' : (query.project ?? '')) as string;
    const charKey = (query instanceof URLSearchParams ? query.get('char_key') || '' : (query.char_key ?? '')) as string;
    const layer = (query instanceof URLSearchParams ? query.get('layer') || '' : (query.layer ?? '')) as string;
    return {
      project: project.trim(),
      charKey: typeof charKey === 'string' ? charKey.trim() : '',
      layer: (layer === 'anchor' || layer === 'general' || layer === 'plot') ? (layer as 'anchor' | 'general' | 'plot') : undefined,
    };
  };
  // 由 window_id 反查 project（兼容旧式单窗 API）。
  async function projectOfWindow(windowId: string): Promise<string | null> {
    if (!windowId) return null;
    const w = await env.OC_DB.prepare(`SELECT project FROM desk_windows WHERE id = ?`).bind(windowId).first<any>();
    return w ? String(w.project) : null;
  }
  // 顶层 GET/POST /memories
  if (url.pathname === '/api/oc/desk/memories' && request.method === 'GET') {
    const store = memoryStore();
    const windowId = (url.searchParams.get('window_id') || '').trim();
    if (windowId) {
      // 兼容旧式：该窗溯源记忆
      const rows = await store.listMemories(windowId);
      return json(request, env, { success: true, memories: rows });
    }
    const scope = scopeOf(url.searchParams);
    if (!scope.project) return json(request, env, { success: false, error: 'project 或 window_id 必填' }, 400);
    const rows = await store.listByScope({ project: scope.project, charKey: scope.charKey, layer: scope.layer });
    return json(request, env, { success: true, memories: rows, scopeName: scope.charKey ? 'char' : 'shared', charKey: scope.charKey });
  }
  if (url.pathname === '/api/oc/desk/memories' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(request, env, { success: false, error: 'request body must be a JSON object' }, 400);
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return json(request, env, { success: false, error: 'content 必填' }, 400);
    const store = memoryStore();
    const now = new Date().toISOString();
    // 作用域：优先 project(+char_key/layer)；兼容旧 body { window_id, ... } → project 由窗反查、char_key=''。
    let project = typeof body.project === 'string' ? body.project.trim() : '';
    let charKey = typeof body.char_key === 'string' ? body.char_key.trim() : '';
    const windowId = typeof body.window_id === 'string' ? body.window_id.trim() : '';
    if (!project) {
      if (!windowId) return json(request, env, { success: false, error: 'project 或 window_id 必填' }, 400);
      const p = await projectOfWindow(windowId);
      if (!p) return json(request, env, { success: false, error: '写作窗不存在' }, 404);
      project = p;
      if (!charKey && windowId) {
        const w = await env.OC_DB.prepare(`SELECT char_key FROM desk_windows WHERE id = ?`).bind(windowId).first<any>();
        charKey = w && w.char_key ? String(w.char_key) : '';
      }
    }
    const memory = {
      id: memId(),
      windowId,
      project,
      charKey,
      layer: normalizeLayer(body.layer),
      theme: normalizeTheme(body.theme),
      title: typeof body.title === 'string' ? body.title.trim() : '',
      content,
      createdAt: now,
      updatedAt: now,
    };
    await store.createMemory(memory);
    return json(request, env, { success: true, memory }, 201);
  }
  if (url.pathname.startsWith('/api/oc/desk/memories/')) {
    const rest = url.pathname.slice('/api/oc/desk/memories/'.length);
    // 作用域盘点：列出项目内共享区 + 各角色区及其条数
    if (rest === 'scopes' && request.method === 'GET') {
      const project = (url.searchParams.get('project') || '').trim();
      if (!project) return json(request, env, { success: false, error: 'project 必填' }, 400);
      const rows = await env.OC_DB.prepare(`SELECT char_key, COUNT(*) AS c FROM desk_memories WHERE project = ? GROUP BY char_key`).bind(project).all<any>();
      const byKey = new Map<string, number>();
      for (const r of (rows.results || [])) byKey.set(String(r.char_key || ''), Number(r.c));
      const scopes: Array<{ scope: 'char' | 'shared'; charKey: string; count: number }> = [];
      scopes.push({ scope: 'shared', charKey: '', count: byKey.get('') || 0 });
      for (const [k, v] of byKey) if (k) scopes.push({ scope: 'char', charKey: k, count: v });
      return json(request, env, { success: true, scopes });
    }
    // 手动总结：角色级 / 项目级批量
    if (rest === 'summarize' && request.method === 'POST') {
      const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT, emptyBody: 'as-empty-object' });
      if ('resp' in read) return read.resp;
      const body = read.body && typeof read.body === 'object' && !Array.isArray(read.body) ? read.body : {};
      const project = typeof body.project === 'string' ? body.project.trim() : '';
      if (!project) return json(request, env, { success: false, error: 'project 必填' }, 400);
      const charKey = typeof body.char_key === 'string' ? body.char_key.trim() : '';
      const layer = body.layer === 'anchor' ? 'anchor' as const : undefined;
      const windowLimit = typeof body.window_limit === 'number' ? body.window_limit : 20;
      const overrides = await new D1ProviderConfigStore(env.OC_DB).list();
      const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
      const storage: DeskChatStorage = { deskStorage: new D1DeskStorage(env.OC_DB), turnStorage: new D1DeskTurnStorage(env.OC_DB), ...deskAssemblyStorage(env), memory: memoryStore() };
      const r = await runMemorySummarize(env as any, storage, { project, charKey, layer, windowLimit }, provider, overrides);
      if ('error' in r) return json(request, env, { success: false, error: r.error }, 500);
      return json(request, env, { success: true, ...r });
    }
    // 人设锚定区口（layer=anchor 专属路由；等价 GET 带 layer=anchor / POST 带 layer=anchor）
    if (rest === 'anchors' && request.method === 'GET') {
      const scope = scopeOf(url.searchParams);
      if (!scope.project) return json(request, env, { success: false, error: 'project 必填' }, 400);
      const rows = await memoryStore().listByScope({ project: scope.project, charKey: scope.charKey, layer: 'anchor' });
      return json(request, env, { success: true, anchors: rows });
    }
    if (rest === 'anchors' && request.method === 'POST') {
      const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
      if ('resp' in read) return read.resp;
      const body = read.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(request, env, { success: false, error: 'request body must be a JSON object' }, 400);
      const project = typeof body.project === 'string' ? body.project.trim() : '';
      if (!project) return json(request, env, { success: false, error: 'project 必填' }, 400);
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      if (!content) return json(request, env, { success: false, error: 'content 必填' }, 400);
      const charKey = typeof body.char_key === 'string' ? body.char_key.trim() : '';
      const now = new Date().toISOString();
      await memoryStore().createMemory({ id: memId(), windowId: typeof body.window_id === 'string' ? body.window_id.trim() : '', project, charKey, layer: 'anchor', theme: normalizeTheme(body.theme), title: typeof body.title === 'string' ? body.title.trim() : '', content, createdAt: now, updatedAt: now });
      return json(request, env, { success: true }, 201);
    }
    // Compact：整体压缩 + 压缩前快照（可回退）。作用域或单窗兼容。
    if (rest === 'compact' && request.method === 'POST') {
      const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT, emptyBody: 'as-empty-object' });
      if ('resp' in read) return read.resp;
      const body = read.body && typeof read.body === 'object' && !Array.isArray(read.body) ? read.body : {};
      const store = memoryStore();
      const now = new Date().toISOString();
      const snapTitle = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : `压缩 ${now}`;
      const windowId = typeof body.window_id === 'string' ? body.window_id.trim() : '';
      let before: DeskMemory[];
      let scopeRef: { project: string; charKey: string };
      if (windowId) {
        // 兼容旧式：按窗压缩（该窗溯源记忆全部层）
        before = await store.listMemories(windowId);
        const p = await projectOfWindow(windowId);
        scopeRef = { project: p || '', charKey: '' };
      } else {
        const scope = scopeOf(body);
        if (!scope.project) return json(request, env, { success: false, error: 'project 或 window_id 必填' }, 400);
        before = await store.listByScope({ project: scope.project, charKey: scope.charKey, layer: scope.layer });
        scopeRef = { project: scope.project, charKey: scope.charKey };
      }
      // 快照按作用域落（含层标记）
      await store.createSnapshot({ id: snapId(), windowId, project: scopeRef.project, charKey: scopeRef.charKey, title: snapTitle, data: before, createdAt: now });
      const { next, removed, merged } = compactMemories(before);
      // 既保留既有 anchor（compact 已排序前置），非 anchor 重建；锚绝不在此被删。
      const anchors = before.filter((m) => m.layer === 'anchor');
      const anchorIds = new Set(anchors.map((m) => m.id));
      const nonAnchor = next.filter((m) => !anchorIds.has(m.id));
      if (windowId) {
        // 兼容旧式（按窗）：先清该窗全部，再逐条重建（含 anchor），无重复且锚不丢。
        await store.truncateMemories(windowId);
        for (const m of nonAnchor) await store.createMemory({ ...m, project: scopeRef.project, charKey: scopeRef.charKey, updatedAt: m.updatedAt || now });
        for (const m of anchors) await store.createMemory({ ...m, updatedAt: m.updatedAt || now });
      } else {
        // 作用域路径：只用 replaceScope 写入一次（其内部处理 anchor 守卫），不重复 createMemory，避免主键冲突。
        await store.replaceScope({ project: scopeRef.project, charKey: scopeRef.charKey, memories: [...anchors, ...nonAnchor] });
      }
      const after = windowId ? await store.listMemories(windowId) : await store.listByScope({ project: scopeRef.project, charKey: scopeRef.charKey });
      return json(request, env, { success: true, memories: after, removed: removed.length, merged });
    }
    // 快照列表 / 回退
    if (rest === 'snapshots' && request.method === 'GET') {
      const windowId = (url.searchParams.get('window_id') || '').trim();
      const store = memoryStore();
      const rows = windowId
        ? await store.listSnapshots(windowId)
        : ((() => { const s = scopeOf(url.searchParams); return s.project ? store.listSnapshotsByScope(s.project, s.charKey) : Promise.resolve([]); })());
      return json(request, env, {
        success: true,
        snapshots: (await rows).map((s) => ({ id: s.id, windowId: s.windowId, project: s.project, charKey: s.charKey, title: s.title, memoryCount: s.data.length, createdAt: s.createdAt })),
      });
    }
    if (rest.startsWith('snapshots/') && rest.endsWith('/restore') && request.method === 'POST') {
      const snapId = rest.slice('snapshots/'.length, -'/restore'.length);
      if (!snapId) return json(request, env, { success: false, error: 'snapshot id 必填' }, 400);
      const restored = await memoryStore().restoreSnapshot(snapId);
      if (!restored) return json(request, env, { success: false, error: '快照不存在' }, 404);
      return json(request, env, { success: true, memories: restored });
    }
    if (!rest || rest === 'compact' || rest === 'snapshots' || rest === 'scopes' || rest === 'summarize' || rest === 'anchors' || rest.endsWith('/compact') || rest.endsWith('/restore')) return json(request, env, { success: false, error: 'not_found' }, 404);
    const id = rest;
    if (request.method === 'PUT') {
      const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
      if ('resp' in read) return read.resp;
      const body = read.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(request, env, { success: false, error: 'request body must be a JSON object' }, 400);
      const patch: any = {};
      if (body.theme !== undefined) patch.theme = normalizeTheme(body.theme);
      if (body.title !== undefined) patch.title = body.title;
      if (body.content !== undefined) patch.content = body.content;
      if (body.layer !== undefined) patch.layer = normalizeLayer(body.layer);
      if (Object.keys(patch).length) {
        if (patch.content !== undefined && !String(patch.content).trim()) return json(request, env, { success: false, error: 'content 不能为空' }, 400);
        patch.updatedAt = new Date().toISOString();
      }
      const updated = await memoryStore().updateMemory(id, patch);
      if (!updated) return json(request, env, { success: false, error: '记忆条目不存在' }, 404);
      return json(request, env, { success: true, memory: updated });
    }
    if (request.method === 'DELETE') {
      const ok = await memoryStore().deleteMemory(id);
      if (!ok) return json(request, env, { success: false, error: '记忆条目不存在' }, 404);
      return json(request, env, { success: true });
    }
    return json(request, env, { success: false, error: 'not_found' }, 404);
  }


    // ----- 日记自动生成（照抄妹居 dirty.md + docs/diary-prompt-template.md 过程还原） -----
    if (url.pathname === '/api/oc/diary/auto' && request.method === 'POST') {
      const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
      if ('resp' in read) return read.resp;
      const body: any = read.body;
      const project = typeof body.project === 'string' ? body.project.trim() : '';
      const charKey = typeof body.charKey === 'string' ? body.charKey.trim() : '';
      const conversation = Array.isArray(body.conversation) ? body.conversation : [];
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId : (typeof body.conversation_id === 'string' ? body.conversation_id : '');
      let characterName = typeof body.characterName === 'string' && body.characterName.trim() ? body.characterName.trim() : (charKey || '');
      let personality = typeof body.personality === 'string' ? body.personality : '';
      let affectionLevel = typeof body.affectionLevel === 'string' ? body.affectionLevel : '';
      const userLabel = typeof body.userLabel === 'string' ? body.userLabel.trim() : (typeof body.user_label === 'string' ? body.user_label.trim() : '');
      // 若前端没传 personality/characterName，尝试按 charKey 从角色卡（memories lore）里回填，避免“有希/Yuki”硬编码兜底
      if (charKey && (!personality || !characterName)) {
        try {
          const loreRows = await new D1DeskAssetStorage(env.OC_DB).listLore(project);
          const hit = loreRows.find((r) => r.name === charKey || r.name === characterName) || loreRows.find((r) => r.isCharacter && r.name) || null;
          if (hit) {
            if (!characterName) characterName = hit.name || charKey;
            if (!personality) {
              const f = (hit.fields || {}) as any;
              const parts = [f.personality, f.description, hit.content].filter((s: any) => typeof s === 'string' && s.trim());
              personality = parts.join(' / ').slice(0, 400);
            }
          }
        } catch {}
      }
      if (!characterName) characterName = charKey || 'TA';
      // 未成年护栏：charKey 含 kindergarten/幼龄 或显式 isAdult=false 则强制 false
      const rawIsAdult = body.isAdult;
      const isAdult = rawIsAdult === false ? false : (rawIsAdult === true ? true : !/kindergarten|幼|未成年|8岁/i.test(charKey + characterName));
      const rawDate = typeof body.date === 'string' ? body.date.trim() : '';
      const dateOverride = normalizeDiaryDate(rawDate);
      const date = dateOverride || todayDiaryDate();
      const time = typeof body.time === 'string' && body.time.trim() ? body.time.trim().slice(0, 24) : diaryTimeNow();
      const allowMulti = body.allowMulti === true;
      const floorIds = Array.isArray(body.floorIds) ? (body.floorIds as any[]).filter((x: any) => typeof x === 'string' && String(x).trim()).map((x: any) => String(x).trim()).slice(0, 50) : [];
      const windowIdForCoverage = conversationId || (typeof body.windowId === 'string' ? String(body.windowId).trim() : '') || '';
      // 重复生成日记防护（task-22）：生成前检验是否已到目标日期且已写过，避免无新数据时复用老对话重复落库
      try {
        const existing = await env.OC_DB.prepare(`SELECT id FROM diaries WHERE project = ? AND char_key = ? AND date = ? LIMIT 1`).bind(project, charKey, date).first<any>();
        if (existing) {
          if (floorIds.length && windowIdForCoverage) {
            const cov = await env.OC_DB.prepare(`SELECT id FROM diary_coverage WHERE window_id = ? AND floor_start = ? AND floor_end = ? LIMIT 1`).bind(windowIdForCoverage, floorIds[0], floorIds[floorIds.length - 1]).first<any>().catch(() => null);
            if (cov) {
              return json(request, env, { success: false, error: '该对话段已生成过日记（避免重复）', duplicate: true }, 409);
            }
          }
          const isEmptyConversation = !conversation.length || conversation.every((m: any) => !String(m.content || '').trim());
          if (isEmptyConversation && !floorIds.length) {
            return json(request, env, { success: false, error: '今日日记已存在且无新对话数据，避免重复生成', duplicate: true }, 409);
          }
          if (!allowMulti && !floorIds.length) {
            return json(request, env, { success: false, error: '该日期日记已存在（同角色同日期仅一篇）', duplicate: true }, 409);
          }
        }
      } catch {}
      const overrides = await new D1ProviderConfigStore(env.OC_DB).list().catch(() => [] as any);
      const provider = typeof body.provider === 'string' && body.provider ? body.provider : undefined;
      const hasModel = provider ? !!resolveDeskProvider(env as any, provider, overrides) : !!(env.OPENAI_API_KEY || env.OPENAI_BASE_URL !== undefined || env.ANTHROPIC_API_KEY);
      let content = '';
      let demo = false;
      if (hasModel) {
        try {
          const backend = makeDeskBackend(env as any, provider, overrides as any);
          const req = buildDiaryPrompt({ characterName, personality, affectionLevel, isAdult, date, time, conversation: conversation.map((m: any) => ({ role: String(m.role || 'assistant'), content: String(m.content || '') })), conversationId, userLabel: userLabel || undefined, allowMulti });
          const gen = await backend.streamChat({ system: req.system, prompt: req.prompt, model: provider ? (resolveDeskProvider(env as any, provider, overrides as any)?.model || 'deepseek-chat') : String((env as any).OPENAI_MODEL || 'deepseek-chat'), signal: request.signal, onEvent: undefined });
          if (gen.ok && gen.text.trim()) content = gen.text.trim();
          else demo = true;
        } catch { demo = true; }
      } else demo = true;
      // 26C aborted 不落库：若前端已终止，后端不再用 demo 兜底落库
      if (request.signal.aborted) {
        return json(request, env, { success: false, error: 'aborted', aborted: true }, 499);
      }
      if (!content) { content = demoDiary({ characterName, personality, affectionLevel, isAdult, date, time, conversation: conversation.map((m: any) => ({ role: String(m.role || 'assistant'), content: String(m.content || '') })), conversationId, userLabel: userLabel || undefined }); demo = true; }
      if (request.signal.aborted) {
        return json(request, env, { success: false, error: 'aborted', aborted: true }, 499);
      }
      // 跨天拆多篇：模型按 "---" 分隔多篇日记，逐篇落库（每篇可自带不同的书写时间，解析后覆盖 date/time）
      if (allowMulti && content.includes('---')) {
        const parts = content.split(/\n---\n/).map((s: string) => s.trim()).filter(Boolean).slice(0, 3);
        if (parts.length > 1) {
          const created: any[] = [];
          for (const part of parts) {
            if (request.signal.aborted) {
              return json(request, env, { success: false, error: 'aborted', aborted: true }, 499);
            }
            const m = part.match(/【日记书写时间为\s*([^\]]+)\s*】/);
            let d = date, t = time;
            if (m) {
              const inner = m[1].trim();
              const segs = inner.split(/\s+/);
              const nd = normalizeDiaryDate(segs[0]);
              if (nd) { d = nd; if (segs.length > 1) t = segs.slice(1).join(' ').slice(0, 24); }
            }
            const rr = await diaryCreate(env as any, { project, charKey, date: d, time: t, title: body.title || '', content: part, affection: body.affection ?? null, conversationId, conversationLength: conversation.length });
            if (rr.success) {
              created.push(rr.diary);
              if (floorIds.length) {
                try { await env.OC_DB.prepare(`INSERT INTO diary_coverage (id, diary_id, project, char_key, window_id, floor_start, floor_end, floor_count) VALUES (?,?,?,?,?,?,?,?)`).bind(`dc_${crypto.randomUUID()}`, rr.diary.id, project || null, charKey || null, windowIdForCoverage || null, floorIds[0], floorIds[floorIds.length - 1], floorIds.length).run(); } catch {}
              } else if (windowIdForCoverage) {
                try { await env.OC_DB.prepare(`INSERT INTO diary_coverage (id, diary_id, project, char_key, window_id, floor_count) VALUES (?,?,?,?,?,?)`).bind(`dc_${crypto.randomUUID()}`, rr.diary.id, project || null, charKey || null, windowIdForCoverage || null, conversation.length).run(); } catch {}
              }
            }
          }
          if (created.length) return json(request, env, { success: true, diary: created[0], diaries: created, demo });
        }
      }
      // 单篇落库：直接复用 diaryCreate 的校验与落库路径（date/time/conversationId 等对齐 diaries 表）
      if (request.signal.aborted) {
        return json(request, env, { success: false, error: 'aborted', aborted: true }, 499);
      }
      const r = await diaryCreate(env as any, { project, charKey, date, time, title: body.title || '', content, affection: body.affection ?? null, conversationId, conversationLength: conversation.length });
      if (!r.success) return json(request, env, r, 400);
      if (floorIds.length) {
        try { await env.OC_DB.prepare(`INSERT INTO diary_coverage (id, diary_id, project, char_key, window_id, floor_start, floor_end, floor_count) VALUES (?,?,?,?,?,?,?,?)`).bind(`dc_${crypto.randomUUID()}`, r.diary.id, project || null, charKey || null, windowIdForCoverage || null, floorIds[0], floorIds[floorIds.length - 1], floorIds.length).run(); } catch {}
      } else if (windowIdForCoverage) {
        try { await env.OC_DB.prepare(`INSERT INTO diary_coverage (id, diary_id, project, char_key, window_id, floor_count) VALUES (?,?,?,?,?,?)`).bind(`dc_${crypto.randomUUID()}`, r.diary.id, project || null, charKey || null, windowIdForCoverage || null, conversation.length).run(); } catch {}
      }
      return json(request, env, { success: true, diary: r.diary, demo });
    }

    // ----- Token 用量聚合（供应商下方趋势+分角色/对话） -----
    if (url.pathname === '/api/oc/usage/summary' && request.method === 'GET') {
      const days = Math.min(Math.max(Number(url.searchParams.get('days') || 7), 1), 90);
      const qProject = url.searchParams.get('project') || undefined;
      const qChar = url.searchParams.get('char_key') || url.searchParams.get('charKey') || undefined;
      const qWindow = url.searchParams.get('window_id') || url.searchParams.get('windowId') || undefined;
      const qProvider = url.searchParams.get('provider') || undefined;
      const qChannel = url.searchParams.get('channel') || undefined;
      const whereParts: string[] = [`datetime(created_at) >= datetime('now', '-${days} days')`];
      const vals: unknown[] = [];
      // 动态 where：列不存在时在 catch 中回落
      const condAdd = (col: string, v: string) => { whereParts.push(`${col} = ?`); vals.push(v); };
      if (qProject) condAdd('project', qProject);
      if (qChar) condAdd('char_key', qChar);
      if (qWindow) condAdd('window_id', qWindow);
      if (qProvider) condAdd('provider_id', qProvider);
      if (qChannel) condAdd('channel', qChannel);
      const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
      let rows: any[] = [];
      try {
        const r = await env.OC_DB.prepare(`SELECT date(created_at) as d, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, status, channel, model, project, char_key, window_id, provider_id, created_at FROM usage_log ${where} ORDER BY created_at DESC LIMIT 2000`).bind(...vals).all<any>();
        rows = r.results || [];
      } catch {
        // 回落旧表（无新增列）
        const fallbackWhere: string[] = [`datetime(created_at) >= datetime('now', '-${days} days')`];
        const fallbackVals: unknown[] = [];
        if (qChannel) { fallbackWhere.push('channel = ?'); fallbackVals.push(qChannel); }
        try {
          const r = await env.OC_DB.prepare(`SELECT date(created_at) as d, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, status, channel, model, created_at FROM usage_log WHERE ${fallbackWhere.join(' AND ')} ORDER BY created_at DESC LIMIT 2000`).bind(...fallbackVals).all<any>();
          rows = r.results || [];
        } catch { rows = []; }
      }
      // 聚合
      const byDay = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number; count: number; hit: number }>();
      const byChar = new Map<string, { input: number; output: number; count: number; cacheRead: number }>();
      const byWindow = new Map<string, { input: number; output: number; count: number; charKey: string; project: string }>();
      let total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, count: 0, ok: 0 };
      for (const r of rows) {
        const d = String(r.d || String(r.created_at || '').slice(0, 10));
        const input = Number(r.input_tokens) || 0;
        const output = Number(r.output_tokens) || 0;
        const cr = Number(r.cache_read_tokens) || 0;
        const cw = Number(r.cache_write_tokens) || 0;
        const ck = String(r.char_key || r.charKey || '') || '(未区分)';
        const win = String(r.window_id || r.windowId || '') || (r.channel || '') + ':' + (r.model || '');
        if (!byDay.has(d)) byDay.set(d, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, count: 0, hit: 0 });
        const day = byDay.get(d)!; day.input += input; day.output += output; day.cacheRead += cr; day.cacheWrite += cw; day.count += 1; day.hit += cr;
        if (!byChar.has(ck)) byChar.set(ck, { input: 0, output: 0, count: 0, cacheRead: 0 });
        const cc = byChar.get(ck)!; cc.input += input; cc.output += output; cc.count += 1; cc.cacheRead += cr;
        if (!byWindow.has(win)) byWindow.set(win, { input: 0, output: 0, count: 0, charKey: ck, project: String(r.project || '') });
        const ww = byWindow.get(win)!; ww.input += input; ww.output += output; ww.count += 1;
        total.input += input; total.output += output; total.cacheRead += cr; total.cacheWrite += cw; total.count += 1; if (String(r.status) === 'ok') total.ok += 1;
      }
      const daily = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v, hitRate: v.input + v.cacheRead + v.cacheWrite ? v.cacheRead / (v.input + v.cacheRead + v.cacheWrite) : 0 }));
      // 小时分桶（仅用于 Today 小时视图，前端聚合复用 daily 兜底）
      const byHour = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number; count: number }>();
      for (const r of rows) {
        const ts = String(r.created_at || '');
        // ts: "2025-08-29T14:32:00.000Z" -> hourKey "2025-08-29 14:00"
        const hourKey = ts.length >= 13 ? `${ts.slice(0, 10)} ${ts.slice(11, 13)}:00` : String(r.d || '').slice(0, 10) + ' 00:00';
        if (!byHour.has(hourKey)) byHour.set(hourKey, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, count: 0 });
        const h = byHour.get(hourKey)!;
        h.input += Number(r.input_tokens) || 0;
        h.output += Number(r.output_tokens) || 0;
        h.cacheRead += Number(r.cache_read_tokens) || 0;
        h.cacheWrite += Number(r.cache_write_tokens) || 0;
        h.count += 1;
      }
      const hourly = Array.from(byHour.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([hour, v]) => ({ hour, ...v, total: v.input + v.output + v.cacheRead + v.cacheWrite }));
      const byCharArr = Array.from(byChar.entries()).map(([charKey, v]) => ({ charKey, ...v, hitRate: v.input + v.cacheRead ? v.cacheRead / (v.input + v.cacheRead) : 0 })).sort((a, b) => (b.input + b.output) - (a.input + a.output)).slice(0, 20);
      const byWindowArr = Array.from(byWindow.entries()).map(([windowId, v]) => ({ windowId, ...v })).sort((a, b) => (b.input + b.output) - (a.input + a.output)).slice(0, 20);
      const hitRate = total.input + total.cacheRead + total.cacheWrite ? total.cacheRead / (total.input + total.cacheRead + total.cacheWrite) : 0;
      return json(request, env, { success: true, rangeDays: days, total: { ...total, hitRate, totalTokens: total.input + total.output + total.cacheRead + total.cacheWrite }, daily, hourly, byChar: byCharArr, byWindow: byWindowArr });
    }

    // ----- 日记覆盖查询（已写/未覆盖，用于补写时跳过） -----
    if (url.pathname === '/api/oc/diary/coverage' && request.method === 'GET') {
      const qProject = url.searchParams.get('project') || undefined;
      const qChar = url.searchParams.get('char_key') || url.searchParams.get('charKey') || undefined;
      const qWindow = url.searchParams.get('window_id') || url.searchParams.get('windowId') || undefined;
      const whereParts: string[] = [];
      const vals: unknown[] = [];
      if (qProject) { whereParts.push('project = ?'); vals.push(qProject); }
      if (qChar) { whereParts.push('char_key = ?'); vals.push(qChar); }
      if (qWindow) { whereParts.push('window_id = ?'); vals.push(qWindow); }
      const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
      try {
        const r = await env.OC_DB.prepare(`SELECT diary_id, project, char_key, window_id, floor_start, floor_end, floor_count, created_at FROM diary_coverage ${where} ORDER BY created_at DESC LIMIT 500`).bind(...vals).all<any>();
        return json(request, env, { success: true, coverage: r.results || [] });
      } catch (e: any) {
        if (String(e?.message || '').includes('no such table')) return json(request, env, { success: true, coverage: [] });
        return json(request, env, { success: false, error: e?.message || '查询失败' }, 500);
      }
    }

    // ----- 日记（按日期 CRUD + 日期刻度时间线；妹居实测格式对齐，见 src/core/diaryService.ts） -----
    if (url.pathname === '/api/oc/diary/dates' && request.method === 'GET') {
      const r = await diaryDates(env as any, {
        project: url.searchParams.get('project') || undefined,
        charKey: url.searchParams.get('char_key') || undefined,
      });
      return json(request, env, r, r.success ? 200 : 500);
    }
    if (url.pathname === '/api/oc/diary' && request.method === 'GET') {
      const r = await diaryList(env as any, {
        date: url.searchParams.get('date') || undefined,
        project: url.searchParams.get('project') || undefined,
        charKey: url.searchParams.get('char_key') || undefined,
        limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
      });
      return json(request, env, r, r.success ? 200 : 500);
    }
    if (url.pathname === '/api/oc/diary' && request.method === 'POST') {
      const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
      if ('resp' in read) return read.resp;
      const r = await diaryCreate(env as any, read.body);
      return json(request, env, r, r.success ? 200 : 400);
    }
    if (url.pathname.startsWith('/api/oc/diary/')) {
      const id = url.pathname.slice('/api/oc/diary/'.length);
      if (!id) return json(request, env, { success: false, error: 'missing id' }, 400);
      if (request.method === 'GET') {
        const r = await diaryGet(env as any, id);
        return json(request, env, r, r.success ? 200 : 404);
      }
      if (request.method === 'PUT') {
        const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
        if ('resp' in read) return read.resp;
        const r = await diaryUpdate(env as any, id, read.body);
        return json(request, env, r, r.success ? 200 : (r.error === '日记不存在' ? 404 : 400));
      }
      if (request.method === 'DELETE') {
        const r = await diaryDelete(env as any, id);
        return json(request, env, r, r.success ? 200 : (r.error === '日记不存在' ? 404 : 400));
      }
      return json(request, env, { success: false, error: 'not_found' }, 404);
    }
// ----- 自定义 CG（task-14：配置 + 按 state 解锁展示） -----
    if (url.pathname === '/api/oc/cg' && request.method === 'GET') {
      const r = await cgList(env as any, {
        project: url.searchParams.get('project') || undefined,
        charKey: url.searchParams.get('char_key') || undefined,
        sceneKey: url.searchParams.get('scene_key') || undefined,
        enabled: url.searchParams.get('enabled') || undefined,
        state: url.searchParams.get('state') || undefined,
        limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
      });
      return json(request, env, r, r.success ? 200 : 400);
    }
    if (url.pathname === '/api/oc/cg' && request.method === 'POST') {
      const read = await deskReadJsonLimited(request, { maxBytes: 4 * 1024 * 1024 });
      if ('resp' in read) return read.resp;
      const r = await cgCreate(env as any, read.body);
      return json(request, env, r, r.success ? 200 : 400);
    }
    if (url.pathname.startsWith('/api/oc/cg/')) {
      const id = url.pathname.slice('/api/oc/cg/'.length);
      if (!id) return json(request, env, { success: false, error: 'missing id' }, 400);
      if (request.method === 'GET') {
        const r = await cgGet(env as any, id);
        return json(request, env, r, r.success ? 200 : (r.error === 'CG 条目不存在' ? 404 : 400));
      }
      if (request.method === 'PUT') {
        const read = await deskReadJsonLimited(request, { maxBytes: 4 * 1024 * 1024 });
        if ('resp' in read) return read.resp;
        const r = await cgUpdate(env as any, id, read.body);
        return json(request, env, r, r.success ? 200 : (r.error === 'CG 条目不存在' ? 404 : 400));
      }
      if (request.method === 'DELETE') {
        const r = await cgDelete(env as any, id);
        return json(request, env, r, r.success ? 200 : (r.error === 'CG 条目不存在' ? 404 : 400));
      }
      return json(request, env, { success: false, error: 'not_found' }, 404);
    }
  // ----- 便签（task-15：独立轻量便利贴；D1 oc_state 键值持久化，零迁移） -----
    if (url.pathname === '/api/oc/sticky-notes' && request.method === 'GET') {
      const r = await stickyNotesList(env as any, {
        project: url.searchParams.get('project') || undefined,
        charKey: url.searchParams.get('char_key') || undefined,
        pinned: url.searchParams.get('pinned') || undefined,
        limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
      });
      return json(request, env, r, r.success ? 200 : 500);
    }
    if (url.pathname === '/api/oc/sticky-notes' && request.method === 'POST') {
      const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
      if ('resp' in read) return read.resp;
      const r = await stickyNotesCreate(env as any, read.body);
      return json(request, env, r, r.success ? 200 : 400);
    }
    if (url.pathname.startsWith('/api/oc/sticky-notes/')) {
      const id = url.pathname.slice('/api/oc/sticky-notes/'.length);
      if (!id) return json(request, env, { success: false, error: 'missing id' }, 400);
      if (request.method === 'GET') {
        const r = await stickyNotesGet(env as any, id);
        return json(request, env, r, r.success ? 200 : (r.error === '便签不存在' ? 404 : 400));
      }
      if (request.method === 'PUT') {
        const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
        if ('resp' in read) return read.resp;
        const r = await stickyNotesUpdate(env as any, id, read.body);
        return json(request, env, r, r.success ? 200 : (r.error === '便签不存在' ? 404 : 400));
      }
      if (request.method === 'DELETE') {
        const r = await stickyNotesDelete(env as any, id);
        return json(request, env, r, r.success ? 200 : (r.error === '便签不存在' ? 404 : 400));
      }
      return json(request, env, { success: false, error: 'not_found' }, 404);
    }
  // ----- 章节记忆 + 参考风格（task-18/19：oc_state 键值持久化，零迁移） -----
    if (url.pathname === '/api/oc/desk/novel/chapter-index' && request.method === 'GET') {
      const r = await chapterIndexList(env as any, { project: url.searchParams.get('project') || '' });
      return json(request, env, r, r.success ? 200 : 400);
    }
    if (url.pathname === '/api/oc/desk/novel/chapter-index' && request.method === 'POST') {
      const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
      if ('resp' in read) return read.resp;
      const r = await chapterIndexUpsert(env as any, read.body);
      return json(request, env, r, r.success ? 200 : 400);
    }
    if (url.pathname === '/api/oc/desk/novel/chapter-index' && request.method === 'DELETE') {
      const r = await chapterIndexDelete(env as any, {
        project: url.searchParams.get('project') || '',
        chapter_no: url.searchParams.get('chapter_no') || '',
      });
      return json(request, env, r, r.success ? 200 : (r.error === '索引条目不存在' ? 404 : 400));
    }
    if (url.pathname === '/api/oc/desk/novel/style-ref' && request.method === 'GET') {
      const r = await styleRefGet(env as any, { project: url.searchParams.get('project') || '' });
      return json(request, env, r, r.success ? 200 : 400);
    }
    if (url.pathname === '/api/oc/desk/novel/style-ref' && request.method === 'PUT') {
      const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
      if ('resp' in read) return read.resp;
      const r = await styleRefPut(env as any, read.body);
      return json(request, env, r, r.success ? 200 : 400);
    }
    if (url.pathname === '/api/oc/desk/novel/retrieve' && request.method === 'POST') {
      const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
      if ('resp' in read) return read.resp;
      const r = await novelContextRetrieve(env as any, read.body);
      return json(request, env, r, r.success ? 200 : 500);
    }
    if (url.pathname === '/api/oc/desk/novel/integrate' && request.method === 'POST') {
      const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
      if ('resp' in read) return read.resp;
      const r = await chapterIntegrate(env as any, read.body);
      return json(request, env, r, r.success ? 200 : 500);
    }
  // ----- recipes (preset + overrides + regex selection bound to a project) -----
  if (url.pathname === '/api/oc/desk/recipes' && request.method === 'GET') {
    const r = await deskRecipeList(env as any);
    return json(request, env, r, r.success ? 200 : 500);
  }
  if (url.pathname === '/api/oc/desk/recipes' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body;
    const r = await deskRecipeCreate(env as any, body);
    return json(request, env, r, r.success ? 200 : 400);
  }
  if (url.pathname.startsWith('/api/oc/desk/recipes/')) {
    const rest = url.pathname.slice('/api/oc/desk/recipes/'.length);
    const exportSuffix = '/export';
    const isExport = rest.endsWith(exportSuffix);
    const id = isExport ? rest.slice(0, -exportSuffix.length) : rest;
    if (!id) return json(request, env, { success: false, error: 'missing id' }, 400);
    if (isExport && request.method === 'GET') {
      const r = await deskRecipeExport(env as any, id);
      if (!r.success) return json(request, env, r, r.error === 'Recipe not found.' ? 404 : (r.server ? 500 : 400));
      const safeName = String(r.name || 'recipe').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80) || 'recipe';
      const headers = new Headers(corsHeaders(request, env));
      headers.set('Content-Type', 'application/json; charset=utf-8');
      headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.json`);
      return new Response(JSON.stringify(r.data, null, 2), { headers });
    }
    if (request.method === 'PUT') {
      const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
      if ('resp' in read) return read.resp;
      const body = read.body;
      const r = await deskRecipeUpdate(env as any, id, body);
      return json(request, env, r, r.success ? 200 : (r.error === 'Recipe not found.' ? 404 : 400));
    }
    if (request.method === 'DELETE') {
      const r = await deskRecipeDelete(env as any, id);
      return json(request, env, r, r.success ? 200 : (r.error === 'Recipe not found.' ? 404 : (r.server === true ? 500 : 400)));
    }
    return json(request, env, { success: false, error: 'not_found' }, 404);
  }
  if (url.pathname === '/api/oc/desk/backfill-chapter-vectors' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT, emptyBody: 'as-empty-object' });
    if ('resp' in read) return read.resp;
    const r = await deskBackfillChapterVectors(env as any, read.body || {});
    return json(request, env, r, r.success ? 200 : 500);
  }
  if (url.pathname === '/api/oc/desk/dryrun' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request);
    if ('resp' in read) return read.resp;
    const r = await deskDryrun(deskAssemblyStorage(env), read.body);
    return json(request, env, r, r.success ? 200 : 400);
  }

  // ----- writing-desk windows and floors -----
  if (url.pathname === '/api/oc/desk/windows' && request.method === 'GET') {
    const r = await deskWindowList(env as any, { project: url.searchParams.get('project') || undefined });
    return json(request, env, r, r.success ? 200 : 500);
  }
  if (url.pathname === '/api/oc/desk/windows' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body;
    const r = await deskWindowCreate(env as any, body);
    return json(request, env, r, r.success ? 200 : (r.server === true ? 500 : 400));
  }
  if (url.pathname.startsWith('/api/oc/desk/windows/')) {
    const rest = url.pathname.slice('/api/oc/desk/windows/'.length);
    if (rest.endsWith('/truncate')) {
      const id = rest.slice(0, -'/truncate'.length);
      if (request.method === 'POST' && id) {
        const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
        if ('resp' in read) return read.resp;
        const body = read.body;
        if (!body || typeof body.floor_id !== 'string') return json(request, env, { success: false, error: 'floor_id is required' }, 400);
        const r = await deskWindowTruncate(env as any, id, body.floor_id, body.inclusive === true);
        return json(request, env, r, r.success ? 200 : (r.error && r.error.includes('not found') ? 404 : 400));
      }
      return json(request, env, { success: false, error: 'not_found' }, 404);
    }
    // State board refresh: read-only recompute from the last (assistant) floor's current text —
    // it returns a draft, it never writes. Persisting it is still PUT /windows/:id (the caller
    // saves it explicitly), see chat/deskBoardRefresh.ts's header for why.
    if (rest.endsWith('/board-refresh')) {
      const id = rest.slice(0, -'/board-refresh'.length);
      if (request.method === 'POST' && id) {
        const r = await deskBoardRefresh(env as any, id);
        return json(request, env, r, r.success ? 200 : (r.error === 'This desk window does not exist.' ? 404 : 400));
      }
      return json(request, env, { success: false, error: 'not_found' }, 404);
    }
    // Manual timeline fold: force skips the auto-fold trigger threshold; keep defaults to the
    // same DESK_TIMELINE_KEEP the automatic path uses. Awaited synchronously (not waitUntil) —
    // the caller pressed a button and wants to see the result now; the fold itself is bounded.
    if (rest.endsWith('/compress')) {
      const id = rest.slice(0, -'/compress'.length);
      if (request.method === 'POST' && id) {
        const read = await deskReadJsonLimited(request, { maxBytes: DESK_TINY_BODY_MAX, emptyBody: 'as-empty-object' });
        if ('resp' in read) return read.resp;
        const body: any = read.body;
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          return json(request, env, { success: false, error: 'request body must be a JSON object' }, 400);
        }
        let keep: number | undefined;
        if (body.keep !== undefined) {
          const k = body.keep;
          if (typeof k !== 'number' || !Number.isSafeInteger(k) || k < 0) {
            return json(request, env, { success: false, error: 'keep must be an integer >= 0' }, 400);
          }
          keep = k;
        }
        const r: any = await maybeFoldDeskTimeline(env as any, id, undefined, { force: true, keep });
        if (r && r.skip === 'window_gone') return json(request, env, { success: false, error: 'Desk window not found.' }, 404);
        return json(request, env, r, r.success ? 200 : 500);
      }
      return json(request, env, { success: false, error: 'not_found' }, 404);
    }
    // Automatic book: deterministic chapter split + model transcription into the reading corner.
    // Two endpoints share the same tiny body shape ({ style?, max_chapters?, budget_chars? }).
    // /book/split is the optional dry-run (no model calls); the frontend main entry is /book.
    if (rest.endsWith('/book/split')) {
      const id = rest.slice(0, -'/book/split'.length);
      if (request.method === 'POST' && id) {
        const read = await deskReadJsonLimited(request, { maxBytes: DESK_TINY_BODY_MAX, emptyBody: 'as-empty-object' });
        if ('resp' in read) return read.resp;
        const body: any = read.body;
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          return json(request, env, { success: false, error: 'request body must be a JSON object' }, 400);
        }
        const r = await deskBookSplit(env as any, id, { budgetChars: body.budget_chars });
        return json(request, env, r, r.success ? 200 : (r.server === true ? 500 : 400));
      }
      return json(request, env, { success: false, error: 'not_found' }, 404);
    }
    if (rest.endsWith('/book')) {
      const id = rest.slice(0, -'/book'.length);
      if (request.method === 'POST' && id) {
        const read = await deskReadJsonLimited(request, { maxBytes: DESK_TINY_BODY_MAX, emptyBody: 'as-empty-object' });
        if ('resp' in read) return read.resp;
        const body: any = read.body;
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          return json(request, env, { success: false, error: 'request body must be a JSON object' }, 400);
        }
        const r = await deskBookAuto(env as any, id, {
          style: body.style,
          max_chapters: body.max_chapters,
          budgetChars: body.budget_chars,
        });
        return json(request, env, r, r.success ? 200 : (r.server === true ? 500 : 400));
      }
      return json(request, env, { success: false, error: 'not_found' }, 404);
    }
// 回溯场景（task-13）：独立路由壳，主逻辑见 src/core/deskService.ts。
      if (rest.endsWith('/backtrack')) {
        const id = rest.slice(0, -'/backtrack'.length);
        if (request.method === 'POST' && id) {
          const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
          if ('resp' in read) return read.resp;
          const r = await deskBacktrackCreate(env as any, id, read.body);
          return json(request, env, r, r.success ? 200 : (r.error && r.error.includes('not found') ? 404 : 400));
        }
        return json(request, env, { success: false, error: 'not_found' }, 404);
      }
      if (rest.endsWith('/branches')) {
        const id = rest.slice(0, -'/branches'.length);
        if (request.method === 'GET' && id) {
          const r = await deskBacktrackList(env as any, id);
          return json(request, env, r, r.success ? 200 : (r.error && r.error.includes('not found') ? 404 : 400));
        }
        return json(request, env, { success: false, error: 'not_found' }, 404);
      }
    const id = rest;
    if (!id) return json(request, env, { success: false, error: 'missing id' }, 400);
    if (request.method === 'GET') {
      const r = await deskWindowGet(env as any, id);
      return json(request, env, r, r.success ? 200 : (r.error === 'Desk window not found.' ? 404 : 400));
    }
    if (request.method === 'PUT') {
      const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
      if ('resp' in read) return read.resp;
      const body = read.body;
      const r = await deskWindowUpdate(env as any, id, body);
      return json(request, env, r, r.success ? 200 : (r.error === 'Desk window not found.' ? 404 : 400));
    }
    if (request.method === 'DELETE') {
      const r = await deskWindowDelete(env as any, id);
      return json(request, env, r, r.success ? 200 : (r.error === 'Desk window not found.' ? 404 : 400));
    }
    return json(request, env, { success: false, error: 'not_found' }, 404);
  }
  if (url.pathname.startsWith('/api/oc/desk/floors/')) {
    const rest = url.pathname.slice('/api/oc/desk/floors/'.length);
    if (rest.endsWith('/variant')) {
      const id = rest.slice(0, -'/variant'.length);
      if (request.method === 'POST' && id) {
        const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
        if ('resp' in read) return read.resp;
        const body = read.body;
        if (!body || typeof body.index !== 'number') return json(request, env, { success: false, error: 'index is required (number)' }, 400);
        const r = await deskFloorVariant(env as any, id, body.index);
        return json(request, env, r, r.success ? 200 : (r.error === 'Floor not found.' ? 404 : 400));
      }
      return json(request, env, { success: false, error: 'not_found' }, 404);
    }
    const id = rest;
    if (!id) return json(request, env, { success: false, error: 'missing id' }, 400);
    if (request.method === 'PUT') {
      const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
      if ('resp' in read) return read.resp;
      const body = read.body;
      if (!body || typeof body.content !== 'string') return json(request, env, { success: false, error: 'content is required (string)' }, 400);
      const r = await deskFloorEdit(env as any, id, body.content);
      return json(request, env, r, r.success ? 200 : (r.error === 'Floor not found.' ? 404 : 400));
    }
    return json(request, env, { success: false, error: 'not_found' }, 404);
  }

  // Desk chat: SSE generation (normal turn or roll), state-board protocol handling, and the
  // atomic floor/window commit all live in chat/desk.ts; this route only wires the D1 storage
  // and the background waitUntil hooks (usage logging, auto-fold) into it.
  // Desk providers: the "商" popover fetches the configured supplier groups (id + name + models).
  // Provider config (网页端增改删供应商):覆盖存 oc_state(provider_config:<id>),merge 到 env 立即生效。
  if (url.pathname === '/api/oc/desk/providers' && request.method === 'GET') {
    const overrides = await new D1ProviderConfigStore(env.OC_DB).list();
    return json(request, env, { success: true, providers: listProviders(env as any, overrides) });
  }
  if (url.pathname === '/api/oc/desk/provider-config' && request.method === 'GET') {
    const overrides = await new D1ProviderConfigStore(env.OC_DB).list();
    return json(request, env, { success: true, providers: providerConfigRows(env as any, overrides) });
  }
  if (url.pathname === '/api/oc/desk/provider-config' && request.method === 'PUT') {
    const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(request, env, { success: false, error: 'request body must be a JSON object' }, 400);
    }
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const isRegistry = PROVIDER_REGISTRY_IDS.includes(id);
    const isCustom = /^custom:.+/.test(id);
    if (!isRegistry && !isCustom) {
      return json(request, env, { success: false, error: 'id 必须是注册表供应商或 custom:<id>' }, 400);
    }
    const def = isRegistry ? DESK_PROVIDER_DEFS.find((d) => d.id === id) : undefined;
    if (body.protocol !== undefined && (body.protocol !== 'openai' && body.protocol !== 'anthropic' && body.protocol !== 'responses')) {
      return json(request, env, { success: false, error: 'protocol 只允许 openai / anthropic / responses' }, 400);
    }
    if (isCustom && body.protocol !== undefined && body.protocol !== 'openai' && body.protocol !== 'anthropic' && body.protocol !== 'responses') {
      return json(request, env, { success: false, error: '自定义供应商协议只允许 openai / anthropic / responses' }, 400);
    }
    if (isRegistry && body.protocol !== undefined && body.protocol !== def!.protocol) {
      return json(request, env, { success: false, error: `注册表供应商 ${id} 的协议不可修改` }, 400);
    }
    const store = new D1ProviderConfigStore(env.OC_DB);
    const existing = await store.get(id);
    // 自定义供应商协议：body.protocol 优先（新开选预设时带上），否则沿用已存的，再兜底 openai。
    const customProtocol: 'openai' | 'anthropic' | 'responses' = body.protocol === 'anthropic'
      ? 'anthropic'
      : body.protocol === 'responses'
        ? 'responses'
        : (existing && (existing.protocol === 'anthropic' || existing.protocol === 'responses') ? existing.protocol as any : 'openai');
    const base: ProviderOverride = existing
      ? { ...existing, protocol: isCustom ? customProtocol : def!.protocol }
      : { id, protocol: isCustom ? customProtocol : def!.protocol };
    // apiKey/baseUrl/model/maxTokens:undefined 或空串 = 保留原值(编辑不覆盖);有值才写,且类型必须对。
    if (body.apiKey !== undefined && body.apiKey !== '') {
      if (typeof body.apiKey !== 'string') return json(request, env, { success: false, error: 'apiKey 必须是字符串' }, 400);
      base.apiKey = body.apiKey;
    }
    if (body.baseUrl !== undefined && body.baseUrl !== '') {
      if (typeof body.baseUrl !== 'string') return json(request, env, { success: false, error: 'baseUrl 必须是字符串' }, 400);
      base.baseUrl = body.baseUrl;
    }
    if (body.model !== undefined && body.model !== '') {
      if (typeof body.model !== 'string') return json(request, env, { success: false, error: 'model 必须是字符串' }, 400);
      base.model = body.model;
    }
    if (body.maxTokens !== undefined && body.maxTokens !== '') {
      if (typeof body.maxTokens !== 'number' || !Number.isFinite(body.maxTokens)) {
        return json(request, env, { success: false, error: 'maxTokens 必须是数字' }, 400);
      }
      base.maxTokens = body.maxTokens;
    }
    if (body.name !== undefined && body.name !== '') {
      if (typeof body.name !== 'string') return json(request, env, { success: false, error: 'name 必须是字符串' }, 400);
      base.name = body.name;
    }
    if (isCustom && !existing) {
      const nameOk = typeof base.name === 'string' && base.name.trim() !== '';
      const credOk = (typeof base.apiKey === 'string' && base.apiKey.trim() !== '') || (typeof base.baseUrl === 'string' && base.baseUrl.trim() !== '');
      if (!nameOk || !credOk) {
        return json(request, env, { success: false, error: '新建自定义供应商必须提供 name,以及 apiKey/baseUrl 至少一个' }, 400);
      }
    }
    await store.put(base);
    const overrides = await store.list();
    const row = providerConfigRows(env as any, overrides).find((r) => r.id === id);
    return json(request, env, { success: true, provider: row });
  }
  if (url.pathname === '/api/oc/desk/provider-config' && request.method === 'DELETE') {
    const id = (url.searchParams.get('id') || '').trim();
    if (!id) return json(request, env, { success: false, error: 'id 必填' }, 400);
    await new D1ProviderConfigStore(env.OC_DB).remove(id);
    return json(request, env, { success: true, id });
  }
  // 「获取模型名称」：从供应商 API 拉模型列表(前端表单里点按钮时调)。走后端代理免得浏览器撞 CORS。
  // body: { id?, baseUrl?, apiKey?, protocol }——id 给了就按已存配置解析(编辑态没改 key 时用),
  // baseUrl/apiKey 给了优先用表单里的(新建态/正在改 key 时)。
  if (url.pathname === '/api/oc/desk/provider-models' && request.method === 'POST') {
    const read = await deskReadJsonLimited(request, { maxBytes: JSON_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body && typeof read.body === 'object' ? read.body : {};
    let protocol: 'openai' | 'anthropic' | 'responses' = body.protocol === 'responses' ? 'responses' : body.protocol === 'anthropic' ? 'anthropic' : 'openai';
    let baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (typeof body.id === 'string' && body.id.trim()) {
      const overrides = await new D1ProviderConfigStore(env.OC_DB).list();
      const cfg = resolveDeskProvider(env as any, body.id.trim(), overrides);
      if (!cfg) return json(request, env, { success: false, error: `供应商 ${body.id} 未配置` }, 400);
      protocol = cfg.protocol;
      if (!baseUrl) baseUrl = cfg.baseUrl || '';
      if (!apiKey) apiKey = cfg.apiKey || '';
    }
    if (!apiKey) {
      return json(request, env, { success: false, error: '要拉模型得先有 API Key（表单里填，或选一个已配置的供应商）' }, 400);
    }
    const modelsUrl = providerModelsUrl(protocol, baseUrl);
    let u: URL;
    try { u = new URL(modelsUrl); } catch {
      return json(request, env, { success: false, error: 'Base URL 不是合法 URL' }, 400);
    }
    const localHttp = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    if (u.protocol !== 'https:' && !localHttp) {
      return json(request, env, { success: false, error: 'Base URL 必须是 https（或本机 http://localhost）' }, 400);
    }
    const mode: 'models' | 'test' = body.mode === 'test' ? 'test' : 'models';
    let resp: Response;
    try {
      const headers: Record<string, string> = protocol === 'anthropic'
        ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        : { authorization: `Bearer ${apiKey}` };
      resp = await fetch(modelsUrl, { method: 'GET', headers, signal: AbortSignal.timeout(12_000) });
    } catch (e: any) {
      if (mode === 'test') return json(request, env, { success: true, ok: false, message: `连接失败：${e?.message || '网络错误'}` });
      return json(request, env, { success: false, error: `拉模型请求失败：${e?.message || '网络错误'}` }, 502);
    }
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => '')).slice(0, 200);
      if (mode === 'test') return json(request, env, { success: true, ok: false, message: `连接失败 HTTP ${resp.status}${detail ? `：${detail}` : ''}` });
      return json(request, env, { success: false, error: `拉模型失败 HTTP ${resp.status}${detail ? `：${detail}` : ''}` }, 502);
    }
    const data: unknown = await resp.json().catch(() => null);
    const models = parseProviderModels(data);
    if (mode === 'test') {
      return json(request, env, {
        success: true, ok: true,
        message: models.length ? `连接正常，拉到 ${models.length} 个模型` : '连接正常（但没解析到模型列表）',
        modelCount: models.length,
      });
    }
    if (!models.length) return json(request, env, { success: false, error: '没拉到模型，检查 Base URL 与 Key' }, 400);
    return json(request, env, { success: true, models });
  }
  // ----- 每日登录触发（task-17）：「每天登录弹一次」剧情机制 -----
  // 原理：记录 lastLoginDate（oc_state 键值表），登录/启动时 today != lastLoginDate 
  // 触发「每日首次」事件；同日不重复，跨日重置。判定/状态推进在 src/core/loreTrigger.ts 纯函数，
  // D1 落库在 d1DailyLoginStore.ts（零 schema 变更，复用 oc_state）。
  if (url.pathname === '/api/oc/desk/daily-login' && request.method === 'GET') {
    const store = new D1DailyLoginStore(env.OC_DB);
    const config = await store.getConfig();
    const state = await store.getState();
    return json(request, env, {
      success: true,
      config: config ?? DEFAULT_DAILY_LOGIN_CONFIG,
      state: state ?? DEFAULT_DAILY_LOGIN_STATE,
    });
  }
  if (url.pathname === '/api/oc/desk/daily-login/claim' && request.method === 'POST') {
    // 登录/启动钩子：前端进书房时调一次，带本地日期（today）跨日重置按用户当地日期算，
    // 不随 Worker 所在时区漂移。body 可选 { today: 'YYYY-MM-DD' }，缺省/非法用服务端日期。
    const read = await deskReadJsonLimited(request, { maxBytes: DESK_TINY_BODY_MAX, emptyBody: 'as-empty-object' });
    if ('resp' in read) return read.resp;
    const body = read.body && typeof read.body === 'object' ? read.body : {};
    const today = parseDailyLoginDateKey(body.today) ?? dailyLoginDateKey();
    const store = new D1DailyLoginStore(env.OC_DB);
    const config = await store.getConfig();
    const state = await store.getState();
    const cfg = config ?? DEFAULT_DAILY_LOGIN_CONFIG;
    const st = state ?? DEFAULT_DAILY_LOGIN_STATE;
    const verdict = evaluateDailyLogin(cfg, st, today);
    if (verdict.shouldTrigger) {
      await store.saveState(nextDailyLoginState(st, today));
      return json(request, env, {
        success: true,
        triggered: true,
        reason: 'ok',
        today,
        event: { title: cfg.title, content: cfg.content },
        state: await store.getState(),
      });
    }
    return json(request, env, { success: true, triggered: false, reason: verdict.reason, today, state: st });
  }
  if (url.pathname === '/api/oc/desk/daily-login/config' && request.method === 'PUT') {
    // 可配置：开关（enabled）+ 哪天（triggerDate，空=每天）+ 剧情内容（title/content）。
    const read = await deskReadJsonLimited(request, { maxBytes: PROSE_LIMIT });
    if ('resp' in read) return read.resp;
    const body = read.body && typeof read.body === 'object' ? read.body : {};
    const store = new D1DailyLoginStore(env.OC_DB);
    const existing = await store.getConfig();
    const cfg: DailyLoginConfig = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : (existing?.enabled ?? DEFAULT_DAILY_LOGIN_CONFIG.enabled),
      title: typeof body.title === 'string' ? body.title : (existing?.title ?? DEFAULT_DAILY_LOGIN_CONFIG.title),
      content: typeof body.content === 'string' ? body.content : (existing?.content ?? DEFAULT_DAILY_LOGIN_CONFIG.content),
      triggerDate: typeof body.triggerDate === 'string' ? body.triggerDate : (existing?.triggerDate ?? DEFAULT_DAILY_LOGIN_CONFIG.triggerDate),
    };
    if (cfg.triggerDate && !parseDailyLoginDateKey(cfg.triggerDate)) {
      return json(request, env, { success: false, error: 'triggerDate 必须是 YYYY-MM-DD 或留空' }, 400);
    }
    await store.saveConfig(cfg);
    return json(request, env, { success: true, config: cfg });
  }
  if (url.pathname === '/api/oc/desk/daily-login/reset' && request.method === 'POST') {
    // 管理/测试用：清空触发状态，让「每日首次」判定重新可用（等同跨日重置）。
    await new D1DailyLoginStore(env.OC_DB).resetState();
    return json(request, env, { success: true, state: DEFAULT_DAILY_LOGIN_STATE });
  }
  // 26A 剧情双分支 → 小纸条（plotOutline）
  if (url.pathname.startsWith('/api/oc/plot')) {
    const r = await handlePlotRoutes(request, env, url);
    if (r) return r;
  }
  if (url.pathname.startsWith('/api/oc/trpg')) return handleTrpgRoutes(request, env, url);
  if (url.pathname.startsWith('/api/oc/save')) return handleSaveRoutes(request, env, url);
  if (url.pathname.startsWith('/api/oc/story')) return handleStoryRoutes(request, env, url);
  if (url.pathname === '/api/oc/desk/chat' && request.method === 'POST') {
    // 附件(图片 base64)会让 body 变大,放宽到 32MB(对齐 import/chat)。
    const read = await deskReadJsonLimited(request, { maxBytes: 32 * 1024 * 1024 });
    if ('resp' in read) return read.resp;
    const storage: DeskChatStorage = { deskStorage: new D1DeskStorage(env.OC_DB), turnStorage: new D1DeskTurnStorage(env.OC_DB), ...deskAssemblyStorage(env), memory: new D1DeskMemoryStorage(env.OC_DB), diary: new D1DiaryStorage(env.OC_DB) };
    const overrides = await new D1ProviderConfigStore(env.OC_DB).list();
    return handleDeskChat(env as any, read.body, storage, request.signal, (promise) => ctx.waitUntil(promise), overrides);
  }

  return null;
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    const headers = corsHeaders(request, env);
    return Object.keys(headers).length ? new Response(null, { status: 204, headers }) : new Response(null, { status: 403 });
  }
  if (url.pathname === '/health' && request.method === 'GET') return json(request, env, { ok: true, service: 'tavern-home' });

  // Writer's-desk admin surface: URL-path token gate, shape /{AUTH_TOKEN}/api/oc/..., mirroring
  // the reference deployment's single `pathParts[0] === AUTH_TOKEN` judgement for this
  // namespace. Scoped to just this prefix — every other route below keeps the existing
  // Bearer/scope system (MCP, published reading, comments); this is not a second general auth
  // mode, just this one namespace's own gate.
  const pathParts = url.pathname.split('/').filter((part) => part.length > 0);
  // MCP via path-token: /{AUTH_TOKEN}/mcp — mirrors admin surface gate, but routes to MCP handler
  if (pathParts.length >= 2 && pathParts[1] === 'mcp') {
    if (!env.AUTH_TOKEN || !(await equalSecret(pathParts[0], env.AUTH_TOKEN))) {
      return json(request, env, { error: 'unauthorized' }, 401);
    }
    if (request.method === 'OPTIONS') {
      const h = corsHeaders(request, env);
      return new Response(null, { status: 204, headers: h as any });
    }
    if (request.method === 'GET') {
      // Streamable HTTP: GET is SSE stream; P0 返回空 405 提示用 POST
      return json(request, env, { error: 'method_not_allowed', message: 'MCP Streamable HTTP uses POST; GET SSE not required for P0' }, 405);
    }
    if (request.method !== 'POST') return json(request, env, { error: 'method_not_allowed' }, 405);
    const mcpResp = await handleMcpPost(request, env);
    // 补 CORS
    for (const [k, v] of Object.entries(corsHeaders(request, env))) mcpResp.headers.set(k, v as string);
    return mcpResp;
  }
  if (pathParts.length >= 3 && pathParts[1] === 'api' && pathParts[2] === 'oc') {
    if (!env.AUTH_TOKEN || !(await equalSecret(pathParts[0], env.AUTH_TOKEN))) {
      return json(request, env, { error: 'unauthorized' }, 401);
    }
    const remainingUrl = new URL(url.toString());
    remainingUrl.pathname = '/' + pathParts.slice(1).join('/');
    const admin = await handleDeskAdmin(request, env, remainingUrl, ctx);
    if (admin) return admin;
    return json(request, env, { error: 'not_found' }, 404);
  }

  // MCP via Bearer (OWNER_TOKEN/COMPANION_TOKEN) at /mcp — primary for external Agent
  if (url.pathname === '/mcp') {
    if (request.method === 'OPTIONS') {
      const h = corsHeaders(request, env);
      return new Response(null, { status: 204, headers: h as any });
    }
    if (request.method === 'GET') {
      return json(request, env, { error: 'method_not_allowed', message: 'MCP Streamable HTTP uses POST; GET SSE not required for P0' }, 405);
    }
    if (request.method !== 'POST') return json(request, env, { error: 'method_not_allowed' }, 405);
    const mcpAuth = await authenticate(request, env);
    if (!mcpAuth) {
      const r = json(request, env, { error: 'unauthorized' }, 401);
      r.headers.set('WWW-Authenticate', 'Bearer');
      return r;
    }
    // MCP 需要 desk 权限（owner 全量，companion 受限）；P0 要求至少 desk:read
    if (!hasScope(mcpAuth, 'desk:read') && !hasScope(mcpAuth, 'desk:write')) {
      return json(request, env, { error: 'forbidden', message: 'MCP requires desk:read/desk:write (owner token)' }, 403);
    }
    const mcpResp = await handleMcpPost(request, env);
    for (const [k, v] of Object.entries(corsHeaders(request, env))) mcpResp.headers.set(k, v as string);
    return mcpResp;
  }

  const auth = await authenticate(request, env);
  const readGate = requireScope(request, env, auth, 'published:read');
  if (readGate) return readGate;
  const actor = auth as AuthContext;
  if (url.pathname === '/api/v1/published' && request.method === 'GET') {
    const rawLimit = url.searchParams.get('limit');
    return json(request, env, await readingService(env).listPublished({
      project: url.searchParams.get('project') || undefined,
      limit: rawLimit ? Number(rawLimit) : undefined,
    }));
  }
  const chapter = url.pathname.match(/^\/api\/v1\/published\/([^/]+)$/);
  if (chapter && request.method === 'GET') return json(request, env, await readingService(env).readPublished(decodeURIComponent(chapter[1])));
  const comments = url.pathname.match(/^\/api\/v1\/published\/([^/]+)\/comments$/);
  if (comments && request.method === 'GET') {
    const commentGate = requireScope(request, env, actor, 'comments:read');
    if (commentGate) return commentGate;
    const rawLimit = url.searchParams.get('limit');
    return json(request, env, await readingService(env).listComments(
      decodeURIComponent(comments[1]), rawLimit ? Number(rawLimit) : undefined,
    ));
  }
  if (comments && request.method === 'POST') {
    const writeGate = requireScope(request, env, actor, 'comments:write');
    if (writeGate) return writeGate;
    let body: any;
    try { body = await readJson(request); }
    catch (error: any) {
      const tooLarge = error.message === 'REQUEST_TOO_LARGE';
      return json(request, env, { error: tooLarge ? 'request_too_large' : 'invalid_json' }, tooLarge ? 413 : 400);
    }
    return createComment(request, env, actor, { ...body, chapter_id: decodeURIComponent(comments[1]) });
  }
  return json(request, env, { error: 'not_found' }, 404);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      return await handle(request, env, ctx);
    } catch (error) {
      console.error('[worker] Unhandled request error:', error);
      return json(request, env, { error: 'internal_error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
