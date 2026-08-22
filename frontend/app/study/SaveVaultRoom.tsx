"use client";

// 酒馆之家存档室（task-16）：导出/导入 .json 的前端。
// 对齐妹居备份结构 {version, timestamp, exportDate, slotId, data{...}}；
// 支持三格式：home（本仓导出）、meiju（妹居备份 .json）、st_chat（SillyTavern JSONL）。
// 导入分两段：先预览（校验+冲突提示），确认后再落库（仅追加，不覆盖）。

import { useState, useRef } from "react";

type SaveFormat = "home" | "meiju" | "st_chat";

interface PreviewPlan {
  add: Record<string, number>;
  duplicatesSkipped: number;
  nothingToDo: boolean;
}

interface PreviewResult {
  success: boolean;
  preview?: boolean;
  format?: SaveFormat;
  warnings?: string[];
  conflicts?: Array<{ domain: string; key: string; detail: string }>;
  plan?: PreviewPlan;
  counts?: { incoming: Record<string, number> };
  detected?: { floors: number };
  hint?: string;
  error?: string;
  version?: string;
  slotId?: string;
}

interface ImportResult {
  success: boolean;
  format?: SaveFormat;
  warnings?: string[];
  imported?: Record<string, number>;
  skipped?: number;
  error?: string;
  message?: string;
}

export default function SaveVaultRoom({
  base,
  envOk,
  onGoBack,
}: {
  base: string;
  envOk: boolean;
  onGoBack?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [pendingContent, setPendingContent] = useState("");
  const [pendingFilename, setPendingFilename] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function doExport() {
    if (!envOk) { setErr("环境未配置"); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const qs = projectFilter.trim() ? `?project=${encodeURIComponent(projectFilter.trim())}` : "";
      const res = await fetch(`${base}/api/oc/save/export${qs}`);
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const disp = res.headers.get("Content-Disposition") || "";
      const m = disp.match(/filename="([^"]+)"/);
      const filename = m ? m[1] : `tavern-home_${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg(`已导出：${filename}`);
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text().catch(() => "");
    if (!text.trim()) { setErr("文件为空"); return; }
    setPendingContent(text);
    setPendingFilename(file.name);
    setPreview(null); setErr(""); setMsg("");
    // 自动预览
    await doPreview(text, file.name);
    // 清空 input 以便重复选同一文件也能触发
    if (fileRef.current) fileRef.current.value = "";
  }

  async function doPreview(content: string, filename: string) {
    if (!envOk) { setErr("环境未配置"); return; }
    setBusy(true); setErr("");
    try {
      const res = await fetch(`${base}/api/oc/save/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, filename, confirmed: false }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      if (!j?.success) throw new Error(j?.error || "预览失败");
      setPreview(j as PreviewResult);
      if (j?.preview) setMsg(j.hint || "预览完成，请确认后导入");
    } catch (e: any) { setErr(e?.message || String(e)); setPreview(null); }
    finally { setBusy(false); }
  }

  async function doImport() {
    if (!envOk || !pendingContent) { setErr("没有待导入的内容"); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const res = await fetch(`${base}/api/oc/save/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: pendingContent, filename: pendingFilename, confirmed: true }),
      });
      const j: ImportResult = await res.json().catch(() => null) as any;
      if (!res.ok) throw new Error((j as any)?.error || `HTTP ${res.status}`);
      if (!j?.success) throw new Error(j?.error || "导入失败");
      const imp = j.imported || {};
      const parts: string[] = [];
      for (const [k, v] of Object.entries(imp)) if (v) parts.push(`${k}:${v}`);
      setMsg(`导入完成${parts.length ? "（" + parts.join("、") + "）" : ""}${j.skipped ? `，跳过重复 ${j.skipped} 条` : ""}`);
      setPreview(null); setPendingContent(""); setPendingFilename("");
      if (j.warnings?.length) setMsg((m) => m + "；提示：" + j.warnings!.slice(0, 3).join("；"));
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  function handleStChatProjectChange(v: string) {
    // st_chat 的 project 由用户在导入时通过额外字段指定，这里暂用 projectFilter 复用
    setProjectFilter(v);
  }

  const fmtLabel: Record<string, string> = {
    windows: "窗口", floors: "楼层", diaries: "日记", deskMemories: "记忆",
    studyEntries: "世界书", chapters: "章节", customCg: "CG", stickyNotes: "便签",
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      {onGoBack && (
        <button onClick={onGoBack} style={{ fontSize: 13, color: "var(--ink2)", background: "none", border: "none", cursor: "pointer", padding: "4px 0", marginBottom: 12 }}>
          ← 返回书房
        </button>
      )}
      <h2 style={{ fontSize: 20, color: "var(--ink-deep)", margin: "0 0 6px" }}>存档</h2>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "0 0 18px", lineHeight: 1.6 }}>
        导出/导入本地存档 .json（结构对齐妹居备份：{"{version, timestamp, exportDate, slotId, data{...}}"}）。
        支持酒馆之家存档、妹居备份、SillyTavern 聊天 JSONL 三种格式；导入前校验并提示冲突，不静默覆盖。
      </p>

      {/* 导出 */}
      <div style={{ border: "1px solid var(--line-soft)", borderRadius: 12, padding: "16px 18px", marginBottom: 16, background: "var(--card-bg)" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-deep)", marginBottom: 10 }}>导出</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            placeholder="按项目过滤（留空=全量）"
            style={{ flex: "1 1 180px", fontSize: 13, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line-soft)", background: "var(--input-bg)", color: "var(--ink-body)" }}
          />
          <button
            onClick={doExport}
            disabled={busy || !envOk}
            style={{ fontSize: 13, padding: "7px 16px", borderRadius: 8, border: "1px solid var(--line-soft)", background: busy ? "var(--scale-0)" : "var(--scale-2)", color: busy ? "var(--ink2)" : "#fff", cursor: busy ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
          >
            {busy ? "处理中…" : "导出 .json"}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 8 }}>含：窗口/楼层、日记、记忆、世界书、章节、CG、便签；每日登录设置随档留存。</div>
      </div>

      {/* 导入 */}
      <div style={{ border: "1px solid var(--line-soft)", borderRadius: 12, padding: "16px 18px", background: "var(--card-bg)" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-deep)", marginBottom: 10 }}>导入</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <label style={{ fontSize: 13, padding: "7px 14px", borderRadius: 8, border: "1px solid var(--line-soft)", background: "var(--scale-0)", color: "var(--ink-body)", cursor: busy ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
            选择文件
            <input ref={fileRef} type="file" accept=".json,.jsonl,.txt" onChange={onPickFile} disabled={busy} style={{ display: "none" }} />
          </label>
          <span style={{ fontSize: 12, color: "var(--ink2)" }}>支持 .json（酒馆/妹居）或 .jsonl（SillyTavern 聊天）</span>
        </div>

        {preview && (
          <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10, background: "var(--scale-0)", border: "1px solid var(--line-soft)" }}>
            <div style={{ fontSize: 12.5, color: "var(--ink-deep)", marginBottom: 8 }}>
              格式：<b>{preview.format}</b>
              {preview.version && <> · 版本 {preview.version}</>}
              {preview.slotId && <> · 槽位 {preview.slotId}</>}
            </div>
            {preview.counts?.incoming && (
              <div style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 8 }}>
                文件内容：
                {Object.entries(preview.counts.incoming).filter(([, v]) => (v as number) > 0).map(([k, v]) => `${fmtLabel[k] || k}:${v}`).join("、") || "（空）"}
              </div>
            )}
            {preview.detected && (
              <div style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 8 }}>检测到楼层 {preview.detected.floors} 条，将新建窗口写入</div>
            )}
            {preview.plan && (
              <div style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 8 }}>
                计划新增：
                {Object.entries(preview.plan.add).filter(([, v]) => (v as number) > 0).map(([k, v]) => `${fmtLabel[k] || k}:${v}`).join("、") || "无"}
                {preview.plan.duplicatesSkipped ? ` · 跳过重复 ${preview.plan.duplicatesSkipped} 条` : ""}
                {preview.plan.nothingToDo ? " · 无可新增内容" : ""}
              </div>
            )}
            {preview.warnings?.length ? (
              <div style={{ fontSize: 11.5, color: "#b48a2a", marginBottom: 6 }}>
                提示：{preview.warnings.slice(0, 5).join("；")}
              </div>
            ) : null}
            {preview.conflicts?.length ? (
              <div style={{ fontSize: 11.5, color: "#c2693f", marginBottom: 8 }}>
                冲突 {preview.conflicts.length} 条：
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  {preview.conflicts.slice(0, 8).map((c, i) => <li key={i}>{c.domain}:{c.key} — {c.detail}</li>)}
                  {preview.conflicts.length > 8 && <li>…还有 {preview.conflicts.length - 8} 条</li>}
                </ul>
              </div>
            ) : null}
            {preview.hint && <div style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 6 }}>{preview.hint}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button
                onClick={doImport}
                disabled={busy || preview.plan?.nothingToDo}
                style={{ fontSize: 13, padding: "7px 16px", borderRadius: 8, border: "none", background: preview.plan?.nothingToDo ? "var(--scale-0)" : "var(--accent, #6b7cff)", color: "#fff", cursor: preview.plan?.nothingToDo || busy ? "not-allowed" : "pointer", opacity: preview.plan?.nothingToDo || busy ? 0.6 : 1 }}
              >
                确认导入（仅追加，不覆盖）
              </button>
              <button
                onClick={() => { setPreview(null); setPendingContent(""); setPendingFilename(""); setErr(""); setMsg(""); }}
                disabled={busy}
                style={{ fontSize: 12.5, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--line-soft)", background: "var(--card-bg)", color: "var(--ink2)", cursor: "pointer" }}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {!preview && pendingFilename && (
          <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>已选：{pendingFilename}</div>
        )}
      </div>

      {msg && <div style={{ marginTop: 12, fontSize: 13, color: "#2e7d32", background: "#e8f5e9", borderRadius: 8, padding: "10px 14px" }}>{msg}</div>}
      {err && <div style={{ marginTop: 12, fontSize: 13, color: "#c62828", background: "#fdecea", borderRadius: 8, padding: "10px 14px" }}>{err}</div>}

      <div style={{ fontSize: 11, color: "var(--ink2)", marginTop: 14, lineHeight: 1.6 }}>
        说明：导入永远只新增，不会覆盖或删除已有数据；重复内容自动跳过。妹居备份的角色卡会转为世界书条目（标签“妹居导入”），游戏私有数值仅留档不转换。
      </div>
    </div>
  );
}