import { authenticate, equalSecret, hasScope, type AuthContext, type AuthEnv, type Scope } from '../../src/auth';
import { ReadingService } from '../../src/core/readingService.ts';
import { D1ReadingStorage } from './adapters/d1ReadingStorage.ts';
import { D1DeskStorage } from './adapters/d1DeskStorage.ts';
import { D1DeskTurnStorage } from './adapters/d1DeskTurnStorage.ts';
import { D1DeskAssetStorage } from './adapters/d1DeskAssetStorage.ts';
import { D1DeskStoryStorage } from './adapters/d1DeskStoryStorage.ts';
import { VectorizeSemanticSearch } from './adapters/vectorizeSemanticSearch.ts';
import type { Ai, VectorizeIndex } from '../../src/storage/vectorize';
import type { SemanticSearchAdapter } from '../../src/core/storage.ts';
import {
  deskImportPreset, deskImportSettings, deskImportWorlds, deskImportRegexBundle, importCharacterCard, deskImportChat,
  deskListPresets, deskPresetDelete, deskListRegex, deskBackfillChapterVectors,
} from '../../src/tools/desk';
import { parseCharacterCard } from '../../src/core/characterCard.ts';
import {
  deskPresetBlocks, deskBlockUpdate, deskLoreList, deskLoreCreate, deskLoreUpdate, deskLoreDelete,
  deskRegexUpdate, deskRegexDelete, deskRegexReorder, deskCoreGet, deskCoreUpdate, deskRecallGet, deskRecallUpdate,
} from '../../src/tools/deskPanels';
import { deskRecipeList, deskRecipeExport, deskRecipeCreate, deskRecipeUpdate, deskRecipeDelete } from '../../src/tools/deskRecipes';
import {
  deskWindowCreate, deskWindowList, deskWindowGet, deskWindowUpdate, deskWindowDelete,
  deskFloorEdit, deskWindowTruncate, deskFloorVariant,
} from '../../src/tools/deskWindows';
import { deskBookSplit, deskBookAuto } from '../../src/tools/deskBook';
import { studyList, studyGet, studyCreate, studyUpdate, studyDelete, studySearch, studyBackfill } from '../../src/tools/study';
import { StudyService } from '../../src/core/studyService.ts';
import { D1StudyStorage } from './adapters/d1StudyStorage.ts';
import {
  chaptersList, chapterGet, chapterCreate, chapterUpdate, chapterDelete, chapterRestore, chapterDeletePermanent,
  chapterPublish, chapterUnpublish, chaptersExport,
  commentsList, commentPost, commentDelete,
} from '../../src/tools/reading';
import { deskDryrun } from '../../src/chat/deskAssemble';
import { maybeFoldDeskTimeline } from '../../src/chat/deskTimeline';
import { deskBoardRefresh } from '../../src/chat/deskBoardRefresh';
import { handleDeskChat, type DeskChatStorage } from '../../src/chat/desk';
import {
  listProviders, PROVIDER_REGISTRY_IDS, DESK_PROVIDER_DEFS, deskProviderConfigured, mergeProviderEnv,
  resolveDeskProvider, providerModelsUrl, parseProviderModels,
  type DeskBackendEnv,
} from '../../src/adapters/streamModelBackends';
import { D1ProviderConfigStore } from './adapters/d1ProviderConfigStore.ts';
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
  protocol: 'openai' | 'anthropic';
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
    rows.push({
      id: def.id,
      name: def.name,
      protocol: def.protocol,
      source: o ? 'override' : 'env',
      hasApiKey: !!key,
      apiKeyTail: key ? String(key).slice(-4) : '',
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
    if (body.protocol !== undefined && (body.protocol !== 'openai' && body.protocol !== 'anthropic')) {
      return json(request, env, { success: false, error: 'protocol 只允许 openai 或 anthropic' }, 400);
    }
    if (isCustom && body.protocol !== undefined && body.protocol !== 'openai' && body.protocol !== 'anthropic') {
      return json(request, env, { success: false, error: '自定义供应商协议只允许 openai 或 anthropic' }, 400);
    }
    if (isRegistry && body.protocol !== undefined && body.protocol !== def!.protocol) {
      return json(request, env, { success: false, error: `注册表供应商 ${id} 的协议不可修改` }, 400);
    }
    const store = new D1ProviderConfigStore(env.OC_DB);
    const existing = await store.get(id);
    // 自定义供应商协议：body.protocol 优先（新开选预设时带上），否则沿用已存的，再兜底 openai。
    const customProtocol: 'openai' | 'anthropic' = body.protocol === 'anthropic'
      ? 'anthropic'
      : (existing && existing.protocol === 'anthropic' ? 'anthropic' : 'openai');
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
    let protocol: 'openai' | 'anthropic' = body.protocol === 'anthropic' ? 'anthropic' : 'openai';
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
  if (url.pathname === '/api/oc/desk/chat' && request.method === 'POST') {
    // 附件(图片 base64)会让 body 变大,放宽到 32MB(对齐 import/chat)。
    const read = await deskReadJsonLimited(request, { maxBytes: 32 * 1024 * 1024 });
    if ('resp' in read) return read.resp;
    const storage: DeskChatStorage = { deskStorage: new D1DeskStorage(env.OC_DB), turnStorage: new D1DeskTurnStorage(env.OC_DB), ...deskAssemblyStorage(env) };
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

  const auth = await authenticate(request, env);
  const readGate = requireScope(request, env, auth, 'published:read');
  if (readGate) return readGate;
  const actor = auth as AuthContext;

  if (url.pathname === '/mcp') return json(request, env, {
    error: 'mcp_transport_not_configured',
    message: 'Embed TavernStudyMcpServer in a host-managed MCP transport and session store.',
  }, 501);
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
