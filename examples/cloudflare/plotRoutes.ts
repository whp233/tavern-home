// examples/cloudflare/plotRoutes.ts
// 26A 剧情双分支 → 小纸条：POST /api/oc/plot/outline
// Path A 有种子 → plotOutline.generate({seed})
// Path B 无种子 → generateContinuation({project,charKey}) 取最近窗 floors + last diary + 记忆 → 共用大纲结构 title/summary/beats/tags
// 文风：extractWorkStyle({workTitle}) 查 docs/styles 预设，无则 LLM 推断 3-5 锚点
// 统一 fillNoteFromOutline → desk_windows.note depth 3 → 开新窗二次确认；大纲落 outline 类（可选 lore）

import { makeDeskBackend, resolveDeskProvider } from '../../src/adapters/streamModelBackends.ts';
import type { DeskBackendEnv } from '../../src/adapters/streamModelBackends.ts';
import type { ProviderOverride } from '../../src/core/providerConfigStore.ts';
import { D1ProviderConfigStore } from './adapters/d1ProviderConfigStore.ts';
import { D1DeskStorage } from './adapters/d1DeskStorage.ts';
import { D1DiaryStorage } from './adapters/d1DiaryStorage.ts';
import { D1DeskMemoryStorage } from './adapters/d1DeskMemoryStorage.ts';
import { buildPlotOutlinePrompt, buildContinuationPrompt, parsePlotOutlineOutput, demoOutline, fillNoteFromOutline, normalizePlotOutline } from '../../src/core/plotOutline.ts';
import { getPresetStyle, buildStylePrompt, parseStyleAnchors, buildStyleFallbackAnchors } from '../../src/core/styleProfile.ts';

interface PlotEnv { [k: string]: any; OC_DB?: D1Database; }

const JSON_LIMIT = 256 * 1024;

function json(req: Request, env: PlotEnv, body: unknown, status = 200): Response {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  const origin = req.headers.get('origin');
  if (origin && env.ALLOWED_ORIGINS) {
    const allowed = new Set(String(env.ALLOWED_ORIGINS).split(',').map((v: string) => v.trim()).filter(Boolean));
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
  try { const p = JSON.parse(text || '{}'); if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('invalid_json'); return p; } catch (e: any) { if (e?.message === 'invalid_json') throw e; throw new Error('invalid_json'); }
}

async function listOverrides(env: PlotEnv): Promise<ProviderOverride[]> {
  try { if (env.OC_DB) return await new D1ProviderConfigStore(env.OC_DB).list(); } catch {}
  return [];
}

function hasModel(env: PlotEnv, provider: string | undefined, overrides: ProviderOverride[]): boolean {
  if (provider) return !!resolveDeskProvider(env as DeskBackendEnv, provider, overrides);
  return !!(env.OPENAI_API_KEY || env.OPENAI_BASE_URL !== undefined || env.ANTHROPIC_API_KEY);
}

function modelName(env: PlotEnv, provider: string | undefined, overrides: ProviderOverride[]): string {
  if (provider) { const c = resolveDeskProvider(env as DeskBackendEnv, provider, overrides); if (c) return c.model || (c.protocol === 'anthropic' ? 'claude-sonnet-4-6' : 'deepseek-chat'); }
  if (env.OPENAI_API_KEY || env.OPENAI_BASE_URL !== undefined) return String(env.OPENAI_MODEL || 'deepseek-chat');
  return String(env.ANTHROPIC_MODEL || 'claude-sonnet-4-6');
}

async function resolveWorkAnchors(env: PlotEnv, workTitle: string | undefined, provider: string | undefined, overrides: ProviderOverride[]): Promise<string[]> {
  const title = typeof workTitle === 'string' ? workTitle.trim() : '';
  const preset = title ? getPresetStyle(title) : null;
  if (preset) return preset.anchors;
  // 无预设 → 尝试 LLM 推断
  if (title && hasModel(env, provider, overrides)) {
    try {
      const backend = makeDeskBackend(env as DeskBackendEnv, provider, overrides);
      const req = buildStylePrompt(title);
      const gen = await backend.streamChat({ system: req.system, prompt: req.prompt, model: modelName(env, provider, overrides), signal: AbortSignal.timeout(30_000), onEvent: undefined });
      if (gen.ok) {
        const parsed = parseStyleAnchors(gen.text);
        if (parsed) return parsed;
      }
    } catch {}
  }
  return buildStyleFallbackAnchors(title);
}

export async function handlePlotRoutes(request: Request, env: PlotEnv, url: URL): Promise<Response | null> {
  const prefix = '/api/oc/plot';
  if (!url.pathname.startsWith(prefix)) return null;
  const rest = url.pathname.slice(prefix.length).replace(/^\/+|\/+$/g, '');

  try {
    // POST /api/oc/plot/outline { project, charKey, seed, workTitle, windowId, provider, preview }
    if (rest === 'outline' && request.method === 'POST') {
      const body = await readJson(request);
      const project = typeof body.project === 'string' ? body.project.trim() : '';
      const charKey = typeof body.charKey === 'string' ? body.charKey.trim() : (typeof body.char_key === 'string' ? body.char_key.trim() : '');
      const intentAlias = typeof body.intentText === 'string' && body.intentText.trim() ? body.intentText.trim() : (typeof body.freeText === 'string' && body.freeText.trim() ? body.freeText.trim() : (typeof body.intent === 'string' && body.intent.trim() ? body.intent.trim() : ''));
      const seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim() : (intentAlias || (typeof body.premise === 'string' ? body.premise.trim() : (typeof body.description === 'string' ? body.description.trim() : '')));
      const workTitle = typeof body.workTitle === 'string' && body.workTitle.trim() ? body.workTitle.trim() : (typeof body.work_title === 'string' && body.work_title.trim() ? body.work_title.trim() : intentAlias);
      const windowId = typeof body.windowId === 'string' ? body.windowId.trim() : (typeof body.window_id === 'string' ? body.window_id.trim() : '');
      const preview = body.preview === true;
      const provider = typeof body.provider === 'string' && body.provider ? body.provider : undefined;
      const overrides = await listOverrides(env);
      const workAnchors = await resolveWorkAnchors(env, workTitle, provider, overrides);
      let outline: any = null;
      let demo = false;
      // 直传 outline 且带 windowId → 直接落小纸条，不再重生成（前端二次确认用）
      if (body.outline && typeof body.outline === 'object' && windowId && !preview) {
        const norm = normalizePlotOutline(body.outline);
        if (norm) {
          norm.styleAnchors = workAnchors;
          const filled2 = fillNoteFromOutline(norm, workAnchors);
          try {
            if (!env.OC_DB) throw new Error('OC_DB 未配置');
            const now2 = new Date().toISOString();
            const res2 = await env.OC_DB.prepare(`UPDATE desk_windows SET note = ?, note_depth = ?, updated_at = ? WHERE id = ?`).bind(filled2.note, filled2.depth, now2, windowId).run();
            if (res2.meta && res2.meta.changes === 1) {
              return json(request, env, { success: true, outline: norm, note: filled2.note, noteDepth: filled2.depth, workTitle: workTitle || null, workAnchors, branch: seed ? 'A' : 'B', demo: false, filledWindowId: windowId });
            }
          } catch (e: any) { return json(request, env, { success: false, error: `落小纸条失败: ${e?.message || e}` }, 500); }
        }
      }
      const isBranchA = !!seed;
      if (isBranchA) {
        // Path A: 有种子
        if (hasModel(env, provider, overrides)) {
          try {
            const backend = makeDeskBackend(env as DeskBackendEnv, provider, overrides);
            const req = buildPlotOutlinePrompt({ seed, project, charKey, workTitle, workAnchors });
            const gen = await backend.streamChat({ system: req.system, prompt: req.prompt, model: modelName(env, provider, overrides), signal: request.signal, onEvent: undefined });
            if (gen.ok) {
              const parsed = parsePlotOutlineOutput(gen.text);
              if (parsed.ok && parsed.outline) outline = parsed.outline;
            }
          } catch {}
        }
        if (!outline) { outline = demoOutline(seed, workTitle); demo = !hasModel(env, provider, overrides); }
      } else {
        // Path B: 无种子 → 取最近剧情 + 记忆 + 日记
        let recentFloors: Array<{ role: string; content: string }> = [];
        let lastDiary: { date: string; title: string; content: string } | null = null;
        let memories: string[] = [];
        if (env.OC_DB) {
          // 最近窗
          try {
            const desk = new D1DeskStorage(env.OC_DB);
            const windows = await desk.listWindows(project || undefined);
            // 按 updated_at 降序，listWindows 已按 updated_at DESC
            const sorted = windows.slice().sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
            const win = sorted[0];
            if (win) {
              const floors = await desk.listFloors(win.id);
              recentFloors = floors.slice(-6).map((f: any) => ({ role: f.role, content: f.content }));
            } else if (windowId) {
              const floors = await desk.listFloors(windowId);
              recentFloors = floors.slice(-6).map((f: any) => ({ role: f.role, content: f.content }));
            }
          } catch {}
          // last diary
          try {
            const diaryStore = new D1DiaryStorage(env.OC_DB);
            const entries = await diaryStore.listEntries({ project: project || undefined, charKey: charKey || undefined, limit: 1 });
            if (entries[0]) lastDiary = { date: entries[0].date, title: entries[0].title, content: entries[0].content };
          } catch {}
          // memories
          try {
            const memStore = new D1DeskMemoryStorage(env.OC_DB);
            const rows = await memStore.listByScope({ project: project || '', charKey: charKey || '' });
            memories = rows.slice(0, 5).map((m: any) => `${m.title}: ${String(m.content).slice(0, 80)}`);
          } catch {}
        }
        if (hasModel(env, provider, overrides)) {
          try {
            const backend = makeDeskBackend(env as DeskBackendEnv, provider, overrides);
            const req = buildContinuationPrompt({ project: project || 'default', charKey, workTitle, workAnchors, recentFloors, lastDiary, memories });
            const gen = await backend.streamChat({ system: req.system, prompt: req.prompt, model: modelName(env, provider, overrides), signal: request.signal, onEvent: undefined });
            if (gen.ok) {
              const parsed = parsePlotOutlineOutput(gen.text);
              if (parsed.ok && parsed.outline) outline = parsed.outline;
            }
          } catch {}
        }
        if (!outline) { outline = demoOutline(seed || (lastDiary?.title ? `续·${lastDiary.title}` : undefined), workTitle); demo = true; }
        // 补充上下文回显，前端可展示“基于…续出”
        (outline as any)._context = { recentFloorsCount: recentFloors.length, hasDiary: !!lastDiary, memoriesCount: memories.length };
      }

      outline.styleAnchors = workAnchors;
      const filled = fillNoteFromOutline(outline, workAnchors);
      // 若指定 windowId 且非预览，则落小纸条
      let filledWindowId: string | null = null;
      if (windowId && !preview) {
        try {
          if (!env.OC_DB) throw new Error('OC_DB 未配置');
          // 直接 UPDATE desk_windows note/note_depth
          const now = new Date().toISOString();
          const res = await env.OC_DB.prepare(`UPDATE desk_windows SET note = ?, note_depth = ?, updated_at = ? WHERE id = ?`).bind(filled.note, filled.depth, now, windowId).run();
          if (res.meta && res.meta.changes === 1) filledWindowId = windowId;
        } catch (e: any) {
          return json(request, env, { success: false, error: `落小纸条失败: ${e?.message || e}` }, 500);
        }
      }

      // 可选：大纲落 outline 类 world lore，便于 deskAssemble 的 worldInfoBefore/After 拾取（常驻）
      // 仅在 project 非空且非预览时尝试，失败不阻主流程
      if (project && !preview) {
        try {
          if (env.OC_DB) {
            const id = `lore_outline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const now = new Date().toISOString();
            // 查是否已有同名 outline，若有则更新，否则插入（幂等：标题唯一）
            const existing = await env.OC_DB.prepare(`SELECT id FROM desk_lore WHERE project = ? AND category = 'outline' AND name = ? LIMIT 1`).bind(project, outline.title).first<any>().catch(() => null);
            if (existing?.id) {
              await env.OC_DB.prepare(`UPDATE desk_lore SET content = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify({ title: outline.title, summary: outline.summary, beats: outline.beats, tags: outline.tags }), now, existing.id).run();
            } else {
              // desk_lore 列：id, project, name, content, keys, position, is_character, constant, trigger_mode, category, fields, created_at, updated_at
              const content = `【大纲】${outline.title}\n${outline.summary}\n节拍：${outline.beats.join(' → ')}\n标签：${(outline.tags || []).join('、')}`;
              const keys = JSON.stringify([outline.title, ...(outline.tags || [])].filter(Boolean));
              const fields = JSON.stringify({});
              await env.OC_DB.prepare(
                `INSERT INTO desk_lore (id, project, name, content, keys, position, is_character, constant, trigger_mode, category, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'before', 0, 0, 'scan', 'outline', ?, ?, ?)`
              ).bind(id, project, outline.title, content, keys, fields, now, now).run().catch(() => {});
            }
          }
        } catch {}
      }

      return json(request, env, {
        success: true,
        outline,
        note: filled.note,
        noteDepth: filled.depth,
        workTitle: workTitle || null,
        workAnchors,
        branch: isBranchA ? 'A' : 'B',
        demo,
        filledWindowId,
      });
    }

    return json(request, env, { success: false, error: 'plot route not found' }, 404);
  } catch (e: any) {
    if (e?.message === 'invalid_json') return json(request, env, { success: false, error: '请求体不是合法 JSON' }, 400);
    if (e?.message === 'body_too_large') return json(request, env, { success: false, error: '请求体过大' }, 413);
    return json(request, env, { success: false, error: e?.message || '内部错误' }, 500);
  }
}
