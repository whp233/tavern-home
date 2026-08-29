// src/core/story/storyRuntime.ts
// 纯函数：解析大纲/开头/续写输出，合并状态，判定 CG 触发（复用 cgService 条件）。

import { evaluateCgCondition } from '../cgService.ts';
import type { StoryContinueDelta, StoryOutline, StoryOpening, StorySession, StoryState } from './types.ts';

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeOutline(raw: unknown): StoryOutline | null {
  if (!isRecord(raw)) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const premise = typeof raw.premise === 'string' ? raw.premise.trim() : '';
  const actsRaw = Array.isArray(raw.acts) ? raw.acts : [];
  const acts = actsRaw
    .map((a: any, i: number) => ({
      act: typeof a?.act === 'number' ? a.act : i + 1,
      title: typeof a?.title === 'string' ? a.title.trim() : `第${i + 1}幕`,
      summary: typeof a?.summary === 'string' ? a.summary.trim() : '',
      beats: Array.isArray(a?.beats) ? a.beats.filter((x: any) => typeof x === 'string') : undefined,
    }))
    .filter((a) => a.summary);
  if (!title || acts.length < 2) return null;
  return {
    title,
    premise: premise || title,
    acts,
    tone: typeof raw.tone === 'string' ? raw.tone : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((x: any) => typeof x === 'string') : undefined,
  };
}

export function normalizeOpening(raw: unknown): StoryOpening | null {
  if (!isRecord(raw)) return null;
  const narration = typeof raw.narration === 'string' ? raw.narration.trim() : '';
  if (!narration) return null;
  const init = isRecord(raw.initialState) ? (raw.initialState as Record<string, unknown>) : isRecord(raw.initial_state) ? (raw.initial_state as Record<string, unknown>) : {};
  const choices = Array.isArray(raw.suggestedChoices)
    ? raw.suggestedChoices.filter((x: any) => typeof x === 'string').slice(0, 4)
    : Array.isArray(raw.suggested_choices)
      ? raw.suggested_choices.filter((x: any) => typeof x === 'string').slice(0, 4)
      : undefined;
  const cg = isRecord(raw.cgEvent) ? (raw.cgEvent as any) : isRecord(raw.cg_event) ? (raw.cg_event as any) : undefined;
  return {
    narration,
    initialState: init,
    suggestedChoices: choices,
    cgEvent: cg ? { sceneKey: typeof cg.sceneKey === 'string' ? cg.sceneKey : undefined, condition: typeof cg.condition === 'string' ? cg.condition : undefined, place: typeof cg.place === 'string' ? cg.place : undefined } : undefined,
  };
}

export function normalizeContinueDelta(raw: unknown): StoryContinueDelta | null {
  if (!isRecord(raw)) return null;
  const narration = typeof raw.narration === 'string' ? raw.narration.trim() : '';
  if (!narration) return null;
  const sc = isRecord(raw.stateChanges) ? raw.stateChanges : isRecord(raw.state_changes) ? raw.state_changes : undefined;
  const cg = isRecord(raw.cgEvent) ? raw.cgEvent : isRecord(raw.cg_event) ? raw.cg_event : undefined;
  const choices = Array.isArray(raw.choices) ? raw.choices.filter((x: any) => typeof x === 'string').slice(0, 4) : Array.isArray(raw.suggestedChoices) ? raw.suggestedChoices.filter((x: any) => typeof x === 'string').slice(0, 4) : undefined;
  return {
    narration,
    stateChanges: sc
      ? {
          sceneKey: typeof sc.sceneKey === 'string' ? sc.sceneKey : typeof sc.scene_key === 'string' ? sc.scene_key : undefined,
          flags: isRecord(sc.flags) ? sc.flags : undefined,
          setFlag: isRecord(sc.setFlag) ? { key: String((sc.setFlag as any).key ?? ''), value: (sc.setFlag as any).value } : isRecord(sc.set_flag) ? { key: String((sc.set_flag as any).key ?? ''), value: (sc.set_flag as any).value } : undefined,
          chapterDelta: typeof sc.chapterDelta === 'number' ? sc.chapterDelta : typeof sc.chapter_delta === 'number' ? sc.chapter_delta : undefined,
        }
      : undefined,
    cgEvent: cg ? { sceneKey: typeof cg.sceneKey === 'string' ? cg.sceneKey : undefined, condition: typeof cg.condition === 'string' ? cg.condition : undefined } : undefined,
    choices,
  };
}

// 从“旁白+JSON”混合输出中稳健抽 JSON（与 trpg parseGmOutput 同策略）
export function extractJsonBlock(text: string): { json: string | null; narration: string } {
  const raw = String(text || '').trim();
  if (!raw) return { json: null, narration: '' };
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  const cands: string[] = [];
  while ((m = fenceRe.exec(raw)) !== null) if (m[1] && m[1].trim()) cands.push(m[1].trim());
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s !== -1 && e > s) cands.push(raw.slice(s, e + 1));
  for (const cand of cands) {
    try {
      JSON.parse(cand);
      const idx = raw.indexOf(cand);
      const narration = idx >= 0 ? (raw.slice(0, idx) + ' ' + raw.slice(idx + cand.length)).replace(/\s+/g, ' ').trim().replace(/```/g, '').trim() : raw.replace(/```/g, '').trim();
      return { json: cand, narration };
    } catch { /* try next */ }
  }
  return { json: null, narration: raw.replace(/```/g, '').trim() };
}

export function parseOutlineOutput(raw: string): { ok: boolean; outline?: StoryOutline; narration?: string; warning?: string } {
  const { json, narration } = extractJsonBlock(raw);
  if (!json) return { ok: false, warning: '未提取到大纲 JSON，按纯文本兜底' };
  try {
    const parsed = JSON.parse(json);
    const out = normalizeOutline(parsed);
    if (!out) return { ok: false, warning: '大纲 JSON 缺必要字段' };
    return { ok: true, outline: out, narration };
  } catch {
    return { ok: false, warning: '大纲 JSON 解析失败' };
  }
}

export function parseOpeningOutput(raw: string): { ok: boolean; opening?: StoryOpening; narration?: string; warning?: string } {
  const { json, narration } = extractJsonBlock(raw);
  if (!json) return { ok: false, warning: '未提取到开头 JSON' };
  try {
    const parsed = JSON.parse(json);
    const out = normalizeOpening(parsed);
    if (!out) return { ok: false, warning: '开头 JSON 缺 narration' };
    return { ok: true, opening: out, narration: out.narration || narration };
  } catch {
    return { ok: false, warning: '开头 JSON 解析失败' };
  }
}

export function parseContinueOutput(raw: string): { ok: boolean; delta?: StoryContinueDelta; narration: string; warning?: string } {
  const { json, narration: fenceNarration } = extractJsonBlock(raw);
  if (!json) return { ok: false, narration: fenceNarration || String(raw || '').trim() || '（无旁白）', warning: '未提取到续写 JSON，按纯旁白处理' };
  try {
    const parsed = JSON.parse(json);
    const delta = normalizeContinueDelta(parsed);
    if (!delta) return { ok: false, narration: fenceNarration || String(raw).trim(), warning: '续写 JSON 缺 narration' };
    const narration = (delta.narration || fenceNarration || '').trim() || String(raw).replace(/```/g, '').trim();
    return { ok: true, delta: { ...delta, narration }, narration, warning: '' };
  } catch {
    return { ok: false, narration: fenceNarration || String(raw).trim(), warning: '续写 JSON 解析失败' };
  }
}

export function applyStoryState(prev: StoryState, changes?: StoryContinueDelta['stateChanges']): StoryState {
  if (!changes) return prev;
  const next: StoryState = { ...prev, flags: { ...prev.flags }, vars: { ...prev.vars } };
  if (typeof changes.sceneKey === 'string' && changes.sceneKey.trim()) next.sceneKey = changes.sceneKey.trim();
  if (changes.flags && typeof changes.flags === 'object') next.flags = { ...next.flags, ...changes.flags };
  if (changes.setFlag && changes.setFlag.key) next.flags[changes.setFlag.key] = changes.setFlag.value;
  if (typeof changes.chapterDelta === 'number' && Number.isFinite(changes.chapterDelta)) next.chapter = Math.max(1, next.chapter + Math.trunc(changes.chapterDelta));
  return next;
}

export function shouldTriggerCg(state: StoryState, cgEvent?: { sceneKey?: string; condition?: string }): boolean {
  if (!cgEvent) return false;
  const flat: Record<string, unknown> = { sceneKey: state.sceneKey, chapter: state.chapter, ...state.flags, ...state.vars };
  if (cgEvent.sceneKey) {
    const want = String(cgEvent.sceneKey).trim();
    if (want && String(state.sceneKey) !== want && !String(state.sceneKey).includes(want)) return false;
  }
  if (cgEvent.condition) return evaluateCgCondition(cgEvent.condition, flat);
  return true;
}

export function buildSessionId(): string {
  return `story_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function demoOutline(seed?: string): StoryOutline {
  const title = seed ? `${seed.slice(0, 12)} · 夜灯下的约定` : '夜灯下的约定';
  return {
    title,
    premise: seed ? `围绕“${seed}”展开的温柔日常` : '与她在小镇的日常里，灯火与心事一同亮起',
    tone: '治愈、细腻、第二人称',
    acts: [
      { act: 1, title: '相遇', summary: '放学路上，你在旧书店再次遇见她，空气中弥漫着纸张与雨气。', beats: ['雨后书店', '对视后的迟疑'] },
      { act: 2, title: '试探', summary: '你们交换了关于未来的只言片语，心跳在沉默里被放大。', beats: ['窗边的对话', '未说出口的邀请'] },
      { act: 3, title: '靠近', summary: '夜灯下，她轻声说出藏了很久的话，你伸手握住她的指尖。', beats: ['夜的告白', '灯下的拥抱'] },
    ],
    tags: ['日常', '治愈', 'CG'],
  };
}

export function demoOpening(outline: StoryOutline): StoryOpening {
  return {
    narration: `雨刚停，书店的木门吱呀一声。你推门而入，看见她正踮脚够向最高处的书脊，暖黄的灯光落在她的发梢。她回头，眼睛里映着你的影子，轻声说：“你来了。”你点点头，心里像被什么轻轻碰了一下。`,
    initialState: { sceneKey: '书店_雨后', chapter: 1, mood: '期待' },
    suggestedChoices: ['走过去帮她拿书', '轻声问她在找什么', '站在原地，静静看她'],
    cgEvent: { sceneKey: '书店_雨后' },
  };
}

export function demoContinue(userInput: string, state: StoryState): StoryContinueDelta {
  const nextScene = state.chapter >= 2 ? '夜灯_书店' : '书店_雨后';
  return {
    narration: `你${userInput ? `轻声说：“${userInput.slice(0, 30)}”` : '沉默了一瞬'}，她微微一怔，随后笑了起来，眼里有星光跳动。书店的灯光把你们的影子拉得很长，这一刻，时间仿佛也放慢了脚步。`,
    stateChanges: { sceneKey: nextScene, chapterDelta: 1, flags: { lastInput: userInput.slice(0, 40) } },
    cgEvent: state.chapter >= 2 ? { sceneKey: nextScene, condition: 'chapter>=2' } : undefined,
    choices: ['继续聊下去', '邀请她一起走走', '问她明天的安排'],
  };
}
