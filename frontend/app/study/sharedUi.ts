// frontend/app/study/sharedUi.ts
import type { CSSProperties } from 'react';
// 打字桌各房间（Room）之间原本各自复制一份的小工具，2026-09-18 精简批次合并到这里。
// 只收「逐字相同」的那些——视觉处理不同的（如 TokenUsagePanel 的紧凑玻璃卡）刻意不收，
// 那是另一种设计，合并会把两种配色硬压成一种。

// —— 房间 API 调用器 ——
// DiaryRoom / CustomCgRoom / TrpgRoom 各有一份逐字相同的版本；DiaryRoom 那版的签名多写了
// `& { signal?: AbortSignal }`，但 RequestInit 本来就含 signal，属冗余，统一用 RequestInit。
// 仍然是工厂函数：各房间用 useCallback(makeDeskApi(base, envOk), [base, envOk]) 保持原依赖语义。
export function makeDeskApi(base: string, envOk: boolean) {
  return async (path: string, opts?: RequestInit): Promise<any> => {
    if (!envOk) throw new Error('环境变量没配好');
    const res = await fetch(`${base}${path}`, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json().catch(() => null);
    if (!d || d.success === false) throw new Error(d?.error || '后端报错');
    return d;
  };
}

// —— 虚线玻璃卡（半径 22 / 阴影 16）——
// 原 CustomCgRoom/DiaryRoom 叫 glassStyle，ProviderConfigRoom/ReadingCorner 叫 glassCardStyle，
// 四份样式值逐字相同。TokenUsagePanel 的 glassStyle（半径 16 / 阴影 12）不在此列。
export const glassCard: CSSProperties = {
  background: 'var(--glass-bg)',
  border: '1.5px dashed var(--dash-line)',
  borderRadius: 22,
  boxShadow: '0 4px 16px var(--card-shadow)',
};

// —— 月/日短格式 ——
// ChaptersStudio / ReadingCorner 版带空值守卫；page.tsx 版签名更窄且无守卫。合并取带守卫的
// 宽签名——对 page.tsx 的现有调用（都传 string）行为不变，空串两版都返回 ''。
export function fmtMD(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch { return iso; }
}
