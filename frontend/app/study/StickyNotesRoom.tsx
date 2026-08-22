'use client';

// 酒馆之家「便签」独立房（task-15）。
// 轻量便利贴 CRUD：新建/编辑/删除/置顶/颜色/项目角色筛选。
// 持久化走后端 `/api/oc/sticky-notes`（D1 oc_state，零 schema 迁移）。
// 入口说明：为避免与 task-13/21 并行窗口抢 page.tsx 热区，本组件先以独立路由
// `/study/sticky-notes` 提供入口；左廊正式入口由收口窗口按注释标记接入。

import { useCallback, useEffect, useMemo, useState } from 'react';

type StickyNoteColor = 'yellow' | 'green' | 'blue' | 'pink' | 'gray';

type StickyNoteItem = {
  id: string;
  project: string;
  charKey: string;
  title: string;
  content: string;
  color: StickyNoteColor;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

type StickyNoteListRow = {
  id: string;
  project: string;
  charKey: string;
  title: string;
  preview: string;
  color: StickyNoteColor;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

const COLORS: { key: StickyNoteColor; label: string; bg: string; line: string; ink: string }[] = [
  { key: 'yellow', label: '黄', bg: 'var(--paper)', line: 'var(--paper-line)', ink: 'var(--paper-ink)' },
  { key: 'green', label: '绿', bg: '#eef7e6', line: '#cfe6bd', ink: '#3f5c33' },
  { key: 'blue', label: '蓝', bg: '#eaf4fb', line: '#c3dfef', ink: '#2e5470' },
  { key: 'pink', label: '粉', bg: '#fdeef2', line: '#f0ccd6', ink: '#7c4454' },
  { key: 'gray', label: '灰', bg: 'var(--scale-0)', line: 'var(--line-soft)', ink: 'var(--ink2)' },
];

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--line-soft)',
  borderRadius: 22,
  boxShadow: '0 6px 18px var(--card-shadow)',
};
const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13.5,
  color: 'var(--ink2)',
  background: 'var(--card-bg)',
  border: '1px solid var(--line-soft)',
  padding: '7px 14px',
  borderRadius: 30,
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
  width: '100%',
  boxSizing: 'border-box',
};

function todayLabel(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

export default function StickyNotesRoom({ base, envOk, onGoBack }: { base: string; envOk: boolean; onGoBack?: () => void }) {
  const [notes, setNotes] = useState<StickyNoteListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterCharKey, setFilterCharKey] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    project: '',
    charKey: '',
    title: '',
    content: '',
    color: 'yellow' as StickyNoteColor,
    pinned: false,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  const load = useCallback(async () => {
    if (!envOk) {
      setError('环境变量没配好');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (filterProject.trim()) qs.set('project', filterProject.trim());
      if (filterCharKey.trim()) qs.set('char_key', filterCharKey.trim());
      const res = await fetch(`${base}/api/oc/sticky-notes?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json().catch(() => null);
      if (!d || d.success === false) throw new Error(d?.error || '后端报错');
      setNotes(Array.isArray(d.notes) ? d.notes : []);
    } catch (e: any) {
      setError(e.message || '便签拉不出来');
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [base, envOk, filterProject, filterCharKey]);

  useEffect(() => { load(); }, [load, reloadNonce]);

  const projectOptions = useMemo(() => Array.from(new Set(notes.map((n) => n.project).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh')), [notes]);
  const charKeyOptions = useMemo(() => Array.from(new Set(notes.map((n) => n.charKey).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh')), [notes]);

  function startCreate() {
    setEditingId(null);
    setForm({ project: filterProject.trim(), charKey: filterCharKey.trim(), title: '', content: '', color: 'yellow', pinned: false });
    setSaveError('');
  }

  function startEdit(row: StickyNoteListRow) {
    setEditingId(row.id);
    setForm({
      project: row.project,
      charKey: row.charKey,
      title: row.title,
      content: row.preview, // 先用 preview 占位；全文拉到后若用户还没动手编辑才替换
      color: row.color,
      pinned: row.pinned,
    });
    setSaveError('');
    (async () => {
      try {
        const res = await fetch(`${base}/api/oc/sticky-notes/${row.id}`);
        if (!res.ok) return;
        const d = await res.json().catch(() => null);
        if (d && d.success) {
          setForm((prev) => {
              const untouched = prev.content === row.preview && prev.title === row.title;
              return untouched
                ? { ...prev, content: d.note?.content ?? '', title: d.note?.title ?? prev.title }
                : prev;
            });
        }
      } catch { /* 全文拉取失败时保留 preview 草稿，保存仍可继续 */ }
    })();
  }

  function cancelEdit() {
    setEditingId(null);
    setSaveError('');
  }

  async function save() {
    if (!envOk) { setSaveError('环境变量没配好'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingId ? `${base}/api/oc/sticky-notes/${editingId}` : `${base}/api/oc/sticky-notes`;
      const method = editingId ? 'PUT' : 'POST';
      const body = {
        project: form.project.trim(),
        charKey: form.charKey.trim(),
        title: form.title,
        content: form.content,
        color: form.color,
        pinned: form.pinned,
      };
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json().catch(() => null);
      if (!d || d.success === false) throw new Error(d?.error || '保存失败');
      setEditingId(null);
      setReloadNonce((n) => n + 1);
    } catch (e: any) {
      setSaveError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('确定删除这张便签吗？')) return;
    try {
      const res = await fetch(`${base}/api/oc/sticky-notes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json().catch(() => null);
      if (!d || d.success === false) throw new Error(d?.error || '删除失败');
      setReloadNonce((n) => n + 1);
    } catch (e: any) {
      setError(e.message || '删除失败');
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <button className="serc" onClick={() => (onGoBack ? onGoBack() : (window.location.href = '/study'))} style={pillStyle}> 返回书房</button>
        <span className="serc" style={{ fontSize: 22, color: 'var(--ink-deep)' }}>便签</span>
        <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>轻量便利贴：写、存、读、删、置顶、颜色，项目  角色筛选</span>
        <button className="serc" onClick={startCreate} style={{ ...pillStyle, marginLeft: 'auto', background: 'var(--accent)', color: '#fff', border: '1px solid transparent' }}>
          ＋ 新建便签
        </button>
      </div>

      <div className="card" style={{ ...cardStyle, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={filterProject} onChange={(e) => setFilterProject(e.target.value)} placeholder="筛项目（留空=全部）" style={{ ...inputStyle, maxWidth: 220 }} />
          <input value={filterCharKey} onChange={(e) => setFilterCharKey(e.target.value)} placeholder="筛角色（留空=全部）" style={{ ...inputStyle, maxWidth: 220 }} />
          <button className="serc" onClick={() => setReloadNonce((n) => n + 1)} style={pillStyle}>刷新</button>
          {projectOptions.length > 0 && (
            <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} style={{ ...inputStyle, maxWidth: 200, cursor: 'pointer' }}>
              <option value="">项目：全部</option>
              {projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {charKeyOptions.length > 0 && (
            <select value={filterCharKey} onChange={(e) => setFilterCharKey(e.target.value)} style={{ ...inputStyle, maxWidth: 200, cursor: 'pointer' }}>
              <option value="">角色：全部</option>
              {charKeyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading && <div style={{ fontSize: 13, color: 'var(--ink2)' }}>正在翻便签</div>}
      {!loading && error && <div style={{ fontSize: 13, color: '#c2693f', marginBottom: 12 }}>便签翻车了：{error}</div>}
      {!loading && !error && notes.length === 0 && (
        <div className="card" style={{ ...cardStyle, padding: 28, textAlign: 'center', color: 'var(--ink2)', fontSize: 13.5 }}>
          还没有便签~点右上角「＋ 新建便签」写第一张。
        </div>
      )}

      {!loading && notes.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
          {notes.map((row) => {
            const color = COLORS.find((c) => c.key === row.color) ?? COLORS[COLORS.length - 1];
            return (
              <div key={row.id} className="card" style={{ ...color, border: `1px solid ${color.line}`, borderRadius: 16, padding: '14px 16px', minHeight: 120, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {row.pinned && <span title="已置顶" style={{ fontSize: 12 }}></span>}
                  <span className="serc" style={{ fontSize: 15, fontWeight: 600, color: color.ink, flex: 1 }}>
                    {row.title || '无标题'}
                  </span>
                  <button className="serc" onClick={() => startEdit(row)} title="编辑" style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13, color: color.ink }}></button>
                  <button className="serc" onClick={() => remove(row.id)} title="删除" style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13, color: color.ink }}></button>
                </div>
                <div style={{ fontSize: 12.5, color: color.ink, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}>
                  {row.preview}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink2)' }}>
                  {row.project && <span>{row.project}</span>}
                  {row.project && row.charKey && <span></span>}
                  {row.charKey && <span>{row.charKey}</span>}
                  <span style={{ marginLeft: 'auto' }}>{todayLabel(row.updatedAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(editingId !== null || (notes.length === 0 && !loading && !error)) && (
        <div className="card" style={{ ...cardStyle, padding: '18px 20px', marginTop: 20 }}>
          <div className="serc" style={{ fontSize: 16, color: 'var(--ink-deep)', marginBottom: 12 }}>
            {editingId ? '编辑便签' : '新建便签'}
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 180px' }}>
                <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>项目（可空）</div>
                <input value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} placeholder="留空=不指定项目" style={inputStyle} />
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>角色（可空）</div>
                <input value={form.charKey} onChange={(e) => setForm({ ...form, charKey: e.target.value })} placeholder="留空=通用" style={inputStyle} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>标题（可空）</div>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="给便签起个名字" style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>正文</div>
              <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={5} placeholder="写点什么" style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.7 }} />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--ink2)' }}>颜色</span>
                {COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setForm({ ...form, color: c.key })}
                    style={{
                      width: 28, height: 28, borderRadius: 8, border: form.color === c.key ? '2px solid var(--accent-deep)' : `1px solid ${c.line}`,
                      background: c.bg, cursor: 'pointer', color: c.ink, fontSize: 12,
                    }}
                    title={c.label}
                  >{c.label}</button>
                ))}
              </div>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--ink2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
                置顶
              </label>
            </div>
            {saveError && <div style={{ fontSize: 12.5, color: '#c2693f' }}>保存失败：{saveError}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="serc" onClick={cancelEdit} disabled={saving} style={pillStyle}>取消</button>
              <button className="serc" onClick={save} disabled={saving || !form.content.trim()} style={{ ...pillStyle, background: 'var(--accent)', color: '#fff', border: '1px solid transparent', opacity: saving || !form.content.trim() ? 0.6 : 1 }}>
                {saving ? '保存中' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}