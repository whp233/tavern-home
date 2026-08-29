'use client';

import { useState, useCallback } from 'react';

type PlotOutline = { title: string; summary: string; beats: string[]; tags?: string[]; styleAnchors?: string[]; _context?: any };

export default function PlotOutlineLauncher({
  base, envOk, project, charKey, selectedCharKeys, onCreated,
}: {
  base: string; envOk: boolean; project: string; charKey?: string; selectedCharKeys?: string[]; onCreated?: (windowId: string) => void;
}) {
  const [intent, setIntent] = useState('');
  const [charInput, setCharInput] = useState(charKey || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outline, setOutline] = useState<PlotOutline | null>(null);
  const [note, setNote] = useState('');
  const [workAnchors, setWorkAnchors] = useState<string[]>([]);
  const [branch, setBranch] = useState<'A' | 'B' | ''>('');
  const [toast, setToast] = useState('');

  const doOneClick = useCallback(async () => {
    if (busy) return;
    setBusy(true); setError(''); setToast('');
    try {
      if (!envOk) throw new Error('环境未就绪');
      const intentText = intent.trim();
      // task-30 多选优先：若外部已选角色块，则直接用选中集合；否则回退到单 charKey 输入
      const selected = Array.isArray(selectedCharKeys) && selectedCharKeys.length ? selectedCharKeys.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
      const ck = selected.length ? selected[0] : (charInput || charKey || '').trim();
      const selectedForVars = selected.length ? selected : (ck ? [ck] : []);
      // 1) 生成大纲（预览语义，后端兼容 intentText/freeText/workTitle/seed）
      const res = await fetch(`${base}/api/oc/plot/outline`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, charKey: ck, seed: intentText, workTitle: intentText, intentText, freeText: intentText, intent: intentText, preview: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json().catch(() => null);
      if (!d || d.success !== true) throw new Error(d?.error || '生成失败');
      const out = d.outline as PlotOutline;
      const n = typeof d.note === 'string' ? d.note : '';
      const anchors: string[] = Array.isArray(d.workAnchors) ? d.workAnchors : [];
      const br: 'A' | 'B' = d.branch || (intentText ? 'A' : 'B');
      setOutline(out);
      setNote(n);
      setWorkAnchors(anchors);
      setBranch(br);
      setToast(intentText ? `已按“${intentText.slice(0, 16)}”感觉生成` : '已按最近剧情续出');
      // 2) 拉配方
      const recRes = await fetch(`${base}/api/oc/desk/recipes`);
      const rd = await recRes.json().catch(() => null);
      const recipes: any[] = rd && rd.success ? (rd.recipes || []) : [];
      const recipeId = recipes[0]?.id;
      if (!recipeId) throw new Error('还没有可用配方，请先在抽屉里导入或新建一个预设配方');
      const title = out?.title || (intentText ? intentText.slice(0, 20) : '续章');
      const winRes = await fetch(`${base}/api/oc/desk/windows`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, recipe_id: recipeId, title, char_key: ck }),
      });
      const wd = await winRes.json().catch(() => null);
      if (!winRes.ok || !wd || wd.success !== true) throw new Error(wd?.error || '开新窗失败');
      const newId = wd.id as string;
      // task-30 多选落 vars（若有选中集合，额外 PUT 持久化，供 deskAssemble 读取）
      if (selectedForVars.length) {
        try {
          await fetch(`${base}/api/oc/desk/windows/${newId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vars: { selected_char_keys: selectedForVars } }),
          });
        } catch {}
      }
      // 3) 落小纸条：直接 PUT note（不二次 LLM，避免漂移）
      // 注意：若已写入 vars，这里需合并而非覆盖；先读后合并，失败则降级为单独 note 写入
      let putRes: any;
      let pd: any;
      if (selectedForVars.length) {
        try {
          const cur = await fetch(`${base}/api/oc/desk/windows/${newId}`).then((r) => r.json().catch(() => null));
          const curVars = cur && cur.window && cur.window.vars && typeof cur.window.vars === 'object' ? cur.window.vars : {};
          const mergedVars = { ...curVars, selected_char_keys: selectedForVars };
          putRes = await fetch(`${base}/api/oc/desk/windows/${newId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: n, note_depth: 3, vars: mergedVars }),
          });
          pd = await putRes.json().catch(() => null);
        } catch {
          putRes = await fetch(`${base}/api/oc/desk/windows/${newId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: n, note_depth: 3 }),
          });
          pd = await putRes.json().catch(() => null);
        }
      } else {
        putRes = await fetch(`${base}/api/oc/desk/windows/${newId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: n, note_depth: 3 }),
        });
        pd = await putRes.json().catch(() => null);
      }
      if (!putRes.ok || !pd || pd.success !== true) throw new Error(pd?.error || '小纸条写入失败');
      // 4) 同时尝试经 outline 接口落地 outline 类 lore（幂等）
      try {
        await fetch(`${base}/api/oc/plot/outline`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, charKey: ck, charKeys: selectedForVars, seed: intentText, workTitle: intentText, intentText, freeText: intentText, windowId: newId, outline: out }),
        });
      } catch {}
      if (onCreated) onCreated(newId);
      else window.dispatchEvent(new CustomEvent('plot-outline-created', { detail: { windowId: newId, project } }));
    } catch (e: any) { setError(e?.message || '失败'); }
    finally { setBusy(false); }
  }, [base, envOk, project, charKey, selectedCharKeys, charInput, intent, busy, onCreated]);

  const cardStyle: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--line-soft)', borderRadius: 18, padding: '16px 18px' };
  const inputStyle: React.CSSProperties = { fontSize: 13.5, color: 'var(--ink-body)', background: 'var(--card-bg)', border: '1px solid var(--line-soft)', borderRadius: 10, padding: '8px 12px', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' as const };
  const btnPrimary: React.CSSProperties = { fontSize: 13, color: 'var(--card-bg)', background: 'var(--accent)', border: 'none', padding: '8px 14px', borderRadius: 16, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 };

  return (
    <div style={cardStyle}>
      <div className="serc" style={{ fontSize: 14, color: 'var(--ink-deep)', marginBottom: 8 }}>剧情大纲＋小纸条一键开新窗</div>
      <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 10 }}>
        一句话自由意图直出大纲并开新窗（留空则自动续接最近剧情＋记忆＋日记，走 B 分支）。文风锚点注入小纸条 depth 3。
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {Array.isArray(selectedCharKeys) && selectedCharKeys.length ? (
          <div style={{ fontSize: 11, color: 'var(--ink2)', background: 'var(--scale-0)', borderRadius: 10, padding: '8px 10px', marginBottom: 8 }}>
            将带入角色：{selectedCharKeys.join('、')}（来自上方角色块多选，可多选；空选亦可开窗）
          </div>
        ) : null}
        <input value={charInput} onChange={(e) => setCharInput(e.target.value)} placeholder="角色 charKey（可选，记忆作用域）" style={{ ...inputStyle, flex: '1 1 160px' }} />
      </div>
      <textarea value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="描述你想要的感觉/参考，比如：想要更压抑的宿命感、想循《越野滑雪》的雪原同行感…（留空则自动续接最近剧情）" rows={3} style={{ ...inputStyle, minHeight: 88, resize: 'vertical', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={doOneClick} style={btnPrimary}>{busy ? '生成并开窗中…' : '一键生成并开新窗'}</button>
        {outline && <span style={{ fontSize: 11, color: 'var(--ink2)' }}>{branch === 'A' ? 'A·有意图' : 'B·无意图续大纲'}</span>}
        {toast && <span style={{ fontSize: 11, color: '#8a6a3a', background: 'var(--scale-0)', borderRadius: 8, padding: '4px 8px' }}>{toast}</span>}
      </div>
      {workAnchors.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink2)', background: 'var(--scale-0)', borderRadius: 10, padding: '8px 10px' }}>
          文风锚点{intent.trim() ? `（已按“${intent.trim().slice(0, 12)}”感觉生成）` : ''}：{workAnchors.join('、')}
        </div>
      )}
      {outline && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: 'var(--scale-0)' }}>
          <div style={{ fontSize: 14, color: 'var(--ink-deep)', fontWeight: 600 }}>{outline.title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 4 }}>{outline.summary}</div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {outline.beats.map((b, i) => <div key={i} style={{ fontSize: 12.5, color: 'var(--ink-body)' }}>{i + 1}. {b}</div>)}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--card-bg)', borderRadius: 8, padding: '8px 10px', border: '1px dashed var(--line-soft)' }}>
            小纸条预览（depth 3）：{note}
          </div>
        </div>
      )}
      {error && <div style={{ marginTop: 8, color: '#c2693f', fontSize: 12 }}>出错：{error}</div>}
    </div>
  );
}
