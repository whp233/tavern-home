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

export interface TrpgSession {
  id: string;
  scenarioId: string;
  createdAt: string;
  state: TrpgState;
  history: string[];
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