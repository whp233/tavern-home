// 酒馆之家存档路由（task-16）：导出/导入 .json 的 HTTP 层。
// 对齐妹居备份结构：{version, timestamp, exportDate, slotId, data{gameData, diary[], settings}}
// 导出 = 全量快照（按 project 可选过滤，默认全库）；导入 = 三格式兼容 + 校验 + 冲突提示，不静默覆盖。
// 写入永远纯追加（新 id 新行），由 src/core/homeSave.ts 的纯函数做格式嗅探/归一化/冲突规划。

import {
  buildHomeSave,
  parseSavePayload,
  planHomeImport,
  emptyExistingSummary,
  diaryKeyOf,
  memoryKeyOf,
  studyKeyOf,
  cgKeyOf,
  chapterKeyOf,
  stickyKeyOf,
  windowTitleKeyOf,
  type NormalizedImport,
  type ExistingSummary,
} from '../../src/core/homeSave.ts';
import { D1DeskStorage } from './adapters/d1DeskStorage.ts';
import { D1DiaryStorage } from './adapters/d1DiaryStorage.ts';
import { D1StudyStorage } from './adapters/d1StudyStorage.ts';
import { D1CgStorage } from './adapters/d1CgStorage.ts';
import { D1StickyNotesStorage } from './adapters/d1StickyNotesStorage.ts';
import { D1DailyLoginStore } from './adapters/d1DailyLoginStore.ts';

interface SaveEnv {
  OC_DB: D1Database;
  [k: string]: any;
}

const JSON_LIMIT = 10 * 1024 * 1024;

function genId(prefix: string): string {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

function safeJsonParse(raw: unknown, fallback: unknown): unknown {
  if (raw == null) return fallback;
  try { return JSON.parse(String(raw)); } catch { return fallback; }
}

function jsonResponse(request: Request, env: SaveEnv, body: unknown, status = 200): Response {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  const origin = (request.headers.get('origin') || '').trim();
  const allowed = String((env as Record<string, unknown>).ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

// ===== 导出：收集全量数据 =====

async function collectExportData(env: SaveEnv, projectFilter?: string) {
  const db = env.OC_DB;
  const deskStorage = new D1DeskStorage(db);
  const windows = projectFilter ? await deskStorage.listWindows(projectFilter) : await deskStorage.listWindows();
  const floors: unknown[] = [];
  for (const w of windows) {
    const list = await deskStorage.listFloors(w.id);
    for (const f of list) floors.push(f);
  }
  const diaryStorage = new D1DiaryStorage(db);
  const diaries = await diaryStorage.listEntries({ limit: 100000 });
  const studyStorage = new D1StudyStorage(db);
  const studyEntries = await studyStorage.listEntries({});
  const cgStorage = new D1CgStorage(db);
  const customCg = await cgStorage.listEntries({ limit: 10000 });
  const stickyStorage = new D1StickyNotesStorage(db);
  let stickyNotes: unknown[] = [];
  try { stickyNotes = await stickyStorage.listNotes({ limit: 10000 }); } catch { stickyNotes = []; }
  let chapters: unknown[] = [];
  try {
    const r = await db.prepare('SELECT * FROM oc_chapters ORDER BY created_at ASC').all<any>();
    chapters = (r.results || []).map((row: any) => ({
      id: row.id, project: row.project || '', chapterNo: row.chapter_no || '',
      title: row.title || '', content: row.content || '', summary: row.summary || '',
      status: row.status || 'draft', createdAt: row.created_at, updatedAt: row.updated_at || null,
      publishedAt: row.published_at || null,
    }));
  } catch { chapters = []; }
  let deskMemories: unknown[] = [];
  try {
    const r = await db.prepare('SELECT * FROM desk_memories ORDER BY created_at ASC').all<any>();
    deskMemories = (r.results || []).map((row: any) => ({
      id: row.id, windowId: row.window_id || '', project: row.project || '',
      charKey: row.char_key || '', layer: row.layer || 'general',
      theme: row.theme || '其他', title: row.title || '', content: row.content || '',
      createdAt: row.created_at, updatedAt: row.updated_at || row.created_at,
    }));
  } catch { deskMemories = []; }
  let settings: Record<string, unknown> = {};
  try {
    const store = new D1DailyLoginStore(db);
    const cfg = await store.getConfig();
    const st = await store.getState();
    settings = { dailyLogin: { config: cfg, state: st } };
  } catch { settings = {}; }
  return { windows, floors, studyEntries, chapters, customCg, stickyNotes, diaries, deskMemories, settings };
}

async function handleExport(request: Request, env: SaveEnv, url: URL): Promise<Response> {
  const project = url.searchParams.get('project')?.trim() || undefined;
  const slotId = url.searchParams.get('slot_id')?.trim() || url.searchParams.get('slotId')?.trim() || undefined;
  const data = await collectExportData(env, project);
  const file = buildHomeSave({
    gameData: {
      windows: data.windows as unknown[],
      floors: data.floors as unknown[],
      studyEntries: data.studyEntries as unknown[],
      chapters: data.chapters as unknown[],
      customCg: data.customCg as unknown[],
      stickyNotes: data.stickyNotes as unknown[],
    },
    diary: data.diaries as unknown[],
    deskMemories: data.deskMemories as unknown[],
    settings: data.settings,
    slotId,
  });
  const body = JSON.stringify(file, null, 2);
  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  const safeSlot = (file.slotId || 'tavern-home').replace(/[^a-zA-Z0-9-_]/g, '_');
  headers.set('Content-Disposition', 'attachment; filename="' + safeSlot + '_' + file.timestamp.slice(0, 10) + '.json"');
  const origin = (request.headers.get('origin') || '').trim();
  const allowed = String((env as Record<string, unknown>).ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return new Response(body, { status: 200, headers });
}

// ===== 导入：校验 + 冲突规划 + 写入 =====

async function collectExistingSummary(env: SaveEnv): Promise<ExistingSummary> {
  const s = emptyExistingSummary();
  const db = env.OC_DB;
  try {
    const r = await db.prepare('SELECT project, char_key, date, content FROM diaries').all<any>();
    for (const row of r.results || []) s.diaryKeys.add(diaryKeyOf({ project: row.project || '', charKey: row.char_key || '', date: row.date || '', content: row.content || '' }));
  } catch {}
  try {
    const r = await db.prepare('SELECT project, char_key, layer, theme, title, content FROM desk_memories').all<any>();
    for (const row of r.results || []) s.memoryKeys.add(memoryKeyOf({ project: row.project || '', charKey: row.char_key || '', layer: row.layer || '', theme: row.theme || '', title: row.title || '', content: row.content || '' }));
  } catch {}
  try {
    const r = await db.prepare('SELECT project, category, title FROM memories').all<any>();
    for (const row of r.results || []) s.studyKeys.add(studyKeyOf({ project: row.project || '', category: row.category || '', title: row.title || '' }));
  } catch {}
  try {
    const r = await db.prepare('SELECT project, char_key, scene_key, title FROM custom_cg').all<any>();
    for (const row of r.results || []) s.cgKeys.add(cgKeyOf({ project: row.project || '', charKey: row.char_key || '', sceneKey: row.scene_key || '', title: row.title || '' }));
  } catch {}
  try {
    const r = await db.prepare('SELECT project, chapter_no, title FROM oc_chapters').all<any>();
    for (const row of r.results || []) s.chapterKeys.add(chapterKeyOf({ project: row.project || '', chapterNo: row.chapter_no || '', title: row.title || '' }));
  } catch {}
  try {
    const row = await db.prepare("SELECT value FROM oc_state WHERE key = 'sticky_notes:all'").first<any>();
    const arr = safeJsonParse(row?.value, []) as unknown[];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          s.stickyKeys.add(stickyKeyOf({ project: String(o.project || ''), charKey: String(o.charKey || ''), title: String(o.title || ''), content: String(o.content || '') }));
        }
      }
    }
  } catch {}
  try {
    const r = await db.prepare('SELECT project, title FROM desk_windows').all<any>();
    for (const row of r.results || []) s.windowTitles.add(windowTitleKeyOf({ project: row.project || '', title: row.title || '' }));
  } catch {}
  return s;
}

async function applyHomeImport(env: SaveEnv, incoming: NormalizedImport, existing: ExistingSummary): Promise<{ added: Record<string, number>; skipped: number; warnings: string[] }> {
  const db = env.OC_DB;
  const added: Record<string, number> = { windows: 0, floors: 0, diaries: 0, deskMemories: 0, studyEntries: 0, chapters: 0, customCg: 0, stickyNotes: 0 };
  let skipped = 0;
  const warnings: string[] = [];
  {
    const storage = new D1DiaryStorage(db);
    for (const d of incoming.diaries) {
      const key = diaryKeyOf(d);
      if (existing.diaryKeys.has(key)) { skipped++; continue; }
      const id = genId('diary');
      try {
        await storage.createEntry({ id, project: d.project, charKey: d.charKey, date: d.date, time: d.time, title: d.title, content: d.content, affection: d.affection, conversationId: d.conversationId, conversationLength: d.conversationLength, createdAt: d.createdAt, updatedAt: d.updatedAt } as any);
        added.diaries++; existing.diaryKeys.add(key);
      } catch (e: any) { warnings.push('diary ' + d.date + ': ' + (e?.message || String(e))); }
    }
  }
  {
    const { D1DeskMemoryStorage } = await import('./adapters/d1DeskMemoryStorage.ts');
    const storage = new D1DeskMemoryStorage(db);
    for (const m of incoming.deskMemories) {
      const key = memoryKeyOf(m);
      if (existing.memoryKeys.has(key)) { skipped++; continue; }
      const id = genId('dmem');
      try {
        await storage.createMemory({ id, windowId: '', project: m.project, charKey: m.charKey, layer: m.layer as any, theme: m.theme, title: m.title, content: m.content, createdAt: m.createdAt, updatedAt: m.updatedAt } as any);
        added.deskMemories++; existing.memoryKeys.add(key);
      } catch (e: any) { warnings.push('memory ' + m.title + ': ' + (e?.message || String(e))); }
    }
  }
  {
    const storage = new D1StudyStorage(db);
    for (const s of incoming.studyEntries) {
      const id = genId('mem');
      const now = new Date().toISOString();
      try {
        await storage.createEntry({ id, project: s.project, category: s.category as any, title: s.title, tags: s.tags, chapter: s.chapter, content: s.content, lore: s.lore as any, createdAt: now, updatedAt: now } as any);
        added.studyEntries++;
      } catch (e: any) { warnings.push('study ' + s.title + ': ' + (e?.message || String(e))); }
    }
  }
  {
    const { D1ReadingStorage } = await import('./adapters/d1ReadingStorage.ts');
    const storage = new D1ReadingStorage(db);
    for (const c of incoming.chapters) {
      const id = genId('ch');
      try {
        await storage.createChapter({ id, project: c.project, chapterNo: c.chapterNo, title: c.title, content: c.content, summary: c.summary, status: c.status as any, createdAt: c.createdAt, updatedAt: c.updatedAt, publishedAt: c.publishedAt } as any);
        added.chapters++;
      } catch (e: any) { warnings.push('chapter ' + c.title + ': ' + (e?.message || String(e))); }
    }
  }
  {
    const storage = new D1CgStorage(db);
    for (const c of incoming.customCg) {
      const id = genId('cg');
      const now = new Date().toISOString();
      try {
        await storage.createEntry({ id, project: c.project, charKey: c.charKey, title: c.title, sceneKey: c.sceneKey, condition: c.condition, imageUrl: c.imageUrl, placeholder: c.placeholder, enabled: c.enabled, createdAt: now, updatedAt: now } as any);
        added.customCg++;
      } catch (e: any) { warnings.push('cg ' + c.title + ': ' + (e?.message || String(e))); }
    }
  }
  {
    const storage = new D1StickyNotesStorage(db);
    for (const n of incoming.stickyNotes) {
      const key = stickyKeyOf(n);
      if (existing.stickyKeys.has(key)) { skipped++; continue; }
      const id = genId('sn');
      const now = new Date().toISOString();
      try {
        await storage.createNote({ id, project: n.project, charKey: n.charKey, title: n.title, content: n.content, color: n.color as any, pinned: n.pinned, createdAt: now, updatedAt: now } as any);
        added.stickyNotes++; existing.stickyKeys.add(key);
      } catch (e: any) { warnings.push('sticky ' + n.title + ': ' + (e?.message || String(e))); }
    }
  }
  if (incoming.windows.length) {
    let fallbackRecipeId = '';
    try {
      const row = await db.prepare('SELECT id FROM desk_recipes ORDER BY created_at ASC, id ASC LIMIT 1').first<any>();
      fallbackRecipeId = row?.id || '';
    } catch {}
    if (!fallbackRecipeId) {
      warnings.push('库里没有任何配方，窗口/楼层未恢复：请先在打字桌建一个配方再重新导入');
    } else {
      const deskStorage = new D1DeskStorage(db);
      for (const win of incoming.windows) {
        const id = genId('dw');
        const now = new Date().toISOString();
        const rawWin = win as unknown as Record<string, unknown>;
        const timelineState = rawWin.timelineState as Record<string, unknown> | undefined;
        const hasRev = timelineState && typeof timelineState.rev === 'number';
        const safeTimeline = hasRev ? timelineState as Record<string, unknown> : { rev: 0, textCount: 0, charCount: 0 };
        try {
          await deskStorage.createWindow({ id, project: win.project || '导入', title: win.title || '导入窗口', recipeId: fallbackRecipeId, charKey: win.charKey || '', note: '', noteDepth: 3, stateBoard: win.stateBoard || {}, timelineState: safeTimeline, vars: win.vars || {}, createdAt: now, updatedAt: now } as any);
          added.windows++;
          for (const f of win.floors) {
            const fid = genId('df');
            try {
              await deskStorage.createFloor({ id: fid, windowId: id, role: f.role as any, content: f.content, variants: f.variants, activeVariant: f.activeVariant, thinking: f.thinking, report: null, createdAt: f.createdAt } as any);
              added.floors++;
            } catch (e: any) { warnings.push('floor ' + fid + ': ' + (e?.message || String(e))); }
          }
        } catch (e: any) { warnings.push('window ' + (win.title || id) + ': ' + (e?.message || String(e))); }
      }
    }
  }
  return { added, skipped, warnings };
}

async function applyStChatImport(env: SaveEnv, floors: import('../../src/core/chatImport.ts').ParsedChatFloor[], body: Record<string, unknown>): Promise<{ windowId: string; floorCount: number; warnings: string[] }> {
  const warnings: string[] = [];
  const project = typeof body.project === 'string' && body.project.trim() ? body.project.trim().slice(0, 100) : '导入';
  const title = typeof body.st_window_title === 'string' && body.st_window_title.trim() ? body.st_window_title.trim().slice(0, 200) : 'ST导入 ' + new Date().toISOString().slice(0, 10);
  const charKey = typeof body.char_key === 'string' ? body.char_key.trim().slice(0, 100) : '';
  const db = env.OC_DB;
  let recipeId = '';
  try {
    const row = await db.prepare('SELECT id FROM desk_recipes ORDER BY created_at ASC, id ASC LIMIT 1').first<any>();
    recipeId = row?.id || '';
  } catch {}
  if (!recipeId) throw new Error('库里没有任何配方，无法创建导入窗口：请先在打字桌建一个配方');
  const deskStorage = new D1DeskStorage(db);
  const wid = genId('dw');
  const now = new Date().toISOString();
  await deskStorage.createWindow({ id: wid, project, title, recipeId, charKey, note: '', noteDepth: 3, stateBoard: {}, timelineState: { rev: 0, textCount: 0, charCount: 0 }, vars: {}, createdAt: now, updatedAt: now } as any);
  let count = 0;
  for (const f of floors) {
    const fid = genId('df');
    try {
      await deskStorage.createFloor({ id: fid, windowId: wid, role: f.role as any, content: f.content, variants: f.variants, activeVariant: f.activeVariant, thinking: null, report: null, createdAt: f.createdAt } as any);
      count++;
    } catch (e: any) { warnings.push('floor ' + fid + ': ' + (e?.message || String(e))); }
  }
  return { windowId: wid, floorCount: count, warnings };
}

async function handleImport(request: Request, env: SaveEnv): Promise<Response> {
  let raw = '';
  try { raw = await request.text(); } catch { return jsonResponse(request, env, { success: false, error: '读取请求体失败' }, 400); }
  if (!raw.trim()) return jsonResponse(request, env, { success: false, error: '请求体为空' }, 400);
  if (raw.length > JSON_LIMIT) return jsonResponse(request, env, { success: false, error: '请求体过大(上限10MB)' }, 413);
  let content = raw;
  let confirmed = false;
  let bodyExtra: Record<string, unknown> = {};
  let filename = '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as Record<string, unknown>).content === 'string') {
      content = String((parsed as Record<string, unknown>).content);
      confirmed = (parsed as Record<string, unknown>).confirmed === true;
      filename = typeof (parsed as Record<string, unknown>).filename === 'string' ? String((parsed as Record<string, unknown>).filename) : '';
      bodyExtra = parsed as Record<string, unknown>;
    }
  } catch {}
  const parsed = parseSavePayload(content);
  if (!parsed.ok) return jsonResponse(request, env, { success: false, error: parsed.error }, 400);
  if (parsed.format === 'st_chat') {
    if (!confirmed) {
      return jsonResponse(request, env, {
        success: true, preview: true, format: 'st_chat',
        detected: { floors: parsed.floors.length },
        warnings: parsed.warnings,
        conflicts: [] as unknown[],
        plan: { add: { windows: 1, floors: parsed.floors.length }, duplicatesSkipped: 0, nothingToDo: false },
        hint: 'st_chat 导入会新建一扇窗口并写入全部楼层；确认后执行（confirmed:true）',
      });
    }
    try {
      const r = await applyStChatImport(env, parsed.floors, bodyExtra);
      return jsonResponse(request, env, { success: true, format: 'st_chat', warnings: [...parsed.warnings, ...r.warnings], imported: { windows: 1, floors: r.floorCount, windowId: r.windowId } });
    } catch (e: any) {
      return jsonResponse(request, env, { success: false, error: e?.message || String(e) }, 500);
    }
  }
  const incoming = parsed.home!;
  const existing = await collectExistingSummary(env);
  const plan = planHomeImport(incoming, existing);
  if (!confirmed) {
    return jsonResponse(request, env, {
      success: true, preview: true, format: parsed.format,
      sourceName: filename || incoming.sourceName || '',
      version: incoming.version, slotId: incoming.slotId,
      warnings: parsed.warnings, conflicts: plan.conflicts, plan,
      counts: {
        incoming: { windows: incoming.windows.length, floors: incoming.windows.reduce((n, w) => n + w.floors.length, 0), diaries: incoming.diaries.length, deskMemories: incoming.deskMemories.length, studyEntries: incoming.studyEntries.length, chapters: incoming.chapters.length, customCg: incoming.customCg.length, stickyNotes: incoming.stickyNotes.length },
      },
      hint: plan.nothingToDo ? '没有可新增的内容（可能已存在或文件为空）' : '预览完成：请确认无误后以 confirmed:true 再次提交以执行导入（仅追加，不覆盖）',
    });
  }
  if (plan.nothingToDo) {
    return jsonResponse(request, env, { success: true, format: parsed.format, warnings: parsed.warnings, conflicts: plan.conflicts, plan, imported: { windows: 0, floors: 0, diaries: 0, deskMemories: 0, studyEntries: 0, chapters: 0, customCg: 0, stickyNotes: 0 }, message: '没有可新增的内容' });
  }
  const applied = await applyHomeImport(env, incoming, existing);
  return jsonResponse(request, env, {
    success: true, format: parsed.format, warnings: [...parsed.warnings, ...applied.warnings],
    conflicts: plan.conflicts, plan, imported: applied.added, skipped: applied.skipped,
  });
}

export async function handleSaveRoutes(request: Request, env: SaveEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/oc/save/export' && request.method === 'GET') return handleExport(request, env, url);
  if (url.pathname === '/api/oc/save/import' && request.method === 'POST') return handleImport(request, env);
  if (url.pathname === '/api/oc/save/preview' && request.method === 'POST') return handleImport(request, env);
  return null;
}