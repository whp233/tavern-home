// src/core/styleProfile.ts
// 作品文风锚点：查 docs/styles/{标题}.md 预设 → 无则 LLM 推断 3-5 锚点 → 兜底通用。

export interface WorkStyle {
  workTitle: string;
  anchors: string[];
  source: 'preset' | 'llm' | 'fallback';
  description?: string;
}

// 预设：与 docs/styles/*.md 同步，手写锚点避免运行时读文件（Workers 无 fs）。
export const PRESET_STYLES: Record<string, { anchors: string[]; description: string }> = {
  '越野滑雪': {
    description: '雪原的呼吸感与克制灼热的并肩同行',
    anchors: [
      '雪原的呼吸感：冷空气、雪粒摩擦、呼吸白雾与心跳同频',
      '克制而灼热的距离：少言与体感先行，情感在滑行与停靠中递增',
      '身体的真实：汗、冷、酸痛与暖意交替，让暧昧落地',
      '低语与留白：对话短、尾音轻，风声补完未说完的话',
      '同行而非追逐：并线、偶尔落后又追上，一起抵达',
    ],
  },
  '越野花侠': {
    description: '冷冽雪原上一点艳色的侠气与艳色对撞',
    anchors: [
      '雪与花的对撞：冷冽雪原上一点艳色（衣角、花、唇）',
      '侠的克制：出手与退让点到为止，护你一段路',
      '风物的仪式感：启程、并肩、递物、回望即表白',
      '低哑的承诺：不说永远，只说这程我陪你滑完',
      '身体的诚实：冷风割面、指尖相触的热',
    ],
  },
};

function pickPreset(title: string): WorkStyle | null {
  const t = String(title || '').trim();
  if (!t) return null;
  // 完全匹配或包含匹配，兼容 "越野滑雪 文风" 这类
  for (const [k, v] of Object.entries(PRESET_STYLES)) {
    if (t === k || t.includes(k) || k.includes(t)) {
      return { workTitle: k, anchors: v.anchors.slice(0, 5), source: 'preset', description: v.description };
    }
  }
  return null;
}

export function getPresetStyle(workTitle: string): WorkStyle | null {
  return pickPreset(workTitle);
}

export function buildStyleFallbackAnchors(workTitle?: string): string[] {
  const base = [
    '体感先行：让环境与身体先于台词抵达',
    '克制递增：情感在停靠与对视中缓慢升温',
    '留白与呼吸：短句、尾音轻，风声补完未竟之意',
  ];
  if (workTitle && String(workTitle).trim()) {
    return [`循《${String(workTitle).trim()}》神似而非复刻：提炼气质、落于当下场景`, ...base].slice(0, 5);
  }
  return base;
}

// LLM 锚点推断的 prompt 构造（与 plotOutline 共用 backend）。
export function buildStylePrompt(workTitle: string): { system: Array<{ text: string; cache: boolean }>; prompt: string } {
  const title = String(workTitle || '').trim() || '未指定作品';
  const persona = '[文风锚点提炼]\n你是文风锚点提炼助手。只输出 JSON，不解释。';
  const ctx = `作品：${title}\n请提炼该作品的文风锚点 3-5 条（每条 12-28 字，中文），要求：可直接用于“小纸条”氛围注入，不复刻原文，仅神似。`;
  const prompt = `请输出 JSON：\n{"anchors":["锚点1","锚点2","锚点3"]}\n要求：3-5 条，每条 12-28 字，中文，聚焦“环境-身体-距离-对白节奏-仪式感”等可执行描写指令。`;
  return { system: [{ text: persona, cache: true }, { text: ctx, cache: true }], prompt };
}

export function parseStyleAnchors(text: string): string[] | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s === -1 || e <= s) return null;
  try {
    const j = JSON.parse(raw.slice(s, e + 1));
    const arr = Array.isArray(j.anchors) ? j.anchors : Array.isArray(j) ? j : null;
    if (!arr) return null;
    const out = arr.filter((x: unknown) => typeof x === 'string' && String(x).trim()).map((x: string) => String(x).trim()).slice(0, 5);
    if (out.length < 3) return null;
    return out;
  } catch { return null; }
}

// 统一入口：优先预设，无则尝试 LLM（调用方传入 llmText），否则 fallback。
export function extractWorkStyleSync(workTitle: string, llmText?: string): WorkStyle {
  const preset = pickPreset(workTitle);
  if (preset) return preset;
  if (llmText) {
    const parsed = parseStyleAnchors(llmText);
    if (parsed) return { workTitle: String(workTitle || '').trim(), anchors: parsed, source: 'llm' };
  }
  return { workTitle: String(workTitle || '').trim(), anchors: buildStyleFallbackAnchors(workTitle), source: 'fallback' };
}
