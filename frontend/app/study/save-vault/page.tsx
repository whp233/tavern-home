"use client";

// 存档独立入口（task-16）。
// 不占用 /study 左廊热区：以独立路由 /study/save-vault 打开，收口窗口/用户验收后再接入左廊。
// 页面只负责环境变量注入，业务全在 SaveVaultRoom.tsx。

import SaveVaultRoom from "../SaveVaultRoom";

export default function SaveVaultPage() {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL;
  const token = process.env.NEXT_PUBLIC_AUTH_TOKEN;
  const base = `${workerUrl}/${token}`;
  const envOk = !!workerUrl && !!token;
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--page-bg)",
        color: "var(--ink-body)",
        fontFamily: "var(--font-sans)",
        padding: "22px 26px 44px",
        boxSizing: "border-box",
      }}
    >
      <SaveVaultRoom base={base} envOk={envOk} onGoBack={() => { window.location.href = "/study"; }} />
    </div>
  );
}