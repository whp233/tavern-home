// src/core/diaryService.ts
// 酒馆之家「日记」纯函数层（task-12）：日期归一化 / 校验 / 时间格式化 / 排序，不带 I/O。
// 数据形状对齐妹居存档实测格式（date "2026/6/27"、time "下午3:35:11"、affection、content、
// conversationLength + id），见 ~/.agents/team/drafts/meiju-implementation-analysis.md §4。
// 日期存取口径（与 UI/API 一起定死，别两头改）：
//   - 落库/收发的 date 一律「YYYY/M/D，无前导零」（妹居实测格式），任何带零/横线/中文的输入都归一化到这里。
//   - 因为无前导零，date 字符串的词法序不可靠（"2026/10/2" 会排在 "2026/9/2" 前面），
//     排序一律走 compareDiaryDesc（数值比较年月日），SQL 只负责筛选不负责排序。

import type { DiaryEntry } from './types.ts';

export const DIARY_CONTENT_MAX = 200000;  // 正文上限，与 study content 同口径（20 万字）
export const DIARY_TITLE_MAX = 200;       // 标题上限
export const DIARY_REF_MAX = 100;         // project / charKey 上限（与 study project 同口径）
export const DIARY_CONVERSATION_ID_MAX = 200; // 对话引用 id 上限
export const DIARY_TIME_MAX = 24;         // time 字符串上限
export const DIARY_AFFECTION_MAX = 1000;  // 好感度上限（妹居 0-1000）

// ===== 日期归一化 =====

// 把各种常见写法的一年内日期归一化成 "YYYY/M/D"（无前导零，妹居格式）：
//   接受：Date / 数字时间戳 / "2026/6/27" / "2026-06-27" / "2026年6月27日" /
//         ISO 时间串 "2026-06-27T07:35:11.680Z"（取日期部分）。
// 非法形状（月份 13、2月30日、非数字、空串…）返回 null，绝不猜测。
// 刻意只认 4 位年份：两数字年份（"26/6/27"）语义太糊，拒收让调用方报错而不是猜世纪。
export function normalizeDiaryDate(raw: unknown): string | null {
  let y = 0, m = 0, d = 0;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    y = raw.getFullYear(); m = raw.getMonth() + 1; d = raw.getDate();
  } else if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    const dt = new Date(raw);
    y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate();
  } else if (typeof raw === 'string') {
    let s = raw.trim();
    if (!s) return null;
    // ISO 时间串：先剥掉 'T' 后面的时区/时间部分
    const tIdx = s.indexOf('T');
    if (tIdx > 0) s = s.slice(0, tIdx);
    const match = s.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?$/);
    if (!match) return null;
    y = Number(match[1]); const mm = Number(match[2]); const dd = Number(match[3]);
    if (!Number.isInteger(mm) || !Number.isInteger(dd)) return null;
    m = mm; d = dd;
  } else {
    return null;
  }
  if (!isValidCalendarDate(y, m, d)) return null;
  return `${y}/${m}/${d}`;
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || y < 1 || y > 9999) return false;
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (!Number.isInteger(d) || d < 1) return false;
  const daysInMonth = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= daysInMonth[m - 1];
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// 今天（本机时区）的日记日期，妹居格式。
export function todayDiaryDate(): string {
  return normalizeDiaryDate(new Date())!;
}

// "YYYY/M/D" → [y, m, d] 数值元组；格式不合法回 null（排序/比较共用）。
export function parseDiaryDateKey(date: string): [number, number, number] | null {
  const m = String(date || '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return isValidCalendarDate(y, mo, d) ? [y, mo, d] : null;
}

// ===== 时间格式化（妹居风格）=====

// Date → "下午3:35:11"（12 小时制中文，分/秒补零，小时不补零；妹居实测同款）。
// 注意：wrangler dev 本机跑时区即用户时区；远端边缘是 UTC 时区——本仓以本地部署为准。
export function formatDiaryTime(d: Date): string {
  const h = d.getHours();
  const half = h < 12 ? '上午' : '下午';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${half}${h12}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function diaryTimeNow(): string {
  return formatDiaryTime(new Date());
}

// ===== 校验 =====

// 新建（partial=false）与部分更新（partial=true）共用校验。
// 约定：只校验「给出的字段」；没给的字段不猜、不默认。date 在 create 缺省时由工具层置今天（见 src/tools/diary.ts）。
export function validateDiaryBody(body: any, opts: { partial?: boolean } = {}): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '请求体不对';
  if (body.date !== undefined) {
    if (typeof body.date !== 'string' || !normalizeDiaryDate(body.date)) return 'date 必须是合法日期（如 2026/6/27）';
  }
  if (body.content !== undefined) {
    if (typeof body.content !== 'string' || body.content.length > DIARY_CONTENT_MAX) {
      return `content 必须是字符串,且不超过${DIARY_CONTENT_MAX}字`;
    }
    if (!body.content.trim()) return 'content 不能为空（空日记没有保存意义）';
  } else if (!opts.partial) {
    return 'content 必填';
  }
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.length > DIARY_TITLE_MAX) return `title 必须是字符串,且不超过${DIARY_TITLE_MAX}字`;
  }
  if (body.project !== undefined) {
    if (typeof body.project !== 'string' || body.project.trim().length > DIARY_REF_MAX) return `project 必须是字符串,且不超过${DIARY_REF_MAX}字`;
  }
  if (body.charKey !== undefined) {
    if (typeof body.charKey !== 'string' || body.charKey.trim().length > DIARY_REF_MAX) return `charKey 必须是字符串,且不超过${DIARY_REF_MAX}字`;
  }
  if (body.affection !== undefined && body.affection !== null) {
    const n = Number(body.affection);
    if (!Number.isInteger(n) || n < 0 || n > DIARY_AFFECTION_MAX) {
      return `affection 必须是 0-${DIARY_AFFECTION_MAX} 的整数或 null`;
    }
  }
  if (body.conversationId !== undefined) {
    if (typeof body.conversationId !== 'string' || body.conversationId.length > DIARY_CONVERSATION_ID_MAX) {
      return `conversationId 必须是字符串,且不超过${DIARY_CONVERSATION_ID_MAX}字`;
    }
  }
  if (body.conversationLength !== undefined && body.conversationLength !== null) {
    const n = Number(body.conversationLength);
    if (!Number.isInteger(n) || n < 0) return 'conversationLength 必须是不小于 0 的整数或 null';
  }
  if (body.time !== undefined) {
    if (typeof body.time !== 'string' || body.time.length > DIARY_TIME_MAX) return `time 必须是字符串,且不超过${DIARY_TIME_MAX}字`;
  }
  return null;
}

// ===== id / 预览 / 排序 =====

export function buildDiaryId(): string {
  return `diary_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// 列表/刻度预览用：换行拍平 + 截断，不带全文（对齐 study.ts makePreview 口径）。
export function makeDiaryPreview(content: unknown, max: number = 120): string {
  return String(content || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

// 排序：日期倒序（最新在前），同日按 updated_at 倒序（最新改的在前）。
// date 无前导零不能词法比，必须数值比；非法 date 沉底。
export function compareDiaryDesc(a: DiaryEntry, b: DiaryEntry): number {
  const ka = parseDiaryDateKey(a.date);
  const kb = parseDiaryDateKey(b.date);
  if (ka && kb) {
    const byDate = kb[0] - ka[0] || kb[1] - ka[1] || kb[2] - ka[2];
    if (byDate !== 0) return byDate;
  } else if (ka) {
    return -1;
  } else if (kb) {
    return 1;
  }
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}