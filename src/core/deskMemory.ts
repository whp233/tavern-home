// 打字桌记忆模块：对话中自动提炼关键信息、按主题分组持久化、手动 Compact 压缩。
// 本文件只放纯函数：记忆渲染、蒸馏输出解析、去重合并、压缩；不碰 D1/模型后端——
// 存储走 DeskMemoryStorage 契约（src/core/storage.ts），模型调用在调用方注入。
//
// 把"怎么想记下来 / 怎么消化已记的"都收敛成可测的纯逻辑，路由与聊天装配只是搬运工。

import type { DeskMemory, MemoryLayer, MemoryScope } from './types.ts';

// 记忆主题：固定集合之外的任意字符串也接受（模型蒸馏时可能给出新主题），但 UI 分组优先用这些。
export const MEMORY_THEMES = ['用户画像', '故事情节', '角色设定', '世界观', '其他'] as const;
export const DEFAULT_MEMORY_THEME = '其他';
// 记忆作用域与分层（跨角色重构）。
export const DEFAULT_MEMORY_LAYER: MemoryLayer = 'plot';
export const ANCHOR_LAYER_LABEL = '人设锚定区';
export const PLOT_LAYER_LABEL = '剧情摘要区';
export const GENERAL_LAYER_LABEL = '通用区';
// 层渲染展示顺序：anchor 最前（稳定锚），plot 次之，general 最后。
export const LAYER_RENDER_ORDER: MemoryLayer[] = ['anchor', 'plot', 'general'];
// ===== 黄文配方·松紧实验与画像协同（task-29） =====
// 锚点短语：用于识别黄文配方（轻/重两版均含此短语，避免硬编码 recipeId）。
export const YELLOW_ANCHOR_PHRASE = '注重角色体验和动作';
// 松版：氛围松弛、留白、细腻心理余韵为主
export const YELLOW_LIGHT_SOFT = '注重角色体验和动作，兼顾男方感觉与女方反应。氛围松弛、留白，细腻心理与感官余韵为主，不过度直给，注重情绪铺垫与身体感的层层递进。';
// 紧版：节奏紧凑、感官强烈、直接有力
export const YELLOW_LIGHT_TIGHT = '注重角色体验和动作，兼顾男方感觉与女方反应。节奏紧凑、感官强烈、直接有力，动作描写具体，反应鲜明，不过度铺垫，直击体验核心。';
// 单窗记忆条数上限：超出即需 Compact，避免无限增长撑爆注入体积。
export const MEMORY_CAP = 200;
// 蒸馏一次性最多新增条数（防模型一次吐一大片刷屏）。
export const DISTILL_BATCH_MAX = 12;
// 蒸馏输入聚焦最近楼层数（对应近景窗口，避免拿整窗历史去蒸馏）。
export const DISTILL_FLOOR_WINDOW = 20;

// 作用域派生：charKey 非空=角色作用域；空=共享作用域。
export function memoryScopeOf(m: Pick<DeskMemory, 'charKey'>): MemoryScope {
  return m.charKey ? 'char' : 'shared';
}

// 层清洗：非法/缺省回退剧情摘要层。
export function normalizeLayer(layer: unknown): MemoryLayer {
  return layer === 'anchor' || layer === 'general' ? layer : DEFAULT_MEMORY_LAYER;
}

function nowIso(): string {
  return new Date().toISOString();
}

// 主题清洗：去首尾空白；空/非法回退默认主题。
export function normalizeTheme(theme: unknown): string {
  const t = typeof theme === 'string' ? theme.trim() : '';
  return t ? t : DEFAULT_MEMORY_THEME;
}

// 单条记忆清洗为合法 DeskMemory 形状。
export function sanitizeMemory(m: Partial<DeskMemory>): DeskMemory | null {
  if (!m) return null;
  const content = typeof m.content === 'string' ? m.content.trim() : '';
  if (!content) return null; // 内容为空不落库
  const title = typeof m.title === 'string' ? m.title.trim() : '';
  const theme = normalizeTheme(m.theme);
  const id = typeof m.id === 'string' && m.id ? m.id : `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const ts = nowIso();
  return {
    id,
    windowId: typeof m.windowId === 'string' ? m.windowId : '',
    project: typeof m.project === 'string' ? m.project : '',
    charKey: typeof m.charKey === 'string' ? m.charKey : '',
    layer: normalizeLayer(m.layer),
    theme,
    title,
    content: content.slice(0, 40000), // 单条记忆体积上限（防一次灌爆）
    createdAt: typeof m.createdAt === 'string' && m.createdAt ? m.createdAt : ts,
    updatedAt: typeof m.updatedAt === 'string' && m.updatedAt ? m.updatedAt : ts,
  };
}

// ===== 注入渲染：把已存记忆搓成给模型的紧凑段落 =====
// 跨角色重构后：按「层（layer）」分组，层内再按主题（theme）分组。层标题（anchor 人设锚定区/plot
// 剧情摘要区/general 通用区）在前，让 AI 能区分稳定人设与实际剧情；层内主题分组自然排前。
// 兼容旧数据：无 layer 字段的记忆视为 plot 层；空记忆集返回 ''（不占 token）。
const LAYER_LABEL: Record<MemoryLayer, string> = {
  anchor: ANCHOR_LAYER_LABEL,
  plot: PLOT_LAYER_LABEL,
  general: GENERAL_LAYER_LABEL,
};

export function renderMemoriesText(memories: DeskMemory[], themeOrder: string[] = [...MEMORY_THEMES]): string {
  const real = (memories || []).filter((m) => m && typeof m.content === 'string' && m.content.trim());
  if (!real.length) return '';
  // 按层分组（无 layer 时视为 plot）
  const layers = new Map<MemoryLayer, DeskMemory[]>();
  for (const m of real) {
    const l = (m.layer && LAYER_RENDER_ORDER.includes(m.layer) ? m.layer : DEFAULT_MEMORY_LAYER) as MemoryLayer;
    const arr = layers.get(l) || [];
    arr.push(m);
    layers.set(l, arr);
  }
  const parts: string[] = [];
  const pushLayer = (layer: MemoryLayer): void => {
    const list = layers.get(layer);
    if (!list || !list.length) return;
    // 层内按主题分组
    const groups = new Map<string, DeskMemory[]>();
    for (const m of list) {
      const g = groups.get(m.theme) || [];
      g.push(m);
      groups.set(m.theme, g);
    }
    const themed = new Set<string>();
    const lines: string[] = [];
    const pushGroup = (theme: string): void => {
      const gl = groups.get(theme);
      if (!gl || themed.has(theme)) return;
      themed.add(theme);
      const groupLines = gl.map((m) => {
        const head = m.title ? `${m.title}：${m.content}` : m.content;
        return `- ${head.replace(/\s*\n+\s*/g, ' ')}`;
      });
      lines.push(`【${theme}】\n${groupLines.join('\n')}`);
    };
    for (const t of themeOrder) pushGroup(t);
    for (const t of groups.keys()) if (!themed.has(t)) pushGroup(t);
    parts.push(`【${LAYER_LABEL[layer]}】\n${lines.join('\n')}`);
  };
  for (const l of LAYER_RENDER_ORDER) pushLayer(l);
  return parts.join('\n\n');
}

// ===== 画像协同 helpers（task-29） =====
// 过滤通用区·用户画像
export function filterPortraitMemories(memories: DeskMemory[]): DeskMemory[] {
  return (memories || []).filter((m) => m && m.layer === 'general' && m.theme === '用户画像' && typeof m.content === 'string' && m.content.trim());
}
export function renderPortraitText(memories: DeskMemory[]): string {
  const list = filterPortraitMemories(memories);
  if (!list.length) return '';
  return list.map((m) => (m.title ? `${m.title}：${m.content}` : m.content).replace(/\s*\n+\s*/g, ' ').trim()).join('\n');
}
// 从已渲染的 memoriesText 中抽取【用户画像】段落（兼容已渲染文本复用，避免二次请求）
export function extractPortraitFromRendered(memoriesText: string): string {
  const text = String(memoriesText || '');
  if (!text) return '';
  // 兼容两种渲染形：通用区内【用户画像】子块，或直接的【用户画像】段
  const m = text.match(/【用户画像】\n([\s\S]*?)(?=\n【|$)/);
  if (m && m[1].trim()) return m[1].trim().slice(0, 1200);
  return '';
}
export function isYellowLightSystem(lightSystem: string): boolean {
  return typeof lightSystem === 'string' && lightSystem.includes(YELLOW_ANCHOR_PHRASE);
}

// ===== 蒸馏输出解析 =====
// 模型的蒸馏调用被要求返回 JSON：{ "memories": [ { "theme","title","content" }, ... ] }。
// 宽容解析：允许整体被 ```json 围栏包裹；容忍多余键；非法条目丢弃。
export interface DistillMemory {
  theme: string;
  layer: MemoryLayer;
  charKey: string; // 角色归属（''=共享/未指定，由上层定）
  title: string;
  content: string;
}
export interface DistillResult {
  memories: DistillMemory[];
  validCount: number;
}

export function parseMemoryDistillOutput(raw: unknown): DistillResult {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { memories: [], validCount: 0 };
  let parsed: any = null;
  // 剥离可能的 ```json ... ``` 围栏
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    // 再尝试从整段里找第一组花括号 JSON
    const braceStart = candidate.indexOf('{');
    const braceEnd = candidate.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      try {
        parsed = JSON.parse(candidate.slice(braceStart, braceEnd + 1));
      } catch {
        parsed = null;
      }
    }
  }
  const arr = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.memories)
    ? parsed.memories
    : null;
  if (!arr) return { memories: [], validCount: 0 };
  const memories: DistillMemory[] = [];
  for (const rawItem of arr.slice(0, DISTILL_BATCH_MAX)) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const content = typeof rawItem.content === 'string' ? rawItem.content.trim() : '';
    if (!content) continue;
    const layer = normalizeLayer(rawItem.layer);
    // charKey 缺省空串=共享/未指定，由上层做角色归属判定（7.1/7.2）。
    const charKey = typeof rawItem.charKey === 'string' ? rawItem.charKey.trim() : '';
    memories.push({
      theme: normalizeTheme(rawItem.theme),
      layer,
      charKey,
      title: typeof rawItem.title === 'string' ? rawItem.title.trim() : '',
      content: content.slice(0, 40000),
    });
  }
  return { memories, validCount: memories.length };
}

// ===== 去重合并（自动蒸馏应用时用）：把新提炼的并入已有集 =====
// 规则：同作用域（project+charKey）**同层（layer）**内，同主题同标题 → 覆盖内容；同主题且内容高度
// 近似(去空白后相等) → 合并；其余新增。anchor 与 plot/general 绝不互相覆盖/合并（层隔离锚）。
// 返回 { next, added, updated, dropped } 便于上层计数。
export interface MergeMemoryInput {
  theme: string;
  layer: MemoryLayer;
  charKey?: string;
  title: string;
  content: string;
}
export function mergeMemories(
  existing: DeskMemory[],
  incoming: MergeMemoryInput[],
  opts: { project: string; windowId?: string; charKey?: string; cap?: number } = { project: '' },
): {
  next: DeskMemory[];
  added: DeskMemory[];
  updated: DeskMemory[];
  dropped: number;
} {
  const project = opts.project || '';
  const windowId = opts.windowId || '';
  const defaultCharKey = opts.charKey || '';
  const cap = opts.cap ?? MEMORY_CAP;
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const next: DeskMemory[] = existing.map((m) => ({ ...m }));
  const added: DeskMemory[] = [];
  const updated: DeskMemory[] = [];
  let dropped = 0;

  for (const inc of incoming) {
    const theme = normalizeTheme(inc.theme);
    const layer = normalizeLayer(inc.layer);
    const charKey = typeof inc.charKey === 'string' && inc.charKey ? inc.charKey : defaultCharKey;
    const title = inc.title;
    const content = inc.content;
    let hit = false;
    for (let i = 0; i < next.length; i++) {
      const m = next[i];
      // 层隔离锚：只与同层条目去重/合并；跨层绝不覆盖（尤其 anchor 不被 plot 触碰）。
      // 兼容旧数据：existing 可能缺 layer/charKey，按默认层('plot')与缺省 charKey 归一比较。
      const mLayer = normalizeLayer(m.layer);
      const mCharKey = typeof m.charKey === 'string' ? m.charKey : '';
      if (m.theme !== theme || mLayer !== layer || mCharKey !== charKey) continue;
      // 同主题同标题：当作更新
      if (title && m.title && m.title === title) {
        if (m.content !== content) {
          m.content = content;
          m.title = title;
          m.updatedAt = nowIso();
          updated.push({ ...m });
        }
        hit = true;
        break;
      }
      // 同主题且内容近似：合并（保留较长内容，标题若空则补）
      if (m.content && norm(m.content) === norm(content)) {
        hit = true;
        break;
      }
    }
    if (hit) continue;
    if (next.length >= cap) { dropped++; continue; }
    const mem = sanitizeMemory({ windowId, project, charKey, layer, theme, title, content })!;
    next.push(mem);
    added.push({ ...mem });
  }

  return { next, added, updated, dropped };
}

// ===== Compact：一键压缩 =====
// 纯逻辑：先按「层(layer)+主题(theme)」分组——同层内合并近似/冗余条目（去空白相等去重、标题相同
// 的合并），空内容剔除；anchor 层条目优先保留（超上限截断时先剔 plot/general），且 anchor 与
// 其他层绝不互相合并。它不负责快照——回退快照由上层在调用前落库。
export function compactMemories(memories: DeskMemory[], opts: { cap?: number } = {}): {
  next: DeskMemory[];
  removed: DeskMemory[];
  merged: number;
} {
  const cap = opts.cap ?? MEMORY_CAP;
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const valid = (memories || []).filter((m) => m && typeof m.content === 'string' && m.content.trim());
  if (!valid.length) return { next: [], removed: [], merged: 0 };
  const layerOf = (m: DeskMemory): MemoryLayer => (LAYER_RENDER_ORDER.includes(m.layer) ? m.layer : DEFAULT_MEMORY_LAYER);

  const out: DeskMemory[] = [];
  const removed: DeskMemory[] = [];
  let merged = 0;

  // 按层分组（anchor/plot/general），层内再按主题分组，仅同层同主题合并。
  const byLayer = new Map<MemoryLayer, Map<string, DeskMemory[]>>();
  for (const m of valid) {
    const l = layerOf(m);
    let byTheme = byLayer.get(l);
    if (!byTheme) { byTheme = new Map(); byLayer.set(l, byTheme); }
    const g = byTheme.get(m.theme) || [];
    g.push(m);
    byTheme.set(m.theme, g);
  }
  const themeOrder = (themes: string[]) => [...themes].sort((a, b) => {
    const ai = MEMORY_THEMES.indexOf(a as any);
    const bi = MEMORY_THEMES.indexOf(b as any);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  // anchor 优先（稳定锚，截断时先保），依次 plot、general。
  for (const layer of LAYER_RENDER_ORDER) {
    const byTheme = byLayer.get(layer);
    if (!byTheme) continue;
    for (const theme of themeOrder([...byTheme.keys()])) {
      const list = byTheme.get(theme)!;
      const kept: DeskMemory[] = [];
      for (const m of list) {
        const key = norm(m.content);
        const similarIdx = kept.findIndex((k) => norm(k.content) === key || (m.title && k.title && m.title === k.title));
        const nowKey = m.title && m.content ? `${m.title}${m.content}` : m.content;
        if (similarIdx >= 0) {
          const k = kept[similarIdx];
          // 合并：保留较长内容，标题补全，更新时刻取最新
          if (nowKey.length > 0 && (k.title + k.content).length < nowKey.length) {
            k.title = m.title || k.title;
          }
          k.content = m.content;
          k.updatedAt = m.updatedAt > k.updatedAt ? m.updatedAt : k.updatedAt;
          merged++;
          removed.push({ ...m });
          continue;
        }
        kept.push({ ...m });
      }
      for (const m of kept) out.push(m);
    }
  }

  // 超上限截断：多余剔除（anchor 靠前序已优先保住，截断从尾部 plot/general 开始丢）
  if (out.length > cap) {
    const keep = out.slice(0, cap);
    removed.push(...out.slice(cap));
    merged += out.length - cap;
    out.length = 0;
    out.push(...keep);
  }

  return { next: out, removed, merged };
}

// ===== 蒸馏提示词 =====
// 交给调用方的模型后端用：系统提示 + 目标楼层正文。返回纯字符串便于测试与复用。
// 跨角色重构后：输出带 layer（锚/剧情/通用）与 charKey（归属角色，缺省共享/由上层定）。
export function buildMemoryDistillSystem(): string {
  return [
    '你是打字桌的"记忆提炼器"。从对话楼层里提炼值得长期记住的关键信息，保存为若干条记忆。',
    '只提炼确定、对后续写作有用的事实：用户给的角色设定、偏好、剧情关键事件、伏笔、世界观规则等。',
    '严格区分记忆分层：',
    '- "anchor"(人设锚定区)：只装角色的稳定人设——性格、说话风格、口头禅、基础关系、不可动摇的设定；同一角色的 anchor 尽量合并，不要重复堆。',
    '- "plot"(剧情摘要区)：装剧情进展——重要事件、关系走向、未收伏笔、关键抉择。',
    '- "general"(通用区)：装既非人设也非剧情、但值得留存的杂项（如用户现实偏好）。',
    '纯闲聊、客套、楼层复述不属于以上任何层 → 输出空数组（不要混入记忆）。',
    '严格区分客观事实与角色认知：楼层里确定发生的事是事实；角色的猜测、感想、误解作为"角色认知"，不要当事实记。',
    '不要复述当前楼层本身，不要输出叙事正文，不要包含无意义的客套。',
    '若没有值得记的信息，输出空数组即可。',
    '请只输出一个 JSON 对象，不要任何额外解释或 Markdown 围栏以外的文字：',
    '{"memories":[{"theme":"用户画像|故事情节|角色设定|世界观|其他","layer":"anchor|plot|general","charKey":"<归属角色名,缺省空串>","title":"简短标题","content":"一句到两三句的要点"}]}',
  ].join('\n');
}

// ===== 手动总结（角色级 / 项目级）纯逻辑 =====
// 手动触发：取某作用域关联各窗最近楼层 + 已在库记忆 → 调模型总结 → 落到各层。
// 本文件只提供输入构造与 diff 应用两个纯函数；模型调用、楼层拉取在 src/chat/desk.ts 的
// runMemorySummarize 里做。

// 构造总结输入：给定若干扇窗的最近楼层（已带 project/charKey 标注窗口）与当前作用域已有记忆。
export interface SummarizeFloorInput {
  windowId: string;
  charKey: string;
  role: 'user' | 'assistant';
  content: string;
}
export function buildSummaryInput(
  floors: SummarizeFloorInput[] | undefined,
  current: DeskMemory[],
  project: string,
): string {
  const list = Array.isArray(floors) ? floors.slice(-DISTILL_FLOOR_WINDOW * 4) : [];
  const floorText = list.length
    ? list
        .map((f) => {
          const who = f.windowId ? `[窗:${f.windowId}${f.charKey ? `·${f.charKey}` : ''}]` : '';
          return `${who} ${f.role === 'user' ? '用户' : '模型'}：${String(f.content || '').replace(/\s*\n+\s*/g, '\n')}`;
        })
        .join('\n\n')
        .slice(0, 120000)
    : '';
  const curText = renderMemoriesText(current);
  return [
    `项目：${project}`,
    floorText ? `最近对话楼层：\n${floorText}` : '',
    curText ? `当前已存记忆：\n${curText}` : '',
    '请据此生成/更新记忆。输出的 memories 每条带 layer(anchor|plot|general) 与 charKey(归属角色名，缺省空串=共享区)。',
    '只输出 JSON 对象：{"memories":[...]}，不要额外文字或围栏。',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// 应用总结 diff：把模型产出落到当前作用域记忆集。
// anchor 策略：只允许「新增」anchor，不覆盖/合并已存在的 anchor（手动补人类设；剧情噪声不得改锚）；
// plot/general 走 mergeMemories 同层去重合并。返回更新明细。
export function applySummaryDiff(
  current: DeskMemory[],
  incoming: DistillMemory[],
  opts: { project: string; charKey?: string; windowId?: string; cap?: number },
): {
  next: DeskMemory[];
  added: DeskMemory[];
  updated: DeskMemory[];
  dropped: number;
  anchorGuard: number; // 被 anchor 守卫拦截（已存在 anchor 不覆盖）的条数
} {
  const next = current.map((m) => ({ ...m }));
  const added: DeskMemory[] = [];
  const updated: DeskMemory[] = [];
  const dropped: number[] = [];
  const defaultCharKey = opts.charKey || '';
  let anchorGuard = 0;

  for (const inc of incoming) {
    const layer = normalizeLayer(inc.layer);
    const charKey = inc.charKey || defaultCharKey;
    if (layer === 'anchor') {
      // anchor 只新增，不覆盖/合并已有 anchor（含同 scope 同 title 的）。
      const exists = next.some(
        (m) => m.layer === 'anchor' && m.charKey === charKey && m.title && m.title === inc.title,
      );
      if (exists) { anchorGuard++; continue; }
      const mem = sanitizeMemory({ windowId: opts.windowId || '', project: opts.project, charKey, layer, theme: inc.theme, title: inc.title, content: inc.content })!;
      next.push(mem);
      added.push({ ...mem });
      continue;
    }
    // plot/general：同层合并（mergeMemories 内部已按 layer+charKey 隔离）
    const { next: mergedNext, added: mergedAdded, updated: mergedUpdated, dropped: mDropped } = mergeMemories(
      next, [{ theme: inc.theme, layer, charKey, title: inc.title, content: inc.content }],
      { project: opts.project, charKey: defaultCharKey, windowId: opts.windowId, cap: opts.cap },
    );
    next.length = 0; next.push(...mergedNext);
    added.push(...mergedAdded);
    updated.push(...mergedUpdated);
    dropped.push(mDropped);
  }

  return {
    next,
    added,
    updated,
    dropped: dropped.reduce((a, b) => a + b, 0),
    anchorGuard,
  };
}

// 蒸馏输入聚焦最近楼层：最多 DISTILL_FLOOR_WINDOW 条，role 前缀标注。
export function buildDistillationInput(floors: Array<{ role: 'user' | 'assistant'; content: string }> | undefined): string {
  const list = Array.isArray(floors) ? floors.slice(-DISTILL_FLOOR_WINDOW) : [];
  if (!list.length) return '';
  return list
    .map((f) => `${f.role === 'user' ? '用户' : '模型'}：${String(f.content || '').replace(/\s*\n+\s*/g, '\n')}`)
    .join('\n\n')
    .slice(0, 120000); // 蒸馏输入体积上限
}

// ===== 章节记忆机制（task-18）：章节索引 / 统一检索 / 续写简报 =====
// 长篇小说逐章生成的记忆底座：每章一条索引（章号/主题/关键事件/角色状态摘要），写新章或开新对话时
// 按「读索引 → 词条检索相关情节（非全文搜索）→ 拼前文提要+大纲+记忆」闭环取材。
// 本段仍是纯函数：索引清洗/合并/渲染、查询分词与计分、多轮聚合（带轮数上限防死循环）、简报拼装、
// 整合整理的抽取提示词与输出解析。存储走 oc_state 键值表（D1 方言在 examples/cloudflare/adapters/），
// 模型调用在调用方注入——与记忆模块同一条「纯逻辑在 core、搬运工在外围」的家规。

export interface ChapterIndexEntry {
  chapterNo: string;       // 章号（同项目内索引主键）
  title: string;           // 章题
  theme: string;           // 主题（整合整理后填充；未整理为空串）
  events: string[];        // 关键事件要点
  charState: string;       // 角色状态摘要（本章结束时各角色处境）
  summary: string;         // 章节梗概（成书转写的 <summary> / 手工维护）
  sourceChapterId: string; // 关联读书角 oc_chapters.id（手工条目为空串）
  integrated: boolean;     // 「记忆机制标记完成」：整合整理过且信息齐全
  updatedAt: string;
}

export const CHAPTER_INDEX_MAX = 500;      // 单项目索引条数上限（个人书房规模足够）
export const DEFAULT_INDEX_THEME = '未整理'; // 未整合条目的主题占位
export const CHAPTER_EVENT_MAX = 8;        // 每章关键事件条数上限
export const CHAPTER_EVENT_LEN = 120;      // 单条事件长度上限
export const CHAR_STATE_LEN = 400;         // 角色状态摘要长度上限
export const INDEX_SUMMARY_LEN = 600;      // 索引内梗概长度上限（正文永不进索引，只进梗概）

// 章号自然序比较（数字段按数值、其余按字典序；空章号沉底）。core 层自持一份，
// 不反向 import chat/deskAssemble 的同名实现——依赖方向必须是 chat→core。
export function compareChapterIndexNo(a: unknown, b: unknown): number {
  const as = String(a ?? '').trim();
  const bs = String(b ?? '').trim();
  if (!as && !bs) return 0;
  if (!as) return 1;
  if (!bs) return -1;
  const xs = as.match(/\d+|\D+/g) || [];
  const ys = bs.match(/\d+|\D+/g) || [];
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const boolOf = (v: unknown): boolean => v === true || v === 'true' || v === 1;

// 单条索引清洗：chapterNo 必填（索引主键），其余字段宽容兜底。
export function sanitizeChapterIndexEntry(raw: Partial<ChapterIndexEntry>): ChapterIndexEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const chapterNo = str(raw.chapterNo).slice(0, 100);
  if (!chapterNo) return null;
  const eventsRaw = Array.isArray(raw.events) ? raw.events : [];
  const events = eventsRaw
    .map((e) => str(e))
    .filter(Boolean)
    .slice(0, CHAPTER_EVENT_MAX)
    .map((e) => e.slice(0, CHAPTER_EVENT_LEN));
  return {
    chapterNo,
    title: str(raw.title).slice(0, 200),
    theme: str(raw.theme).slice(0, 60) || DEFAULT_INDEX_THEME,
    events,
    charState: str(raw.charState).slice(0, CHAR_STATE_LEN),
    summary: str(raw.summary).slice(0, INDEX_SUMMARY_LEN),
    sourceChapterId: str(raw.sourceChapterId).slice(0, 200),
    integrated: boolOf(raw.integrated),
    updatedAt: str(raw.updatedAt) || nowIso(),
  };
}

// 解析 oc_state 里存的索引 JSON（坏形状退空数组，绝不抛——照 parseStoredNotes 的口径）。
export function parseChapterIndexJson(value: unknown): ChapterIndexEntry[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    const list = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.entries)
      ? parsed.entries
      : Array.isArray(parsed) ? parsed : [];
    return (list as unknown[])
      .map((e) => sanitizeChapterIndexEntry(e as Partial<ChapterIndexEntry>))
      .filter((e): e is ChapterIndexEntry => !!e)
      .slice(0, CHAPTER_INDEX_MAX);
  } catch {
    return [];
  }
}

// 合并落库：同 chapterNo 覆盖更新（updatedAt 取新），其余追加；返回明细供上层计数。
// 追加超 CHAPTER_INDEX_MAX 时丢最旧（按章号自然序最前），保证新章永远进得来。
export function upsertChapterIndexEntries(
  existing: ChapterIndexEntry[],
  incoming: ChapterIndexEntry[],
): { next: ChapterIndexEntry[]; added: ChapterIndexEntry[]; updated: ChapterIndexEntry[] } {
  const byNo = new Map<string, ChapterIndexEntry>();
  for (const e of existing) byNo.set(e.chapterNo, { ...e });
  const added: ChapterIndexEntry[] = [];
  const updated: ChapterIndexEntry[] = [];
  for (const inc of incoming) {
    const clean = sanitizeChapterIndexEntry(inc);
    if (!clean) continue;
    const prev = byNo.get(clean.chapterNo);
    byNo.set(clean.chapterNo, clean);
    if (prev) updated.push(clean);
    else added.push(clean);
  }
  let next = [...byNo.values()].sort((a, b) => compareChapterIndexNo(a.chapterNo, b.chapterNo));
  if (next.length > CHAPTER_INDEX_MAX) next = next.slice(next.length - CHAPTER_INDEX_MAX);
  return { next, added, updated };
}

// 索引紧凑渲染（给模型读的「大纲视图」）：一行一章，空字段自动省略。
export function renderChapterIndexText(entries: ChapterIndexEntry[], opts: { limit?: number; integratedOnly?: boolean } = {}): string {
  const pool = (entries || []).filter((e) => e && e.chapterNo && (!opts.integratedOnly || e.integrated));
  if (!pool.length) return '';
  const limit = Math.max(1, opts.limit ?? 80);
  const lines = pool.slice(-limit).map((e) => {
    const segs = [
      `第${e.chapterNo}章${e.title ? `《${e.title}》` : ''}`,
      e.theme && e.theme !== DEFAULT_INDEX_THEME ? `主题:${e.theme}` : '',
      e.events.length ? `关键事件:${e.events.join('；')}` : '',
      e.charState ? `角色状态:${e.charState}` : '',
      e.summary ? `梗概:${e.summary}` : '',
    ].filter(Boolean);
    return `- ${segs.join('｜')}`;
  });
  return lines.join('\n');
}

// ===== 检索（非全文搜索）：词条命中计分 + 多轮放宽 + 轮数上限 =====

// 查询分词：ASCII 词元（≥2 字符）+ CJK 连续段切二元组（单字段保留单字）。去重保序，上限 24。
export function tokenizeQuery(query: string): string[] {
  const text = String(query || '');
  const out: string[] = [];
  const push = (t: string) => { if (t && !out.includes(t)) out.push(t); };
  for (const m of text.matchAll(/[A-Za-z0-9_]{2,}/g)) push(m[0].toLowerCase());
  for (const m of text.matchAll(/[\u3400-\u4dbf\u4e00-\u9fff]+/g)) {
    const run = m[0];
    if (run.length === 1) { push(run); continue; }
    for (let i = 0; i < run.length - 1; i++) push(run.slice(i, i + 2));
  }
  return out.slice(0, 24);
}

// 放宽轮分词：CJK 逐字（召回优先于精度），ASCII 词元照旧。用于第二轮「没搜够再放宽」。
export function tokenizeQueryLoose(query: string): string[] {
  const text = String(query || '');
  const out: string[] = [];
  const push = (t: string) => { if (t && !out.includes(t)) out.push(t); };
  for (const m of text.matchAll(/[A-Za-z0-9_]{2,}/g)) push(m[0].toLowerCase());
  for (const ch of text) if (/[\u3400-\u4dbf\u4e00-\u9fff]/.test(ch)) push(ch);
  return out.slice(0, 40);
}

// 词条命中计分：命中一个词元记 1 分（大小写不敏感）。简单确定性，可测可解释。
export function scoreTextAgainstTerms(text: string, terms: string[]): number {
  if (!terms.length) return 0;
  const hay = String(text || '').toLowerCase();
  let score = 0;
  for (const t of terms) if (hay.includes(t)) score += 1;
  return score;
}

export type RetrievalSource = 'chapter_index' | 'memory' | 'lore';
export const RETRIEVAL_SOURCE_LABEL: Record<RetrievalSource, string> = {
  chapter_index: '章节',
  memory: '记忆',
  lore: '世界书',
};

export interface RetrievalRecord {
  source: RetrievalSource;
  id: string;
  title: string;
  text: string;
  score: number;
}

export interface RetrievalCandidate {
  source: RetrievalSource;
  id: string;
  title: string;
  text: string;
}

// 三源统一候选池：章节索引（含梗概/事件/角色状态）、打字桌记忆（分层条目）、世界书条目。
export function buildRetrievalCandidates(input: {
  indexEntries?: ChapterIndexEntry[];
  memories?: DeskMemory[];
  lore?: Array<{ id: string; name: string; content: string }>;
}): RetrievalCandidate[] {
  const out: RetrievalCandidate[] = [];
  for (const e of input.indexEntries || []) {
    if (!e || !e.chapterNo) continue;
    const body = [
      e.theme && e.theme !== DEFAULT_INDEX_THEME ? e.theme : '',
      e.events.join('；'),
      e.charState,
      e.summary,
    ].filter(Boolean).join('\n');
    if (!body) continue;
    out.push({ source: 'chapter_index', id: `idx:${e.chapterNo}`, title: `第${e.chapterNo}章${e.title ? `《${e.title}》` : ''}`, text: body });
  }
  for (const m of input.memories || []) {
    if (!m || !m.content) continue;
    out.push({ source: 'memory', id: m.id, title: [m.layer === 'anchor' ? ANCHOR_LAYER_LABEL : m.layer === 'general' ? GENERAL_LAYER_LABEL : PLOT_LAYER_LABEL, m.theme, m.title].filter(Boolean).join('/'), text: m.content });
  }
  for (const l of input.lore || []) {
    if (!l || !l.content) continue;
    out.push({ source: 'lore', id: l.id || l.name, title: l.name || '', text: l.content });
  }
  return out;
}

export const MAX_RETRIEVAL_ROUNDS = 3;   // 流程B检索上限：达上限取当前最好结果，绝不挂死
export const RETRIEVAL_MIN_RECORDS = 3;  // 信息「算俱全」的最少相关记录数
export const RETRIEVAL_RECORD_LIMIT = 6; // 注入记录条数上限
export const RETRIEVAL_TEXT_CAP = 400;   // 单条记录注入体积上限
export const RETRIEVAL_FALLBACK_COUNT = 4; // 兜底轮带出的最新已整合章数

// 统一聚合检索：第1轮整句词条；不足 minRecords → 第2轮逐字放宽；仍不足 → 第3轮兜底
// （最新已整合章节 + 人设锚记忆无条件入选，保证续写简报永远有承接材料）。结果跨轮累积取最高分。
export function aggregateRetrieval(opts: {
  query: string;
  indexEntries?: ChapterIndexEntry[];
  memories?: DeskMemory[];
  lore?: Array<{ id: string; name: string; content: string }>;
  limit?: number;
  minRecords?: number;
  rounds?: number;
}): { records: RetrievalRecord[]; roundsUsed: number; exhausted: boolean } {
  const limit = Math.max(1, opts.limit ?? RETRIEVAL_RECORD_LIMIT);
  const minRecords = Math.max(1, opts.minRecords ?? RETRIEVAL_MIN_RECORDS);
  const roundsCap = Math.min(Math.max(1, opts.rounds ?? MAX_RETRIEVAL_ROUNDS), MAX_RETRIEVAL_ROUNDS);
  const candidates = buildRetrievalCandidates(opts);
  const best = new Map<string, RetrievalRecord>();
  const absorb = (cands: RetrievalCandidate[], terms: string[]) => {
    for (const c of cands) {
      const score = scoreTextAgainstTerms(`${c.title}\n${c.text}`, terms);
      if (score <= 0) continue;
      const key = `${c.source}:${c.id}`;
      const prev = best.get(key);
      if (!prev || prev.score < score) best.set(key, { ...c, score });
    }
  };
  let roundsUsed = 0;
  for (let round = 1; round <= roundsCap; round++) {
    roundsUsed = round;
    if (round === 1) absorb(candidates, tokenizeQuery(opts.query));
    else if (round === 2) absorb(candidates, tokenizeQueryLoose(opts.query));
    else {
      // 兜底轮：最新已整合章节 + anchor 记忆无条件入选（score=0 沉底排序）
      const integrated = (opts.indexEntries || []).filter((e) => e.integrated).slice(-RETRIEVAL_FALLBACK_COUNT);
      for (const e of integrated) {
        const key = `chapter_index:idx:${e.chapterNo}`;
        if (!best.has(key)) {
          const body = [e.summary, e.charState].filter(Boolean).join('\n');
          if (body) best.set(key, { source: 'chapter_index', id: `idx:${e.chapterNo}`, title: `第${e.chapterNo}章${e.title ? `《${e.title}》` : ''}`, text: body, score: 0 });
        }
      }
      for (const m of opts.memories || []) {
        if ((m.layer || DEFAULT_MEMORY_LAYER) !== 'anchor') continue;
        const key = `memory:${m.id}`;
        if (!best.has(key) && m.content) best.set(key, { source: 'memory', id: m.id, title: [ANCHOR_LAYER_LABEL, m.theme, m.title].filter(Boolean).join('/'), text: m.content, score: 0 });
      }
    }
    if (best.size >= minRecords) break;
  }
  const records = [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({ ...r, text: r.text.slice(0, RETRIEVAL_TEXT_CAP) }));
  return { records, roundsUsed, exhausted: roundsUsed >= roundsCap && best.size < minRecords };
}

// 续写简报（流程B产物）：前文提要（索引大纲视图）+ 相关情节记录（三源标注）+ 已存记忆原文
// （renderMemoriesText 输出自带 task-10 的【人设锚定区】/【剧情摘要区】层标题，原样拼接即对齐）。
export function buildContinuationBrief(opts: {
  indexEntries: ChapterIndexEntry[];
  records?: RetrievalRecord[];
  memoriesText?: string;
  indexLimit?: number;
}): string {
  const parts: string[] = [];
  const digest = renderChapterIndexText(opts.indexEntries, { limit: opts.indexLimit ?? 12, integratedOnly: false });
  if (digest) parts.push(`【前文提要·章节索引】\n${digest}`);
  const recs = (opts.records || []).filter((r) => r.text.trim());
  if (recs.length) {
    parts.push(`【相关情节记录】\n${recs.map((r) => `- [${RETRIEVAL_SOURCE_LABEL[r.source]}] ${r.title ? `${r.title}：` : ''}${r.text.replace(/\s*\n+\s*/g, ' ')}`).join('\n')}`);
  }
  const mem = String(opts.memoriesText || '').trim();
  if (mem) parts.push(mem);
  return parts.join('\n\n');
}

// ===== 整合整理（流程A收尾）：模型抽取主题/关键事件/角色状态 =====

// 抽取提示词：对指定一章产出结构化索引字段。要求只出 JSON。
export function buildChapterIntegrateSystem(): string {
  return [
    '你是小说章节的"索引整理器"。根据给出的章节标题、梗概与正文节选，提炼这一章的索引字段。',
    '规则：',
    '- theme：本章主题，4~12字（如"琉璃塔初探""身份揭穿"）。',
    '- events：本章关键事件要点，2~6条，每条一句话，只记确定发生的事实。',
    '- char_state：本章结束时主要角色的处境/关系/状态变化摘要，两三句话。',
    '严格区分客观事实与角色认知：角色的猜测、感想不要当事实写。',
    '若正文节选信息不足以判断某字段，给出你能确定的范围即可，不要编造。',
    '请只输出一个 JSON 对象，不要任何额外解释或 Markdown 围栏以外的文字：',
    '{"theme":"…","events":["…","…"],"char_state":"…"}',
  ].join('\n');
}

// 抽取输入：标题+梗概+正文节选（正文截 4000 字，防灌爆）。
export function buildChapterIntegrateInput(ch: { title?: string; summary?: string; content?: string }): string {
  return [
    ch.title ? `【章节标题】\n${ch.title}` : '',
    ch.summary ? `【本章梗概】\n${ch.summary}` : '',
    ch.content ? `【正文节选】\n${String(ch.content).slice(0, 4000)}` : '',
  ].filter(Boolean).join('\n\n');
}

export interface ChapterIntegrateExtract {
  theme: string;
  events: string[];
  charState: string;
}

// 宽容解析抽取输出（照 parseMemoryDistillOutput 的口径：剥围栏、找花括号、非法丢弃）。
export function parseIntegrateOutput(raw: unknown): ChapterIntegrateExtract | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  let parsed: any = null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const braceStart = candidate.indexOf('{');
    const braceEnd = candidate.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      try { parsed = JSON.parse(candidate.slice(braceStart, braceEnd + 1)); } catch { parsed = null; }
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const eventsRaw = Array.isArray(parsed.events) ? parsed.events : [];
  const events = eventsRaw.map((e: unknown) => str(e)).filter(Boolean).slice(0, CHAPTER_EVENT_MAX).map((e: string) => e.slice(0, CHAPTER_EVENT_LEN));
  const theme = str(parsed.theme).slice(0, 60);
  const charState = str(parsed.char_state ?? parsed.charState).slice(0, CHAR_STATE_LEN);
  if (!theme && !events.length && !charState) return null;
  return { theme: theme || DEFAULT_INDEX_THEME, events, charState };
}
