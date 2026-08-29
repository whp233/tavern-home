// 开窗上下文：仅在新对话（首轮）一次性注入 记忆 + 近2-3条日记索引 + 章节/风格附录。
// 后续轮不再重复，避免上下文污染与 token 浪费。

import type { DeskMemory } from './types.ts';
import type { DiaryEntry } from './types.ts';
import { renderMemoriesText } from './deskMemory.ts';

export function renderDiaryIndexText(entries: DiaryEntry[], limit = 3): string {
  const list = (entries || []).slice(0, limit).filter((e) => e && e.date);
  if (!list.length) return '';
  const lines = list.map((e) => {
    const date = String(e.date || '');
    const title = String(e.title || '无题');
    const preview = String(e.content || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const previewPart = preview ? ` — ${preview}${String(e.content || '').length > 120 ? '…' : ''}` : '';
    return `- ${date}《${title}》${previewPart}`;
  });
  return `【近期日记索引】\n${lines.join('\n')}`;
}

export function buildOpeningContext(opts: {
  memoriesText?: string;
  diaryIndexText?: string;
  chapterAppendix?: string;
  styleAppendix?: string;
}): string {
  const parts: string[] = [];
  const mem = String(opts.memoriesText || '').trim();
  if (mem) parts.push(mem);
  const diary = String(opts.diaryIndexText || '').trim();
  if (diary) parts.push(diary);
  const ch = String(opts.chapterAppendix || '').trim();
  if (ch) parts.push(ch);
  const st = String(opts.styleAppendix || '').trim();
  if (st) parts.push(st);
  return parts.join('\n\n');
}

export function isFirstTurn(allFloors: Array<{ role: string }>): boolean {
  return !allFloors || allFloors.length === 0;
}
