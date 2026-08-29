// examples/cloudflare/adapters/d1StoryStorage.ts
// 剧情CG会话持久化：复用 oc_state（零 migration），key = story:session:<id>
// 与 diary/custom_cg 同层，不跟 desk_windows 抢热区。

export interface StoryPersistSession {
  id: string;
  project: string;
  charKey?: string;
  title: string;
  outline: unknown;
  opening: unknown;
  state: unknown;
  history: unknown[];
  createdAt: string;
  updatedAt: string;
}

function parseObj(raw: string | null): any {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export class D1StoryStorage {
  constructor(private readonly db: D1Database) {}

  private key(id: string): string { return `story:session:${id}`; }
  private idxKey(project: string): string { return `story:index:${project || '_'}`; }

  async save(session: StoryPersistSession): Promise<void> {
    const now = session.updatedAt || new Date().toISOString();
    await this.db.prepare(`INSERT INTO oc_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .bind(this.key(session.id), JSON.stringify(session), now).run();
    // 索引：project -> id 列表（追加，幂等）
    const idxRaw = await this.db.prepare(`SELECT value FROM oc_state WHERE key=?`).bind(this.idxKey(session.project)).first<any>();
    const list: string[] = idxRaw ? (parseObj(idxRaw.value)?.ids || []) : [];
    if (!list.includes(session.id)) {
      list.unshift(session.id);
      const trimmed = list.slice(0, 200);
      await this.db.prepare(`INSERT INTO oc_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .bind(this.idxKey(session.project), JSON.stringify({ ids: trimmed }), now).run();
    }
  }

  async get(id: string): Promise<StoryPersistSession | null> {
    const row = await this.db.prepare(`SELECT value FROM oc_state WHERE key=?`).bind(this.key(id)).first<any>();
    if (!row) return null;
    return parseObj(row.value);
  }

  async list(project: string, limit = 20): Promise<StoryPersistSession[]> {
    const idxRaw = await this.db.prepare(`SELECT value FROM oc_state WHERE key=?`).bind(this.idxKey(project)).first<any>();
    if (!idxRaw) return [];
    const ids: string[] = parseObj(idxRaw.value)?.ids || [];
    const out: StoryPersistSession[] = [];
    for (const id of ids.slice(0, limit)) {
      const s = await this.get(id);
      if (s) out.push(s);
    }
    return out;
  }

  async delete(id: string): Promise<boolean> {
    const row = await this.db.prepare(`SELECT value FROM oc_state WHERE key=?`).bind(this.key(id)).first<any>();
    if (!row) return false;
    const sess = parseObj(row.value) as StoryPersistSession | null;
    const project = sess?.project || '_';
    await this.db.prepare(`DELETE FROM oc_state WHERE key=?`).bind(this.key(id)).run();
    const idxRaw = await this.db.prepare(`SELECT value FROM oc_state WHERE key=?`).bind(this.idxKey(project)).first<any>();
    if (idxRaw) {
      const ids: string[] = parseObj(idxRaw.value)?.ids || [];
      const next = ids.filter((x) => x !== id);
      const now = new Date().toISOString();
      await this.db.prepare(`INSERT INTO oc_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .bind(this.idxKey(project), JSON.stringify({ ids: next }), now).run();
    }
    return true;
  }
}
