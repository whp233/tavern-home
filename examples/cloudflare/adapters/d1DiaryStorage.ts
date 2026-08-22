// D1 版 DiaryStorage：日记条目按日期组织（date 列存妹居格式 "YYYY/M/D"）。
// 读/写惯例对齐 d1DeskStorage.ts / d1DeskMemoryStorage.ts（JSON 文本列 + parse* 回读），
// 不带业务逻辑——校验在 src/core/diaryService.ts，REST 壳在 src/tools/diary.ts。
// 排序不做业务承诺（date 无前导零，词法序不可靠）：本类只按 created_at 收窄，调用方用
// compareDiaryDesc 数值排序（对齐 study.ts「chapter 序在 JS 里再排一遍」的既有口径）。

import type { DiaryStorage } from '../../../src/core/storage.ts';
import type { DiaryEntry } from '../../../src/core/types.ts';

function parseAffection(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function parseConversationLength(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function parseEntry(row: any): DiaryEntry | null {
  if (!row) return null;
  return {
    id: String(row.id),
    project: String(row.project ?? ''),
    charKey: String(row.char_key ?? ''),
    date: String(row.date ?? ''),
    time: String(row.time ?? ''),
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    affection: parseAffection(row.affection),
    conversationId: String(row.conversation_id ?? ''),
    conversationLength: parseConversationLength(row.conversation_length),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at || row.created_at),
  };
}

const ENTRY_COLS = 'id, project, char_key, date, time, title, content, affection, conversation_id, conversation_length, created_at, updated_at';

export class D1DiaryStorage implements DiaryStorage {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async listEntries(opts: { date?: string; project?: string; charKey?: string; limit?: number } = {}): Promise<DiaryEntry[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (opts.date) { conditions.push('date = ?'); values.push(opts.date); }
    if (opts.project !== undefined && opts.project !== null && String(opts.project) !== '') { conditions.push('project = ?'); values.push(String(opts.project)); }
    if (opts.charKey !== undefined && opts.charKey !== null && String(opts.charKey) !== '') { conditions.push('char_key = ?'); values.push(String(opts.charKey)); }
    const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 2000);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.db.prepare(
      `SELECT * FROM diaries ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(...values, limit).all<any>();
    return (result.results || []).map(parseEntry).filter((e): e is DiaryEntry => e !== null);
  }

  async listDates(opts: { project?: string; charKey?: string; limit?: number } = {}): Promise<Array<{ date: string; count: number }>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (opts.project !== undefined && opts.project !== null && String(opts.project) !== '') { conditions.push('project = ?'); values.push(String(opts.project)); }
    if (opts.charKey !== undefined && opts.charKey !== null && String(opts.charKey) !== '') { conditions.push('char_key = ?'); values.push(String(opts.charKey)); }
    const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 2000);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.db.prepare(
      `SELECT date, COUNT(*) AS c FROM diaries ${where} GROUP BY date ORDER BY MAX(created_at) DESC LIMIT ?`,
    ).bind(...values, limit).all<any>();
    return (result.results || []).map((row: any) => ({
      date: String(row.date ?? ''),
      count: Number(row.c ?? 0),
    }));
  }

  async getEntry(id: string): Promise<DiaryEntry | null> {
    const row = await this.db.prepare(`SELECT * FROM diaries WHERE id = ?`).bind(id).first<any>();
    return row ? parseEntry(row) : null;
  }

  async createEntry(value: DiaryEntry): Promise<void> {
    await this.db.prepare(
      `INSERT INTO diaries (${ENTRY_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      value.id, value.project, value.charKey, value.date, value.time, value.title, value.content,
      value.affection, value.conversationId, value.conversationLength, value.createdAt, value.updatedAt,
    ).run();
  }

  async updateEntry(id: string, patch: Partial<Omit<DiaryEntry, 'id' | 'createdAt'>>): Promise<DiaryEntry | null> {
    const columns: Array<[keyof typeof patch, string, (v: any) => unknown]> = [
      ['project', 'project', (v) => String(v ?? '')],
      ['charKey', 'char_key', (v) => String(v ?? '')],
      ['date', 'date', (v) => String(v)],
      ['time', 'time', (v) => String(v ?? '')],
      ['title', 'title', (v) => String(v ?? '')],
      ['content', 'content', (v) => String(v ?? '')],
      ['affection', 'affection', (v) => (v === null || v === undefined ? null : v)],
      ['conversationId', 'conversation_id', (v) => String(v ?? '')],
      ['conversationLength', 'conversation_length', (v) => (v === null || v === undefined ? null : v)],
      ['updatedAt', 'updated_at', (v) => String(v)],
    ];
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column, encode] of columns) {
      if (patch[key] !== undefined) { sets.push(`${column} = ?`); values.push(encode(patch[key])); }
    }
    if (!sets.length) return this.getEntry(id);
    const result = await this.db.prepare(`UPDATE diaries SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
    return result.meta?.changes ? this.getEntry(id) : null;
  }

  async deleteEntry(id: string): Promise<boolean> {
    const result = await this.db.prepare(`DELETE FROM diaries WHERE id = ?`).bind(id).run();
    return !!result.meta?.changes;
  }
}