// src/core/story/types.ts
// 剧情CG模式（对齐妹居 GM/演出）：大纲+开头生成后进入沉浸式剧情，CG 按 state 条件解锁。

export interface StoryOutline {
  title: string;
  premise: string;
  acts: Array<{ act: number; title: string; summary: string; beats?: string[] }>;
  tone?: string;
  tags?: string[];
}

export interface StoryOpening {
  narration: string;
  initialState: Record<string, unknown>;
  suggestedChoices?: string[];
  cgEvent?: { sceneKey?: string; condition?: string; place?: string };
}

export interface StoryState {
  chapter: number;
  sceneKey: string;
  flags: Record<string, unknown>;
  vars: Record<string, unknown>;
}

export interface StorySession {
  id: string;
  project: string;
  charKey?: string;
  title: string;
  outline: StoryOutline;
  opening: StoryOpening;
  state: StoryState;
  history: Array<{ role: 'user' | 'assistant'; content: string; at: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface StoryContinueDelta {
  narration: string;
  stateChanges?: {
    sceneKey?: string;
    flags?: Record<string, unknown>;
    setFlag?: { key: string; value: unknown };
    chapterDelta?: number;
  };
  cgEvent?: { sceneKey?: string; condition?: string };
  choices?: string[];
}
