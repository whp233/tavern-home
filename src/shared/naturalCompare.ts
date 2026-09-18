// src/shared/naturalCompare.ts
// 章节号自然排序。原先在 core/{readingService,studyService}.ts、tools/reading.ts、
// chat/deskAssemble.ts 各持一份（4 份，deskMemory.ts 里那个是另一回事的比较器，不含在内），
// 2026-09-18 精简批次合并到这里，逻辑一行未改。
//
// 为什么手搓而不用 localeCompare 的 numeric 选项：workerd 的 ICU 是裁剪版，对该选项不可靠，
// 手搓「数字段按数值比、文字段按码位比」在哪个运行时行为都一样。这是保留手写的理由，
// 不是保留 4 份副本的理由——副本合并后这个理由依然成立。
export function naturalCompare(x: string, y: string): number {
  const seg = (s: string) => s.match(/\d+|\D+/g) || [];
  const xs = seg(x), ys = seg(y);
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const a = xs[i], b = ys[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const an = /^\d+$/.test(a), bn = /^\d+$/.test(b);
    if (an && bn) {
      const d = Number(a) - Number(b);
      if (d !== 0) return d;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
}
