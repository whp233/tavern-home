// src/core/homeSave.ts
// 酒馆之家 home 存档（task-16）：导出/导入 .json 的纯函数层。
// 结构对齐妹居备份实测（~/.agents/team/drafts/meiju-implementation-analysis.md §9）：
//   { version, timestamp, exportDate, slotId, data{ gameData{...}, diary[], settings } }
// 本仓扩展：data.deskMemories（打字桌记忆，task-7/10 产物）随档走；settings 只放非敏感配置
// （绝不落 API key——供应商密钥由路由层排除）。
// 不碰 D1/env——只吃/吐普通对象（同 chatImport.ts 家法），路由/测试/前端三层共用。
//
// 导入支持三种格式（detectSaveFormat 按形状嗅探，不认文件名）：
//   home    —— 本仓导出的存档（data.deskMemories 数组为独有标记）
//   meiju   —— 妹居备份 .json：diary 直接映射进日记房；data.prompts 分档角色卡 → 书房世界书
//              条目（category world + isCharacter）；gameData/settings 是妹居私有形状，
//              留档不转换（warnings 里说明）。
//   st_chat —— SillyTavern JSONL 聊天记录（复用 chatImport.parseChatJsonl → 新窗口楼层）。
//
// 冲突口径：planHomeImport 只「规划」不写库——逐域判重（内容键完全一致=重复跳过；同键不同
// 内容=冲突提示，两边都保留）。真正写入在 saveRoutes.ts，且永远是纯追加（新 id、新行），
// 结构上不存在 UPDATE/DELETE 路径 = 防静默覆盖。

import { parseChatJsonl, type ParsedChatFloor } from './chatImport.ts';
import {
  formatDiaryTime,
  normalizeDiaryDate,
  DIARY_AFFECTION_MAX,
  DIARY_CONTENT_MAX,
} from './diaryService.ts';

export const HOME_SAVE_VERSION = '1.0.0';

export type SaveFormat = 'home' | 'meiju' | 'st_chat';
export type MemoryLayerName = 'anchor' | 'plot' | 'general';

const MEMORY_LAYERS: readonly string[] = ['anchor', 'plot', 'general'];
const MEMORY_THEMES: readonly string[] = ['用户画像', '故事情节', '角色设定', '世界观', '其他'];
const STUDY_CATEGORIES: readonly string[] = ['world', 'plot', 'outline', 'session'];
const STICKY_COLORS: readonly string[] = ['yellow', 'green', 'blue', 'pink', 'gray'];

// 楼层正文上限——与 chatImport.ts 的 MES_MAX 同一把尺子（码点安全截断同款手法）。
const FLOOR_TEXT_MAX = 50000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function clampText(s: string, max: number): string {
  return Array.from(s).slice(0, max).join('');
}

function asIntOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return null;
}

function asIso(v: unknown): string {
  const s = asStr(v).trim();
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

// ===== 导出：组装 home 存档文件 =====

export interface HomeSaveGameData {
  windows: unknown[];
  floors: unknown[];
  studyEntries: unknown[];
  chapters: unknown[];
  customCg: unknown[];
  stickyNotes: unknown[];
}

export function emptyGameData(): HomeSaveGameData {
  return { windows: [], floors: [], studyEntries: [], chapters: [], customCg: [], stickyNotes: [] };
}

export interface HomeSaveData {
  gameData: HomeSaveGameData;
  diary: unknown[];
  deskMemories: unknown[];
  settings: Record<string, unknown>;
}

export interface HomeSaveFile {
  version: string;
  timestamp: string;
  exportDate: string;
  slotId: string;
  data: HomeSaveData;
}

// "2026/8/23 下午3:35:11"——妹居风格（无前导零日期 + 上下午12小时制），时间部分与
// diaryService.formatDiaryTime 同源，保证 exportDate 和日记 time 字段长得一样。
export function formatMeijuExportDate(d: Date): string {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${formatDiaryTime(d)}`;
}

export interface BuildHomeSaveInput {
  gameData?: Partial<HomeSaveGameData>;
  diary?: unknown[];
  deskMemories?: unknown[];
  settings?: Record<string, unknown>;
  slotId?: string;
  now?: Date;
}

export function buildHomeSave(input: BuildHomeSaveInput = {}): HomeSaveFile {
  const now = input.now ?? new Date();
  const g = input.gameData ?? {};
  const slotIdRaw = typeof input.slotId === 'string' ? input.slotId.trim() : '';
  return {
    version: HOME_SAVE_VERSION,
    timestamp: now.toISOString(),
    exportDate: formatMeijuExportDate(now),
    slotId: slotIdRaw ? clampText(slotIdRaw, 100) : 'tavern-home',
    data: {
      gameData: {
        windows: asArray(g.windows),
        floors: asArray(g.floors),
        studyEntries: asArray(g.studyEntries),
        chapters: asArray(g.chapters),
        customCg: asArray(g.customCg),
        stickyNotes: asArray(g.stickyNotes),
      },
      diary: asArray(input.diary),
      deskMemories: asArray(input.deskMemories),
      settings: isPlainObject(input.settings) ? input.settings : {},
    },
  };
}

// ===== 格式嗅探 =====

function looksLikeStChatJsonl(raw: string): boolean {
  let sawJsonLine = false;
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    if (!s.startsWith('{')) return false; // 混有非 JSON 行 → 不是纯 JSONL 聊天
    sawJsonLine = true;
    try {
      const m = JSON.parse(s) as Record<string, unknown>;
      if (typeof m.mes === 'string') return true;
    } catch {
      // 单行坏不算整体否决
    }
  }
  return false;
}

// 对已 JSON.parse 的对象判格式：
//   home  —— data.deskMemories 是数组（本仓导出独有标记）
//   meiju —— 有 data 且 gameData/diary/prompts 任一存在（妹居备份顶层结构）
export function detectObjectSaveFormat(parsed: unknown): SaveFormat | null {
  if (!isPlainObject(parsed)) return null;
  const data = parsed.data;
  if (!isPlainObject(data)) return null;
  if (Array.isArray(data.deskMemories)) return 'home';
  if (parsed.version === HOME_SAVE_VERSION && typeof parsed.slotId === 'string' && parsed.slotId.startsWith('tavern-home')) return 'home';
  if (isPlainObject(data.gameData) || Array.isArray(data.diary) || isPlainObject(data.prompts)) return 'meiju';
  return null;
}

export function detectSaveFormat(raw: string): SaveFormat | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // 整块不是合法 JSON → 继续按 JSONL 嗅探
      return looksLikeStChatJsonl(trimmed) ? 'st_chat' : null;
    }
    if (isPlainObject(parsed)) return detectObjectSaveFormat(parsed);
    return looksLikeStChatJsonl(trimmed) ? 'st_chat' : null;
  }
  return looksLikeStChatJsonl(trimmed) ? 'st_chat' : null;
}

// ===== 归一化导入载荷 =====

export interface NormalizedFloor {
  role: 'user' | 'assistant';
  content: string;
  variants: string[];
  activeVariant: number;
  thinking: string | null;
  createdAt: string;
}

export interface NormalizedWindow {
  project: string;
  title: string;
  charKey: string;
  vars: Record<string, unknown>;
  stateBoard: Record<string, unknown>;
  floors: NormalizedFloor[];
}

export interface NormalizedDiary {
  project: string;
  charKey: string;
  date: string;
  time: string;
  title: string;
  content: string;
  affection: number | null;
  conversationId: string;
  conversationLength: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedMemory {
  project: string;
  charKey: string;
  layer: MemoryLayerName;
  theme: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedStudyEntry {
  project: string;
  category: string;
  title: string;
  tags: string[];
  chapter: string;
  content: string;
  lore: Record<string, unknown>;
}

export interface NormalizedChapter {
  project: string;
  chapterNo: string;
  title: string;
  content: string;
  summary: string;
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string | null;
  publishedAt: string | null;
}

export interface NormalizedCg {
  project: string;
  charKey: string;
  title: string;
  sceneKey: string;
  condition: string;
  imageUrl: string;
  placeholder: string;
  enabled: boolean;
}

export interface NormalizedStickyNote {
  project: string;
  charKey: string;
  title: string;
  content: string;
  color: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedImport {
  format: 'home' | 'meiju';
  version: string;
  slotId: string;
  exportedAt: string;
  sourceName: string;
  windows: NormalizedWindow[];
  diaries: NormalizedDiary[];
  deskMemories: NormalizedMemory[];
  studyEntries: NormalizedStudyEntry[];
  chapters: NormalizedChapter[];
  customCg: NormalizedCg[];
  stickyNotes: NormalizedStickyNote[];
  settingsRaw: Record<string, unknown>;
}

export type ParseSaveResult =
  | { ok: true; format: SaveFormat; home: NormalizedImport | null; floors: ParsedChatFloor[]; warnings: string[] }
  | { ok: false; error: string };

// ===== 各域归一化（home / meiju 共用，缺字段跳过 + warning，同 chatImport 容错口径）=====

type Warnings = { warnings: string[] };

function normalizeDiaryRow(raw: Record<string, unknown>, label: string, w: Warnings): NormalizedDiary | null {
  const content = clampText(asStr(raw.content), DIARY_CONTENT_MAX).trim();
  if (!content) {
    w.warnings.push(`${label}: 缺 content(或为空)，已跳过`);
    return null;
  }
  // date：先按妹居 "YYYY/M/D" 归一；不行就从 timestamp ISO 推；再不行跳过。
  let date = normalizeDiaryDate(raw.date);
  const iso = asIso(raw.timestamp ?? raw.createdAt);
  if (!date && iso) date = normalizeDiaryDate(iso.slice(0, 10));
  if (!date) {
    w.warnings.push(`${label}: 日期无法识别(date/timestamp 均无效)，已跳过`);
    return null;
  }
  let time = clampText(asStr(raw.time), 24).trim();
  if (!time && iso) time = formatDiaryTime(new Date(iso));
  const affectionRaw = asIntOrNull(raw.affection);
  const affection =
    affectionRaw === null || affectionRaw < 0 ? null : Math.min(affectionRaw, DIARY_AFFECTION_MAX);
  const convLen = asIntOrNull(raw.conversationLength);
  return {
    project: clampText(asStr(raw.project), 100),
    charKey: clampText(asStr(raw.charKey), 100),
    date,
    time,
    title: clampText(asStr(raw.title), 200),
    content,
    affection,
    conversationId: clampText(asStr(raw.conversationId), 200),
    conversationLength: convLen !== null && convLen >= 0 ? convLen : null,
    createdAt: iso || new Date().toISOString(),
    updatedAt: asIso(raw.updatedAt) || iso || new Date().toISOString(),
  };
}

function normalizeMemoryRow(raw: Record<string, unknown>, label: string, w: Warnings): NormalizedMemory | null {
  const content = clampText(asStr(raw.content), DIARY_CONTENT_MAX).trim();
  if (!content) {
    w.warnings.push(`${label}: 记忆缺 content(或为空)，已跳过`);
    return null;
  }
  const layerRaw = asStr(raw.layer);
  const themeRaw = clampText(asStr(raw.theme), 50).trim();
  const createdAt = asIso(raw.createdAt) || new Date().toISOString();
  return {
    project: clampText(asStr(raw.project), 100),
    charKey: clampText(asStr(raw.charKey), 100),
    layer: (MEMORY_LAYERS.includes(layerRaw) ? layerRaw : 'general') as MemoryLayerName,
    theme: MEMORY_THEMES.includes(themeRaw) ? themeRaw : '其他',
    title: clampText(asStr(raw.title), 200),
    content,
    createdAt,
    updatedAt: asIso(raw.updatedAt) || createdAt,
  };
}

function normalizeStudyRow(raw: Record<string, unknown>, label: string, w: Warnings): NormalizedStudyEntry | null {
  const title = clampText(asStr(raw.title), 200).trim();
  const content = clampText(asStr(raw.content), DIARY_CONTENT_MAX);
  if (!title && !content.trim()) {
    w.warnings.push(`${label}: 世界书条目缺 title/content，已跳过`);
    return null;
  }
  const categoryRaw = asStr(raw.category);
  const loreRaw = isPlainObject(raw.lore) ? raw.lore : {};
  const keysArr = asArray(loreRaw.keys).filter((k): k is string => typeof k === 'string');
  const fieldsRaw = isPlainObject(loreRaw.fields) ? loreRaw.fields : {};
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(fieldsRaw)) {
    if (typeof v === 'string') fields[k] = v;
  }
  const position = asStr(loreRaw.position) === 'after' ? 'after' : 'before';
  const triggerMode = asStr(loreRaw.triggerMode) === 'presence' ? 'presence' : 'scan';
  return {
    project: clampText(asStr(raw.project), 100),
    category: STUDY_CATEGORIES.includes(categoryRaw) ? categoryRaw : 'world',
    title,
    tags: asArray(raw.tags).filter((t): t is string => typeof t === 'string').slice(0, 50),
    chapter: clampText(asStr(raw.chapter), 100),
    content,
    lore: {
      keys: keysArr.slice(0, 100),
      position,
      isCharacter: loreRaw.isCharacter === true,
      constant: loreRaw.constant !== false,
      triggerMode,
      enabled: loreRaw.enabled !== false,
      fields,
    },
  };
}

function normalizeChapterRow(raw: Record<string, unknown>, label: string, w: Warnings): NormalizedChapter | null {
  const content = clampText(asStr(raw.content), DIARY_CONTENT_MAX);
  if (!content.trim()) {
    w.warnings.push(`${label}: 章节缺 content，已跳过`);
    return null;
  }
  const statusRaw = asStr(raw.status);
  return {
    project: clampText(asStr(raw.project), 100),
    chapterNo: clampText(asStr(raw.chapterNo), 50),
    title: clampText(asStr(raw.title), 300),
    summary: clampText(asStr(raw.summary), 5000),
    status: statusRaw === 'published' ? 'published' : 'draft',
    content,
    createdAt: asIso(raw.createdAt) || new Date().toISOString(),
    updatedAt: asIso(raw.updatedAt) || null,
    publishedAt: asIso(raw.publishedAt) || null,
  };
}

function normalizeCgRow(raw: Record<string, unknown>, label: string, w: Warnings): NormalizedCg | null {
  const title = clampText(asStr(raw.title), 200).trim();
  const imageUrl = clampText(asStr(raw.imageUrl), 500000).trim();
  const placeholder = clampText(asStr(raw.placeholder), 500).trim();
  if (!title && !imageUrl && !placeholder) {
    w.warnings.push(`${label}: CG 缺 title/imageUrl/placeholder，已跳过`);
    return null;
  }
  return {
    project: clampText(asStr(raw.project), 100),
    charKey: clampText(asStr(raw.charKey), 100),
    title,
    sceneKey: clampText(asStr(raw.sceneKey), 200).trim(),
    condition: clampText(asStr(raw.condition), 2000),
    imageUrl,
    placeholder,
    enabled: raw.enabled !== false,
  };
}

function normalizeStickyRow(raw: Record<string, unknown>, label: string, w: Warnings): NormalizedStickyNote | null {
  const content = clampText(asStr(raw.content), 5000);
  if (!content.trim()) {
    w.warnings.push(`${label}: 便签缺 content，已跳过`);
    return null;
  }
  const colorRaw = asStr(raw.color);
  const createdAt = asIso(raw.createdAt) || new Date().toISOString();
  return {
    project: clampText(asStr(raw.project), 100),
    charKey: clampText(asStr(raw.charKey), 100),
    title: clampText(asStr(raw.title), 100),
    content,
    color: STICKY_COLORS.includes(colorRaw) ? colorRaw : 'yellow',
    pinned: raw.pinned === true,
    createdAt,
    updatedAt: asIso(raw.updatedAt) || createdAt,
  };
}

// 楼层归一化：硬不变量 content === variants[activeVariant] 在解析端保证（chatImport 同款）。
function normalizeFloorRow(raw: Record<string, unknown>): NormalizedFloor | null {
  if (typeof raw.mes === 'string' && !Array.isArray(raw.variants)) return null; // ST 消息对象混进窗口楼层 → 不是本仓形状
  const roleRaw = asStr(raw.role);
  if (roleRaw !== 'user' && roleRaw !== 'assistant') return null;
  const role: 'user' | 'assistant' = roleRaw;
  let variants = asArray(raw.variants).filter((v): v is string => typeof v === 'string');
  const activeRaw = asIntOrNull(raw.activeVariant) ?? 0;
  let active = Number.isInteger(activeRaw) ? Math.min(Math.max(activeRaw, 0), Math.max(variants.length - 1, 0)) : 0;
  if (!variants.length) variants = [''];
  let content = String(variants[active] ?? '');
  if (Array.from(content).length > FLOOR_TEXT_MAX) content = clampText(content, FLOOR_TEXT_MAX);
  variants = variants.map((v) => (Array.from(v).length > FLOOR_TEXT_MAX ? clampText(v, FLOOR_TEXT_MAX) : v));
  variants[active] = content;
  return {
    role,
    content,
    variants,
    activeVariant: active,
    thinking: typeof raw.thinking === 'string' ? raw.thinking : null,
    createdAt: asIso(raw.createdAt) || new Date().toISOString(),
  };
}

function normalizeWindowRows(
  windowsRaw: unknown[],
  floorsRaw: unknown[],
  w: Warnings,
): NormalizedWindow[] {
  const out: NormalizedWindow[] = [];
  const knownIds = new Set<string>();
  for (let i = 0; i < windowsRaw.length; i++) {
    const raw = windowsRaw[i];
    if (!isPlainObject(raw)) {
      w.warnings.push(`data.gameData.windows[${i}]: 不是对象，已跳过`);
      continue;
    }
    const id = asStr((raw as Record<string, unknown>).id).trim();
    if (id) knownIds.add(id);
    out.push({
      project: clampText(asStr(raw.project), 100),
      title: clampText(asStr(raw.title), 300),
      charKey: clampText(asStr(raw.charKey), 100),
      vars: isPlainObject(raw.vars) ? raw.vars : {},
      stateBoard: isPlainObject(raw.stateBoard) ? raw.stateBoard : {},
      floors: [],
    });
    (out[out.length - 1] as NormalizedWindow & { _id?: string })._id = id;
  }
  // 楼层按 windowId 挂回窗口；孤儿楼层丢弃并警告。
  const byIndex = new Map<number, NormalizedFloor[]>();
  for (let i = 0; i < floorsRaw.length; i++) {
    const raw = floorsRaw[i];
    if (!isPlainObject(raw)) continue;
    const floor = normalizeFloorRow(raw);
    if (!floor) {
      w.warnings.push(`data.gameData.floors[${i}]: 形状不对(role/variants 非法)，已跳过`);
      continue;
    }
    const wid = asStr((raw as Record<string, unknown>).windowId).trim();
    let targetIdx = -1;
    if (wid) {
      targetIdx = out.findIndex((win) => (win as NormalizedWindow & { _id?: string })._id === wid);
      if (targetIdx < 0) {
        w.warnings.push(`data.gameData.floors[${i}]: 指向的窗口 ${wid} 不在存档里，已丢弃该楼`);
        continue;
      }
    } else {
      targetIdx = 0; // 无 windowId 的楼层挂到第一个窗口
    }
    if (targetIdx < 0) continue;
    const list = byIndex.get(targetIdx) ?? [];
    list.push(floor);
    byIndex.set(targetIdx, list);
  }
  for (const [idx, floors] of byIndex) {
    if (out[idx]) out[idx].floors = floors;
  }
  for (const win of out) {
    delete (win as NormalizedWindow & { _id?: string })._id;
  }
  return out.filter((win) => win.floors.length > 0 || win.title || Object.keys(win.stateBoard).length > 0);
}

// ===== home 格式解析（校验 + 归一化）=====

export function parseHomeSaveObject(
  parsed: unknown,
  sourceName = '',
): ParseSaveResult {
  if (!isPlainObject(parsed)) return { ok: false, error: '存档根节点不是 JSON 对象' };
  const data = parsed.data;
  if (!isPlainObject(data)) return { ok: false, error: '存档缺 data 对象——不是酒馆之家/妹居备份结构' };
  const w: Warnings = { warnings: [] };
  const version = asStr(parsed.version) || 'unknown';
  if (version !== HOME_SAVE_VERSION) {
    w.warnings.push(`存档版本 ${version} 与当前 ${HOME_SAVE_VERSION} 不同，已按兼容方式读取`);
  }
  const g = isPlainObject(data.gameData) ? data.gameData : {};
  const windows = normalizeWindowRows(asArray(g.windows), asArray(g.floors), w);
  const diaries: NormalizedDiary[] = [];
  asArray(data.diary).forEach((row, i) => {
    if (!isPlainObject(row)) return;
    const n = normalizeDiaryRow(row, `data.diary[${i}]`, w);
    if (n) diaries.push(n);
  });
  const memories: NormalizedMemory[] = [];
  asArray(data.deskMemories).forEach((row, i) => {
    if (!isPlainObject(row)) return;
    const n = normalizeMemoryRow(row, `data.deskMemories[${i}]`, w);
    if (n) memories.push(n);
  });
  const study: NormalizedStudyEntry[] = [];
  asArray(g.studyEntries).forEach((row, i) => {
    if (!isPlainObject(row)) return;
    const n = normalizeStudyRow(row, `gameData.studyEntries[${i}]`, w);
    if (n) study.push(n);
  });
  const chapters: NormalizedChapter[] = [];
  asArray(g.chapters).forEach((row, i) => {
    if (!isPlainObject(row)) return;
    const n = normalizeChapterRow(row, `gameData.chapters[${i}]`, w);
    if (n) chapters.push(n);
  });
  const cgs: NormalizedCg[] = [];
  asArray(g.customCg).forEach((row, i) => {
    if (!isPlainObject(row)) return;
    const n = normalizeCgRow(row, `gameData.customCg[${i}]`, w);
    if (n) cgs.push(n);
  });
  const stickies: NormalizedStickyNote[] = [];
  asArray(g.stickyNotes).forEach((row, i) => {
    if (!isPlainObject(row)) return;
    const n = normalizeStickyRow(row, `gameData.stickyNotes[${i}]`, w);
    if (n) stickies.push(n);
  });
  return {
    ok: true,
    format: 'home',
    home: {
      format: 'home',
      version,
      slotId: clampText(asStr(parsed.slotId), 100) || 'tavern-home',
      exportedAt: asIso(parsed.timestamp) || '',
      sourceName,
      windows,
      diaries,
      deskMemories: memories,
      studyEntries: study,
      chapters,
      customCg: cgs,
      stickyNotes: stickies,
      settingsRaw: isPlainObject(data.settings) ? data.settings : {},
    },
    floors: [],
    warnings: w.warnings,
  };
}

// ===== meiju 备份转换 =====

// data.prompts 的每张分档角色卡 → 一条书房世界书条目（category world + isCharacter），
// 卡片原文 JSON 存进 content（后续可用角色卡 Skill/parseCharacterCard 再拆）。
function convertMeijuPrompts(prompts: Record<string, unknown>, w: Warnings): NormalizedStudyEntry[] {
  const out: NormalizedStudyEntry[] = [];
  for (const [key, value] of Object.entries(prompts)) {
    if (!isPlainObject(value)) continue;
    const nameFromCard = asStr(value.name).trim() || asStr((value.data as Record<string, unknown>)?.name).trim();
    let cardText: string;
    try {
      cardText = JSON.stringify(value);
    } catch {
      w.warnings.push(`prompts.${key}: 角色卡序列化失败，已跳过`);
      continue;
    }
    out.push({
      project: '',
      category: 'world',
      title: nameFromCard || `妹居角色卡·${key}`,
      tags: ['妹居导入'],
      chapter: '',
      content: cardText,
      lore: {
        keys: [],
        position: 'before',
        isCharacter: true,
        constant: true,
        triggerMode: 'scan',
        enabled: true,
        fields: {},
      },
    });
  }
  return out;
}

export function convertMeijuBackup(
  parsed: unknown,
  sourceName = '',
): ParseSaveResult {
  if (!isPlainObject(parsed)) return { ok: false, error: '妹居备份根节点不是 JSON 对象' };
  const data = parsed.data;
  if (!isPlainObject(data)) return { ok: false, error: '妹居备份缺 data 对象' };
  const diaryArr = asArray(data.diary);
  const prompts = isPlainObject(data.prompts) ? data.prompts : {};
  const gameData = isPlainObject(data.gameData) ? data.gameData : {};
  if (!diaryArr.length && !Object.keys(prompts).length && !Object.keys(gameData).length) {
    return { ok: false, error: '妹居备份里没有可导入的内容(diary/prompts/gameData 全空)' };
  }
  const w: Warnings = { warnings: [] };
  const diaries: NormalizedDiary[] = [];
  diaryArr.forEach((row, i) => {
    if (!isPlainObject(row)) return;
    const n = normalizeDiaryRow(row, `data.diary[${i}]`, w);
    if (n) diaries.push(n);
  });
  const study = convertMeijuPrompts(prompts, w);
  w.warnings.push('妹居 gameData/settings 为游戏私有数值(好感度等)，本次留档未转换');
  return {
    ok: true,
    format: 'meiju',
    home: {
      format: 'meiju',
      version: asStr(parsed.version) || 'unknown',
      slotId: clampText(asStr(parsed.slotId), 100) || 'meiju',
      exportedAt: asIso(parsed.timestamp) || '',
      sourceName,
      windows: [],
      diaries,
      deskMemories: [],
      studyEntries: study,
      chapters: [],
      customCg: [],
      stickyNotes: [],
      settingsRaw: isPlainObject(data.settings)
        ? { meijuSettings: data.settings }
        : {},
    },
    floors: [],
    warnings: w.warnings,
  };
}

// ===== 主入口：解析任意存档文本 =====

export function parseSavePayload(raw: string): ParseSaveResult {
  const format = detectSaveFormat(raw);
  if (!format) {
    return { ok: false, error: '无法识别的存档格式：既不是酒馆之家/妹居备份 .json，也不是 SillyTavern JSONL 聊天记录' };
  }
  if (format === 'st_chat') {
    const r = parseChatJsonl(raw);
    if (!r.ok) return { ok: false, error: `SillyTavern 聊天记录解析失败：${r.error}` };
    if (!r.floors.length) return { ok: false, error: '聊天记录里没有可导入的消息(全是系统/空行/坏行)' };
    return { ok: true, format, home: null, floors: r.floors, warnings: r.warnings };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return { ok: false, error: 'JSON 解析失败——文件损坏或被截断' };
  }
  if (format === 'home') return parseHomeSaveObject(parsed);
  return convertMeijuBackup(parsed);
}

// ===== 冲突规划（纯函数，不写库）=====

// 判重键生成器：导出给路由层建 ExistingSummary 用，两边共用同一把尺子。
export function diaryKeyOf(e: { project?: string; charKey?: string; date?: string; content?: string }): string {
  return [e.project ?? '', e.charKey ?? '', e.date ?? '', e.content ?? ''].join('\u0000');
}
export function memoryKeyOf(e: { project?: string; charKey?: string; layer?: string; theme?: string; title?: string; content?: string }): string {
  return [e.project ?? '', e.charKey ?? '', e.layer ?? '', e.theme ?? '', e.title ?? '', e.content ?? ''].join('\u0000');
}
export function studyKeyOf(e: { project?: string; category?: string; title?: string }): string {
  return [e.project ?? '', e.category ?? '', e.title ?? ''].join('\u0000');
}
export function cgKeyOf(e: { project?: string; charKey?: string; sceneKey?: string; title?: string }): string {
  return [e.project ?? '', e.charKey ?? '', e.sceneKey ?? '', e.title ?? ''].join('\u0000');
}
export function chapterKeyOf(e: { project?: string; chapterNo?: string; title?: string }): string {
  return [e.project ?? '', e.chapterNo ?? '', e.title ?? ''].join('\u0000');
}
export function stickyKeyOf(e: { project?: string; charKey?: string; title?: string; content?: string }): string {
  return [e.project ?? '', e.charKey ?? '', e.title ?? '', e.content ?? ''].join('\u0000');
}
export function windowTitleKeyOf(e: { project?: string; title?: string }): string {
  return `${e.project ?? ''}\u0000${e.title ?? ''}`;
}

export interface ExistingSummary {
  diaryKeys: Set<string>;
  memoryKeys: Set<string>;
  studyKeys: Set<string>;
  cgKeys: Set<string>;
  chapterKeys: Set<string>;
  stickyKeys: Set<string>;
  windowTitles: Set<string>;
}

export function emptyExistingSummary(): ExistingSummary {
  return {
    diaryKeys: new Set(),
    memoryKeys: new Set(),
    studyKeys: new Set(),
    cgKeys: new Set(),
    chapterKeys: new Set(),
    stickyKeys: new Set(),
    windowTitles: new Set(),
  };
}

export interface ImportPlanConflict {
  domain: string;
  key: string;
  detail: string;
}

export interface ImportPlanCounts {
  windows: number;
  floors: number;
  diaries: number;
  deskMemories: number;
  studyEntries: number;
  chapters: number;
  customCg: number;
  stickyNotes: number;
}

export interface ImportPlan {
  ok: boolean;
  errors: string[];
  warnings: string[];
  conflicts: ImportPlanConflict[];
  add: ImportPlanCounts;
  duplicatesSkipped: number;
  nothingToDo: boolean;
}

export function emptyPlan(): ImportPlan {
  return {
    ok: true,
    errors: [],
    warnings: [],
    conflicts: [],
    add: { windows: 0, floors: 0, diaries: 0, deskMemories: 0, studyEntries: 0, chapters: 0, customCg: 0, stickyNotes: 0 },
    duplicatesSkipped: 0,
    nothingToDo: true,
  };
}

export function planHomeImport(incoming: NormalizedImport, existing: ExistingSummary): ImportPlan {
  const plan = emptyPlan();
  plan.ok = true;

  for (const d of incoming.diaries) {
    const key = diaryKeyOf(d);
    if (existing.diaryKeys.has(key)) {
      plan.duplicatesSkipped++;
      continue;
    }
    plan.add.diaries++;
  }
  for (const m of incoming.deskMemories) {
    const key = memoryKeyOf(m);
    if (existing.memoryKeys.has(key)) {
      plan.duplicatesSkipped++;
      continue;
    }
    plan.add.deskMemories++;
  }
  for (const s of incoming.studyEntries) {
    const key = studyKeyOf(s);
    if (!key.endsWith('\u0000')) {
      if (existing.studyKeys.has(key)) {
        plan.conflicts.push({ domain: 'studyEntries', key: s.title || '(无标题)', detail: '同项目同类目下已有同名条目，将作为新条目追加(两份共存)' });
      } else {
        plan.add.studyEntries++;
      }
    } else {
      plan.add.studyEntries++;
    }
  }
  for (const c of incoming.chapters) {
    const key = chapterKeyOf(c);
    if (existing.chapterKeys.has(key)) {
      plan.conflicts.push({ domain: 'chapters', key: `${c.project}#${c.chapterNo || c.title}`, detail: '同项目已有同编号同名章节，将作为草稿副本追加' });
    } else {
      plan.add.chapters++;
    }
  }
  for (const c of incoming.customCg) {
    const key = cgKeyOf(c);
    if (existing.cgKeys.has(key)) {
      plan.conflicts.push({ domain: 'customCg', key: c.title || c.sceneKey || '(未命名)', detail: '已存在同项目同角色的同名 CG 配置，将作为新条目追加' });
    } else {
      plan.add.customCg++;
    }
  }
  for (const s of incoming.stickyNotes) {
    const key = stickyKeyOf(s);
    if (existing.stickyKeys.has(key)) {
      plan.duplicatesSkipped++;
      continue;
    }
    plan.add.stickyNotes++;
  }
  for (const win of incoming.windows) {
    plan.add.windows++;
    plan.add.floors += win.floors.length;
    const tkey = windowTitleKeyOf(win);
    if (win.title && existing.windowTitles.has(tkey)) {
      plan.conflicts.push({ domain: 'windows', key: win.title, detail: '已存在同名写作窗，导入会新建一扇窗(原窗不动)' });
    }
  }

  plan.nothingToDo =
    plan.add.windows === 0 &&
    plan.add.floors === 0 &&
    plan.add.diaries === 0 &&
    plan.add.deskMemories === 0 &&
    plan.add.studyEntries === 0 &&
    plan.add.chapters === 0 &&
    plan.add.customCg === 0 &&
    plan.add.stickyNotes === 0;
  return plan;
}
