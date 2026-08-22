// src/core/trpg/parseGmOutput.ts
// 从模型输出中稳健提取 JSON 数据块与旁白文本。
// 容忍代码块、叙述中夹带异常字符；解析失败降级为纯叙述不判定。

import type { GmParsedOutput, ParseGmOutputResult, TrpgStateChanges } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asItemList(value: unknown): { id: string; quantity?: number }[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const out: { id: string; quantity?: number }[] = [];
    for (const item of value) {
      if (item && typeof item === 'object' && typeof (item as any).id === 'string') {
        const q = (item as any).quantity;
        out.push({ id: (item as any).id, ...(typeof q === 'number' ? { quantity: q } : {}) });
      }
    }
    return out;
  }
  if (typeof (value as any)?.id === 'string') {
    const q = (value as any).quantity;
    return [{ id: (value as any).id, ...(typeof q === 'number' ? { quantity: q } : {}) }];
  }
  return undefined;
}

export function normalizeStateChanges(raw: unknown): TrpgStateChanges {
  if (!isRecord(raw)) return {};
  const out: TrpgStateChanges = {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const s = num(raw.stamina);
  if (s !== undefined) out.stamina = s;
  const t = num(raw.time);
  if (t !== undefined) out.time = t;
  const c = num(raw.coins);
  if (c !== undefined) out.coins = c;
  const af = num(raw.affection);
  if (af !== undefined) out.affection = af;
  const tr = num(raw.trust);
  if (tr !== undefined) out.trust = tr;
  const add = asItemList(raw.addItem ?? raw.add_item);
  if (add !== undefined) out.addItem = add.length === 1 ? add[0] : add;
  const remove = asItemList(raw.removeItem ?? raw.remove_item);
  if (remove !== undefined) out.removeItem = remove.length === 1 ? remove[0] : remove;
  const setFlagRaw = raw.setFlag ?? raw.set_flag;
  if (isRecord(setFlagRaw)) {
    out.setFlag = {
      key: String(setFlagRaw.key ?? ''),
      value: setFlagRaw.value,
    };
  }
  if (isRecord(raw.flags)) out.flags = raw.flags;
  const unlock = raw.unlockLocation ?? raw.unlock_location;
  if (typeof unlock === 'string') out.unlockLocation = unlock;
  else if (Array.isArray(unlock)) out.unlockLocation = unlock.filter((x): x is string => typeof x === 'string');
  const loc = raw.locationId ?? raw.location_id;
  if (typeof loc === 'string') out.locationId = loc;
  const missionRaw = raw.missionState ?? raw.mission_state;
  if (isRecord(missionRaw)) out.missionState = missionRaw;
  return out;
}

function removeFences(text: string): string {
  return String(text || '').replace(/```json[\s\S]*?```/gi, ' ').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
}

function removeJsonBlock(text: string, block: string): string {
  const before = String(text || '');
  const idx = before.indexOf(block);
  if (idx >= 0) {
    const out = (before.slice(0, idx) + ' ' + before.slice(idx + block.length)).replace(/\s+/g, ' ').trim();
    return removeFences(out) || '';
  }
  return removeFences(before);
}

export function parseGmOutput(raw: string): ParseGmOutputResult {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, narration: '', warning: '模型输出为空' };

  const candidates: string[] = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m[1] && m[1].trim()) candidates.push(m[1].trim());
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed)) {
        const data: GmParsedOutput = {
          narration: typeof parsed.narration === 'string' ? parsed.narration : undefined,
          requiresDice: typeof parsed.requires_dice === 'boolean' ? parsed.requires_dice : (typeof parsed.requiresDice === 'boolean' ? parsed.requiresDice : undefined),
          difficulty: typeof parsed.difficulty === 'number' && Number.isFinite(parsed.difficulty) ? parsed.difficulty : undefined,
          actionType: typeof parsed.action_type === 'string' ? parsed.action_type : (typeof parsed.actionType === 'string' ? parsed.actionType : undefined),
          stateChanges: normalizeStateChanges(parsed.state_changes ?? parsed.stateChanges),
        };
        const trimmedNarration = removeJsonBlock(text, candidate);
        const narration = trimmedNarration || data.narration?.trim() || '（GM 没有给出旁白）';
        return { ok: true, narration, data, warning: '' };
      }
    } catch {
      // 继续尝试下一个候选块
    }
  }

  return {
    ok: false,
    narration: removeFences(text) || '（GM 没有给出旁白）',
    warning: 'GM 输出未包含可解析 JSON，本次按纯叙述处理，不进行判定。',
  };
}
