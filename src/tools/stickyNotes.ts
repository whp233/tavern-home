// src/tools/stickyNotes.ts
// 酒馆之家「便签」REST 数据层（task-15）：独立便签 CRUD。
// 存储走 examples/cloudflare/adapters/d1StickyNotesStorage.ts（复用 oc_state，零迁移）。
// 校验/排序/预览在 src/core/stickyNotes.ts 纯函数，这里只做请求壳。

import type { StickyNotesStorage } from '../core/stickyNotes.ts';
import type { StickyNote } from '../core/stickyNotes.ts';
import {
  buildStickyNoteId, validateStickyNoteBody, compareStickyNotes, makeStickyNotePreview,
  isStickyNoteColor, STICKY_LIST_LIMIT_MAX,
} from '../core/stickyNotes.ts';
import { D1StickyNotesStorage } from '../../examples/cloudflare/adapters/d1StickyNotesStorage.ts';

interface StickyNotesEnv {
  OC_DB: D1Database;
}

const LIST_LIMIT_DEFAULT = 200;

function storeOf(env: StickyNotesEnv): StickyNotesStorage {
  return new D1StickyNotesStorage(env.OC_DB);
}

function notFound() {
  return { success: false as const, error: '便签不存在' };
}

// ===== 列表：可按 project / char_key / pinned 筛选；列表只带 preview，不带全文 =====
export async function stickyNotesList(env: StickyNotesEnv, params: any): Promise<any> {
  const rawLimit = Number(params?.limit ?? LIST_LIMIT_DEFAULT);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : LIST_LIMIT_DEFAULT, 1), STICKY_LIST_LIMIT_MAX);
  const project = params?.project === undefined || params?.project === null ? undefined : String(params.project);
  const charKey = params?.charKey === undefined || params?.charKey === null ? undefined : String(params.charKey);
  let pinned: boolean | undefined;
  if (params?.pinned !== undefined && params?.pinned !== null) {
    const raw = String(params.pinned);
    pinned = raw === '1' || raw.toLowerCase() === 'true';
  }
  try {
    const rows = await storeOf(env).listNotes({ project, charKey, pinned, limit });
    const sorted = [...rows].sort(compareStickyNotes);
    const notes = sorted.map((n) => ({
      id: n.id,
      project: n.project,
      charKey: n.charKey,
      title: n.title,
      color: n.color,
      pinned: n.pinned,
      updatedAt: n.updatedAt,
      createdAt: n.createdAt,
      preview: makeStickyNotePreview(n.content),
    }));
    return { success: true, count: notes.length, notes };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ===== 单条完整返回（编辑回填用，不截断）=====
export async function stickyNotesGet(env: StickyNotesEnv, id: string): Promise<any> {
  if (!id) return { success: false, error: '缺少便签 id' };
  try {
    const note = await storeOf(env).getNote(id);
    if (!note) return notFound();
    return { success: true, note };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ===== 新建：content 必填，其余可空；color 默认 yellow =====
export async function stickyNotesCreate(env: StickyNotesEnv, body: any): Promise<any> {
  const err = validateStickyNoteBody(body, { partial: false });
  if (err) return { success: false, error: err };

  const now = new Date().toISOString();
  const note: StickyNote = {
    id: buildStickyNoteId(),
    project: typeof body.project === 'string' ? body.project.trim() : '',
    charKey: typeof body.charKey === 'string' ? body.charKey.trim() : '',
    title: typeof body.title === 'string' ? body.title : '',
    content: String(body.content ?? ''),
    color: isStickyNoteColor(body.color) ? body.color : 'yellow',
    pinned: body.pinned === true,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await storeOf(env).createNote(note);
    return { success: true, note };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ===== 部分更新：只改给出的字段；updatedAt 总是刷新 =====
export async function stickyNotesUpdate(env: StickyNotesEnv, id: string, body: any): Promise<any> {
  if (!id) return { success: false, error: '缺少便签 id' };
  const err = validateStickyNoteBody(body, { partial: true });
  if (err) return { success: false, error: err };

  const patch: Partial<Omit<StickyNote, 'id' | 'createdAt'>> = {};
  if (body.project !== undefined) patch.project = String(body.project).trim();
  if (body.charKey !== undefined) patch.charKey = String(body.charKey).trim();
  if (body.title !== undefined) patch.title = String(body.title);
  if (body.content !== undefined) patch.content = String(body.content);
  if (body.color !== undefined) patch.color = body.color;
  if (body.pinned !== undefined) patch.pinned = !!body.pinned;
  patch.updatedAt = new Date().toISOString();

  try {
    const updated = await storeOf(env).updateNote(id, patch);
    if (!updated) return notFound();
    return { success: true, note: updated };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ===== 删除 =====
export async function stickyNotesDelete(env: StickyNotesEnv, id: string): Promise<any> {
  if (!id) return { success: false, error: '缺少便签 id' };
  try {
    const ok = await storeOf(env).deleteNote(id);
    return ok ? { success: true } : notFound();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}