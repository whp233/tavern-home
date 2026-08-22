import type { Chapter, ChapterComment, CommentAuthor, CustomCgEntry, DeskFloor, DeskLore, DeskMemory, DeskMemorySnapshot, DeskPromptBlock, DeskRecipe, DeskRegex, DeskWindow, DiaryEntry, MemoryLayer, StudyEntry } from './types.ts';

export interface StudyListQuery {
  project?: string;
  category?: StudyEntry['category'];
  keyword?: string;
  tag?: string;
}

export interface StudyStats {
  byCategory: Record<string, number>;
  byProject: Record<string, number>;
  total: number;
}

export interface StudyStorage {
  listEntries(query: StudyListQuery): Promise<StudyEntry[]>;
  getEntry(id: string): Promise<StudyEntry | null>;
  createEntry(entry: StudyEntry): Promise<void>;
  updateEntry(id: string, patch: Partial<Omit<StudyEntry, 'id' | 'createdAt'>>): Promise<StudyEntry | null>;
  deleteEntry(id: string): Promise<boolean>;
  stats(): Promise<StudyStats>;
}

export interface ReadingStorage {
  createChapter(chapter: Chapter): Promise<void>;
  getChapter(id: string): Promise<Chapter | null>;
  publishChapter(id: string, publishedAt: string): Promise<Chapter | null>;
  listPublishedChapters(project?: string): Promise<Array<Chapter & { commentCount: number }>>;
  getPublishedChapter(id: string): Promise<Chapter | null>;
  listPublishedComments(chapterId: string, limit: number): Promise<ChapterComment[] | null>;
  createPublishedComment(input: {
    id: string;
    chapterId: string;
    replyTo: string | null;
    author: CommentAuthor;
    content: string;
    createdAt: string;
  }): Promise<ChapterComment | null>;
}

export interface DeskStorage {
  listWindows(project?: string): Promise<DeskWindow[]>;
  getWindow(id: string): Promise<DeskWindow | null>;
  createWindow(window: DeskWindow): Promise<void>;
  updateWindow(id: string, patch: Partial<Omit<DeskWindow, 'id' | 'createdAt'>>): Promise<DeskWindow | null>;
  updateTimelineState(id: string, expectedUpdatedAt: string, timelineState: Record<string, unknown>, updatedAt: string): Promise<DeskWindow | null>;
  deleteWindow(id: string): Promise<boolean>;
  listFloors(windowId: string): Promise<DeskFloor[]>;
  getFloor(id: string): Promise<DeskFloor | null>;
  createFloor(floor: DeskFloor): Promise<void>;
  updateFloor(id: string, patch: Partial<Omit<DeskFloor, 'id' | 'windowId' | 'createdAt'>>): Promise<DeskFloor | null>;
  truncateFloors(windowId: string, anchorId: string, inclusive: boolean): Promise<number | null>;
}

export interface DeskAssetStorage {
  getRecipe(id: string): Promise<DeskRecipe | null>;
  hasPreset(id: string): Promise<boolean>;
  listRegex(ids: string[]): Promise<DeskRegex[]>;
  listQueueBlocks(presetId: string): Promise<DeskPromptBlock[]>;
  listLore(project: string): Promise<DeskLore[]>;
  importPack(pack: DeskAssetPack): Promise<void>;
}

export interface DeskAssetPack {
  project: string;
  name: string;
  recipe: DeskRecipe;
  blocks: DeskPromptBlock[];
  regex: DeskRegex[];
}

export interface DeskStoryStorage {
  getState(key: string): Promise<string | null>;
  listPublishedChapters(project: string): Promise<Chapter[]>;
  getPublishedChapters(ids: string[], project: string): Promise<Chapter[]>;
}

export interface DeskTurnCommit {
  content: string;
  thinking: string | null;
  report: Record<string, unknown>;
  stateBoard: Record<string, unknown>;
  committedAt: string;
}

export interface DeskTurnStorage {
  commitAssistantFloor(windowId: string, floorId: string, commit: DeskTurnCommit): Promise<DeskFloor | null>;
  rollAssistantFloor(input: {
    windowId: string;
    floorId: string;
    expected: Pick<DeskFloor, 'content' | 'variants' | 'activeVariant' | 'thinking' | 'report'>;
    commit: DeskTurnCommit;
  }): Promise<DeskFloor | null>;
}

export interface DeskMemoryStorage {
  // —— 既有方法（window 溯源查询，语义不变，task-7/9 兼容）——
  listMemories(windowId: string): Promise<DeskMemory[]>;
  getMemory(id: string): Promise<DeskMemory | null>;
  createMemory(memory: DeskMemory): Promise<void>;
  updateMemory(id: string, patch: Partial<Omit<DeskMemory, 'id' | 'windowId' | 'project' | 'charKey' | 'createdAt'>>): Promise<DeskMemory | null>;
  deleteMemory(id: string): Promise<boolean>;
  truncateMemories(windowId: string): Promise<number>;
  // Compact 回退快照
  listSnapshots(windowId: string): Promise<DeskMemorySnapshot[]>;
  listSnapshotsByScope(project: string, charKey?: string): Promise<DeskMemorySnapshot[]>;
  createSnapshot(snapshot: DeskMemorySnapshot): Promise<void>;
  restoreSnapshot(snapshotId: string): Promise<DeskMemory[] | null>;

  // —— 新增：按项目×charKey 作用域查询（跨角色重构；charKey 缺省('')=共享作用域）——
  listByScope(opts: {
    project: string;
    charKey?: string;    // 缺省 '' = 共享作用域；非空 = 该角色作用域
    layer?: MemoryLayer; // 可选层过滤
  }): Promise<DeskMemory[]>;

  // —— 新增：按作用域批量写（自动/手动蒸馏落库；anchor 守卫见实现）——
  replaceScope(opts: {
    project: string;
    charKey?: string;    // 同上
    memories: DeskMemory[];
  }): Promise<number>;   // 返回替换条数
}

export interface DiaryStorage {
  // 日记列表：可按日期精确筛（date 形如 "YYYY/M/D"）/ 按项目×角色筛选。
  // 行序不做业务承诺（date 无前导零，词法序不可靠）；调用方用 diaryService.compareDiaryDesc 排序。
  listEntries(opts: { date?: string; project?: string; charKey?: string; limit?: number }): Promise<DiaryEntry[]>;
  // 日期刻度（时间线用）：去重日期 + 该日条数，用于日期刻度条/月份导航。
  listDates(opts: { project?: string; charKey?: string; limit?: number }): Promise<Array<{ date: string; count: number }>>;
  getEntry(id: string): Promise<DiaryEntry | null>;
  createEntry(entry: DiaryEntry): Promise<void>;
  updateEntry(id: string, patch: Partial<Omit<DiaryEntry, 'id' | 'createdAt'>>): Promise<DiaryEntry | null>;
  deleteEntry(id: string): Promise<boolean>;
}
export interface CgStorage {
  // 自定义 CG 列表：可按项目×角色×场景筛选；行序按 updated_at DESC（最新配置在前）。
  listEntries(opts: { project?: string; charKey?: string; sceneKey?: string; enabled?: boolean; limit?: number }): Promise<CustomCgEntry[]>;
  getEntry(id: string): Promise<CustomCgEntry | null>;
  createEntry(entry: CustomCgEntry): Promise<void>;
  updateEntry(id: string, patch: Partial<Omit<CustomCgEntry, 'id' | 'createdAt'>>): Promise<CustomCgEntry | null>;
  deleteEntry(id: string): Promise<boolean>;
}

export interface StorageAdapter {
  reading: ReadingStorage;
  study: StudyStorage;
  desk: DeskStorage;
  deskAssets: DeskAssetStorage;
  deskStory: DeskStoryStorage;
  deskTurn: DeskTurnStorage;
  // 记忆模块可选注入：缺省时对话装配跳过记忆注入与自动蒸馏（向后兼容）。
  memory?: DeskMemoryStorage;
  // 日记存储可选注入（task-12；本仓 D1 方言在 examples/cloudflare/adapters/d1DiaryStorage.ts）。
  diary?: DiaryStorage;
// 自定义 CG 存储可选注入（task-14；本仓 D1 方言在 examples/cloudflare/adapters/d1CgStorage.ts）。
    cg?: CgStorage;
}

export interface SemanticDocument {
  id: string;
  text: string;
  metadata: Record<string, string>;
}

export interface SemanticHit {
  id: string;
  score: number;
}

export interface SemanticSearchAdapter {
  upsert(document: SemanticDocument): Promise<void>;
  delete(id: string): Promise<void>;
  search(query: string, options: { limit: number; filter?: Record<string, string> }): Promise<SemanticHit[]>;
}
