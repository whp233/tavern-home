// D1 版章节记忆/参考风格存储（task-18 + task-19）：复用 oc_state 键值表（key TEXT PRIMARY KEY,
// value TEXT, updated_at）。零 schema 迁移——收口窗 winA-close 在途期间不碰 schema/migrations/**，
// 照 task-15 便签（sticky_notes:all）同款先例，整集合 JSON 读写。
//   · 章节索引：键 `desk_chapter_index:<project>` → { version: 1, entries: [...] }
//   · 参考风格：键 `desk_style_ref:<project>`   → { version: 1, config: {...} }
// 校验/合并/渲染在 src/core/deskMemory.ts 与 src/core/deskGenerationService.ts 纯函数，这里只读写。

import {
  parseChapterIndexJson, upsertChapterIndexEntries,
  type ChapterIndexEntry,
} from '../../../src/core/deskMemory.ts';
import { sanitizeStyleRefConfig, type StyleRefConfig } from '../../../src/core/deskGenerationService.ts';

const indexKeyOf = (project: string): string => `desk_chapter_index:${project}`;
const styleKeyOf = (project: string): string => `desk_style_ref:${project}`;

export class D1DeskChapterMemoryStore {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  private async readValue(key: string): Promise<string | null> {
    const row = await this.db.prepare(`SELECT value FROM oc_state WHERE key = ?`).bind(key).first<any>();
    return typeof row?.value === 'string' ? row.value : null;
  }

  private async writeValue(key: string, value: string): Promise<void> {
    await this.db.prepare(`INSERT OR REPLACE INTO oc_state (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind(key, value, new Date().toISOString()).run();
  }

  async listIndex(project: string): Promise<ChapterIndexEntry[]> {
    return parseChapterIndexJson(await this.readValue(indexKeyOf(project)));
  }

  // 整体覆盖写（调用方先 listIndex → 内存合并 → saveIndex）。
  async saveIndex(project: string, entries: ChapterIndexEntry[]): Promise<void> {
    await this.writeValue(indexKeyOf(project), JSON.stringify({ version: 1, entries }));
  }

  // 合并式写入：upsert 后落盘，返回合并后的全量索引与计数明细。
  async upsertEntries(project: string, incoming: ChapterIndexEntry[]): Promise<{
    entries: ChapterIndexEntry[];
    added: number;
    updated: number;
  }> {
    const existing = await this.listIndex(project);
    const { next, added, updated } = upsertChapterIndexEntries(existing, incoming);
    await this.saveIndex(project, next);
    return { entries: next, added: added.length, updated: updated.length };
  }

  async deleteEntry(project: string, chapterNo: string): Promise<boolean> {
    const existing = await this.listIndex(project);
    const next = existing.filter((e) => e.chapterNo !== chapterNo);
    if (next.length === existing.length) return false;
    await this.saveIndex(project, next);
    return true;
  }

  async getStyleRef(project: string): Promise<StyleRefConfig> {
    let raw: unknown = null;
    try {
      raw = JSON.parse((await this.readValue(styleKeyOf(project))) ?? 'null');
    } catch {
      raw = null;
    }
    const cfg = sanitizeStyleRefConfig(raw && typeof raw === 'object' ? (raw as any).config ?? raw : null);
    return cfg;
  }

  async putStyleRef(project: string, config: StyleRefConfig): Promise<StyleRefConfig> {
    const clean = sanitizeStyleRefConfig(config);
    await this.writeValue(styleKeyOf(project), JSON.stringify({ version: 1, config: clean }));
    return clean;
  }
}
