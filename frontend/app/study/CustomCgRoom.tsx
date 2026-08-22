'use client';

// 自定义 CG 房门（task-14）：管理 CG 条目（图片/占位 + 场景键 + 条件表达式），
// 并按模拟 state 展示「已解锁 / 未解锁」状态。对接 /api/oc/cg/*。
// fetch 一律 try/catch，res.ok 和 body.success 都要验（书房家法）。

import { useState, useEffect, useCallback } from 'react';

type CgRow = {
  id: string;
  project: string;
  charKey: string;
  title: string;
  sceneKey: string;
  condition: string;
  imageUrl: string;
  placeholder: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  unlocked?: boolean;
};

type FormState = {
  title: string;
  project: string;
  charKey: string;
  sceneKey: string;
  condition: string;
  imageUrl: string;
  placeholder: string;
  enabled: boolean;
};

const emptyForm: FormState = {
  title: '', project: '', charKey: '', sceneKey: '', condition: '',
  imageUrl: '', placeholder: '📖', enabled: true,
};

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--line-soft)',
  borderRadius: 22,
  boxShadow: '0 6px 18px var(--card-shadow)',
};
const glassStyle: React.CSSProperties = {
  background: 'var(--glass-bg)',
  border: '1.5px dashed var(--dash-line)',
  borderRadius: 22,
  boxShadow: '0 4px 16px var(--card-shadow)',
};
const pillStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--ink2)',
  background: 'var(--card-bg)', border: '1px solid var(--line-soft)', padding: '7px 16px',
  borderRadius: 30, cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit',
};
const btnPrimaryStyle: React.CSSProperties = {
  fontSize: 13, color: 'var(--card-bg)', background: 'var(--accent)', border: 'none',
  padding: '9px 18px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
};
const btnDangerStyle: React.CSSProperties = {
  fontSize: 13, color: '#c2693f', background: 'transparent', border: '1px solid #c2693f',
  padding: '8px 16px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
};
const inputStyle: React.CSSProperties = {
  fontSize: 13.5, color: 'var(--ink-body)', background: 'var(--card-bg)',
  border: '1px solid var(--line-soft)', borderRadius: 12, padding: '9px 14px',
  fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
};
const textareaStyle: React.CSSProperties = {
  ...inputStyle, minHeight: 80, resize: 'vertical', lineHeight: 1.6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

export default function CustomCgRoom({ base, envOk, onGoBack }: { base: string; envOk: boolean; onGoBack: () => void }) {
  const [cgs, setCgs] = useState<CgRow[]>([]);
  const [stateText, setStateText] = useState('{}');
  const [withState, setWithState] = useState(false);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const api = useCallback(async (path: string, opts?: RequestInit): Promise<any> => {
    if (!envOk) throw new Error('环境变量没配好');
    const res = await fetch(`${base}${path}`, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json().catch(() => null);
    if (!d || d.success === false) throw new Error(d?.error || '后端报错');
    return d;
  }, [base, envOk]);

  const load = useCallback(async (withStateFlag: boolean, stateJson: string) => {
    setLoading(true); setError('');
    try {
      const q = withStateFlag
        ? `?state=${encodeURIComponent(stateJson || '{}')}`
        : '';
      const d = await api(`/api/oc/cg${q}`);
      setCgs(Array.isArray(d.cgs) ? d.cgs : []);
    } catch (e: any) {
      setError(e.message || 'CG 列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load(false, '{}');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyState() {
    try {
      const parsed = JSON.parse(stateText || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('需为 JSON 对象');
      setWithState(true);
      load(true, JSON.stringify(parsed));
    } catch (e: any) {
      setError(e.message || 'state JSON 格式不对');
    }
  }

  function clearState() {
    setStateText('{}');
    setWithState(false);
    load(false, '{}');
  }

  function openNew() {
    setEditingId(null);
    setEditing({ ...emptyForm });
  }

  function openEdit(row: CgRow) {
    setEditingId(row.id);
    setEditing({
      title: row.title,
      project: row.project,
      charKey: row.charKey,
      sceneKey: row.sceneKey,
      condition: row.condition,
      imageUrl: row.imageUrl,
      placeholder: row.placeholder,
      enabled: row.enabled,
    });
  }

  function cancelEdit() {
    setEditing(null);
    setEditingId(null);
  }

  async function saveCg() {
    if (!editing) return;
    if (!editing.title.trim()) { setError('标题不能为空'); return; }
    const payload: Record<string, unknown> = {
      title: editing.title.trim(),
      project: editing.project.trim(),
      charKey: editing.charKey.trim(),
      sceneKey: editing.sceneKey.trim(),
      condition: editing.condition.trim(),
      imageUrl: editing.imageUrl.trim(),
      placeholder: editing.placeholder.trim(),
      enabled: editing.enabled,
    };
    setSaving(true); setError('');
    try {
      const isNew = editingId === null;
      if (isNew) {
        await api('/api/oc/cg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } else {
        await api(`/api/oc/cg/${encodeURIComponent(editingId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      setEditing(null);
      setEditingId(null);
      await load(withState, stateText);
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeCg(id: string) {
    if (!window.confirm('确定删除这张 CG 吗？')) return;
    setError('');
    try {
      await api(`/api/oc/cg/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (editingId === id) { setEditing(null); setEditingId(null); }
      await load(withState, stateText);
    } catch (e: any) {
      setError(e.message || '删除失败');
    }
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    e.target.value = '';
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl.length > 4 * 1024 * 1024) {
        setError('图片转 data URL 后超过 4MB，换小一点的图');
        return;
      }
      setEditing({ ...editing, imageUrl: dataUrl });
      setError('');
    } catch (err: any) {
      setError(err.message || '图片读取失败');
    }
  }

  const showForm = editing !== null;

  return (
    <div style={{ maxWidth: 1080 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <button className="serc" onClick={onGoBack} style={pillStyle}>← 回书架</button>
        <span className="serc" style={{ fontSize: 20, color: 'var(--ink-deep)' }}>CG 图库</span>
        <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>自定义剧情 CG / 场景图（配置 + 解锁展示）</span>
        {!showForm && (
          <button className="serc" onClick={openNew} style={{ ...btnPrimaryStyle, marginLeft: 'auto', whiteSpace: 'nowrap' }}>＋ 新建 CG</button>
        )}
      </div>

      {error && (
        <div className="card" style={{ ...cardStyle, padding: '14px 18px', marginBottom: 16, fontSize: 13, color: '#c2693f' }}>{error}</div>
      )}

      {/* ── 模拟 state / 解锁预览 ── */}
      <div style={{ ...glassStyle, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: 240 }}>
            <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>
              state（JSON 对象，模拟「当前场景/状态」；留空对象表示不判断条件）
            </div>
            <textarea value={stateText} onChange={(e) => setStateText(e.target.value)} style={{ ...textareaStyle, minHeight: 64 }} placeholder='{"场景":"琉璃塔","yuki_power":60}' />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
            <button className="serc" onClick={applyState} style={pillStyle}>按此 state 刷新解锁</button>
            <button className="serc" onClick={clearState} style={pillStyle}>清除判断</button>
          </div>
        </div>
      </div>

      {showForm ? (
        /* ── 新建 / 编辑表单 ── */
        <div className="card" style={{ ...cardStyle, padding: '20px 22px' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ flex: '1 1 200px', minWidth: 170 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>标题 *</div>
              <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="如：琉璃塔初次相遇" style={inputStyle} maxLength={200} />
            </div>
            <div style={{ flex: '1 1 150px', minWidth: 120 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>项目（可选）</div>
              <input value={editing.project} onChange={(e) => setEditing({ ...editing, project: e.target.value })} placeholder="如：琉璃塔" style={inputStyle} maxLength={100} />
            </div>
            <div style={{ flex: '1 1 150px', minWidth: 120 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>角色（可选）</div>
              <input value={editing.charKey} onChange={(e) => setEditing({ ...editing, charKey: e.target.value })} placeholder="如：Yuki" style={inputStyle} maxLength={100} />
            </div>
            <div style={{ flex: '1 1 150px', minWidth: 120 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>场景键（可选）</div>
              <input value={editing.sceneKey} onChange={(e) => setEditing({ ...editing, sceneKey: e.target.value })} placeholder="如：琉璃塔" style={inputStyle} maxLength={200} />
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>
            条件表达式（可选；对 state 求值，如 <code>yuki_power &gt;= 50</code>）
          </div>
          <textarea
            value={editing.condition}
            onChange={(e) => setEditing({ ...editing, condition: e.target.value })}
            placeholder={''}
            style={textareaStyle}
            maxLength={4000}
          />

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <div style={{ flex: '1 1 260px', minWidth: 220 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>图片（data URL / URL，可选；不填则显示占位）</div>
              <input value={editing.imageUrl.startsWith('data:') ? '已选择图片（可重新选择）' : editing.imageUrl} onChange={(e) => setEditing({ ...editing, imageUrl: e.target.value })} placeholder="https://... 或选择本地图片" style={inputStyle} maxLength={4000000} />
              <input type="file" accept="image/*" onChange={pickImage} style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-body)' }} />
            </div>
            <div style={{ flex: '1 1 180px', minWidth: 150 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>无图占位（可选）</div>
              <input value={editing.placeholder} onChange={(e) => setEditing({ ...editing, placeholder: e.target.value })} placeholder="📖" style={inputStyle} maxLength={500} />
            </div>
            <div style={{ flex: '1 1 140px', minWidth: 120, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-body)', cursor: 'pointer' }}>
                <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
                启用
              </label>
            </div>
          </div>

          {editing.imageUrl && (
            <div style={{ marginTop: 12 }}>
              <img src={editing.imageUrl} alt="预览" style={{ maxWidth: 260, maxHeight: 180, borderRadius: 14, border: '1px solid var(--line-soft)' }} />
              {editing.imageUrl.startsWith('data:') && (
                <button className="serc" onClick={() => setEditing({ ...editing, imageUrl: '' })} style={{ ...pillStyle, marginLeft: 10, fontSize: 12 }}>清除图片</button>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <button className="serc" onClick={saveCg} disabled={saving} style={{ ...btnPrimaryStyle, opacity: saving ? 0.6 : 1 }}>{saving ? '保存中…' : '保存 CG'}</button>
            <button className="serc" onClick={cancelEdit} style={pillStyle}>取消</button>
            {editingId && (
              <button className="serc" onClick={() => removeCg(editingId)} style={{ ...btnDangerStyle, marginLeft: 'auto' }}>删除</button>
            )}
          </div>
        </div>
      ) : (
        /* ── 图库网格 ── */
        loading ? (
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>正在加载 CG…</div>
        ) : cgs.length === 0 ? (
          <div style={{ ...glassStyle, padding: '20px 22px', fontSize: 13, color: 'var(--ink2)' }}>
            还没有自定义 CG。点「＋ 新建 CG」上传一张图或只写占位，并配好场景/条件。
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 14 }}>
            {cgs.map((cg) => (
              <div key={cg.id} className="card" style={{ ...cardStyle, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ width: '100%', height: 150, borderRadius: 14, overflow: 'hidden', background: 'var(--scale-0)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line-soft)' }}>
                  {cg.imageUrl ? (
                    <img src={cg.imageUrl} alt={cg.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: 40, lineHeight: 1 }}>{cg.placeholder || '📖'}</span>
                  )}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-deep)' }}>{cg.title}</span>
                    {!cg.enabled && <span style={{ fontSize: 11, color: 'var(--ink2)' }}>停用</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink2)', marginTop: 4, lineHeight: 1.6 }}>
                    {[cg.project && `项目 ${cg.project}`, cg.charKey && `角色 ${cg.charKey}`, cg.sceneKey && `场景 ${cg.sceneKey}`].filter(Boolean).join(' · ') || '未分类'}
                  </div>
                  {cg.condition && <div style={{ fontSize: 11, color: 'var(--ink2)', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', marginTop: 4, wordBreak: 'break-all' }}>if {cg.condition}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
                  {withState ? (
                    <span style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 20, background: cg.unlocked ? 'rgba(46,160,67,0.12)' : 'var(--scale-0)', color: cg.unlocked ? '#2ea043' : 'var(--ink2)' }}>
                      {cg.unlocked ? '已解锁' : '未解锁'}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11.5, color: 'var(--ink2)' }}>未判断</span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button className="serc" onClick={() => openEdit(cg)} style={{ ...pillStyle, fontSize: 12, padding: '5px 12px' }}>编辑</button>
                    <button className="serc" onClick={() => removeCg(cg.id)} style={{ ...btnDangerStyle, fontSize: 12, padding: '5px 12px' }}>删</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}