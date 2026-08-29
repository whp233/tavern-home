// examples/cloudflare/storyRoutes.ts
// 剧情CG模式（对齐妹居“大纲+开头→沉浸体验+CG”）： outline / start / continue / session / list
// 复用 streamModelBackends 的 provider 覆盖层；无模型时本地 demo 兜底可跑。

import { makeDeskBackend, resolveDeskProvider } from '../../src/adapters/streamModelBackends.ts';
import type { DeskBackendEnv } from '../../src/adapters/streamModelBackends.ts';
import type { ProviderOverride } from '../../src/core/providerConfigStore.ts';
import { D1ProviderConfigStore } from './adapters/d1ProviderConfigStore.ts';
import { D1StoryStorage } from './adapters/d1StoryStorage.ts';
import { D1DeskStorage } from './adapters/d1DeskStorage.ts';
import { buildContinuePrompt, buildOpeningPrompt, buildOutlinePrompt } from '../../src/core/story/storyPrompt.ts';
import { applyStoryState, buildSessionId, demoContinue, demoOpening, demoOutline, parseContinueOutput, parseOpeningOutput, parseOutlineOutput, shouldTriggerCg } from '../../src/core/story/storyRuntime.ts';
import type { StorySession, StoryState } from '../../src/core/story/types.ts';

interface StoryEnv { [k: string]: any; OC_DB?: D1Database; }

const JSON_LIMIT = 256 * 1024;

function json(req: Request, env: StoryEnv, body: unknown, status = 200): Response {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  const origin = req.headers.get('origin');
  if (origin && env.ALLOWED_ORIGINS) {
    const allowed = new Set(String(env.ALLOWED_ORIGINS).split(',').map((v:string)=>v.trim()).filter(Boolean));
    if (allowed.has(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      headers.set('Access-Control-Max-Age', '86400');
      headers.set('Vary', 'Origin');
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJson(req: Request): Promise<any> {
  const text = await req.text();
  if (text.length > JSON_LIMIT) throw new Error('body_too_large');
  try { const p = JSON.parse(text || '{}'); if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('invalid_json'); return p; } catch (e: any) { if (e?.message==='invalid_json') throw e; throw new Error('invalid_json'); }
}

async function listOverrides(env: StoryEnv): Promise<ProviderOverride[]> {
  try { if (env.OC_DB) return await new D1ProviderConfigStore(env.OC_DB).list(); } catch {}
  return [];
}

function hasModel(env: StoryEnv, provider: string | undefined, overrides: ProviderOverride[]): boolean {
  if (provider) return !!resolveDeskProvider(env as DeskBackendEnv, provider, overrides);
  return !!(env.OPENAI_API_KEY || env.OPENAI_BASE_URL !== undefined || env.ANTHROPIC_API_KEY);
}

function modelName(env: StoryEnv, provider: string | undefined, overrides: ProviderOverride[]): string {
  if (provider) { const c = resolveDeskProvider(env as DeskBackendEnv, provider, overrides); if (c) return c.model || (c.protocol==='anthropic'?'claude-sonnet-4-6':'deepseek-chat'); }
  if (env.OPENAI_API_KEY || env.OPENAI_BASE_URL !== undefined) return String(env.OPENAI_MODEL || 'deepseek-chat');
  return String(env.ANTHROPIC_MODEL || 'claude-sonnet-4-6');
}

export async function handleStoryRoutes(request: Request, env: StoryEnv, url: URL): Promise<Response | null> {
  const prefix = '/api/oc/story';
  if (!url.pathname.startsWith(prefix)) return null;
  const rest = url.pathname.slice(prefix.length).replace(/^\/+|\/+$/g, '');

  try {
    // POST /api/oc/story/outline { premise, project, charKey, tone, seedHint, provider }
    if (rest === 'outline' && request.method === 'POST') {
      const body = await readJson(request);
      const premise = typeof body.premise === 'string' ? body.premise : (typeof body.seed === 'string' ? body.seed : '');
      const project = typeof body.project === 'string' ? body.project : '';
      const charKey = typeof body.charKey === 'string' ? body.charKey : '';
      const tone = typeof body.tone === 'string' ? body.tone : '';
      const seedHint = typeof body.seedHint === 'string' ? body.seedHint : '';
      const provider = typeof body.provider === 'string' && body.provider ? body.provider : undefined;
      const overrides = await listOverrides(env);
      const useModel = hasModel(env, provider, overrides);
      if (useModel) {
        try {
          const backend = makeDeskBackend(env as DeskBackendEnv, provider, overrides);
          const req = buildOutlinePrompt({ premise: premise || seedHint, project, charKey, tone, seedHint });
          const gen = await backend.streamChat({ system: req.system, prompt: req.prompt, model: modelName(env, provider, overrides), signal: request.signal, onEvent: undefined });
          if (gen.ok) {
            const parsed = parseOutlineOutput(gen.text);
            if (parsed.ok && parsed.outline) return json(request, env, { success: true, outline: parsed.outline, demo: false, meta: { narration: parsed.narration } });
            // 解析失败则回落 demo，但保留模型原文作 warning
            return json(request, env, { success: true, outline: demoOutline(premise || seedHint), demo: true, warning: parsed.warning, raw: gen.text.slice(0, 2000) });
          }
        } catch { /* fallback demo */ }
      }
      return json(request, env, { success: true, outline: demoOutline(premise || seedHint), demo: true });
    }

    // POST /api/oc/story/start { outline, project, charKey, provider }
    if (rest === 'start' && request.method === 'POST') {
      const body = await readJson(request);
      const outline = body.outline;
      if (!outline || typeof outline !== 'object') return json(request, env, { success: false, error: 'outline 必填' }, 400);
      const project = typeof body.project === 'string' ? body.project : '';
      const charKey = typeof body.charKey === 'string' ? body.charKey : '';
      const provider = typeof body.provider === 'string' && body.provider ? body.provider : undefined;
      const overrides = await listOverrides(env);
      const useModel = hasModel(env, provider, overrides);
      let opening: any = null;
      let demo = false;
      let warning = '';
      if (useModel) {
        try {
          const backend = makeDeskBackend(env as DeskBackendEnv, provider, overrides);
          const req = buildOpeningPrompt(outline as any, { project, charKey });
          const gen = await backend.streamChat({ system: req.system, prompt: req.prompt, model: modelName(env, provider, overrides), signal: request.signal, onEvent: undefined });
          if (gen.ok) {
            const parsed = parseOpeningOutput(gen.text);
            if (parsed.ok && parsed.opening) opening = parsed.opening;
            else { demo = true; warning = parsed.warning || ''; }
          } else demo = true;
        } catch { demo = true; }
      } else demo = true;
      if (!opening) { opening = demoOpening(outline as any); demo = true; }
      // 建会话
      const initState: StoryState = {
        chapter: Number((opening.initialState as any)?.chapter) || 1,
        sceneKey: String((opening.initialState as any)?.sceneKey || (opening.initialState as any)?.scene || '开场') || '开场',
        flags: { ...(opening.initialState as any), mood: (opening.initialState as any)?.mood || '期待' },
        vars: {},
      };
      const session: StorySession = {
        id: buildSessionId(),
        project: project || 'default',
        charKey: charKey || undefined,
        title: (outline as any).title || '未命名剧情',
        outline: outline as any,
        opening,
        state: initState,
        history: [{ role: 'assistant', content: opening.narration, at: new Date().toISOString() }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (env.OC_DB) await new D1StoryStorage(env.OC_DB).save(session as any);
      return json(request, env, { success: true, session, demo, warning });
    }

    // POST /api/oc/story/continue { sessionId, input, provider }
    if (rest === 'continue' && request.method === 'POST') {
      const body = await readJson(request);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const input = typeof body.input === 'string' ? body.input : (typeof body.content === 'string' ? body.content : '');
      if (!sessionId) return json(request, env, { success: false, error: 'sessionId 必填' }, 400);
      const provider = typeof body.provider === 'string' && body.provider ? body.provider : undefined;
      if (!env.OC_DB) return json(request, env, { success: false, error: 'OC_DB 未配置' }, 500);
      const store = new D1StoryStorage(env.OC_DB);
      const sess = await store.get(sessionId) as StorySession | null;
      if (!sess) return json(request, env, { success: false, error: '会话不存在或已过期' }, 404);
      const overrides = await listOverrides(env);
      const useModel = hasModel(env, provider, overrides);
      let narration = '';
      let delta: any = null;
      let demo = false;
      let warning = '';
      if (useModel) {
        try {
          const backend = makeDeskBackend(env as DeskBackendEnv, provider, overrides);
          const req = buildContinuePrompt({ outline: sess.outline as any, state: sess.state as any, history: sess.history, userInput: input });
          const gen = await backend.streamChat({ system: req.system, prompt: req.prompt, model: modelName(env, provider, overrides), signal: request.signal, onEvent: undefined });
          if (gen.ok) {
            const parsed = parseContinueOutput(gen.text);
            narration = parsed.narration;
            if (parsed.ok && parsed.delta) delta = parsed.delta;
            warning = parsed.warning || '';
            if (!parsed.ok) demo = true;
          } else demo = true;
        } catch { demo = true; }
      } else demo = true;
      if (!narration) {
        const d = demoContinue(input, sess.state as StoryState);
        narration = d.narration; delta = d;
      }
      // 应用状态
      const prevState = sess.state as StoryState;
      const nextState = applyStoryState(prevState, delta?.stateChanges);
      const history = [...sess.history, { role: 'user' as const, content: input, at: new Date().toISOString() }, { role: 'assistant' as const, content: narration, at: new Date().toISOString() }];
      const next: StorySession = { ...sess, state: nextState as any, history, updatedAt: new Date().toISOString() };
      await store.save(next as any);
      const cgShould = shouldTriggerCg(nextState as any, delta?.cgEvent);
      return json(request, env, { success: true, narration, state: nextState, history: next.history, delta, cgShould, demo, warning });
    }

    // GET /api/oc/story/session/:id
    if (rest.startsWith('session/') && request.method === 'GET') {
      const id = decodeURIComponent(rest.slice('session/'.length));
      if (!env.OC_DB) return json(request, env, { success: false, error: 'OC_DB 未配置' }, 500);
      const s = await new D1StoryStorage(env.OC_DB).get(id);
      if (!s) return json(request, env, { success: false, error: '会话不存在' }, 404);
      return json(request, env, { success: true, session: s });
    }

    // POST /api/oc/story/attach { windowId, sessionId } -> 把开头旁白落成打字桌首楼（自动进桌后可见）
    if (rest === 'attach' && request.method === 'POST') {
      const body = await readJson(request);
      const windowId = typeof body.windowId === 'string' ? body.windowId.trim() : '';
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      if (!windowId || !sessionId) return json(request, env, { success: false, error: 'windowId 与 sessionId 必填' }, 400);
      if (!env.OC_DB) return json(request, env, { success: false, error: 'OC_DB 未配置' }, 500);
      const sess = await new D1StoryStorage(env.OC_DB).get(sessionId) as StorySession | null;
      if (!sess) return json(request, env, { success: false, error: '会话不存在' }, 404);
      const desk = new D1DeskStorage(env.OC_DB);
      const win = await desk.getWindow(windowId);
      if (!win) return json(request, env, { success: false, error: '写作窗不存在' }, 404);
      const narration = String((sess.opening as any)?.narration || '').trim();
      if (!narration) return json(request, env, { success: false, error: '会话没有开头旁白' }, 400);
      const now = new Date().toISOString();
      // 已有楼层则不重复落（幂等：已有一楼说明已 attach 过）
      const floors = await desk.listFloors(windowId);
      if (floors.length === 0) {
        await desk.createFloor({ id: `floor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, windowId, role: 'assistant', content: narration, variants: [narration], activeVariant: 0, thinking: null, report: { storySessionId: sessionId, storyTitle: (sess as any).title } as any, createdAt: now });
        await desk.updateWindow(windowId, { updatedAt: now });
      }
      return json(request, env, { success: true });
    }

    // GET /api/oc/story/list?project=&limit=
    if (rest === 'list' && request.method === 'GET') {
      const project = (url.searchParams.get('project') || '').trim() || 'default';
      const limit = Number(url.searchParams.get('limit') || '20');
      if (!env.OC_DB) return json(request, env, { success: false, error: 'OC_DB 未配置' }, 500);
      const list = await new D1StoryStorage(env.OC_DB).list(project, Number.isFinite(limit) ? limit : 20);
      return json(request, env, { success: true, sessions: list });
    }

    // DELETE /api/oc/story/session/:id — 删除历史会话/绘画（含索引清理）
    if (rest.startsWith('session/') && request.method === 'DELETE') {
      const id = decodeURIComponent(rest.slice('session/'.length));
      if (!env.OC_DB) return json(request, env, { success: false, error: 'OC_DB 未配置' }, 500);
      const ok = await new D1StoryStorage(env.OC_DB).delete(id);
      if (!ok) return json(request, env, { success: false, error: '会话不存在' }, 404);
      return json(request, env, { success: true });
    }

    return json(request, env, { success: false, error: 'story route not found' }, 404);
  } catch (e: any) {
    if (e?.message === 'invalid_json') return json(request, env, { success: false, error: '请求体不是合法 JSON' }, 400);
    if (e?.message === 'body_too_large') return json(request, env, { success: false, error: '请求体过大' }, 413);
    return json(request, env, { success: false, error: e?.message || '内部错误' }, 500);
  }
}
