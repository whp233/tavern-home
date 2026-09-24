// examples/cloudflare/trpgRoutes.ts
// TRPG 剧情模式（task-21）路由独立文件。
// 列剧本 / 开始 / 行动 / 结算 + 轻量会话（P0 不落库，后续接 D1/存档）。

import { makeDeskBackend, resolveDeskProvider } from '../../src/adapters/streamModelBackends.ts';
import type { DeskBackendEnv } from '../../src/adapters/streamModelBackends.ts';
import type { ProviderOverride } from '../../src/core/providerConfigStore.ts';
import { D1ProviderConfigStore } from './adapters/d1ProviderConfigStore.ts';
import { D1DeskAssetStorage } from './adapters/d1DeskAssetStorage.ts';
import {
  getScenario,
  listScenarioSummaries,
} from '../../src/core/trpg/scenarioData.ts';
import { buildGmRequest } from '../../src/core/trpg/gmPrompt.ts';
import { parseGmOutput } from '../../src/core/trpg/parseGmOutput.ts';
import { rollDice } from '../../src/core/trpg/dice.ts';
import {
  createInitialState,
  getAction,
  getActionViews,
  resolveActionStep,
} from '../../src/core/trpg/trpgRuntime.ts';
import type {
  GmParsedOutput,
  TrpgActionResult,
  TrpgSession,
  TrpgState,
} from '../../src/core/trpg/types.ts';

interface TrpgRouteEnv {
  [key: string]: any;
  OC_DB?: D1Database;
}

const sessions = new Map<string, TrpgSession>();
const JSON_LIMIT = 256 * 1024;

function corsHeaders(request: Request, env: TrpgRouteEnv): HeadersInit {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const allowed = new Set((env.ALLOWED_ORIGINS || '').split(',').map((v: string) => v.trim()).filter(Boolean));
  if (!allowed.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request: Request, env: TrpgRouteEnv, body: unknown, status = 200): Response {
  const headers = new Headers(corsHeaders(request, env));
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJsonBody(request: Request, maxBytes = JSON_LIMIT): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('body_too_large');
  try {
    const parsed = JSON.parse(text || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json');
    return parsed as Record<string, unknown>;
  } catch (e: any) {
    if (e?.message === 'invalid_json') throw e;
    throw new Error('invalid_json');
  }
}

function buildSessionId(): string {
  return `trpg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultModelName(env: TrpgRouteEnv, provider: string | undefined, overrides: ProviderOverride[] = []): string {
  if (provider) {
    const cfg = resolveDeskProvider(env as DeskBackendEnv, provider, overrides);
    if (cfg) return cfg.model || (cfg.protocol === 'anthropic' ? 'claude-sonnet-4-6' : 'deepseek-chat');
  }
  if (env.OPENAI_API_KEY || env.OPENAI_BASE_URL !== undefined) return String(env.OPENAI_MODEL || 'deepseek-chat');
  return String(env.ANTHROPIC_MODEL || 'claude-sonnet-4-6');
}

async function listProviderOverrides(env: TrpgRouteEnv): Promise<ProviderOverride[]> {
  try {
    if (env.OC_DB) return await new D1ProviderConfigStore(env.OC_DB).list();
  } catch {
    // 路由层不因供应商配置读取失败而崩；回落纯 env。
  }
  return [];
}

function sessionView(session: TrpgSession) {
  const scenario = getScenario(session.scenarioId);
  const views = scenario ? getActionViews(scenario, session.state) : [];
  return {
    sessionId: session.id,
    scenarioId: session.scenarioId,
    state: session.state,
    // 场景选项系统（2026-09-24）：下发「看得见的」动作 + 标志位，由前端决定画什么。
    // 服务端仍会挡掉 visibleExp 为假的（不能从网络包里漏彩蛋）；但**看得见却点不动的**
    // 照常下发，带 locked 标志 —— 参考系 JSK / 1room 都保留未解锁槽位，
    // 让玩家看得见「这里还有东西」，而不是直接消失。
    actions: views,
    // 兼容旧调用方；跑一个版本后再撤。
    availableActions: views.filter((v) => v.enabled).map((v) => v.action),
    ended: session.state.phase !== 'active',
  };
}

async function runAction(
  env: TrpgRouteEnv,
  scenarioId: string,
  state: TrpgState,
  actionId: string,
  provider: string | undefined,
  signal: AbortSignal | undefined,
  extra?: { preferences?: string; charCards?: Array<{ name: string; content: string; fields?: Record<string, string> }> },
): Promise<{ result: TrpgActionResult; demo: boolean }> {
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new Error('剧本不存在');
  const action = getAction(scenario, state.locationId, actionId);
  if (!action) throw new Error('当前地点没有这个动作');

  const overrides = await listProviderOverrides(env);
  const modelName = defaultModelName(env, provider, overrides);
  const useRawModel = provider ? !!resolveDeskProvider(env as DeskBackendEnv, provider, overrides) : (env.OPENAI_API_KEY || env.OPENAI_BASE_URL !== undefined || env.ANTHROPIC_API_KEY);
  let gmOutput: GmParsedOutput | null = null;
  let parseWarning = '';
  let demo = false;

  if (useRawModel) {
    try {
      const backend = makeDeskBackend(env as DeskBackendEnv, provider, overrides);
      const req = buildGmRequest(scenario, state, action, extra);
      const generated = await backend.streamChat({
        system: req.system,
        prompt: req.prompt,
        model: modelName,
        signal,
        onEvent: undefined,
      });
      if (generated.ok) {
        const parsed = parseGmOutput(generated.text);
        gmOutput = parsed.data || null;
        parseWarning = parsed.warning || '';
        if (!gmOutput) {
          gmOutput = { narration: parsed.narration, requiresDice: action.kind === 'check', difficulty: action.difficulty };
        }
      } else {
        demo = true;
      }
    } catch {
      demo = true;
    }
  } else {
    demo = true;
  }

  if (demo) {
    const scenario = getScenario(scenarioId)!;
    const keyEvent = action.keyEventId ? scenario.keyEvents.find((k) => k.id === action.keyEventId) || null : null;
    gmOutput = {
      narration: `你选择了「${action.label}」。${action.description}（演示模式：当前未配置模型供应商，或模型调用不可用，本次按动作预设推进。）`,
      requiresDice: action.kind === 'check' || !!action.difficulty || !!keyEvent?.difficulty,
      difficulty: action.difficulty ?? keyEvent?.difficulty ?? 10,
    };
  }

  const result = resolveActionStep(scenario, state, action, {
    gmOutput,
    demo,
    forcedDice: demo ? undefined : undefined,
  });
  result.narration = gmOutput?.narration || result.narration;
  result.parseWarning = parseWarning || result.parseWarning;
  return { result, demo };
}

export async function handleTrpgRoutes(request: Request, env: TrpgRouteEnv, url: URL): Promise<Response | null> {
  const prefix = '/api/oc/trpg';
  if (!url.pathname.startsWith(prefix)) return null;
  const rest = url.pathname.slice(prefix.length).replace(/^\/+|\/+$/g, '');

  try {
    // 列剧本
    if (rest === 'scenarios' && request.method === 'GET') {
      return json(request, env, { success: true, scenarios: listScenarioSummaries() });
    }

    // 开始（支持玩家偏好+多角色卡定制）
    if (rest === 'start' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const scenarioId = typeof body.scenarioId === 'string' ? body.scenarioId : '';
      const scenario = getScenario(scenarioId);
      if (!scenario) return json(request, env, { success: false, error: '剧本不存在' }, 404);
      const preferences = typeof body.preferences === 'string' ? body.preferences.trim().slice(0, 2000) : (typeof body.customPreferences === 'string' ? body.customPreferences.trim().slice(0, 2000) : '');
      const project = typeof body.project === 'string' ? body.project.trim() : '';
      let charCards: Array<{ name: string; content: string; fields?: Record<string, string> }> = [];
      if (Array.isArray(body.charCards)) {
        charCards = (body.charCards as any[])
          .filter((c) => c && typeof c.name === 'string' && c.name.trim())
          .map((c) => ({ name: String(c.name).trim().slice(0, 100), content: String(c.content || '').slice(0, 2000), fields: c.fields && typeof c.fields === 'object' ? c.fields as Record<string, string> : undefined }))
          .slice(0, 6);
      } else if (Array.isArray(body.charNames) && project && env.OC_DB) {
        try {
          const lore = await new D1DeskAssetStorage(env.OC_DB).listLore(project);
          const names: string[] = (body.charNames as any[]).filter((n) => typeof n === 'string' && n.trim()).map((n) => String(n).trim());
          charCards = lore
            .filter((r) => names.includes(r.name))
            .map((r) => ({ name: r.name, content: r.content || '', fields: r.fields as Record<string, string> }))
            .slice(0, 6);
        } catch {}
      }
      const state = createInitialState(scenario);
      const id = buildSessionId();
      const session: TrpgSession = { id, scenarioId, createdAt: new Date().toISOString(), state, history: [], custom: { preferences: preferences || undefined, charCards: charCards.length ? charCards : undefined, project: project || undefined } };
      sessions.set(id, session);
      return json(request, env, {
        success: true,
        session: sessionView(session),
        scenario: {
          id: scenario.id,
          name: scenario.name,
          info: scenario.info,
          difficulty: scenario.difficulty,
          estimatedTime: scenario.estimatedTime,
          tags: scenario.tags,
          intro: scenario.scenario.intro,
        },
        custom: session.custom,
      });
    }

    // 会话详情
    // ⚠️ 修 2026-09-24：原判据 `!rest.includes('/')` 恒为假 —— rest 此时就是 `session/<id>`，
    // 本身就含 `/`，所以这个分支从来没进过，GET /session/<id> 一律 404。
    // 前端每次行动后都靠它刷新动作列表，因此表现为「点了动作，按钮不变」。
    if (rest.startsWith('session/') && request.method === 'GET'
        && !rest.slice('session/'.length).includes('/')) {
      const id = decodeURIComponent(rest.slice('session/'.length));
      const session = sessions.get(id);
      if (!session) return json(request, env, { success: false, error: '会话不存在或已过期' }, 404);
      return json(request, env, { success: true, session: sessionView(session) });
    }

    // 行动（沿用开局时的偏好/角色卡；也允许本次覆盖）
    if (rest === 'action' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const actionId = typeof body.actionId === 'string' ? body.actionId : '';
      const provider = typeof body.provider === 'string' && body.provider ? body.provider : undefined;
      const session = sessions.get(sessionId);
      if (!session) return json(request, env, { success: false, error: '会话不存在或已过期' }, 404);
      if (session.state.phase !== 'active') return json(request, env, { success: false, error: '本局已经结束，请重新开始' }, 400);
      // 允许本次 action 覆盖定制（否则沿用开局 custom）
      const overridePrefs = typeof body.preferences === 'string' ? body.preferences.trim().slice(0, 2000) : undefined;
      if (overridePrefs !== undefined) session.custom = { ...(session.custom || {}), preferences: overridePrefs || undefined };
      const extra = session.custom ? { preferences: session.custom.preferences, charCards: session.custom.charCards } : undefined;

      // 门禁在服务端也要判（2026-09-24）：enableExp 不能只是画个灰。
      // 否则前端把按钮置灰、脚本照样能 POST 上来 —— 那 visibleExp / enableExp 就只是装饰。
      // 判定与展示共用同一份 getActionViews，不存在两套逻辑漂移的可能。
      // 顺序：先判门禁再跑模型 —— 没解锁的动作不该白烧一次生成。
      const gateScenario = getScenario(session.scenarioId);
      if (gateScenario) {
        const view = getActionViews(gateScenario, session.state).find((v) => v.action.id === actionId);
        if (!view) return json(request, env, { success: false, error: '当前地点没有这个动作' }, 400);
        if (!view.enabled) return json(request, env, { success: false, error: '这个动作还没解锁' }, 400);
      }

      const { result } = await runAction(env, session.scenarioId, session.state, actionId, provider, request.signal, extra);
      result.sessionId = session.id;
      session.state = result.state;
      session.history.push(`${result.actionId}: ${result.narration}`);
      return json(request, env, { success: true, result });
    }

    // 结算
    if (rest === 'settle' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const session = sessions.get(sessionId);
      if (!session) return json(request, env, { success: false, error: '会话不存在或已过期' }, 404);
      if (session.state.phase === 'active') return json(request, env, { success: false, error: '本局还在进行中，没有可结算的结局' }, 400);
      const scenario = getScenario(session.scenarioId);
      const ending = scenario?.endings.find((e) => e.id === session.state.phase || e.id === session.state.phase)
        ?? scenario?.endings.find((e) => {
          if (session.state.phase === 'victory') return e.bonusReward !== undefined;
          if (session.state.phase === 'failure') return e.penaltyReward !== undefined;
          return true;
        }) ?? null;
      return json(request, env, {
        success: true,
        settlement: {
          sessionId: session.id,
          phase: session.state.phase,
          ending,
          state: session.state,
          message: ending ? `已结算「${ending.name}」` : '已结算',
        },
      });
    }

    return json(request, env, { success: false, error: 'trpg route not found' }, 404);
  } catch (e: any) {
    if (e?.message === 'invalid_json') return json(request, env, { success: false, error: '请求体不是合法 JSON' }, 400);
    if (e?.message === 'body_too_large') return json(request, env, { success: false, error: '请求体过大' }, 413);
    return json(request, env, { success: false, error: e?.message || '内部错误' }, 500);
  }
}
