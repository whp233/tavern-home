// src/core/stickyNotes.ts
// 酒馆之家「便签」纯函数层（task-15）。
// 便签 = 独立于 desk_windows.note 的轻量便利贴：
//   - project 命名空间（空串 = 未指定项目）
//   - charKey 角色关联（空串 = 未指定角色/通用）
//   - title/content/color/pinned 组成一张可粘贴、可置顶的便签
//   - 数据持久化走 D1 oc_state 键值（sticky_notes:all），零 schema 迁移。

export type StickyNoteColor = 'yellow' | 'green' | 'blue' | 'pink' | 'gray';

export interface StickyNote {
  id: string;
  project: string;          // 空串 = 未指定项目
  charKey: string;          // 空串 = 未指定角色/通用
  title: string;
  content: string;
  color: StickyNoteColor;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StickyNotesStorage {
  listNotes(opts?: { project?: string; charKey?: string; pinned?: boolean; limit?: number }): Promise<StickyNote[]>;
  getNote(id: string): Promise<StickyNote | null>;
  createNote(note: StickyNote): Promise<void>;
  updateNote(id: string, patch: Partial<Omit<StickyNote, 'id' | 'createdAt'>>): Promise<StickyNote | null>;
  deleteNote(id: string): Promise<boolean>;
}
export const STICKY_COLORS: readonly StickyNoteColor[] = ['yellow', 'green', 'blue', 'pink', 'gray'];
export const STICKY_TITLE_MAX = 100;
export const STICKY_CONTENT_MAX = 5000;
export const STICKY_PROJECT_MAX = 100;
export const STICKY_CHAR_KEY_MAX = 100;
export const STICKY_LIST_LIMIT_MAX = 500;
export const STICKY_PREVIEW_MAX = 120;
const STICKY_ID_PREFIX = 'sn_';

export function isStickyNoteColor(value: unknown): value is StickyNoteColor {
  return typeof value === 'string' && (STICKY_COLORS as readonly string[]).includes(value);
}

export function buildStickyNoteId(): string {
  return `${STICKY_ID_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function wrongTypeMessage(field: string, max: number): string {
  return `${field} 必须是字符串,且不超过${max}字`;
}

// 新建与部分更新共用同一把尺子；partial 模式下只校验给出的字段。
export function validateStickyNoteBody(body: any, opts?: { partial?: boolean }): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '请求体不对';
  const partial = !!opts?.partial;

  if (!partial && body.content === undefined) {
    return 'content 必填';
  }
  if (body.content !== undefined && typeof body.content !== 'string') {
    return wrongTypeMessage('content', STICKY_CONTENT_MAX);
  }
  if (!partial && typeof body.content === 'string' && !body.content.trim()) {
    return 'content 不能为空';
  }
  if (body.content !== undefined) {
    if (typeof body.content !== 'string') return wrongTypeMessage('content', STICKY_CONTENT_MAX);
    if (body.content.length > STICKY_CONTENT_MAX) return wrongTypeMessage('content', STICKY_CONTENT_MAX);
    if (!partial && !body.content.trim()) return 'content 不能为空';
  }
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > STICKY_TITLE_MAX)) {
    return wrongTypeMessage('title', STICKY_TITLE_MAX);
  }
  if (body.project !== undefined && (typeof body.project !== 'string' || body.project.length > STICKY_PROJECT_MAX)) {
    return wrongTypeMessage('project', STICKY_PROJECT_MAX);
  }
  if (body.charKey !== undefined && (typeof body.charKey !== 'string' || body.charKey.length > STICKY_CHAR_KEY_MAX)) {
    return wrongTypeMessage('charKey', STICKY_CHAR_KEY_MAX);
  }
  if (body.color !== undefined && !isStickyNoteColor(body.color)) {
    return `color 必须是 ${STICKY_COLORS.join('/')} 之一`;
  }
  if (body.pinned !== undefined && typeof body.pinned !== 'boolean') {
    return 'pinned 必须是布尔值';
  }
  return null;
}

// 列表项预览：换行拍平成空格、截断，不含全文。
export function makeStickyNotePreview(content: unknown, max: number = STICKY_PREVIEW_MAX): string {
  if (typeof content !== 'string') return '';
  const flat = content.replace(/\s*\n+\s*/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// 便签排序：置顶优先，其次 updatedAt 倒序，再 createdAt 倒序（稳定兜底）。
export function compareStickyNotes(a: StickyNote, b: StickyNote): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const byUpdated = String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
  if (byUpdated !== 0) return byUpdated;
  const byCreated = String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  if (byCreated !== 0) return byCreated;
  return a.id.localeCompare(b.id);
}