// src/core/plotOutline.ts
// 26A 剧情双分支 → 小纸条：大纲结构 title/summary/beats/tags + 文风锚点
// Path A 有种子：seed → generate({seed, project, charKey, workTitle})
// Path B 无种子：取最近窗 floors + last diary + 记忆 → generateContinuation({project,charKey,workTitle})
// 两分支共用同一大纲结构，最终经 fillNoteFromOutline 落 desk_windows.note depth 3

export interface PlotOutline {
  title: string;
  summary: string;
  beats: string[];
  tags?: string[];
  styleAnchors?: string[];
}

export interface PlotGenerateOpts {
  seed: string;
  project: string;
  charKey?: string;
  workTitle?: string; // 越野滑雪 / 越野花侠 等，驱动 styleProfile
  workAnchors?: string[];
}

export interface PlotContinuationContext {
  project: string;
  charKey?: string;
  workTitle?: string;
  workAnchors?: string[];
  recentFloors: Array<{ role: string; content: string }>;
  lastDiary?: { date: string; title: string; content: string } | null;
  memories?: string[]; // 已渲染记忆条目简要
}

function esc(v: unknown): string { return String(v ?? '').trim().slice(0, 4000); }

export function buildPlotOutlinePrompt(opts: PlotGenerateOpts): { system: Array<{ text: string; cache: boolean }>; prompt: string } {
  const seed = esc(opts.seed) || '温馨日常 / 雪原同行';
  const anchors = (opts.workAnchors || []).slice(0, 5).join('；') || '体感先行、克制递增、留白与呼吸';
  const persona = '[剧情大纲策划]\n你是“小纸条”大纲策划，负责把用户的一句话种子扩展为可直接注入的剧情大纲。只输出一个 JSON 块，不解释。';
  const ctx = `项目：${esc(opts.project) || '未指定'}  角色：${esc(opts.charKey) || '通用'}  文风锚点：${anchors}\n种子：${seed}\n作品：${esc(opts.workTitle) || '未指定（按通用文风）'}`;
  const prompt = `请生成大纲 JSON（与小纸条同源，氛围神似“${esc(opts.workTitle) || '通用细腻'}”但不复刻原文）：\n{\n  "title": "标题 6-14 字",\n  "summary": "一句话梗概 30-60 字，紧扣种子“${seed}”",\n  "beats": ["节拍1 15-30字","节拍2","节拍3","节拍4"],\n  "tags": ["标签1","标签2"]\n}\n要求：beats 3-5 条，中文，节拍即“可演的一步”，包含至少一条体感/环境描写；整体呼应文风锚点“${anchors}”，但不要在正文中直引锚点原文。`;
  return { system: [{ text: persona, cache: true }, { text: ctx, cache: true }], prompt };
}

export function buildContinuationPrompt(ctx: PlotContinuationContext): { system: Array<{ text: string; cache: boolean }>; prompt: string } {
  const anchors = (ctx.workAnchors || []).slice(0, 5).join('；') || '体感先行、克制递增、留白与呼吸';
  const floors = ctx.recentFloors.slice(-6).map((f) => `${f.role}: ${esc(f.content).slice(0, 300)}`).join('\n').slice(0, 2500) || '（无近期对话）';
  const diary = ctx.lastDiary ? `最近日记 ${ctx.lastDiary.date}《${ctx.lastDiary.title}》: ${esc(ctx.lastDiary.content).slice(0, 300)}` : '（无近期日记）';
  const mem = (ctx.memories || []).slice(0, 5).join('\n').slice(0, 1200) || '（无记忆）';
  const persona = '[剧情续大纲策划]\n用户未给新种子，需基于“最近剧情 + 记忆 + 日记”自然续出下一段大纲。只输出一个 JSON 块，不解释。';
  const contextBlock = `项目：${esc(ctx.project)}  角色：${esc(ctx.charKey) || '通用'}  文风：${anchors}\n近期剧情：\n${floors}\n${diary}\n相关记忆：\n${mem}`;
  const prompt = `请基于上方【近期剧情/日记/记忆】，以“顺势续写、而非另起炉灶”的方式生成后续大纲 JSON（与上游种子同源感）：\n{\n  "title": "续章标题 6-14 字",\n  "summary": "一句话梗概 30-60 字，体现延续性",\n  "beats": ["节拍1","节拍2","节拍3"],\n  "tags": ["延续","标签2"]\n}\n要求：beats 3-5 条，首条承接上一段的未竟之事，末条留悬念；呼应文风锚点“${anchors}”。`;
  return { system: [{ text: persona, cache: true }, { text: contextBlock, cache: true }], prompt };
}

export function normalizePlotOutline(raw: unknown): PlotOutline | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o: any = raw;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const summary = typeof o.summary === 'string' ? o.summary.trim() : (typeof o.premise === 'string' ? o.premise.trim() : '');
  const beatsRaw = Array.isArray(o.beats) ? o.beats : Array.isArray(o.beats_list) ? o.beats_list : [];
  const beats = beatsRaw.filter((x: unknown) => typeof x === 'string' && String(x).trim()).map((x: string) => String(x).trim()).slice(0, 6);
  if (!title || !summary || beats.length < 2) return null;
  const tags = Array.isArray(o.tags) ? o.tags.filter((x: unknown) => typeof x === 'string').map((x: string) => String(x).trim()).slice(0, 6) : undefined;
  const styleAnchors = Array.isArray(o.styleAnchors) ? o.styleAnchors.filter((x: unknown) => typeof x === 'string').map((x: string) => String(x).trim()).slice(0, 5) : undefined;
  return { title, summary, beats, tags, styleAnchors };
}

export function extractJsonBlock(text: string): { json: string | null; narration: string } {
  const raw = String(text || '').trim();
  if (!raw) return { json: null, narration: '' };
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  const cands: string[] = [];
  while ((m = fenceRe.exec(raw)) !== null) if (m[1] && m[1].trim()) cands.push(m[1].trim());
  const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
  if (s !== -1 && e > s) cands.push(raw.slice(s, e + 1));
  for (const cand of cands) { try { JSON.parse(cand); return { json: cand, narration: raw.replace(cand, '').trim() }; } catch {} }
  return { json: null, narration: raw.replace(/```/g, '').trim() };
}

export function parsePlotOutlineOutput(text: string): { ok: boolean; outline?: PlotOutline; warning?: string; raw?: string } {
  const { json } = extractJsonBlock(text);
  if (!json) return { ok: false, warning: '未提取到大纲 JSON' , raw: text.slice(0, 2000) };
  try {
    const parsed = JSON.parse(json);
    const out = normalizePlotOutline(parsed);
    if (!out) return { ok: false, warning: '大纲缺必要字段', raw: text.slice(0, 2000) };
    return { ok: true, outline: out };
  } catch { return { ok: false, warning: '大纲 JSON 解析失败', raw: text.slice(0, 2000) }; }
}

export function demoOutline(seed?: string, workTitle?: string): PlotOutline {
  const anchors = workTitle ? `循《${workTitle}》神似` : '细腻治愈';
  const base = seed ? String(seed).slice(0, 18) : '雪后并肩';
  return {
    title: `${base} · 同行`,
    summary: `围绕“${seed || '雪原同行'}”展开，${anchors}，在滑行与停靠中让情感自然递增。`,
    beats: [
      '雪场启程：冷空气与心跳同频，肩并肩滑出第一段',
      '停靠对视：风声中一句轻语，距离被悄然拉近',
      '递物护行：一个小动作兑现承诺，体温驱散寒意',
      '并线归途：不再追逐，只是一起抵达',
    ],
    tags: workTitle ? [workTitle, '同行'] : ['日常', '治愈'],
  };
}

export function buildNoteFromOutline(outline: PlotOutline, anchors: string[]): string {
  const tag = anchors.slice(0, 3).join('、');
  const beats = outline.beats.slice(0, 4).join(' → ');
  // 小纸条：标题 + 梗概 + 节拍 + 文风锚点（神似不复刻），供 deskAssemble 注在 depth 3
  return `【剧情大纲】${outline.title}：${outline.summary}\n节拍：${beats}\n文风锚点：${tag}（氛围神似，不复刻原文）`;
}

// fillNoteFromOutline: 纯函数产出 note 文本；落库由调用方（路由）执行 desk_windows.note
export function fillNoteFromOutline(outline: PlotOutline, workAnchors: string[]): { note: string; depth: number } {
  return { note: buildNoteFromOutline(outline, workAnchors), depth: 3 };
}
