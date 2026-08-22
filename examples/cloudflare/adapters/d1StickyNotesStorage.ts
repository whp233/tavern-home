// D1 版便签存储（task-15）：复用 oc_state 键值表（key TEXT PRIMARY KEY, value TEXT, updated_at）。
// 键 `sticky_notes:all` 存整个便签集合的 JSON（{ version: 1, notes: [...] }）。
// 优点：零 schema 迁移，不与正在并行推进的 0007/0008 迁移/init.sql 抢热点；
// 个人书房规模下整集合读写足够，不需要拆表。
// 校验/排序在 src/core/stickyNotes.ts，REST 壳在 src/tools/stickyNotes.ts。
// 不带业务逻辑这里只负责读取/落盘/映射。

import type { StickyNote } from '../../../src/core/stickyNotes.ts';
import type { StickyNotesStorage } from '../../../src/core/stickyNotes.ts';

const STORAGE_KEY = 'sticky_notes:all';
const MAX_NOTES = 2000;

function parseStoredNotes(value: unknown): StickyNote[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const notes = parsed.notes;
    if (!Array.isArray(notes)) return [];
    return notes.filter((n: any): n is StickyNote => !!n && typeof n === 'object' && typeof n.id === 'string');
  } catch {
    return [];
  }
}

export class D1StickyNotesStorage implements StickyNotesStorage {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  private async readAll(): Promise<StickyNote[]> {
    const row = await this.db.prepare(`SELECT value FROM oc_state WHERE key = ?`).bind(STORAGE_KEY).first<any>();
    return parseStoredNotes(row?.value);
  }

  private async writeAll(notes: StickyNote[]): Promise<void> {
    await this.db.prepare(`INSERT OR REPLACE INTO oc_state (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind(STORAGE_KEY, JSON.stringify({ version: 1, notes }), new Date().toISOString()).run();
  }

  async listNotes(opts: { project?: string; charKey?: string; pinned?: boolean; limit?: number } = {}): Promise<StickyNote[]> {
    const all = await this.readAll();
    let rows = all;
    if (opts.project !== undefined && opts.project !== null && String(opts.project) !== '') {
      const project = String(opts.project);
      rows = rows.filter((n) => n.project === project);
    }
    if (opts.charKey !== undefined && opts.charKey !== null && String(opts.charKey) !== '') {
      const charKey = String(opts.charKey);
      rows = rows.filter((n) => n.charKey === charKey);
    }
    if (opts.pinned !== undefined && opts.pinned !== null) {
      rows = rows.filter((n) => n.pinned === opts.pinned);
    }
    const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), MAX_NOTES);
    return rows.slice(0, limit);
  }

  async getNote(id: string): Promise<StickyNote | null> {
    const all = await this.readAll();
    return all.find((n) => n.id === id) ?? null;
  }

  async createNote(note: StickyNote): Promise<void> {
    const all = await this.readAll();
    if (all.length >= MAX_NOTES) throw new Error('便签数量已达上限');
    all.push(note);
    await this.writeAll(all);
  }

  async updateNote(id: string, patch: Partial<Omit<StickyNote, 'id' | 'createdAt'>>): Promise<StickyNote | null> {
    const all = await this.readAll();
    const idx = all.findIndex((n) => n.id === id);
    if (idx < 0) return null;
    const current = all[idx];
    const next: StickyNote = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: patch.updatedAt ?? current.updatedAt,
    };
    all[idx] = next;
    await this.writeAll(all);
    return next;
  }

  async deleteNote(id: string): Promise<boolean> {
    const all = await this.readAll();
    const next = all.filter((n) => n.id !== id);
    if (next.length === all.length) return false;
    await this.writeAll(next);
    return true;
  }
}