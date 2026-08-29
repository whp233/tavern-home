// src/tools/chapterMemory.ts
// 章节记忆机制（task-18）+ 参考风格（task-19）REST 数据层。
//   · 章节索引：oc_state `desk_chapter_index:<project>`（零迁移，收口窗在途不碰 schema/migrations）。
//   · 统一检索入口：章节索引 + 打字桌记忆(desk_memories 分层) + 世界书(memories 表 world/outline)
//     三源聚合，词条命中计分（非全文搜索），多轮放宽 + 轮数上限防死循环。
//   · 整合整理（流程A收尾）：用户指定章节或 auto 建议位 → 模型抽取主题/关键事件/角色状态 →
//     索引条目标记 integrated=true，并把剧情要点并进 desk_memories plot 层（衔接 task-10）。
// 校验/合并/检索/简报全是 src/core/deskMemory.ts 纯函数；这里只做请求壳与模型调用。

import {
  sanitizeChapterIndexEntry, aggregateRetrieval, buildContinuationBrief,
  renderMemoriesText, renderChapterIndexText, mergeMemories, RETRIEVAL_SOURCE_LABEL,
  buildChapterIntegrateSystem, buildChapterIntegrateInput, parseIntegrateOutput,
  type ChapterIndexEntry, type MergeMemoryInput, type RetrievalRecord,
} from '../core/deskMemory.ts';
import { sanitizeStyleRefConfig, renderStyleRefBlock } from '../core/deskGenerationService.ts';
import { completeText, type CompleteTextUsage } from '../chat/modelBackend.ts';
import { makeD1UsageSink } from '../storage/usageSink.ts';
import { D1DeskChapterMemoryStore } from '../../examples/cloudflare/adapters/d1DeskChapterMemoryStorage.ts';
import { D1DeskMemoryStorage } from '../../examples/cloudflare/adapters/d1DeskMemoryStorage.ts';
import { D1DeskAssetStorage } from '../../examples/cloudflare/adapters/d1DeskAssetStorage.ts';

interface ChapterMemoryEnv {
  OC_DB: D1Database;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  [k: string]: any;
}

const storeOf = (env: ChapterMemoryEnv) => new D1DeskChapterMemoryStore(env.OC_DB);
const memStoreOf = (env: ChapterMemoryEnv) => new D1DeskMemoryStorage(env.OC_DB);

// 整合整理默认模型（与自动成书同档）；单请求最多整理章数：每章一次模型调用，8 章 ≈ 最坏十几分钟量级
// 的极端情形实际由 completeText 100s 超时兜底，前端可对 failed 续跑。
export const INTEGRATE_MODEL = 'claude-sonnet-4-6';
export const CHAPTERS_PER_INTEGRATE = 8;

function requireProject(params: any): string | null {
  const project = typeof params?.project === 'string' ? params.project.trim() : '';
  return project || null;
}

// ===== 章节索引 CRUD =====

export async function chapterIndexList(env: ChapterMemoryEnv, params: any): Promise<any> {
  const project = requireProject(params);
  if (!project) return { success: false, error: 'project 必填' };
  try {
    const entries = await storeOf(env).listIndex(project);
    return {
      success: true,
      project,
      count: entries.length,
      integrated_count: entries.filter((e) => e.integrated).length,
      entries,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// 手工维护入口：body {project, entry:{...}} 或 {project, entries:[{...}, ...]}。
export async function chapterIndexUpsert(env: ChapterMemoryEnv, body: any): Promise<any> {
  const project = requireProject(body);
  if (!project) return { success: false, error: 'project 必填' };
  const rawList: unknown[] = Array.isArray(body.entries) ? body.entries : body.entry ? [body.entry] : [];
  if (!rawList.length) return { success: false, error: 'entry 或 entries 必填' };
  const incoming = rawList
    .map((e) => sanitizeChapterIndexEntry(e as Partial<ChapterIndexEntry>))
    .filter((e): e is ChapterIndexEntry => !!e);
  if (!incoming.length) return { success: false, error: '没有合法条目（chapterNo 必填）' };
  try {
    const r = await storeOf(env).upsertEntries(project, incoming);
    return { success: true, project, added: r.added, updated: r.updated, count: r.entries.length, entries: r.entries };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function chapterIndexDelete(env: ChapterMemoryEnv, params: any): Promise<any> {
  const project = requireProject(params);
  const chapterNo = typeof params?.chapter_no === 'string' ? params.chapter_no.trim() : '';
  if (!project || !chapterNo) return { success: false, error: 'project 与 chapter_no 必填' };
  try {
    const removed = await storeOf(env).deleteEntry(project, chapterNo);
    return removed ? { success: true } : { success: false, error: '索引条目不存在' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ===== 参考小说/风格（task-19）：配置读写 =====

export async function styleRefGet(env: ChapterMemoryEnv, params: any): Promise<any> {
  const project = requireProject(params);
  if (!project) return { success: false, error: 'project 必填' };
  try {
    const config = await storeOf(env).getStyleRef(project);
    return { success: true, project, config };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function styleRefPut(env: ChapterMemoryEnv, body: any): Promise<any> {
  const project = requireProject(body);
  if (!project) return { success: false, error: 'project 必填' };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { success: false, error: 'request body must be a JSON object' };
  try {
    // 全量 PUT：未带字段视为清空（前端保存整张表单），避免半张表单悄悄保留旧值。
    const config = await storeOf(env).putStyleRef(project, sanitizeStyleRefConfig({
      enabled: body.enabled,
      bookTitle: typeof body.book_title === 'string' ? body.book_title : body.bookTitle,
      styleNotes: typeof body.style_notes === 'string' ? body.style_notes : body.styleNotes,
      excerpt: typeof body.excerpt === 'string' ? body.excerpt : '',
    }));
    return { success: true, project, config };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ===== 统一检索入口（流程B）：三源聚合 + 简报拼装 =====

// 三源装载（章节索引 + 打字桌记忆共享区/角色区 + 世界书）。任何一源读失败都退空继续，
// 检索是增强不是硬依赖——绝不因杂源抖动打断装配。
export async function loadNovelContextSources(env: ChapterMemoryEnv, project: string, charKey = ''): Promise<{
  indexEntries: ChapterIndexEntry[];
  memories: import('../core/types.ts').DeskMemory[];
  lore: Array<{ id: string; name: string; content: string }>;
}> {
  const indexEntries = await storeOf(env).listIndex(project);
  const memStore = memStoreOf(env);
  const memories = [...await memStore.listByScope({ project, charKey: '' })];
  if (charKey) memories.push(...await memStore.listByScope({ project, charKey }));
  let lore: Array<{ id: string; name: string; content: string }> = [];
  try {
    lore = (await new D1DeskAssetStorage(env.OC_DB).listLore(project)).map((l) => ({ id: l.id, name: l.name, content: l.content }));
  } catch { lore = []; }
  return { indexEntries, memories, lore };
}

// 检索 + 简报一步到位。deskBook 成书、聊天装配、REST /novel/retrieve 三处共用同一实现，
// 保证「工具查找相关情节」口径全链路一致。
export async function buildNovelRetrieval(env: ChapterMemoryEnv, opts: {
  project: string;
  query: string;
  charKey?: string;
  limit?: number;
}): Promise<{
  records: RetrievalRecord[];
  brief: string;
  roundsUsed: number;
  exhausted: boolean;
  indexEntries: ChapterIndexEntry[];
}> {
  const { indexEntries, memories, lore } = await loadNovelContextSources(env, opts.project, opts.charKey || '');
  const agg = aggregateRetrieval({
    query: opts.query,
    indexEntries, memories, lore,
    limit: opts.limit,
  });
  const memoriesText = renderMemoriesText(memories);
  const brief = buildContinuationBrief({ indexEntries, records: agg.records, memoriesText });
  return { records: agg.records, brief, roundsUsed: agg.roundsUsed, exhausted: agg.exhausted, indexEntries };
}

export async function novelContextRetrieve(env: ChapterMemoryEnv, body: any): Promise<any> {
  const project = requireProject(body);
  if (!project) return { success: false, error: 'project 必填' };
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  const charKey = typeof body?.char_key === 'string' ? body.char_key.trim() : '';
  try {
    const r = await buildNovelRetrieval(env, {
      project, query, charKey,
      limit: Number.isInteger(body?.limit) && (body.limit as number) > 0 ? Math.min(body.limit as number, 20) : undefined,
    });
    return {
      success: true,
      project,
      query_used: query,
      records: r.records.map((rec) => ({ source: rec.source, title: rec.title, text: rec.text, score: rec.score })),
      brief: r.brief,
      rounds_used: r.roundsUsed,
      exhausted: r.exhausted,
      index_size: r.indexEntries.length,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// 聊天装配用附录（task-18 流程B / task-19）：前文提要（索引大纲视图）+ 相关情节记录 + 参考风格块。
// 刻意不含记忆段——聊天装配已自行渲染 desk_memories（renderMemoriesText），这里再拼会重复注入。
// 26E 显式参考书：仅当 window.vars.refBookIds 非空时注入，且仅对选书注入
export function parseRefBookIds(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  const s = String(raw).trim();
  if (!s) return [];
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) return j.map((x) => String(x).trim()).filter(Boolean);
  } catch {}
  return s.split(/[,\s，、]+/).map((x) => x.trim()).filter(Boolean);
}
export async function buildChatAppendix(env: ChapterMemoryEnv, opts: {
  project: string;
  query: string;
  charKey?: string;
  refBookIds?: string[];
}): Promise<{ appendix: string; styleBlock: string }> {
  // 26E：未选书不注入
  if (opts.refBookIds && opts.refBookIds.length === 0) return { appendix: '', styleBlock: '' };
  let { indexEntries, memories, lore } = await loadNovelContextSources(env, opts.project, opts.charKey || '');
  if (opts.refBookIds && opts.refBookIds.length) {
    const ids = new Set(opts.refBookIds);
    // 显式选书：仅保留命中 id/标题 的条目
    lore = lore.filter((l) => ids.has(l.id) || ids.has(l.name));
    indexEntries = indexEntries.filter((e) => ids.has(e.chapterNo) || ids.has(e.title) || ids.has(e.sourceChapterId));
    // 无命中时不注入，避免空转
    if (!lore.length && !indexEntries.length) return { appendix: '', styleBlock: '' };
  }
  const agg = aggregateRetrieval({ query: opts.query, indexEntries, memories, lore });
  const parts: string[] = [];
  const digest = renderChapterIndexText(indexEntries, { limit: 12 });
  if (digest) parts.push(`【前文提要·章节索引】\n${digest}`);
  const recs = agg.records.filter((r) => r.text.trim());
  if (recs.length) {
    parts.push(`【相关情节记录】\n${recs.map((r) => `- [${RETRIEVAL_SOURCE_LABEL[r.source]}] ${r.title ? `${r.title}：` : ''}${r.text.replace(/\s*\n+\s*/g, ' ')}`).join('\n')}`);
  }
  let styleBlock = '';
  try {
    styleBlock = renderStyleRefBlock(await storeOf(env).getStyleRef(opts.project));
  } catch { styleBlock = ''; }
  return { appendix: parts.join('\n\n'), styleBlock };
}

// ===== 整合整理（流程A收尾）：选择章节 → 抽取 → 标记完成 + 记忆落库 =====

interface ChapterRow {
  id: string;
  chapter_no: string;
  title: string;
  summary: string;
  content: string;
}

async function listProjectChapters(env: ChapterMemoryEnv, project: string): Promise<ChapterRow[]> {
  const rows = (await env.OC_DB.prepare(
    `SELECT id, chapter_no, title, summary, content FROM oc_chapters WHERE project = ?`,
  ).bind(project).all<any>()).results || [];
  return rows.map((r: any) => ({
    id: String(r.id ?? ''),
    chapter_no: String(r.chapter_no ?? '').trim(),
    title: String(r.title ?? ''),
    summary: String(r.summary ?? ''),
    content: String(r.content ?? ''),
  }));
}

// 整合整理主入口：
//   body {project, chapters?: string[]（章号列表=用户指定）, auto?: boolean（未整理优先=建议位）,
//         extract?: boolean（默认 true，跳过抽取只登记基础条目）, char_key?, model?}
// 返回逐章结果明细，失败的章不标记完成、可在下一轮重试。
export async function chapterIntegrate(env: ChapterMemoryEnv, body: any): Promise<any> {
  const project = requireProject(body);
  if (!project) return { success: false, error: 'project 必填' };
  const extract = body?.extract !== false; // 默认走模型抽取；extract=false 只登记基础条目（可跳过步骤）
  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : INTEGRATE_MODEL;
  const charKey = typeof body?.char_key === 'string' ? body.char_key.trim() : '';

  let chapters: ChapterRow[];
  try {
    chapters = (await listProjectChapters(env, project)).filter((c) => c.chapter_no);
  } catch (err: any) {
    return { success: false, error: err.message };
  }

  const requested = Array.isArray(body?.chapters)
    ? [...new Set((body.chapters as unknown[]).map((n) => String(n ?? '').trim()).filter(Boolean))]
    : [];
  const byNo = new Map(chapters.map((c) => [c.chapter_no, c]));
  let targets: ChapterRow[];
  if (requested.length) {
    targets = requested.map((no) => byNo.get(no)).filter((c): c is ChapterRow => !!c); // 用户选择为主
  } else if (body?.auto === true) {
    // 建议位（确定性规则）：还没进索引 / 进了但未标记完成的章优先。
    const existing = new Map((await storeOf(env).listIndex(project)).map((e) => [e.chapterNo, e]));
    targets = chapters.filter((c) => {
      const e = existing.get(c.chapter_no);
      return !e || !e.integrated;
    }).slice(0, CHAPTERS_PER_INTEGRATE);
  } else {
    return { success: false, error: '需指定 chapters（章号列表）或 auto=true' };
  }
  if (!targets.length) return { success: true, project, selected: 0, extracted: 0, failed: [], index: null, memory: null };

  const usageSink = makeD1UsageSink(env);
  const upserts: ChapterIndexEntry[] = [];
  const perChapter: Array<{ chapter_no: string; ok: boolean; theme?: string; error?: string }> = [];
  let extractedCount = 0;

  for (const ch of targets.slice(0, CHAPTERS_PER_INTEGRATE)) {
    const entry: ChapterIndexEntry = {
      chapterNo: ch.chapter_no,
      title: ch.title.slice(0, 200),
      theme: '',
      events: [],
      charState: '',
      summary: ch.summary.slice(0, 600),
      sourceChapterId: ch.id,
      integrated: false,
      updatedAt: new Date().toISOString(),
    };
    if (extract) {
      let apiUsage: CompleteTextUsage | undefined;
      try {
        const r = await completeText(env, {
          system: buildChapterIntegrateSystem(),
          prompt: buildChapterIntegrateInput({ title: ch.title, summary: ch.summary, content: ch.content }),
          model,
        });
        apiUsage = r.usage;
        if (!r.ok) throw new Error(`抽取失败(${r.kind}${r.detail ? ': ' + r.detail : ''})`);
        const parsed = parseIntegrateOutput(String(r.text));
        if (!parsed) throw new Error('模型没有按 JSON 格式输出索引字段');
        entry.theme = parsed.theme;
        entry.events = parsed.events;
        entry.charState = parsed.charState;
        entry.integrated = true; // 信息齐全 → 记忆机制标记完成
        extractedCount += 1;
        perChapter.push({ chapter_no: ch.chapter_no, ok: true, theme: parsed.theme });
        await usageSink.logUsage('desk-book', model, apiUsage, 'ok').catch(() => {});
      } catch (err: any) {
        // 抽取失败：基础条目照常登记（梗概仍可用），该章不算完成，下轮可重试。
        perChapter.push({ chapter_no: ch.chapter_no, ok: false, error: err?.message || String(err) });
        await usageSink.logUsage('desk-book', model, apiUsage, 'failed').catch(() => {});
      }
    } else {
      entry.theme = '未整理';
      entry.integrated = false;
      perChapter.push({ chapter_no: ch.chapter_no, ok: true, theme: entry.theme });
    }
    upserts.push(entry);
  }

  // 索引落库
  let indexResult: { added: number; updated: number; total: number; integrated: number } | null = null;
  try {
    const r = await storeOf(env).upsertEntries(project, upserts);
    indexResult = {
      added: r.added,
      updated: r.updated,
      total: r.entries.length,
      integrated: r.entries.filter((e) => e.integrated).length,
    };
  } catch (err: any) {
    return { success: false, error: `索引落库失败: ${err?.message || err}`, results: perChapter };
  }

  // 记忆衔接（task-10）：把已标记完成的章写成 plot 层记忆条目，进后续对话的全量记忆注入。
  const doneChapters = upserts.filter((e) => e.integrated);
  let memoryResult: { added: number; updated: number; dropped: number } | null = null;
  if (doneChapters.length) {
    try {
      const rowByNo = new Map(targets.map((c) => [c.chapter_no, c]));
      const incoming: MergeMemoryInput[] = doneChapters.map((e) => {
        const ch = rowByNo.get(e.chapterNo);
        const segs = [
          ch?.summary ? ch.summary : '',
          e.events.length ? `关键事件：${e.events.join('；')}` : '',
          e.charState ? `角色状态：${e.charState}` : '',
        ].filter(Boolean);
        return {
          theme: '故事情节',
          layer: 'plot' as const,
          charKey,
          title: `第${e.chapterNo}章${e.title ? `《${e.title}》` : ''}`,
          content: segs.join('\n'),
        };
      });
      const memStore = memStoreOf(env);
      const scopeRows = await memStore.listByScope({ project, charKey });
      const merged = mergeMemories(scopeRows, incoming, { project, charKey });
      await memStore.replaceScope({ project, charKey, memories: merged.next });
      memoryResult = { added: merged.added.length, updated: merged.updated.length, dropped: merged.dropped };
    } catch (err: any) {
      // 记忆并库失败不影响索引结果——索引已是正本，下次整合会按同主题同标题覆盖更新。
      memoryResult = { added: -1, updated: -1, dropped: -1 };
      perChapter.push({ chapter_no: '*', ok: false, error: `记忆落库失败: ${err?.message || err}` });
    }
  }

  return {
    success: true,
    project,
    selected: Math.min(targets.length, CHAPTERS_PER_INTEGRATE),
    remaining_candidates: Math.max(0, targets.length - Math.min(targets.length, CHAPTERS_PER_INTEGRATE)),
    extracted: extractedCount,
    extract_skipped: !extract,
    results: perChapter,
    failed: perChapter.filter((p) => !p.ok),
    index: indexResult,
    memory: memoryResult,
  };
}
