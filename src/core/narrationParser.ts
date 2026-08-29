// 旁白/角色语言二分：约定的输出协议 旁白:… / Role:"…" → 渲染时上旁白卡下气泡
// 兼容无协议退化单块（返回纯 text）

export interface NarrationBlock {
  kind: 'narration' | 'dialogue';
  speaker?: string;
  text: string;
}

// 行首旁白： 旁白: / 旁白： / [旁白] / Narration:
const NARRATION_RE = /^\s*(?:旁白|narration)\s*[:：]\s*(.+)$/i;
// 角色台词： 名字:"内容" / 名字： "内容" / 名字: 内容（支持中英文引号）
const DIALOGUE_RE = /^\s*([A-Za-z0-9\u4e00-\u9fff_\-]{1,20})\s*[:：]\s*["“'『](.+?)["”'』]\s*$/;
// 裸冒号台词： 名字: 内容（无引号，兜底）
const DIALOGUE_BARE_RE = /^\s*([A-Za-z0-9\u4e00-\u9fff_\-]{1,20})\s*[:：]\s*(.+)$/;

export function parseNarrationBlocks(text: string): NarrationBlock[] {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  const lines = raw.split(/\r?\n/);
  const blocks: NarrationBlock[] = [];
  let narrationBuf: string[] = [];
  const flushNarration = () => {
    if (narrationBuf.length) {
      blocks.push({ kind: 'narration', text: narrationBuf.join('\n').trim() });
      narrationBuf = [];
    }
  };
  for (const line of lines) {
    const mNar = NARRATION_RE.exec(line);
    if (mNar) {
      flushNarration();
      blocks.push({ kind: 'narration', text: mNar[1].trim() });
      continue;
    }
    const mDia = DIALOGUE_RE.exec(line);
    if (mDia) {
      flushNarration();
      blocks.push({ kind: 'dialogue', speaker: mDia[1].trim(), text: mDia[2].trim() });
      continue;
    }
    // 若已在旁白块内且非对话，则归为旁白续行；否则按普通段落归旁白缓冲
    if (line.trim() === '') {
      if (narrationBuf.length) narrationBuf.push('');
      continue;
    }
    // 裸冒号台词兜底：仅当行含中文或字母+冒号且长度适中，且不在旁白缓冲中
    const mBare = DIALOGUE_BARE_RE.exec(line);
    if (mBare && mBare[2].trim().length >= 2 && mBare[2].trim().length <= 300) {
      // 避免把 旁白: 已处理的再判；此处旁白已提前 return，故安全
      flushNarration();
      blocks.push({ kind: 'dialogue', speaker: mBare[1].trim(), text: mBare[2].trim() });
      continue;
    }
    narrationBuf.push(line);
  }
  flushNarration();
  if (!blocks.length && raw.trim()) return [{ kind: 'narration', text: raw.trim() }];
  // 合并相邻同类旁白（避免每行一块）
  const merged: NarrationBlock[] = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && last.kind === 'narration' && b.kind === 'narration') last.text = `${last.text}\n${b.text}`;
    else merged.push(b);
  }
  return merged;
}
