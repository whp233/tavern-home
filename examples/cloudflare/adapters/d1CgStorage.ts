// D1 版 CgStorage：自定义 CG 条目 CRUD（task-14）。
// 读/写惯例对齐 d1DiaryStorage.ts：TEXT 列 + parse* 回读，不带业务逻辑。
// 校验在 src/core/cgService.ts，REST 壳在 src/tools/cg.ts。

import type { CgStorage } from '../../../src/core/storage.ts';
import type { CustomCgEntry } from '../../../src/core/types.ts';

function parseEnabled(v: unknown): boolean {
  return Number(v ?? 0) !== 0;
}

function parseEntry(row: any): CustomCgEntry | null {
  if (!row) return null;
  return {
    id: String(row.id),
    project: String(row.project ?? ''),
    charKey: String(row.char_key ?? ''),
    title: String(row.title ?? ''),
    sceneKey: String(row.scene_key ?? ''),
    condition: String(row.condition ?? ''),
    imageUrl: String(row.image_url ?? ''),
    placeholder: String(row.placeholder ?? ''),
    enabled: parseEnabled(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at || row.created_at),
  };
}

const ENTRY_COLS = 'id, project, char_key, title, scene_key, condition, image_url, placeholder, enabled, created_at, updated_at';

export class D1CgStorage implements CgStorage {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async listEntries(opts: { project?: string; charKey?: string; sceneKey?: string; enabled?: boolean; limit?: number } = {}): Promise<CustomCgEntry[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (opts.project !== undefined && opts.project !== null && String(opts.project) !== '') {
      conditions.push('project = ?');
      values.push(String(opts.project));
    }
    if (opts.charKey !== undefined && opts.charKey !== null && String(opts.charKey) !== '') {
      conditions.push('char_key = ?');
      values.push(String(opts.charKey));
    }
    if (opts.sceneKey !== undefined && opts.sceneKey !== null && String(opts.sceneKey) !== '') {
      conditions.push('scene_key = ?');
      values.push(String(opts.sceneKey));
    }
    if (opts.enabled !== undefined) {
      conditions.push('enabled = ?');
      values.push(opts.enabled ? 1 : 0);
    }
    const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 2000);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.db.prepare(
      `SELECT * FROM custom_cg ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`,
    ).bind(...values, limit).all<any>();
    return (result.results || []).map(parseEntry).filter((e): e is CustomCgEntry => e !== null);
  }

  async getEntry(id: string): Promise<CustomCgEntry | null> {
    const row = await this.db.prepare(`SELECT * FROM custom_cg WHERE id = ?`).bind(id).first<any>();
    return row ? parseEntry(row) : null;
  }

  async createEntry(value: CustomCgEntry): Promise<void> {
    await this.db.prepare(
      `INSERT INTO custom_cg (${ENTRY_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      value.id, value.project, value.charKey, value.title, value.sceneKey, value.condition,
      value.imageUrl, value.placeholder, value.enabled ? 1 : 0, value.createdAt, value.updatedAt,
    ).run();
  }

  async updateEntry(id: string, patch: Partial<Omit<CustomCgEntry, 'id' | 'createdAt'>>): Promise<CustomCgEntry | null> {
    const columns: Array<[keyof typeof patch, string, (v: any) => unknown]> = [
      ['project', 'project', (v) => String(v ?? '')],
      ['charKey', 'char_key', (v) => String(v ?? '')],
      ['title', 'title', (v) => String(v ?? '')],
      ['sceneKey', 'scene_key', (v) => String(v ?? '')],
      ['condition', 'condition', (v) => String(v ?? '')],
      ['imageUrl', 'image_url', (v) => String(v ?? '')],
      ['placeholder', 'placeholder', (v) => String(v ?? '')],
      ['enabled', 'enabled', (v) => (v ? 1 : 0)],
      ['updatedAt', 'updated_at', (v) => String(v)],
    ];
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column, encode] of columns) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(encode(patch[key]));
      }
    }
    if (!sets.length) return this.getEntry(id);
    const result = await this.db.prepare(`UPDATE custom_cg SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
    return result.meta?.changes ? this.getEntry(id) : null;
  }

  async deleteEntry(id: string): Promise<boolean> {
    const result = await this.db.prepare(`DELETE FROM custom_cg WHERE id = ?`).bind(id).run();
    return !!result.meta?.changes;
  }
}