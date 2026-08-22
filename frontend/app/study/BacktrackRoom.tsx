'use client';

// 回溯场景（task-13）独立预览组件。
// 当前入口为「待合并」状态：先做成独立房间/实验台，后续合并进打字桌时可直接在每楼放「回溯到此」。
// 交互：选源窗口 → 选楼层 → 确认 → 后端创建新分支窗口（源窗口原样保留）。

import { useCallback, useEffect, useState } from 'react';

type WindowListItem = {
  id: string;
  project: string;
  title: string;
  recipe_id: string;
  floor_count: number;
  updated_at: string;
  created_at: string;
};

type BranchInfo = {
  id: string;
  project: string;
  title: string;
  recipe_id: string;
  parent_window_id: string;
  anchor_floor_id: string;
  anchor_index: number | null;
  label: string;
  created_at: string;
  updated_at: string;
};

type FloorInfo = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  variants_count: number;
  active_variant: number;
  report: unknown;
  created_at: string;
};

type WindowDetail = {
  id: string;
  project: string;
  title: string;
  recipe_id: string;
  char_key: string;
  note: string;
  note_depth: number;
  state_board: Record<string, unknown>;
  timeline_state: Record<string, unknown>;
  vars: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--line-soft)',
  borderRadius: 22,
  boxShadow: '0 6px 18px var(--card-shadow)',
  padding: '20px 24px',
};

const btnPrimaryStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--card-bg)',
  background: 'var(--accent)',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 18,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnGhostStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--ink-body)',
  background: 'transparent',
  border: '1px solid var(--line-soft)',
  padding: '8px 14px',
  borderRadius: 18,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const inputStyle: React.CSSProperties = {
  fontSize: 13.5,
  color: 'var(--ink-body)',
  background: 'var(--card-bg)',
  border: '1px solid var(--line-soft)',
  borderRadius: 12,
  padding: '9px 14px',
  fontFamily: 'inherit',
  outline: 'none',
};

function preview(text: string): string {
  const plain = String(text || '').replace(/\s+/g, ' ').trim();
  return plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;
}

export default function BacktrackRoom({ base, envOk, onGoBack }: {
  base: string;
  envOk: boolean;
  onGoBack: () => void;
}) {
  const [windows, setWindows] = useState<WindowListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<{ window: WindowDetail | null; floors: FloorInfo[] } | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [branchTitle, setBranchTitle] = useState('');
  const [confirmFloorId, setConfirmFloorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; title: string } | null>(null);

  const loadWindows = useCallback(async () => {
    if (!envOk) { setLoading(false); setError('环境变量未就绪，无法连接后端'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${base}/api/oc/desk/windows`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) throw new Error(data?.error || '加载写作窗失败');
      setWindows(Array.isArray(data.windows) ? data.windows : []);
    } catch (e: unknown) {
      setError(errorMessage(e, '加载写作窗失败'));
    } finally {
      setLoading(false);
    }
  }, [base, envOk]);

  useEffect(() => {
      let cancelled = false;
      const timer = setTimeout(() => {
        if (cancelled) return;
        void loadWindows();
      }, 0);
      return () => { cancelled = true; clearTimeout(timer); };
    }, [loadWindows]);

  async function selectWindow(id: string) {
    if (!id) { setSelectedId(''); setDetail(null); setBranches([]); return; }
    setSelectedId(id);
    setResult(null);
    setConfirmFloorId(null);
    setBranchTitle('');
    setDetailLoading(true);
    try {
      const res = await fetch(`${base}/api/oc/desk/windows/${id}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) throw new Error(data?.error || '加载窗口详情失败');
      setDetail({ window: data.window, floors: Array.isArray(data.floors) ? data.floors : [] });
    } catch (e: unknown) {
      setError(errorMessage(e, '加载窗口详情失败'));
    } finally {
      setDetailLoading(false);
    }
    try {
      const branchRes = await fetch(`${base}/api/oc/desk/windows/${id}/branches`);
      const branchData = await branchRes.json().catch(() => null);
      if (branchRes.ok && branchData && branchData.success) {
        setBranches(Array.isArray(branchData.branches) ? branchData.branches : []);
      }
    } catch {
      setBranches([]);
    }
  }

  async function runBacktrack(floorId: string) {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${base}/api/oc/desk/windows/${selectedId}/backtrack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          floor_id: floorId,
          title: branchTitle.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) throw new Error(data?.error || '回溯创建失败');
      setResult({ id: data.window.id, title: data.window.title });
      setConfirmFloorId(null);
      const branchRes = await fetch(`${base}/api/oc/desk/windows/${selectedId}/branches`);
      const branchData = await branchRes.json().catch(() => null);
      if (branchRes.ok && branchData && branchData.success) {
        setBranches(Array.isArray(branchData.branches) ? branchData.branches : []);
      }
    } catch (e: unknown) {
      setError(errorMessage(e, '回溯创建失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 980 }}>
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px' }}>
          <div className="serc" style={{ fontSize: 18, color: 'var(--ink-deep)', marginBottom: 6 }}>回溯场景（task-13）</div>
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>
            选择源窗口和要回溯到的楼层，系统会把「到该楼为止」复制成一个新分支窗口；源窗口原样保留，新分支可继续写。
          </div>
        </div>
        <button onClick={onGoBack} style={btnGhostStyle}>← 返回书架</button>
      </div>

      <div style={{ ...cardStyle, background: 'color-mix(in srgb, var(--card-bg) 94%, transparent)' }}>
        <div className="serc" style={{ fontSize: 14, color: 'var(--ink-deep)', marginBottom: 10 }}>① 选择源窗口</div>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>正在加载写作窗…</div>
        ) : windows.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>还没有写作窗，先去打字桌建一扇。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {windows.map((w) => (
              <button
                key={w.id}
                onClick={() => selectWindow(w.id)}
                style={{
                  ...(selectedId === w.id ? btnPrimaryStyle : btnGhostStyle),
                  textAlign: 'left',
                  borderRadius: 14,
                }}
              >
                <span className="serc">{w.title || '未命名窗口'}</span>
                <span style={{ fontSize: 11, opacity: 0.8, marginLeft: 10 }}>{w.project} · {w.floor_count} 楼</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedId && (
        <div style={{ ...cardStyle }}>
          <div className="serc" style={{ fontSize: 14, color: 'var(--ink-deep)', marginBottom: 10 }}>② 选择回溯楼层（该楼及之前会保留在新分支里）</div>
          {detailLoading ? (
            <div style={{ fontSize: 13, color: 'var(--ink2)' }}>加载楼层…</div>
          ) : detail && detail.floors.length > 0 ? (
            <>
              <input
                value={branchTitle}
                onChange={(e) => setBranchTitle(e.target.value)}
                placeholder="新分支标题（可留空自动生成）"
                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: 12 }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                {detail.floors.map((f, index) => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 14, background: 'var(--scale-0)' }}>
                    <span className="mono" style={{ flex: 'none', minWidth: 36, fontSize: 12, color: 'var(--ink2)', paddingTop: 3 }}>
                      #{index + 1}
                    </span>
                    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 3 }}>
                        {f.role === 'user' ? '🧑 用户' : '🤖 助手'}
                        {f.variants_count > 1 ? ` · ${f.variants_count} 个变体` : ''}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--ink-body)', whiteSpace: 'pre-line' }}>{preview(f.content)}</div>
                    </div>
                    <div style={{ flex: 'none' }}>
                      {confirmFloorId === f.id ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button disabled={busy} onClick={() => runBacktrack(f.id)} style={btnPrimaryStyle}>确认回溯</button>
                          <button disabled={busy} onClick={() => setConfirmFloorId(null)} style={btnGhostStyle}>取消</button>
                        </div>
                      ) : (
                        <button onClick={() => { setConfirmFloorId(f.id); setError(''); }} style={btnGhostStyle}>回溯到此</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--ink2)' }}>这扇窗还没有楼层。</div>
          )}
        </div>
      )}

      {error && (
        <div style={{ ...cardStyle, fontSize: 13, color: '#c2693f' }}>出错了：{error}</div>
      )}

      {result && (
        <div style={{ ...cardStyle }}>
          <div className="serc" style={{ fontSize: 15, color: 'var(--ink-deep)', marginBottom: 8 }}>✅ 分支已创建</div>
          <div style={{ fontSize: 13, color: 'var(--ink-body)', marginBottom: 6 }}>
            <strong>{result.title}</strong>（{result.id}）
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
            去左侧「打字桌」刷新窗口列表即可找到这个分支继续写。旧窗口仍保留可查。
            <span style={{ marginLeft: 8, color: 'var(--ink2)' }}>（本入口为待合并预览，后续合并进消息列表后可直接跳转）</span>
          </div>
        </div>
      )}

      {selectedId && (
        <div style={{ ...cardStyle }}>
          <div className="serc" style={{ fontSize: 14, color: 'var(--ink-deep)', marginBottom: 10 }}>③ 已有分支</div>
          {branches.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink2)' }}>这扇窗还没有生成过分支。</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {branches.map((b) => (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: 'var(--scale-0)' }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-body)' }}>
                    {b.label || `回溯@第${b.anchor_index === null ? '?' : b.anchor_index + 1}楼`}
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}