'use client';

// 便签独立入口（task-15）。
// 不占用 /study 左廊热区：以独立路由 /study/sticky-notes 打开，收口窗口/用户验收后可再接入左廊。
// 页面只负责环境变量注入，业务全在 StickyNotesRoom.tsx。

import StickyNotesRoom from '../StickyNotesRoom';

export default function StickyNotesPage() {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL;
  const token = process.env.NEXT_PUBLIC_AUTH_TOKEN;
  const base = `${workerUrl}/${token}`;
  const envOk = !!workerUrl && !!token;
  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--page-bg)',
      color: 'var(--ink-body)',
      fontFamily: 'var(--font-sans)',
      padding: '22px 26px 44px',
      boxSizing: 'border-box',
    }}>
      <StickyNotesRoom base={base} envOk={envOk} onGoBack={() => { window.location.href = '/study'; }} />
    </div>
  );
}