// src/tools/diary.ts
// 酒馆之家「日记」REST 数据层（task-12）：按日期的日记 CRUD + 日期刻度（时间线）。
// 口径对齐 src/tools/study.ts：这是部署者书房页自己用的 REST 接口，人是主体——
//   - get 回填必须是真全文（编辑页拿截断正文去保存 = 数据损失）
//   - list/刻度带 preview 与摘要（列表页不需要全文）
// 存储走 examples/cloudflare/adapters/d1DiaryStorage.ts（DiaryStorage 契约在 src/core/storage.ts），
// 校验/归一化/排序全在 src/core/diaryService.ts（纯函数）。

import type { DiaryStorage } from '../core/storage.ts';
import type { DiaryEntry } from '../core/types.ts';
import {
  normalizeDiaryDate, todayDiaryDate, diaryTimeNow, validateDiaryBody, buildDiaryId,
  compareDiaryDesc, makeDiaryPreview,
} from '../core/diaryService.ts';
import { D1DiaryStorage } from '../../examples/cloudflare/adapters/d1DiaryStorage.ts';

interface DiaryEnv {
  OC_DB: D1Database;
}

const LIST_LIMIT_DEFAULT = 200;
const LIST_LIMIT_MAX = 500;
const DATES_LIMIT_DEFAULT = 500;
const DATES_LIMIT_MAX = 2000;

function storeOf(env: DiaryEnv): DiaryStorage {
  return new D1DiaryStorage(env.OC_DB);
}

function notFound() {
  return { success: false as const, error: '日记不存在' };
}

// ===== 日期刻度（时间线：去重日期 + 当日条数，倒序）=====
export async function diaryDates(env: DiaryEnv, params: any): Promise<any> {
  const project = params?.project === undefined || params?.project === null ? undefined : String(params.project);
  const charKey = params?.charKey === undefined || params?.charKey === null ? undefined : String(params.charKey);
  const rawLimit = Number(params?.limit ?? DATES_LIMIT_DEFAULT);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : DATES_LIMIT_DEFAULT, 1), DATES_LIMIT_MAX);
  try {
    const dates = await storeOf(env).listDates({ project, charKey, limit });
    return { success: true, count: dates.length, dates };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ===== 列表：可按日期精确筛 / 按项目×角色筛；条目带 preview（不带全文）=====
export async function diaryList(env: DiaryEnv, params: any): Promise<any> {
  const rawLimit = Number(params?.limit ?? LIST_LIMIT_DEFAULT);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
  let date: string | undefined;
  if (params?.date !== undefined && params?.date !== null && String(params.date) !== '') {
    const normalized = normalizeDiaryDate(String(params.date));
    if (!normalized) return { success: false, error: 'date 必须是合法日期（如 2026/6/27）' };
    date = normalized;
  }
  const project = params?.project === undefined || params?.project === null ? undefined : String(params.project);
  const charKey = params?.charKey === undefined || params?.charKey === null ? undefined : String(params.charKey);
  try {
    const rows = await storeOf(env).listEntries({ date, project, charKey });
    // date 无前导零，词法序不可靠——按数值倒序排（对齐 study.ts chapter 自然排序的做法）
    const sorted = [...rows].sort(compareDiaryDesc).slice(0, limit);
    const diaries = sorted.map((e) => ({
      id: e.id,
      project: e.project,
      charKey: e.charKey,
      date: e.date,
      time: e.time,
      title: e.title,
      affection: e.affection,
      conversationId: e.conversationId,
      conversationLength: e.conversationLength,
      updatedAt: e.updatedAt,
      preview: makeDiaryPreview(e.content, 120),
    }));
    return { success: true, count: diaries.length, diaries };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ===== 单条完整返回（编辑页回填全文用，绝不截断）=====
export async function diaryGet(env: DiaryEnv, id: string): Promise<any> {
  if (!id) return { success: false, error: '缺少日记 id' };
  try {
    const entry = await storeOf(env).getEntry(id);
    if (!entry) return notFound();
    return { success: true, diary: entry };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ===== 新建：date 缺省今天、time 缺省现在（妹居格式）=====
export async function diaryCreate(env: DiaryEnv, body: any): Promise<any> {
  const err = validateDiaryBody(body, { partial: false });
  if (err) return { success: false, error: err };

  const now = new Date().toISOString();
  const normalizedDate = body.date !== undefined ? normalizeDiaryDate(String(body.date))! : todayDiaryDate();
  const rawAffection = body.affection === undefined || body.affection === null ? null : Number(body.affection);
  const rawConversationLength = body.conversationLength === undefined || body.conversationLength === null ? null : Number(body.conversationLength);
  const entry: DiaryEntry = {
    id: buildDiaryId(),
    project: String(body.project ?? '').trim(),
    charKey: String(body.charKey ?? '').trim(),
    date: normalizedDate,
    time: typeof body.time === 'string' && body.time ? body.time : diaryTimeNow(),
    title: typeof body.title === 'string' ? body.title : '',
    content: String(body.content ?? ''),
    affection: rawAffection,
    conversationId: typeof body.conversationId === 'string' ? body.conversationId : '',
    conversationLength: rawConversationLength,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await storeOf(env).createEntry(entry);
    return { success: true, diary: entry };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ===== 部分更新：只改给出的字段（date 给了也归一化；updatedAt 总是刷新）=====
export async function diaryUpdate(env: DiaryEnv, id: string, body: any): Promise<any> {
  if (!id) return { success: false, error: '缺少日记 id' };
  const err = validateDiaryBody(body, { partial: true });
  if (err) return { success: false, error: err };

  const patch: Partial<Omit<DiaryEntry, 'id' | 'createdAt'>> = {};
  if (body.date !== undefined) patch.date = normalizeDiaryDate(String(body.date))!;
  if (typeof body.time === 'string' && body.time) patch.time = body.time;
  if (body.title !== undefined) patch.title = String(body.title);
  if (body.content !== undefined) patch.content = String(body.content);
  if (body.project !== undefined) patch.project = String(body.project).trim();
  if (body.charKey !== undefined) patch.charKey = String(body.charKey).trim();
  if (body.affection !== undefined && body.affection !== null) patch.affection = Number(body.affection);
  if (body.affection === null) patch.affection = null;
  if (body.conversationId !== undefined) patch.conversationId = String(body.conversationId);
  if (body.conversationLength !== undefined && body.conversationLength !== null) patch.conversationLength = Number(body.conversationLength);
  if (body.conversationLength === null) patch.conversationLength = null;
  patch.updatedAt = new Date().toISOString();

  try {
    const updated = await storeOf(env).updateEntry(id, patch);
    if (!updated) return notFound();
    return { success: true, diary: updated };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ===== 删除 =====
export async function diaryDelete(env: DiaryEnv, id: string): Promise<any> {
  if (!id) return { success: false, error: '缺少日记 id' };
  try {
    const ok = await storeOf(env).deleteEntry(id);
    return ok ? { success: true } : notFound();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}