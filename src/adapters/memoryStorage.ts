import type { DeskAssetPack, DeskAssetStorage, DeskMemoryStorage, DeskStorage, DeskStoryStorage, DeskTurnCommit, DeskTurnStorage, ReadingStorage, StorageAdapter, StudyListQuery, StudyStats, StudyStorage } from '../core/storage.ts';
import type { Chapter, ChapterComment, DeskFloor, DeskLore, DeskMemory, DeskMemorySnapshot, DeskPromptBlock, DeskRecipe, DeskRegex, DeskWindow, MemoryLayer, StudyEntry } from '../core/types.ts';

export interface MemorySeed {
  chapters?: Chapter[];
  comments?: ChapterComment[];
  studyEntries?: StudyEntry[];
  deskWindows?: DeskWindow[];
  deskFloors?: DeskFloor[];
  deskRecipes?: DeskRecipe[];
  deskPresetIds?: string[];
  deskRegex?: DeskRegex[];
  deskBlocks?: Array<DeskPromptBlock & { presetId: string }>;
  deskLore?: Array<DeskLore & { project: string }>;
  deskState?: Record<string, string>;
  deskMemories?: DeskMemory[];
  deskMemorySnapshots?: DeskMemorySnapshot[];
}

export class MemoryDeskStoryStorage implements DeskStoryStorage {
  private readonly chapters: Map<string, Chapter>; private readonly state: Record<string, string>;
  constructor(seed: Pick<MemorySeed, 'chapters' | 'deskState'> = {}, chapters?: Map<string, Chapter>) { this.chapters = chapters || new Map((seed.chapters || []).map((chapter) => [chapter.id, structuredClone(chapter)])); this.state = structuredClone(seed.deskState || {}); }
  async getState(key: string) { return this.state[key] ?? null; }
  async listPublishedChapters(project: string) { return [...this.chapters.values()].filter((x) => x.project === project && x.status === 'published').map((x) => structuredClone(x)); }
  async getPublishedChapters(ids: string[], project: string) { return [...this.chapters.values()].filter((x) => ids.includes(x.id) && x.project === project && x.status === 'published' && (!!x.content.trim() || !!x.summary.trim())).map((x) => structuredClone(x)); }
}

export class MemoryDeskAssetStorage implements DeskAssetStorage {
  private readonly seed: Required<Pick<MemorySeed, 'deskRecipes' | 'deskPresetIds' | 'deskRegex' | 'deskBlocks' | 'deskLore'>>;
  constructor(seed: Pick<MemorySeed, 'deskRecipes' | 'deskPresetIds' | 'deskRegex' | 'deskBlocks' | 'deskLore'> = {}) { this.seed = structuredClone({ deskRecipes: seed.deskRecipes || [], deskPresetIds: seed.deskPresetIds || [], deskRegex: seed.deskRegex || [], deskBlocks: seed.deskBlocks || [], deskLore: seed.deskLore || [] }); }
  async getRecipe(id: string) { const row = this.seed.deskRecipes?.find((x) => x.id === id); return row ? structuredClone(row) : null; }
  async hasPreset(id: string) { return !!this.seed.deskPresetIds?.includes(id); }
  async listRegex(ids: string[]) { return (this.seed.deskRegex || []).filter((x) => ids.includes(x.id)).map((x) => structuredClone(x)); }
  async listQueueBlocks(presetId: string) { return (this.seed.deskBlocks || []).filter((x) => x.presetId === presetId).map(({ presetId: _presetId, ...x }) => structuredClone(x)); }
  async listLore(project: string) { return (this.seed.deskLore || []).filter((x) => x.project === project).sort((a, b) => a.id.localeCompare(b.id)).map(({ project: _project, ...x }) => structuredClone(x)); }
  async importPack(pack: DeskAssetPack) {
    if (this.seed.deskRecipes.some((item) => item.id === pack.recipe.id) || this.seed.deskPresetIds.includes(pack.recipe.presetId)) throw new Error('asset pack id already exists');
    const regexIds = new Set(this.seed.deskRegex.map((item) => item.id));
    if (pack.regex.some((item) => regexIds.has(item.id))) throw new Error('asset pack regex id already exists');
    this.seed.deskPresetIds.push(pack.recipe.presetId); this.seed.deskRecipes.push(structuredClone(pack.recipe));
    this.seed.deskRegex.push(...structuredClone(pack.regex));
    this.seed.deskBlocks.push(...pack.blocks.map((block) => ({ ...structuredClone(block), presetId: pack.recipe.presetId })));
  }
}

const floorOrder = (a: DeskFloor, b: DeskFloor) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export class MemoryDeskStorage implements DeskStorage, DeskTurnStorage {
  readonly windows = new Map<string, DeskWindow>();
  readonly floors = new Map<string, DeskFloor>();

  constructor(seed: Pick<MemorySeed, 'deskWindows' | 'deskFloors'> = {}) {
    for (const row of seed.deskWindows || []) this.windows.set(row.id, structuredClone(row));
    for (const row of seed.deskFloors || []) this.floors.set(row.id, structuredClone(row));
  }
  async listWindows(project?: string) { return [...this.windows.values()].filter((w) => !project || w.project === project).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)).map((row) => structuredClone(row)); }
  async getWindow(id: string) { const row = this.windows.get(id); return row ? structuredClone(row) : null; }
  async createWindow(row: DeskWindow) { if (this.windows.has(row.id)) throw new Error('duplicate desk window'); this.windows.set(row.id, structuredClone(row)); }
  async updateWindow(id: string, patch: Partial<Omit<DeskWindow, 'id' | 'createdAt'>>) { const row = this.windows.get(id); if (!row) return null; const next = { ...row, ...structuredClone(patch) }; this.windows.set(id, next); return structuredClone(next); }
  async updateTimelineState(id: string, expectedUpdatedAt: string, timelineState: Record<string, unknown>, updatedAt: string) { const row = this.windows.get(id); if (!row || row.updatedAt !== expectedUpdatedAt) return null; const next = { ...row, timelineState: structuredClone(timelineState), updatedAt }; this.windows.set(id, next); return structuredClone(next); }
  async deleteWindow(id: string) { if (!this.windows.delete(id)) return false; for (const [floorId, floor] of this.floors) if (floor.windowId === id) this.floors.delete(floorId); return true; }
  async listFloors(windowId: string) { return [...this.floors.values()].filter((f) => f.windowId === windowId).sort(floorOrder).map((row) => structuredClone(row)); }
  async getFloor(id: string) { const row = this.floors.get(id); return row ? structuredClone(row) : null; }
  async createFloor(row: DeskFloor) { if (!this.windows.has(row.windowId)) throw new Error('desk window not found'); if (this.floors.has(row.id)) throw new Error('duplicate desk floor'); this.floors.set(row.id, structuredClone(row)); }
  async updateFloor(id: string, patch: Partial<Omit<DeskFloor, 'id' | 'windowId' | 'createdAt'>>) { const row = this.floors.get(id); if (!row) return null; const next = { ...row, ...structuredClone(patch) }; this.floors.set(id, next); return structuredClone(next); }
  async truncateFloors(windowId: string, anchorId: string, inclusive: boolean) { const rows = await this.listFloors(windowId); const index = rows.findIndex((f) => f.id === anchorId); if (index < 0) return null; const doomed = rows.slice(inclusive ? index : index + 1); for (const row of doomed) this.floors.delete(row.id); return doomed.length; }
  async commitAssistantFloor(windowId: string, floorId: string, commit: DeskTurnCommit) {
    const window = this.windows.get(windowId); if (!window || this.floors.has(floorId)) return null;
    const report = { ...structuredClone(commit.report), commitToken: crypto.randomUUID() };
    const floor: DeskFloor = { id: floorId, windowId, role: 'assistant', content: commit.content, variants: [commit.content], activeVariant: 0, thinking: commit.thinking, report, createdAt: commit.committedAt };
    this.floors.set(floorId, floor); this.windows.set(windowId, { ...window, stateBoard: structuredClone(commit.stateBoard), updatedAt: commit.committedAt });
    return structuredClone(floor);
  }
  async rollAssistantFloor(input: { windowId: string; floorId: string; expected: Pick<DeskFloor, 'content' | 'variants' | 'activeVariant' | 'thinking' | 'report'>; commit: DeskTurnCommit }) {
    const floor = this.floors.get(input.floorId); const window = this.windows.get(input.windowId);
    if (!floor || !window || floor.windowId !== input.windowId || floor.role !== 'assistant') return null;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (floor.content !== input.expected.content || floor.activeVariant !== input.expected.activeVariant || floor.thinking !== input.expected.thinking || !same(floor.variants, input.expected.variants) || !same(floor.report, input.expected.report)) return null;
    const variants = [...floor.variants, input.commit.content];
    const report = { ...structuredClone(input.commit.report), commitToken: crypto.randomUUID() };
    const next: DeskFloor = { ...floor, content: input.commit.content, variants, activeVariant: variants.length - 1, thinking: input.commit.thinking, report };
    this.floors.set(floor.id, next); this.windows.set(window.id, { ...window, stateBoard: structuredClone(input.commit.stateBoard), updatedAt: input.commit.committedAt });
    return structuredClone(next);
  }
}

export class MemoryStudyStorage implements StudyStorage {
  readonly entries = new Map<string, StudyEntry>();

  constructor(entries: StudyEntry[] = []) {
    for (const entry of entries) this.entries.set(entry.id, structuredClone(entry));
  }

  async listEntries(query: StudyListQuery): Promise<StudyEntry[]> {
    const keyword = query.keyword?.toLowerCase();
    return [...this.entries.values()]
      .filter((entry) => query.project === undefined || entry.project === query.project)
      .filter((entry) => !query.category || entry.category === query.category)
      .filter((entry) => !query.tag || entry.tags.includes(query.tag))
      .filter((entry) => !keyword || `${entry.title}\n${entry.content}\n${entry.tags.join(' ')}`.toLowerCase().includes(keyword))
      .map((entry) => structuredClone(entry));
  }

  async getEntry(id: string): Promise<StudyEntry | null> {
    const entry = this.entries.get(id);
    return entry ? structuredClone(entry) : null;
  }

  async createEntry(entry: StudyEntry): Promise<void> {
    if (this.entries.has(entry.id)) throw new Error('duplicate study entry');
    this.entries.set(entry.id, structuredClone(entry));
  }

  async updateEntry(id: string, patch: Partial<Omit<StudyEntry, 'id' | 'createdAt'>>): Promise<StudyEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const updated = { ...entry, ...structuredClone(patch) };
    this.entries.set(id, updated);
    return structuredClone(updated);
  }

  async deleteEntry(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  async stats(): Promise<StudyStats> {
    const byCategory: Record<string, number> = {};
    const byProject: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
      byProject[entry.project] = (byProject[entry.project] || 0) + 1;
    }
    return { byCategory, byProject, total: this.entries.size };
  }
}

export class MemoryReadingStorage implements ReadingStorage {
  readonly chapters = new Map<string, Chapter>();
  readonly comments = new Map<string, ChapterComment>();

  constructor(seed: MemorySeed = {}) {
    for (const chapter of seed.chapters || []) this.chapters.set(chapter.id, structuredClone(chapter));
    for (const comment of seed.comments || []) this.comments.set(comment.id, structuredClone(comment));
  }

  async createChapter(chapter: Chapter): Promise<void> { if (this.chapters.has(chapter.id)) throw new Error('duplicate chapter'); this.chapters.set(chapter.id, structuredClone(chapter)); }
  async getChapter(id: string): Promise<Chapter | null> { const chapter = this.chapters.get(id); return chapter ? structuredClone(chapter) : null; }
  async publishChapter(id: string, publishedAt: string): Promise<Chapter | null> {
    const chapter = this.chapters.get(id); if (!chapter || chapter.status !== 'draft') return null;
    const next: Chapter = { ...chapter, status: 'published', publishedAt, updatedAt: publishedAt };
    this.chapters.set(id, next); return structuredClone(next);
  }

  async listPublishedChapters(project?: string): Promise<Array<Chapter & { commentCount: number }>> {
    return [...this.chapters.values()]
      .filter((chapter) => chapter.status === 'published' && (!project || chapter.project === project))
      .map((chapter) => ({
        ...structuredClone(chapter),
        commentCount: [...this.comments.values()].filter((comment) => comment.chapterId === chapter.id).length,
      }));
  }

  async getPublishedChapter(id: string): Promise<Chapter | null> {
    const chapter = this.chapters.get(id);
    return chapter?.status === 'published' ? structuredClone(chapter) : null;
  }

  async listPublishedComments(chapterId: string, limit: number): Promise<ChapterComment[] | null> {
    if (!(await this.getPublishedChapter(chapterId))) return null;
    return [...this.comments.values()]
      .filter((comment) => comment.chapterId === chapterId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((comment) => structuredClone(comment));
  }

  async createPublishedComment(input: ChapterComment): Promise<ChapterComment | null> {
    if (!(await this.getPublishedChapter(input.chapterId))) return null;
    if (input.replyTo) {
      const parent = this.comments.get(input.replyTo);
      if (!parent || parent.chapterId !== input.chapterId) return null;
    }
    if (this.comments.has(input.id)) return structuredClone(this.comments.get(input.id)!);
    const comment = structuredClone(input);
    this.comments.set(comment.id, comment);
    return structuredClone(comment);
  }
}

const memOrder = (a: DeskMemory, b: DeskMemory) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id);

export class MemoryDeskMemoryStorage implements DeskMemoryStorage {
  readonly memories = new Map<string, DeskMemory>();
  readonly snapshots = new Map<string, DeskMemorySnapshot>();

  constructor(seed: Pick<MemorySeed, 'deskMemories' | 'deskMemorySnapshots'> = {}) {
    for (const row of seed.deskMemories || []) this.memories.set(row.id, structuredClone(row));
    for (const row of seed.deskMemorySnapshots || []) this.snapshots.set(row.id, structuredClone(row));
  }
  async listMemories(windowId: string) { return [...this.memories.values()].filter((m) => m.windowId === windowId).sort(memOrder).map((m) => structuredClone(m)); }
  async listByScope(opts: { project: string; charKey?: string; layer?: MemoryLayer }) {
    const project = opts.project || '';
    const charKey = opts.charKey || '';
    return [...this.memories.values()]
      .filter((m) => m.project === project && m.charKey === charKey && (!opts.layer || m.layer === opts.layer))
      .sort(memOrder)
      .map((m) => structuredClone(m));
  }
  async getMemory(id: string) { const row = this.memories.get(id); return row ? structuredClone(row) : null; }
  async createMemory(row: DeskMemory) { if (this.memories.has(row.id)) throw new Error('duplicate memory'); this.memories.set(row.id, structuredClone(row)); }
  async replaceScope(opts: { project: string; charKey?: string; memories: DeskMemory[] }) {
    const project = opts.project || '';
    const charKey = opts.charKey || '';
    const now = new Date().toISOString();
    // anchor 守卫：先删该 scope 所有非 anchor 行；再对入场行按规则写入——
    //   非 anchor：INSERT OR REPLACE；anchor：已存在（同 scope 同 title）则跳过（不覆盖锚）。
    for (const [id, m] of this.memories) {
      if (m.project === project && m.charKey === charKey && m.layer !== 'anchor') this.memories.delete(id);
    }
    for (const inc of opts.memories || []) {
      if (inc.layer === 'anchor') {
        const exists = [...this.memories.values()].some((m) => m.project === project && m.charKey === charKey && m.layer === 'anchor' && m.title && m.title === inc.title);
        if (exists) continue;
      }
      const row: DeskMemory = {
        id: inc.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        windowId: inc.windowId || '',
        project,
        charKey,
        layer: inc.layer || 'plot',
        theme: inc.theme || '其他',
        title: inc.title || '',
        content: inc.content,
        createdAt: inc.createdAt || now,
        updatedAt: inc.updatedAt || now,
      };
      this.memories.set(row.id, structuredClone(row));
    }
    return (opts.memories || []).length;
  }
  async updateMemory(id: string, patch: Partial<Omit<DeskMemory, 'id' | 'windowId' | 'project' | 'charKey' | 'createdAt'>>) {
    const row = this.memories.get(id); if (!row) return null;
    const next = { ...row, ...structuredClone(patch) }; this.memories.set(id, next); return structuredClone(next);
  }
  async deleteMemory(id: string) { return this.memories.delete(id); }
  async truncateMemories(windowId: string) {
    let n = 0;
    for (const [id, m] of this.memories) { if (m.windowId === windowId) { this.memories.delete(id); n++; } }
    return n;
  }
  async listSnapshots(windowId: string) { return [...this.snapshots.values()].filter((s) => s.windowId === windowId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map((s) => structuredClone(s)); }
  async listSnapshotsByScope(project: string, charKey?: string) {
    const ck = charKey || '';
    return [...this.snapshots.values()].filter((s) => s.project === project && s.charKey === ck).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map((s) => structuredClone(s));
  }
  async createSnapshot(row: DeskMemorySnapshot) { this.snapshots.set(row.id, structuredClone(row)); }
  async restoreSnapshot(snapshotId: string) {
    const snap = this.snapshots.get(snapshotId); if (!snap) return null;
    const next = (snap.data || []).map((m) => structuredClone(m));
    // 回退按作用域（project+charKey）清空，再重建。
    for (const [id, m] of this.memories) {
      if (m.project === snap.project && m.charKey === snap.charKey) this.memories.delete(id);
    }
    for (const m of next) this.memories.set(m.id, m);
    return snapshotData(snap);
  }
}

function snapshotData(snap: DeskMemorySnapshot): DeskMemory[] {
  return (snap.data || []).map((m) => structuredClone(m));
}

export function createMemoryStorage(seed: MemorySeed = {}): StorageAdapter {
  const desk = new MemoryDeskStorage(seed);
  const reading = new MemoryReadingStorage(seed);
  return {
    reading,
    study: new MemoryStudyStorage(seed.studyEntries),
    desk,
    deskAssets: new MemoryDeskAssetStorage(seed),
    deskStory: new MemoryDeskStoryStorage(seed, reading.chapters),
    deskTurn: desk,
    memory: new MemoryDeskMemoryStorage(seed),
  };
}
