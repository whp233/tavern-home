export interface LoreTriggerEntry {
  id: string;
  name: string;
  keys: string[];
}

export function buildLoreScanCorpus(
  input: string,
  floors: Array<{ content?: string | null }>,
  keep = 6,
): string {
  return [input, ...floors.slice(-keep).map((floor) => floor.content || '')].join('\n');
}

export function extractAtMentions(input: string): string[] {
  const mentions: string[] = [];
  const pattern = /(?<![A-Za-z0-9._%+-])@([\p{L}\p{N}_-]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(input || ''))) !== null) {
    const token = match[1].trim().toLowerCase();
    if (token) mentions.push(token);
  }
  return mentions;
}

export function resolveAtMentionIds(input: string, lore: LoreTriggerEntry[]): Set<string> {
  const names: Array<{ value: string; id: string }> = [];
  for (const entry of lore) {
    for (const candidate of [entry.name, ...entry.keys]) {
      const value = String(candidate || '').trim().toLowerCase();
      if (value) names.push({ value, id: entry.id });
    }
  }

  const ids = new Set<string>();
  for (const token of extractAtMentions(input)) {
    let best = '';
    let exact = false;
    for (const candidate of names) {
      if (candidate.value === token) {
        exact = true;
        best = token;
      } else if (
        !exact
        && candidate.value.length > best.length
        && token.startsWith(candidate.value)
        && !/[A-Za-z0-9]/.test(token.charAt(candidate.value.length))
      ) {
        best = candidate.value;
      }
    }
    if (best) for (const candidate of names) if (candidate.value === best) ids.add(candidate.id);
  }
  return ids;
}

export function presenceHasName(current: unknown, names: string[]): boolean {
  const items: string[] = [];
  const collect = (value: unknown, depth: number): void => {
    if (depth > 4 || items.length >= 200) return;
    if (typeof value === 'string') {
      for (const piece of value.split(/[、,，;；/·\s]+/)) {
        const item = piece.trim();
        if (item) items.push(item);
        if (items.length >= 200) return;
      }
    } else if (Array.isArray(value)) {
      for (const item of value) collect(item, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        collect(key, depth + 1);
        collect(item, depth + 1);
      }
    }
  };
  collect(current, 0);

  const normalized = names.map((name) => name.trim().toLowerCase()).filter(Boolean);
  return items.some((item) => normalized.some((name) => {
    const value = item.toLowerCase();
    if (value === name) return true;
    if (!value.startsWith(name)) return false;
    const nextCodePoint = Array.from(value.slice(name.length))[0] || '';
    return !/[\p{L}\p{N}]/u.test(nextCodePoint);
  }));
}

export function addMentionedCharactersToPresence(
  stateBoard: Record<string, unknown>,
  characters: LoreTriggerEntry[],
): void {
  if (!characters.length) return;
  const key = Object.prototype.hasOwnProperty.call(stateBoard, '在场角色')
    ? '在场角色'
    : Object.prototype.hasOwnProperty.call(stateBoard, 'presence') ? 'presence' : '在场角色';
  let current = stateBoard[key];
  for (const character of characters) {
    if (presenceHasName(current, [character.name, ...character.keys])) continue;
    if (Array.isArray(current)) current.push(character.name);
    else if (typeof current === 'string') current = current.trim() ? `${current}、${character.name}` : character.name;
    else if (current && typeof current === 'object') (current as Record<string, unknown>)[character.name] = '在场';
    else current = [character.name];
  }
  stateBoard[key] = current;
}

// ── 每日登录触发（task-17）：「每天登录弹一次」机制 = 日期状态 + 触发判定 + 条件演出。
// 参照《妹居物语》实现原理（drafts/meiju-implementation-analysis.md §5/§6）：内置日期/天系统 +
// 事件条件组件引擎。酒馆落地为：记录 lastLoginDate（oc_state 键值表），登录/启动时
// today != lastLoginDate → 触发「每日首次」事件；同日不重复，跨日重置。
// 本段只放纯函数（判定 + 状态推进），不做任何 IO——落库/路由在 examples/cloudflare/。

export interface DailyLoginConfig {
  /** 总开关：false 时永不触发 */
  enabled: boolean;
  /** 剧情/提醒标题 */
  title: string;
  /** 剧情/提醒正文（预设剧情内容，组件化弹窗展示） */
  content: string;
  /** 可选：只在指定日期触发（YYYY-MM-DD），空/缺省 = 每天首次登录都触发 */
  triggerDate?: string;
}

export interface DailyLoginState {
  /** 上次触发日期（YYYY-MM-DD），null = 从未触发 */
  lastTriggerDate: string | null;
  /** 累计触发次数（跨日递增，用于统计/去重佐证） */
  triggerCount: number;
}

/** 默认配置：开、标题+正文留待前端/用户配置；triggerDate 缺省 = 每天。 */
export const DEFAULT_DAILY_LOGIN_CONFIG: DailyLoginConfig = {
  enabled: true,
  title: '每日问候',
  content: '',
  triggerDate: '',
};

export const DEFAULT_DAILY_LOGIN_STATE: DailyLoginState = {
  lastTriggerDate: null,
  triggerCount: 0,
};

// 严格 YYYY-MM-DD（本地时区日期键，跨日重置按用户当地日期算，跟 UTC 日期无关）。
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 取本地日期键 YYYY-MM-DD（默认今天；传入 Date 可用于测试/离线模拟）。 */
export function dailyLoginDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 校验日期键格式，非法返回 null（客户端传参/配置落库前的兜底）。 */
export function parseDailyLoginDateKey(value: unknown): string | null {
  return typeof value === 'string' && DATE_KEY_PATTERN.test(value) ? value : null;
}

export type DailyLoginVerdict =
  | { shouldTrigger: true; reason: 'ok' }
  | { shouldTrigger: false; reason: 'disabled' | 'not_trigger_day' | 'already_triggered' };

/**
 * 每日登录触发判定（纯函数）：今天是否该弹第一次剧情。
 * - enabled=false → 不触发（开关关闭）
 * - triggerDate 配置了且 != today → 不触发（指定的"哪天"还没到/已过）
 * - state.lastTriggerDate === today → 不触发（同日已经弹过）
 * - 其余 → 触发（跨日重置 / 首次登录）
 */
export function evaluateDailyLogin(
  config: DailyLoginConfig,
  state: DailyLoginState,
  today: string,
): DailyLoginVerdict {
  if (!config.enabled) return { shouldTrigger: false, reason: 'disabled' };
  const triggerDate = parseDailyLoginDateKey(config.triggerDate);
  if (triggerDate && triggerDate !== today) return { shouldTrigger: false, reason: 'not_trigger_day' };
  if (state.lastTriggerDate === today) return { shouldTrigger: false, reason: 'already_triggered' };
  return { shouldTrigger: true, reason: 'ok' };
}

/** 触发后推进状态：记下今日、计数 +1（只有真正触发才调用）。 */
export function nextDailyLoginState(state: DailyLoginState, today: string): DailyLoginState {
  return { lastTriggerDate: today, triggerCount: state.triggerCount + 1 };
}
