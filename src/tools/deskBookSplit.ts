// src/tools/deskBookSplit.ts
// 自动成书 · 确定性切章内核（零 D1、零模型调用）。
//
// 与 src/tools/deskBook.ts 分开放：这一份只吃"楼层数组 → 章组"的纯计算，不碰 env/DB，
// 因此能被 node --test 直接 import（deskBook.ts 那侧要拉 deskWindows/reading，那些模块
// 走 esbuild 的无扩展名导入，node 原生 ESM 解析不了）。deskBook.ts 从这边 re-export 全部符号。
//
// 规则（照时光带折叠 selectDeskTimelineFoldBatch 的口径）：
//   1) 过滤 content === '' 的空楼（口径同 maybeFoldDeskTimeline 的 SQL content != ''）；
//   2) 每章累积 assistant 正文字符数，到 budgetChars 就闭章；闭章检查在每次加完 assistant 之后
//      立即做，单楼超预算天然单独成章；
//   3) 每章必须收在 assistant 楼（user 楼是导演指令，跟随其 assistant 入章）；
//   4) 末尾孤儿 user 楼（无后续 assistant）并入前章；
//   5) 窗口全空/无 assistant 拒绝。
// floors 需已按 created_at ASC, id ASC 排序（deskWindowGet 的输出即此序）。

import { estTokens } from '../chat/deskAssemble.ts';

// 每章预算：累积 assistant 正文 ≈4000-6000 字（默认取中值 5000，可配置）。
// 用字符数当预算尺，不用 estTokens：一章转写正文要在单次 completeText 的 max_tokens(8000)
// 内装下，estTokens=ceil(字/3) 会把"4000-6000 字"放大成 12000-18000 token，必然截断。
export const DESK_BOOK_BUDGET_DEFAULT = 5000;

export interface DeskBookFloor {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface DeskBookChapterGroup {
  start_floor_id: string;
  end_floor_id: string;
  floor_ids: string[];      // 章内楼层顺序（幂等映射/转写原文用，REST 响应也带上方便对账）
  est_chars: number;        // estTokens 粗估（报告用，非预算尺）
  assistant_count: number;
}

export interface DeskBookSplitOpts {
  budgetChars?: number;
}

export function deskBookSplitFloors(
  floors: DeskBookFloor[],
  opts: DeskBookSplitOpts = {},
): { success: boolean; error?: string; chapter_groups?: DeskBookChapterGroup[] } {
  const budget = Number.isFinite(opts.budgetChars) && (opts.budgetChars as number) > 0
    ? (opts.budgetChars as number)
    : DESK_BOOK_BUDGET_DEFAULT;

  const nonEmpty = (Array.isArray(floors) ? floors : []).filter(
    (f) => f && typeof f.content === 'string' && f.content !== '',
  );
  if (nonEmpty.length === 0) return { success: false, error: '窗口没有非空楼层,没东西可成书' };
  if (!nonEmpty.some((f) => f.role === 'assistant')) {
    return { success: false, error: '窗口里没有模型写过的楼层,无法成书' };
  }

  const makeGroup = (list: DeskBookFloor[]): DeskBookChapterGroup => {
    const assistants = list.filter((f) => f.role === 'assistant');
    return {
      start_floor_id: list[0].id,
      end_floor_id: list[list.length - 1].id,
      floor_ids: list.map((f) => f.id),
      est_chars: assistants.reduce((n, f) => n + estTokens(f.content), 0),
      assistant_count: assistants.length,
    };
  };

  // 章内先用楼层对象数组累积，最后统一转成公开的 DeskBookChapterGroup 形状
  const rawGroups: DeskBookFloor[][] = [];
  let current: DeskBookFloor[] = [];
  let accChars = 0;

  for (const floor of nonEmpty) {
    current.push(floor);
    if (floor.role === 'assistant') {
      accChars += String(floor.content || '').length;
      if (accChars >= budget) {
        rawGroups.push(current);
        current = [];
        accChars = 0;
      }
    }
  }

  if (current.length) {
    const last = current[current.length - 1];
    if (last.role === 'assistant') {
      rawGroups.push(current);
    } else if (rawGroups.length) {
      // 孤儿 user 楼（无后续 assistant）并入前章
      rawGroups[rawGroups.length - 1] = [...rawGroups[rawGroups.length - 1], ...current];
    } else {
      return { success: false, error: '窗口没有可成书的章节' };
    }
  }

  return { success: true, chapter_groups: rawGroups.map(makeGroup) };
}

// ===== 信封解析：<title>/<summary>/<content> 三标签，缺一即失败 =====
export function parseEnvelope(text: string): { title: string; summary: string; content: string } | null {
  const title = /<title>([\s\S]*?)<\/title>/.exec(text);
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text);
  const content = /<content>([\s\S]*?)<\/content>/.exec(text);
  if (!title || !summary || !content) return null;
  return { title: title[1], summary: summary[1], content: content[1] };
}

// ===== 标题编号归一：模型爱在标题里带"第N章/第四章/第29章"这类编号，且经常编错——
//   chapter_no 字段才是系统的真编号（读书角/章节工房都拿它渲染"第N章"徽章），
//   标题里的编号一律剥掉、只留纯标题，彻底消掉"标题标号对不上"的问题。=====
export function normalizeChapterTitle(raw: string, chapterNo: string): string {
  const t = String(raw || '').trim();
  const stripped = t.replace(/^第[^\s]{0,8}章\s*/, '').trim();
  return stripped || `第${chapterNo}章`;
}

// 幂等判定：章组的楼层是否已全部进过 desk_chapter_floors（全进=已生成过，跳过）
export function groupFullyMapped(group: DeskBookChapterGroup, mapped: Set<string>): boolean {
  return group.floor_ids.every((id) => mapped.has(id));
}
