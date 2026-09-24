// src/core/trpg/types.ts
// TRPG 剧情模式（task-21）类型定义：声明式剧本 / 运行时状态 / GM 协议 / 结果。

// 剧本目录项
export interface TrpgRegistryPaths {
  config: string;
  gmPrompt: string;
}

export interface TrpgRegistryEntry {
  id: string;
  name: string;
  info: string;
  difficulty: string;
  estimatedTime: string;
  tags: string[];
  paths: TrpgRegistryPaths;
}

// 道具
export interface TrpgItemEffect {
  diceBonus?: number;
  restoreStamina?: number;
  requiresCheck?: boolean;
  custom?: string;
}

export interface TrpgItem {
  id: string;
  name: string;
  description: string;
  type: 'consumable' | 'equipment' | 'quest' | 'other';
  price: number;
  usable: boolean;
  consumable: boolean;
  stackable: boolean;
  effect?: TrpgItemEffect;
}

// GM JSON state_changes：程序状态机可识别的最小变更集
export interface TrpgAddItem {
  id: string;
  quantity?: number;
}

export interface TrpgStateChanges {
  stamina?: number;
  time?: number;
  coins?: number;
  affection?: number;
  trust?: number;
  addItem?: TrpgAddItem | TrpgAddItem[];
  removeItem?: TrpgAddItem | TrpgAddItem[];
  setFlag?: { key: string; value: unknown };
  flags?: Record<string, unknown>;
  unlockLocation?: string | string[];
  locationId?: string;
  missionState?: Record<string, unknown>;
}

// 动作
export interface TrpgAction {
  id: string;
  label: string;
  description: string;
  kind?: 'story' | 'check' | 'rest' | 'travel';
  difficulty?: number;
  staminaCost?: number;
  timeCost?: number;
  keyEventId?: string;
  requiresItem?: string;
  stateChanges?: TrpgStateChanges;

  // ── 场景选项系统（2026-09-24 赋能）：全部可选，旧剧本零改动 ──────────
  // 参考 1room《ActMenuItem》的双档设计：显不显示 / 能不能点，是两件事。
  /** 显不显示。缺省 = 恒真（等价于改造前行为）。 */
  visibleExp?: string;
  /** 能不能点。缺省 = 沿用 requiresItem 判定（等价于改造前行为）。 */
  enableExp?: string;
  /**
   * 预留：LLM 提示词片段路径（想让该动作的叙述有专属引导时用）。
   * ⚠️ 目前**没有消费方** —— gmPrompt.ts 还不读它，写了不生效。
   * 先落进类型是为了剧本可以先标注；接线时改 gmPrompt.buildGmRequest。
   */
  promptRef?: string;
}

// 动作视图：服务端下发全量动作 + 标志位，由前端决定怎么画。
// 与 TrpgAction 分开，是为了不改旧函数签名（getAvailableActions 原样保留）。
export interface TrpgActionView {
  action: TrpgAction;
  /** 该不该出现在列表里（false = 玩家不该知道有这东西） */
  visible: boolean;
  /** 出现了但能不能点 */
  enabled: boolean;
  /** visible && !enabled —— 前端渲染「未開放」槽位用（灰 + 锁标，但不清空） */
  locked: boolean;
}

export interface TrpgLocation {
  id: string;
  name: string;
  description: string;
  isStart?: boolean;
  unlocked?: boolean;
  staminaCost?: number;
  timeCost?: number;
  availableActions: TrpgAction[];
}

export interface TrpgKeyEvent {
  id: string;
  name: string;
  requiredLocation: string;
  difficulty?: number;
  onSuccess: TrpgStateChanges;
  onFailure: TrpgStateChanges;
}

export interface TrpgEnding {
  id: string;
  name: string;
  condition: string;
  description: string;
  bonusReward?: TrpgStateChanges;
  penaltyReward?: TrpgStateChanges;
}

export interface TrpgUiEventComponent {
  event: string;
  condition?: string;
  component?: string;
  title?: string;
  message?: string;
  priority?: number;
}

export interface TrpgScenario {
  id: string;
  name: string;
  info: string;
  difficulty: string;
  estimatedTime: string;
  tags: string[];
  paths: TrpgRegistryPaths;
  scenario: {
    title: string;
    intro: string;
    initialState: {
      locationId: string;
      stamina: number;
      time: number;
      coins: number;
      affection: number;
      trust: number;
      flags?: Record<string, unknown>;
      items?: Record<string, number>;
    };
  };
  locations: TrpgLocation[];
  items: TrpgItem[];
  keyEvents: TrpgKeyEvent[];
  endings: TrpgEnding[];
  uiEvents?: TrpgUiEventComponent[];
}

export type TrpgPhase = 'active' | 'victory' | 'failure' | 'ending';

export interface TrpgState {
  locationId: string;
  stamina: number;
  time: number;
  coins: number;
  affection: number;
  trust: number;
  flags: Record<string, unknown>;
  items: Record<string, number>;
  phase: TrpgPhase;
}

export interface TrpgCustomContext {
  preferences?: string;
  charCards?: Array<{ name: string; content: string; fields?: Record<string, string> }>;
  project?: string;
}

export interface TrpgSession {
  id: string;
  scenarioId: string;
  createdAt: string;
  state: TrpgState;
  history: string[];
  custom?: TrpgCustomContext;
}

// 骰子
export interface TrpgDiceResult {
  d20: number;
  bonus: number;
  total: number;
  target: number;
  success: boolean;
  critical: 'success' | 'failure' | 'none';
}

// GM 解析结果
export interface GmParsedOutput {
  narration?: string;
  requiresDice?: boolean;
  difficulty?: number;
  actionType?: string;
  stateChanges?: TrpgStateChanges;
}

export interface ParseGmOutputResult {
  ok: boolean;
  narration: string;
  data?: GmParsedOutput;
  warning?: string;
}

// 前端演出发射的事件
export type TrpgEventType =
  | 'LOCATION_CHANGED'
  | 'KEY_EVENT_TRIGGERED'
  | 'STATE_CHANGED'
  | 'DICE_SUCCESS'
  | 'DICE_FAILURE'
  | 'ENDING_TRIGGERED'
  | 'DICE_CRITICAL_SUCCESS'
  | 'DICE_CRITICAL_FAILURE';

export interface TrpgGameEvent {
  type: TrpgEventType;
  message: string;
  data?: Record<string, unknown>;
}

export interface TrpgActionResult {
  sessionId: string;
  actionId: string;
  narration: string;
  demo: boolean;
  parseWarning?: string;
  dice?: TrpgDiceResult | null;
  state: TrpgState;
  stateChanges: TrpgStateChanges;
  events: TrpgGameEvent[];
  ending?: TrpgEnding | null;
  rewards?: TrpgStateChanges | null;
}