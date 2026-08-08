// src/tools/deskBook.ts
// 自动成书：把打字桌窗口的聊天楼层自动切章、用模型转写成小说、写入读书角。
//
// 三件套：
//   · deskBookSplit   —— 确定性切章，零模型调用（纯逻辑在 deskBookSplit.ts）。
//   · deskBookGenerate—— 逐章转写（核心）。走 completeText 双通道（Anthropic/OpenAI），
//     每章一次非流式调用，解析 <title>/<summary>/<content> 信封；解析失败/截断/拒答不落库，
//     记入 failed，前端对 remaining>0 再调一次（幂等续跑靠 desk_chapter_floors 映射表）。
//   · deskBookAuto    —— 一键组合（split 后直接 generate 第一批），前端主入口。
//
// 记账走 usageSink.logUsage('desk-book', ...)，CHANNELS 白名单在 src/storage/usageSink.ts。
// 章总结向量钩子：生成的是 draft 草稿章，chapterCreate 的 published-embed 钩子不会触发；
// 发布走既有 chapterPublish 那套钩子，这里不重复 embed。

import { deskWindowGet } from './deskWindows';
import { completeText, type CompleteTextUsage } from '../chat/modelBackend';
import { makeD1UsageSink } from '../storage/usageSink';
import { extractDeskTimelineAssistantBody, renderTimelineText } from '../chat/deskTimeline';
import { parseCoreMemory } from '../chat/deskAssemble';
import { chapterCreate } from './reading';
import {
  deskBookSplitFloors, parseEnvelope, groupFullyMapped, DESK_BOOK_BUDGET_DEFAULT,
  type DeskBookFloor, type DeskBookSplitOpts,
} from './deskBookSplit';

// 纯内核（deskBookSplit.ts）re-export，REST/测试共用同一份
export {
  DESK_BOOK_BUDGET_DEFAULT, deskBookSplitFloors, parseEnvelope, groupFullyMapped,
  type DeskBookFloor, type DeskBookChapterGroup, type DeskBookSplitOpts,
} from './deskBookSplit';

interface DeskBookEnv {
  OC_DB: D1Database;
  [k: string]: any;
}

// 单请求最多处理章数：最坏 100s/章 → 4 章 ≈ 400s（≤5min 量级），前端对 remaining>0 继续调。
export const CHAPTERS_PER_REQUEST = 4;

const BOOK_MODEL = 'claude-sonnet-4-6'; // 跟时光带折叠同档：长剧情转写比状态板刷新那档贵一档

// ===== POST /api/oc/desk/windows/:id/book/split：确定性切章（可选端点，前端主入口走 auto）=====
export async function deskBookSplit(env: DeskBookEnv, windowId: string, opts: DeskBookSplitOpts = {}): Promise<any> {
  if (!windowId) return { success: false, error: '缺 window id' };
  try {
    const r = await deskWindowGet(env, windowId);
    if (!r.success) return r;
    const floors: DeskBookFloor[] = (r.floors || []).map((f: any) => ({
      id: f.id, role: f.role, content: f.content, created_at: f.created_at,
    }));
    const split = deskBookSplitFloors(floors, opts);
    if (!split.success) return { success: false, error: split.error };
    return {
      success: true,
      window_id: windowId,
      total_chapters: split.chapter_groups!.length,
      chapter_groups: split.chapter_groups,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// 楼层原文转全角防注入（照 deskBoardRefresh 的 safeContent / deskTimeline 对 <楼层原文> 的思路）：
// 只改这次请求的临时副本，D1 里的楼层正本一字不动。
function toSafeFloorText(raw: string): string {
  return String(raw || '')
    .replace(/<楼层原文>/g, '＜楼层原文＞')
    .replace(/<\/楼层原文>/g, '＜/楼层原文＞')
    .trim();
}

const SYSTEM_NOVEL =
  `你是小说转写助手。把打字桌窗口里的聊天楼层（导演指令与模型续写的场景正文）转写成流畅的小说章节。\n\n` +
  `规则：\n` +
  `1-以第三人称叙述为主，把对话与场景转写成连贯的小说正文。\n` +
  `2-严格区分客观事实与角色认知：楼层里确定发生的事是事实，角色的猜测、感想、误解作为"角色认知"呈现，不要当成事实写。\n` +
  `3-只依据【本章楼层原文】转写，禁止脑补原文没有的剧情、人物、事件、心理活动。\n` +
  `4-正文用中文，自然分段；人名、地名、时间线保持原文一致。\n\n` +
  `输出格式（必须完整输出下面三个标签，不要输出任何其它内容）：\n` +
  `<title>第N章 标题</title>\n` +
  `<summary>200字左右的本章梗概</summary>\n` +
  `<content>转写正文</content>`;

const SYSTEM_DIALOGUE =
  `你是小说转写助手。把打字桌窗口里的聊天楼层转写成以对话为主、穿插叙述的小说章节。\n\n` +
  `规则：\n` +
  `1-保留楼层里的对话主体，以对白推动剧情，用少量叙述串联场景与动作。\n` +
  `2-严格区分客观事实与角色认知：楼层里确定发生的事是事实，角色的猜测、感想、误解作为"角色认知"呈现，不要当成事实写。\n` +
  `3-只依据【本章楼层原文】转写，禁止脑补原文没有的剧情、人物、事件、心理活动。\n` +
  `4-正文用中文，自然分段；人名、地名、时间线保持原文一致。\n\n` +
  `输出格式（必须完整输出下面三个标签，不要输出任何其它内容）：\n` +
  `<title>第N章 标题</title>\n` +
  `<summary>200字左右的本章梗概</summary>\n` +
  `<content>转写正文</content>`;

export interface DeskBookGenerateOpts {
  style?: 'novel' | 'dialogue';
  max_chapters?: number;
  budgetChars?: number;
  model?: string;
}

// ===== POST /api/oc/desk/windows/:id/book 的内核：逐章转写（幂等，单请求最多 K 章）=====
export async function deskBookGenerate(env: DeskBookEnv, windowId: string, opts: DeskBookGenerateOpts = {}): Promise<any> {
  if (!windowId) return { success: false, error: '缺 window id' };
  const style = opts.style === 'dialogue' ? 'dialogue' : 'novel';
  const maxChapters = Number.isInteger(opts.max_chapters) && (opts.max_chapters as number) > 0
    ? Math.min(opts.max_chapters as number, CHAPTERS_PER_REQUEST)
    : CHAPTERS_PER_REQUEST;
  const model = opts.model || BOOK_MODEL;
  const usageSink = makeD1UsageSink(env);

  let win: any; let floors: DeskBookFloor[];
  try {
    const r = await deskWindowGet(env, windowId);
    if (!r.success) return r;
    win = r.window;
    floors = (r.floors || []).map((f: any) => ({
      id: f.id, role: f.role, content: f.content, created_at: f.created_at,
    }));
  } catch (err: any) {
    return { success: false, error: err.message };
  }
  const project = String(win.project || '').trim();
  if (!project) return { success: false, error: '这个写作窗没有绑定 project,无法写入读书角' };

  const split = deskBookSplitFloors(floors, { budgetChars: opts.budgetChars });
  if (!split.success) return { success: false, error: split.error };
  const groups = split.chapter_groups!;

  // 幂等：已映射进 desk_chapter_floors 的楼层整组跳过（已生成的章不重写）
  let mapped = new Set<string>();
  try {
    const rows = await env.OC_DB.prepare(
      `SELECT floor_id FROM desk_chapter_floors WHERE window_id = ?`
    ).bind(windowId).all<any>();
    mapped = new Set((rows.results || []).map((row: any) => String(row.floor_id)));
  } catch (err: any) {
    return { success: false, error: err.message };
  }

  const pending = groups.filter((g) => !groupFullyMapped(g, mapped));
  const totalChapters = groups.length;
  const already = groups.length - pending.length;
  const taken = pending.slice(0, maxChapters);
  if (taken.length === 0) {
    return { success: true, total_chapters: totalChapters, already, done: 0, remaining: 0, failed: [] };
  }

  // 剧情核心记忆（oc_state 的 desk_core:<project>，形态宽容见 parseCoreMemory）
  let coreMemory = '';
  try {
    const row = await env.OC_DB.prepare(`SELECT value FROM oc_state WHERE key = ?`)
      .bind(`desk_core:${project}`).first<any>();
    coreMemory = parseCoreMemory(row?.value ?? null);
  } catch (err: any) {
    coreMemory = '';
  }

  // 时光带摘要（窗口 timeline_state 渲染成纯文本；坏形状退空）
  let timelineText = '';
  try {
    const st = win.timeline_state;
    if (st && typeof st === 'object' && Array.isArray((st as any).segs)) {
      timelineText = renderTimelineText(st);
    }
  } catch { timelineText = ''; }

  // 章号自动编号：项目内现有 chapter_no 最大数字段 + 1（照 ChaptersStudio.tsx nextChapterNo 思路）。
  // 上一章概要取当前编号最大的那一章 summary，作为转写的承接上下文。
  let chapterRows: Array<{ chapter_no: string; summary: string }> = [];
  try {
    chapterRows = ((await env.OC_DB.prepare(
      `SELECT chapter_no, summary FROM oc_chapters WHERE project = ?`
    ).bind(project).all<any>()).results || []) as Array<{ chapter_no: string; summary: string }>;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
  let maxNo = 0;
  let prevSummary = '';
  for (const r of chapterRows) {
    const n = parseInt(String(r.chapter_no ?? '').trim(), 10);
    if (Number.isFinite(n) && n > maxNo) {
      maxNo = n;
      prevSummary = String(r.summary || '').trim();
    }
  }
  const nextNo = maxNo + 1;

  const floorById = new Map(floors.map((f) => [f.id, f]));
  const failed: Array<{ chapter_index: number; error: string }> = [];
  let done = 0;

  for (let i = 0; i < taken.length; i++) {
    const group = taken[i];
    const chapterIndex = groups.indexOf(group);
    // 章号按章组位置编号（nextNo+i）：断点重试时 nextNo 会被已成功章节推进，章号保持稳定，
    // 确定性章 id（ch_deskbook_<window>_<no>）也就稳定，chapterCreate 幂等去重才靠得住。
    const chapterNo = String(nextNo + i);

    // 组装【本章楼层原文】：assistant 楼剥协议渣（extractDeskTimelineAssistantBody），
    // user 楼是导演指令；楼层原文转全角防注入。
    const lines = group.floor_ids.map((fid) => {
      const f = floorById.get(fid);
      if (!f) return null;
      const raw = f.role === 'assistant' ? extractDeskTimelineAssistantBody(f.content) : f.content;
      const safe = toSafeFloorText(raw);
      return safe ? `${f.role === 'assistant' ? '【模型正文】' : '【导演指令】'}\n${safe}` : null;
    }).filter((x): x is string => !!x).join('\n\n');

    if (!lines.trim()) {
      const reason = '本章没有可转写的正文';
      console.error(`[desk-book] window ${windowId} 第${chapterNo}章 ${reason}`);
      await usageSink.logUsage('desk-book', model, undefined, 'failed');
      failed.push({ chapter_index: chapterIndex, error: reason });
      continue;
    }

    const system = style === 'dialogue' ? SYSTEM_DIALOGUE : SYSTEM_NOVEL;
    const user =
      `【剧情核心记忆】\n${coreMemory || '(无)'}\n\n` +
      `【时光带摘要】\n${timelineText || '(无)'}\n\n` +
      `【上一章概要】\n${prevSummary || '(无)'}\n\n` +
      `【本章楼层原文】\n<楼层原文>\n${lines}\n</楼层原文>`;

    // 每章一次 completeText（最坏 100s）；失败/截断/拒答不落库，记 failed 让前端续跑重试。
    let text = '';
    let apiUsage: CompleteTextUsage | undefined;
    const r = await completeText(env, { system, prompt: user, model });
    apiUsage = r.usage;
    if (!r.ok) {
      const reason =
        r.kind === 'truncated' ? '转写被 max_tokens 截断,该章未落库' :
        r.kind === 'no_key' ? '模型渠道没配(ANTHROPIC_API_KEY 或 OPENAI_API_KEY)' :
        r.kind === 'timeout' ? '转写超时被砍(100s),该章未落库' :
        r.kind === 'refusal' ? '模型拒答(refusal),该章未落库' :
        `转写失败(${r.kind}${r.detail ? ': ' + r.detail : ''})`;
      console.error(`[desk-book] window ${windowId} 第${chapterNo}章 ${reason}`);
      await usageSink.logUsage('desk-book', model, apiUsage, 'failed');
      failed.push({ chapter_index: chapterIndex, error: reason });
      continue;
    }
    text = String(r.text).trim();

    const parsed = parseEnvelope(text);
    if (!parsed) {
      const reason = '模型没有按信封格式(<title>/<summary>/<content>)输出,该章未落库';
      console.error(`[desk-book] window ${windowId} 第${chapterNo}章 ${reason}`);
      await usageSink.logUsage('desk-book', model, apiUsage, 'failed');
      failed.push({ chapter_index: chapterIndex, error: reason });
      continue;
    }
    const title = parsed.title.trim() || `第${chapterNo}章`;
    const content = parsed.content.trim();
    const summary = parsed.summary.trim();
    if (!content) {
      const reason = '模型没有给出转写正文(<content> 为空),该章未落库';
      console.error(`[desk-book] window ${windowId} 第${chapterNo}章 ${reason}`);
      await usageSink.logUsage('desk-book', model, apiUsage, 'failed');
      failed.push({ chapter_index: chapterIndex, error: reason });
      continue;
    }

    // 落库：先章后映射。章 id 用确定性 ch_deskbook_<window>_<no>，撞主键走 chapterCreate 幂等去重
    // （映射写入失败/响应丢失后重试，不会造双胞胎章）。
    const chapterId = `ch_deskbook_${windowId}_${chapterNo}`;
    try {
      const created = await chapterCreate(env as any, {
        id: chapterId, project, chapter_no: chapterNo, title, content, summary, status: 'draft',
      });
      if (!created.success) throw new Error(created.error || '落库失败');
      // 映射每章一个 batch，INSERT OR IGNORE 幂等（同一 chapter_id+floor_id 重跑不报错）。
      await env.OC_DB.batch(group.floor_ids.map((fid, idx) => env.OC_DB.prepare(
        `INSERT OR IGNORE INTO desk_chapter_floors (chapter_id, window_id, floor_id, seq) VALUES (?, ?, ?, ?)`
      ).bind(chapterId, windowId, fid, idx)));
    } catch (err: any) {
      const reason = `落库失败: ${err?.message || err}`;
      console.error(`[desk-book] window ${windowId} 第${chapterNo}章 ${reason}`);
      await usageSink.logUsage('desk-book', model, apiUsage, 'failed');
      failed.push({ chapter_index: chapterIndex, error: reason });
      continue;
    }

    await usageSink.logUsage('desk-book', model, apiUsage, 'ok');
    prevSummary = summary;
    done += 1;
  }

  const remaining = groups.length - already - done;
  return {
    success: true,
    total_chapters: totalChapters,
    already,
    done,
    remaining,
    failed,
  };
}

// ===== POST /api/oc/desk/windows/:id/book：一键组合（前端主入口）=====
// 已有 desk_chapter_floors 记录 → 跳过 split（幂等续跑）；否则先 split 拿章组再 generate 第一批。
export async function deskBookAuto(env: DeskBookEnv, windowId: string, opts: DeskBookGenerateOpts = {}): Promise<any> {
  if (!windowId) return { success: false, error: '缺 window id' };
  try {
    let existing = 0;
    try {
      const row = await env.OC_DB.prepare(
        `SELECT COUNT(*) AS c FROM desk_chapter_floors WHERE window_id = ?`
      ).bind(windowId).first<any>();
      existing = Number(row?.c) || 0;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
    if (existing === 0) {
      const split = await deskBookSplit(env, windowId, { budgetChars: opts.budgetChars });
      if (!split.success) return split;
    }

    const gen = await deskBookGenerate(env, windowId, opts);
    if (!gen.success) return gen;
    return {
      success: true,
      window_id: windowId,
      total_chapters: gen.total_chapters,
      already: gen.already,
      done: gen.done,
      remaining: gen.remaining,
      failed: gen.failed,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
