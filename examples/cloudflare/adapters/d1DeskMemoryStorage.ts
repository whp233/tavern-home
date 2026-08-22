// D1 版 DeskMemoryStorage：打字桌记忆条目 + Compact 回退快照。
// desk_memories 每行一条记忆；desk_memory_snapshots 每行一份作用域快照（data 列存 JSON 数组）。
// 读/写惯例对齐 d1DeskStorage.ts（JSON.stringify 落文本列 + parse* 回读），不带业务逻辑。
// 跨角色重构（task-10）：记忆作用域 = 项目×charKey + 层（layer）；window_id 为溯源。
// anchor 守卫：replaceScope 只批量清空替换「非 anchor」行；anchor 行走逐条 upsert，不被剧情蒸馏清除。

import type { DeskMemoryStorage } from '../../../src/core/storage.ts';
import type { DeskMemory, DeskMemorySnapshot, MemoryLayer } from '../../../src/core/types.ts';

function parseLayer(v: unknown): MemoryLayer {
  return v === 'anchor' || v === 'general' ? v : 'plot';
}

function parseMemory(row: any): DeskMemory | null {
  if (!row) return null;
  const content = String(row.content || '');
  return {
    id: String(row.id),
    windowId: String(row.window_id ?? ''),
    project: String(row.project ?? ''),
    charKey: String(row.char_key ?? ''),
    layer: parseLayer(row.layer),
    theme: String(row.theme ?? '其他'),
    title: String(row.title ?? ''),
    content,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at || row.created_at),
  };
}

function parseSnapshot(row: any): DeskMemorySnapshot | null {
  if (!row) return null;
  let data: DeskMemory[] = [];
  try {
    const v = JSON.parse(String(row.data ?? '[]'));
    if (Array.isArray(v)) data = v.filter((x): x is DeskMemory => x && typeof x === 'object' && typeof x.content === 'string');
  } catch {
    data = [];
  }
  return {
    id: String(row.id),
    windowId: String(row.window_id ?? ''),
    project: String(row.project ?? ''),
    charKey: String(row.char_key ?? ''),
    title: String(row.title ?? ''),
    data,
    createdAt: String(row.created_at),
  };
}

const MEM_COLS = 'id, window_id, project, char_key, layer, theme, title, content, created_at, updated_at';

export class D1DeskMemoryStorage implements DeskMemoryStorage {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async listMemories(windowId: string): Promise<DeskMemory[]> {
    const result = await this.db.prepare(
      `SELECT * FROM desk_memories WHERE window_id = ? ORDER BY updated_at ASC, id ASC`,
    ).bind(windowId).all<any>();
    return (result.results || []).map(parseMemory).filter((m): m is DeskMemory => m !== null);
  }

  async listByScope(opts: { project: string; charKey?: string; layer?: MemoryLayer }): Promise<DeskMemory[]> {
    const project = opts.project || '';
    const charKey = opts.charKey || '';
    let sql = `SELECT * FROM desk_memories WHERE project = ? AND char_key = ?`;
    const params: unknown[] = [project, charKey];
    if (opts.layer) { sql += ` AND layer = ?`; params.push(opts.layer); }
    sql += ` ORDER BY updated_at ASC, id ASC`;
    const result = await this.db.prepare(sql).bind(...params).all<any>();
    return (result.results || []).map(parseMemory).filter((m): m is DeskMemory => m !== null);
  }

  async getMemory(id: string): Promise<DeskMemory | null> {
    const row = await this.db.prepare(`SELECT * FROM desk_memories WHERE id = ?`).bind(id).first<any>();
    return row ? parseMemory(row) : null;
  }

  async createMemory(value: DeskMemory): Promise<void> {
    await this.db.prepare(
      `INSERT INTO desk_memories (${MEM_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      value.id, value.windowId, value.project, value.charKey, value.layer,
      value.theme, value.title, value.content, value.createdAt, value.updatedAt,
    ).run();
  }

  async replaceScope(opts: { project: string; charKey?: string; memories: DeskMemory[] }): Promise<number> {
    const project = opts.project || '';
    const charKey = opts.charKey || '';
    const now = new Date().toISOString();
    // anchor 守卫：批量清空只删「非 anchor」行；anchor 新行逐条 INSERT OR IGNORE——剧情蒸馏绝不
    // 清除既有 anchor，也不覆盖已存在的 anchor（同一 role 名不重复建）。
    const list = opts.memories || [];
    const anchors = list.filter((m) => m && m.layer === 'anchor');
    const plots = list.filter((m) => m && m.layer !== 'anchor');
    const batch: D1PreparedStatement[] = [
      this.db.prepare(`DELETE FROM desk_memories WHERE project = ? AND char_key = ? AND layer != 'anchor'`).bind(project, charKey),
    ];
    const pushStmt = this.db.prepare(
      `INSERT OR REPLACE INTO desk_memories (${MEM_COLS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const m of plots) {
      batch.push(pushStmt.bind(
        m.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        m.windowId || '', project, charKey, m.layer || 'plot',
        m.theme || '其他', m.title || '', m.content, m.createdAt || now, m.updatedAt || now,
      ));
    }
    const anchorStmt = this.db.prepare(
      `INSERT OR IGNORE INTO desk_memories (${MEM_COLS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const a of anchors) {
      batch.push(anchorStmt.bind(
        a.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        a.windowId || '', project, charKey, a.layer, a.theme || '其他', a.title || '', a.content,
        a.createdAt || now, a.updatedAt || now,
      ));
    }
    await this.db.batch(batch);
    return plots.length + anchors.length;
  }

  async updateMemory(id: string, patch: Partial<Omit<DeskMemory, 'id' | 'windowId' | 'project' | 'charKey' | 'createdAt'>>): Promise<DeskMemory | null> {
    const columns: Array<[keyof typeof patch, string, (v: any) => unknown]> = [
      ['theme', 'theme', (v) => v], ['title', 'title', (v) => v],
      ['content', 'content', (v) => v], ['layer', 'layer', (v) => parseLayer(v)],
      ['updatedAt', 'updated_at', (v) => v],
    ];
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column, encode] of columns) {
      if (patch[key] !== undefined) { sets.push(`${column} = ?`); values.push(encode(patch[key])); }
    }
    if (!sets.length) return this.getMemory(id);
    const result = await this.db.prepare(`UPDATE desk_memories SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
    return result.meta?.changes ? this.getMemory(id) : null;
  }

  async deleteMemory(id: string): Promise<boolean> {
    const result = await this.db.prepare(`DELETE FROM desk_memories WHERE id = ?`).bind(id).run();
    return !!result.meta?.changes;
  }

  async truncateMemories(windowId: string): Promise<number> {
    const result = await this.db.prepare(`DELETE FROM desk_memories WHERE window_id = ?`).bind(windowId).run();
    return Number(result.meta?.changes || 0);
  }

  async listSnapshots(windowId: string): Promise<DeskMemorySnapshot[]> {
    const result = await this.db.prepare(
      `SELECT * FROM desk_memory_snapshots WHERE window_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
    ).bind(windowId).all<any>();
    return (result.results || []).map(parseSnapshot).filter((s): s is DeskMemorySnapshot => s !== null);
  }

  async listSnapshotsByScope(project: string, charKey?: string): Promise<DeskMemorySnapshot[]> {
    const ck = charKey || '';
    const result = await this.db.prepare(
      `SELECT * FROM desk_memory_snapshots WHERE project = ? AND char_key = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
    ).bind(project, ck).all<any>();
    return (result.results || []).map(parseSnapshot).filter((s): s is DeskMemorySnapshot => s !== null);
  }

  async createSnapshot(value: DeskMemorySnapshot): Promise<void> {
    await this.db.prepare(
      `INSERT INTO desk_memory_snapshots (id, window_id, project, char_key, title, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(value.id, value.windowId, value.project, value.charKey, value.title, JSON.stringify(value.data), value.createdAt).run();
  }

  async restoreSnapshot(snapshotId: string): Promise<DeskMemory[] | null> {
    const row = await this.db.prepare(`SELECT * FROM desk_memory_snapshots WHERE id = ?`).bind(snapshotId).first<any>();
    if (!row) return null;
    const snap = parseSnapshot(row)!;
    const now = new Date().toISOString();
    const project = snap.project || '';
    const charKey = snap.charKey || '';
    // 回退作用域全量（含 anchor），对齐 task-7「回退=回该快照全集」语义。
    const batch: D1PreparedStatement[] = [
      this.db.prepare(`DELETE FROM desk_memories WHERE project = ? AND char_key = ?`).bind(project, charKey),
    ];
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO desk_memories (${MEM_COLS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const m of snap.data) {
      batch.push(stmt.bind(
        m.id,
        m.windowId || '',
        m.project || project,
        m.charKey ?? charKey,
        m.layer || 'plot',
        m.theme || '其他',
        m.title || '',
        m.content,
        m.createdAt || now,
        m.updatedAt || now,
      ));
    }
    await this.db.batch(batch);
    return snap.data.map((m) => ({ ...m }));
  }
}
