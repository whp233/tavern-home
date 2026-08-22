export type ChapterStatus = 'draft' | 'published';

export interface Chapter {
  id: string;
  project: string;
  chapterNo: string;
  title: string;
  content: string;
  summary: string;
  status: ChapterStatus;
  createdAt: string;
  updatedAt: string | null;
  publishedAt: string | null;
}

export interface CommentAuthor {
  id: string;
  type: 'owner' | 'ai';
  displayName: string;
}

export interface ChapterComment {
  id: string;
  chapterId: string;
  replyTo: string | null;
  author: CommentAuthor;
  content: string;
  createdAt: string;
}

export type StudyCategory = 'world' | 'plot' | 'outline' | 'session';

export interface LoreConfig {
  keys: string[];
  position: 'before' | 'after';
  isCharacter: boolean;
  constant: boolean;
  triggerMode: 'scan' | 'presence';
  enabled: boolean;
  fields: Record<string, string>;
}

export interface StudyEntry {
  id: string;
  project: string;
  category: StudyCategory;
  title: string;
  tags: string[];
  chapter: string;
  content: string;
  lore: LoreConfig;
  createdAt: string;
  updatedAt: string | null;
}

export interface DeskWindow {
  id: string;
  project: string;
  title: string;
  recipeId: string;
  note: string;
  noteDepth: number;
  // 窗口声明的角色（char_key）：使同角色跨窗口记忆聚合。缺省 '' = 无角色声明。
  charKey: string;
  stateBoard: Record<string, unknown>;
  timelineState: Record<string, unknown>;
  vars: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DeskFloor {
  id: string;
  windowId: string;
  role: 'user' | 'assistant';
  content: string;
  variants: string[];
  activeVariant: number;
  thinking: string | null;
  report: Record<string, unknown> | null;
  createdAt: string;
}

export interface DeskRecipe {
  id: string;
  presetId: string;
  weight: 'light' | 'heavy';
  overrides: Record<string, { enabled?: boolean; pos?: number }>;
  regexIds: string[];
  lightSystem: string;
}

export interface DeskPromptBlock {
  identifier: string;
  name: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  marker: boolean;
  queuePos: number | null;
  enabledDefault: boolean;
}

export interface DeskRegex {
  id: string;
  find: string;
  flags: string;
  replace: string;
  direction: 'up' | 'down' | 'both';
  meta: Record<string, unknown>;
}

export interface DeskLore {
  id: string;
  name: string;
  content: string;
  keys: string[];
  position: string;
  isCharacter: boolean;
  constant: boolean;
  triggerMode: 'scan' | 'presence';
  fields: Record<string, string>;
}

// 记忆作用域：char=角色作用域（同角色跨窗口聚合）；shared=共享作用域（项目级，所有角色可见）。
export type MemoryScope = 'char' | 'shared';
// 记忆分层：anchor=人设锚定区（稳定锚，剧情蒸馏不覆盖）；plot=剧情摘要区；general=通用区（杂项，闲聊默认不入区）。
export type MemoryLayer = 'anchor' | 'plot' | 'general';

// 打字桌记忆条目：对话中自动提炼/手动维护的关键信息。
// 作用域从「按 desk_window 隔离」升级为「项目 ×（角色|共享）+ 分层」：
//   - project：命名空间，隔离不同项目，防止跨项目串记忆。
//   - charKey：非空 → 角色作用域（同角色跨窗口聚合）；空串 → 共享作用域（项目内所有角色可见）。
//   - layer：所属层（anchor 人设锚 / plot 剧情摘要 / general 通用）。
//   - windowId：降级为溯源（记录这条记忆由哪扇窗提炼/产生），不再担任作用域。
export interface DeskMemory {
  id: string;
  windowId: string;
  project: string;
  charKey: string;
  layer: MemoryLayer;
  theme: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// Compact 压缩前置快照：某记忆作用域在当前时刻的 JSON 快照，用于压缩/回退。
// project+charKey 定位快照所属作用域（charKey='' 为共享区；非空为角色区）。
export interface DeskMemorySnapshot {
  id: string;
  windowId: string;
  project: string;
  charKey: string;
  title: string;
  data: DeskMemory[]; // 该作用域完整记忆集快照
  createdAt: string;
}

// 日记条目（酒馆之家「日记」功能，task-12）：按日期组织的个人+剧情日记。
// 字段对齐妹居存档实测格式（date "YYYY/M/D" / time "下午3:35:11" / affection / content /
// conversationLength + id），并扩展关联与反向递归锚点：
//   - project   可选关联项目（命名空间，空串=未指定）
//   - charKey   可选角色关联（「谁的日记」，空串=未指定）
//   - title     可选标题（默认空串）
//   - conversationId + conversationLength：反向递归锚点——可从日记反查剧情节点，
//     定位当时的对话/演出，联动 task-13/14（回溯场景/自定义 CG）。
export interface DiaryEntry {
  id: string;
  project: string;                    // 可选关联项目，默认 ''
  charKey: string;                    // 可选角色关联，默认 ''（空串=未指定）
  date: string;                       // 归一化日期 "YYYY/M/D"（妹居实测格式，无前导零）
  time: string;                       // 当日记录时间，妹居风格 "下午3:35:11"
  title: string;                      // 可选标题，默认 ''
  content: string;                    // 日记正文
  affection: number | null;           // 好感度数值（0-1000，可空；妹居实测字段）
  conversationId: string;             // 反向递归锚点：关联对话 id，默认 ''
  conversationLength: number | null;  // 对话条数（可空）
  createdAt: string;
  updatedAt: string;
}
// 自定义 CG（task-14）：用户可为角色/剧情配置 CG 图（data URL / URL）或占位，
// 并带场景键 + 状态表达式条件（对齐妹居「事件→条件→组件」的最小可落地形态）。
//   project   可选命名空间（空串=未指定）
//   charKey   可选角色关联（空串=未指定）
//   sceneKey  场景/剧情节点键；非空时当前 state 的「场景/scene/位置」需匹配才解锁
//   condition JS 表达式（可选）；对 state 判定，空串=恒显示
//   imageUrl  图片地址（http(s) 或 data URL）；空串则显示 placeholder 占位
//   placeholder 无图时的占位文本（可放 emoji / 场景名）
export interface CustomCgEntry {
  id: string;
  project: string;
  charKey: string;
  title: string;
  sceneKey: string;
  condition: string;
  imageUrl: string;
  placeholder: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
