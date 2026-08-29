'use client';

// 日记房门（task-12）：按日期的日记 CRUD + 时间线回看。
// 对接 /api/oc/diary/*；fetch 一律 try/catch，res.ok 和 body.success 都要验（书房家法）。
// 数据形状对齐妹居存档实测：date "2026/6/27"、time "下午3:35:11"、affection、content、
// conversationId/conversationLength（反向递归锚点，联动 task-13/14）。
// 颜色只走 var(--xxx) token，不写死色号。

import { useState, useEffect, useCallback } from 'react';
import { useFloatingTask, FloatingTaskBall } from './useFloatingTask';

type DiaryRow = {
  id: string;
  project: string;
  charKey: string;
  date: string;
  time: string;
  title: string;
  affection: number | null;
  conversationId: string;
  conversationLength: number | null;
  updatedAt: string;
  preview: string;
};
type DiaryFull = DiaryRow & { content: string };
type DateChip = { date: string; count: number };
type FormState = {
  date: string;      // input[type=date] 用的 YYYY-MM-DD
  title: string;
  content: string;
  charKey: string;
  project: string;
  affection: string; // 输入框留空=不填
  conversationId: string;
  conversationLength: string;
};

const emptyForm = (dateInput: string): FormState => ({
  date: dateInput, title: '', content: '', charKey: '', project: '', affection: '', conversationId: '', conversationLength: '',
});

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
  ...inputStyle, minHeight: 280, resize: 'vertical', lineHeight: 1.7,
};

// "2026/6/27" → "2026-06-27"（input[type=date] 用）
function toInputDate(diaryDate: string): string {
  const m = String(diaryDate || '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}
// "2026-06-27" → "2026/6/27"（妹居格式）
function toDiaryDate(inputDate: string): string {
  const m = String(inputDate || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return inputDate;
  return `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
}
function todayInputDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DiaryRoom({ base, envOk, onGoBack }: { base: string; envOk: boolean; onGoBack: () => void }) {
  const [dates, setDates] = useState<DateChip[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => toDiaryDate(todayInputDate()));
  const [entries, setEntries] = useState<DiaryRow[]>([]);
  const [selected, setSelected] = useState<DiaryFull | null>(null); // 查看中的条目（全文）
  const [editing, setEditing] = useState<FormState | null>(null);   // 非空=编辑/新建表单
  const [editingId, setEditingId] = useState<string | null>(null);  // null=新建
  const [loadingDates, setLoadingDates] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // 26C 悬浮球后台化：日记保存/批量共用一颗球，AbortController -> signal -> fetch
  const floating = useFloatingTask('日记生成中');

  const api = useCallback(async (path: string, opts?: RequestInit & { signal?: AbortSignal }): Promise<any> => {
    if (!envOk) throw new Error('环境变量没配好');
    const res = await fetch(`${base}${path}`, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json().catch(() => null);
    if (!d || d.success === false) throw new Error(d?.error || '后端报错');
    return d;
  }, [base, envOk]);

  const loadDates = useCallback(async () => {
    setLoadingDates(true); setError('');
    try {
      const d = await api('/api/oc/diary/dates');
      setDates(Array.isArray(d.dates) ? d.dates : []);
    } catch (e: any) {
      setError(e.message || '日期刻度加载失败');
    } finally {
      setLoadingDates(false);
    }
  }, [api]);

  const loadEntries = useCallback(async (date: string) => {
    if (!date) return;
    setLoadingEntries(true); setError('');
    try {
      const d = await api(`/api/oc/diary?date=${encodeURIComponent(date)}`);
      setEntries(Array.isArray(d.diaries) ? d.diaries : []);
    } catch (e: any) {
      setError(e.message || '日记列表加载失败');
    } finally {
      setLoadingEntries(false);
    }
  }, [api]);

  // 首次挂载：拉日期刻度，并把今天选为默认日期
  useEffect(() => {
    loadDates();
    loadEntries(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshAll(date: string) {
    loadDates();
    loadEntries(date);
  }

  function openDate(date: string) {
    setSelectedDate(date);
    setSelected(null);
    setEditing(null);
    loadEntries(date);
  }

  function openNew() {
    const dateInput = toInputDate(selectedDate) || todayInputDate();
    setEditingId(null);
    setSelected(null);
    setEditing(emptyForm(dateInput));
  }

  async function openView(row: DiaryRow) {
    setEditing(null);
    setSelected(row as DiaryFull); // 先显示列表预览，全文下来后再补
    try {
      const d = await api(`/api/oc/diary/${encodeURIComponent(row.id)}`);
      if (d.diary) setSelected(d.diary);
    } catch (e: any) {
      setError(e.message || '日记加载失败');
    }
  }

  function openEdit(row: DiaryRow) {
    setSelected(null);
    setEditingId(row.id);
    setEditing({
      date: toInputDate(row.date),
      title: row.title,
      content: (row as DiaryFull).content ?? row.preview,
      charKey: row.charKey,
      project: row.project,
      affection: row.affection === null || row.affection === undefined ? '' : String(row.affection),
      conversationId: row.conversationId,
      conversationLength: row.conversationLength === null || row.conversationLength === undefined ? '' : String(row.conversationLength),
    });
  }

  function cancelEdit() {
    setEditing(null);
    setEditingId(null);
  }

  async function saveDiary() {
    if (!editing) return;
    if (!editing.content.trim()) { setError('正文不能为空'); return; }
    const date = toDiaryDate(editing.date) || selectedDate;
    const payload: Record<string, unknown> = {
      date,
      title: editing.title.trim(),
      content: editing.content,
      charKey: editing.charKey.trim(),
      project: editing.project.trim(),
      conversationId: editing.conversationId.trim(),
    };
    const affection = editing.affection.trim();
    payload.affection = affection ? Number(affection) : null;
    const convLen = editing.conversationLength.trim();
    payload.conversationLength = convLen ? Number(convLen) : null;

    const signal = floating.start('保存中', { detail: '日记保存中，后台进行中' });
    setSaving(true); setError('');
    try {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const isNew = editingId === null;
      const d = isNew
        ? await api('/api/oc/diary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal } as any)
        : await api(`/api/oc/diary/${encodeURIComponent(editingId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal } as any);
      if (signal.aborted) { setError('已暂停'); return; }
      setSelectedDate(date);
      setSelected(d.diary);
      setEditing(null);
      setEditingId(null);
      refreshAll(date);
    } catch (e: any) {
      if (e?.name === 'AbortError' || e?.message === 'aborted' || (e as any)?.aborted) {
        setError('已暂停');
      } else {
        setError(e.message || '保存失败');
      }
    } finally {
      setSaving(false);
      floating.dismiss();
    }
  }

  async function removeDiary(id: string) {
    if (!window.confirm('确定删除这篇日记吗？删了就没有了。')) return;
    setError('');
    try {
      await api(`/api/oc/diary/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setSelected(null);
      setEditing(null);
      refreshAll(selectedDate);
    } catch (e: any) {
      setError(e.message || '删除失败');
    }
  }

  const today = toDiaryDate(todayInputDate());
  const showForm = editing !== null;

  return (
    <div style={{ maxWidth: 980 }}>
      {/* ── 顶栏 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <button className="serc" onClick={onGoBack} style={pillStyle}>← 回书架</button>
        <span className="serc" style={{ fontSize: 20, color: 'var(--ink-deep)' }}>日记</span>
        <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>按日期记录、可回看的个人+剧情日记</span>
        {!showForm && (
          <button className="serc" onClick={openNew} style={{ ...btnPrimaryStyle, marginLeft: 'auto', whiteSpace: 'nowrap' }}>＋ 写日记</button>
        )}
      </div>

      {error && (
        <div className="card" style={{ ...cardStyle, padding: '14px 18px', marginBottom: 16, fontSize: 13, color: '#c2693f' }}>{error}</div>
      )}

      {/* ── 日期刻度（时间线：妹居 diary-scale-track 同款） ── */}
        {/* ── 垂直时间线（按时间线划分）· 左侧纵轴 + 右侧概览 ── */}
        <div style={{ ...glassStyle, padding: 0, marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexDirection: 'row', minHeight: 140 }}>
            <div style={{ width: 200, flex: 'none', borderRight: '1px solid var(--line-soft)', background: 'color-mix(in srgb, var(--scale-0) 70%, var(--card-bg))', padding: '16px 10px 16px 0', maxHeight: 360, overflowY: 'auto' }}>
              <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--ink2)', marginBottom: 12, paddingLeft: 18 }}>时间线</div>
              {loadingDates ? (
                <div style={{ fontSize: 12.5, color: 'var(--ink2)', paddingLeft: 18 }}>正在翻历…</div>
              ) : dates.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--ink2)', paddingLeft: 18, lineHeight: 1.6 }}>还没有日记<br />点「＋ 写日记」记下今天</div>
              ) : (
                <div style={{ position: 'relative', paddingLeft: 18 }}>
                  <div style={{ position: 'absolute', left: 5, top: 8, bottom: 8, width: 2, background: 'var(--line-soft)', borderRadius: 1 }} />
                  {dates.map((c) => {
                    const active = selectedDate === c.date;
                    return (
                      <button
                        key={c.date}
                        className="serc"
                        onClick={() => openDate(c.date)}
                        style={{
                          position: 'relative',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          textAlign: 'left',
                          padding: '9px 10px 9px 18px',
                          marginBottom: 4,
                          borderRadius: 12,
                          border: active ? '1px solid var(--accent)' : '1px solid transparent',
                          background: active ? 'var(--card-bg)' : 'transparent',
                          boxShadow: active ? '0 2px 10px var(--card-shadow)' : 'none',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <span style={{
                          position: 'absolute',
                          left: -13,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          border: active ? '3px solid var(--accent)' : '2px solid var(--line-soft)',
                          background: active ? 'var(--accent)' : 'var(--card-bg)',
                          boxShadow: active ? '0 0 0 4px rgba(120,90,255,0.14)' : 'none',
                          flex: 'none',
                        }} />
                        <span style={{ fontSize: 13, color: active ? 'var(--ink-deep)' : 'var(--ink-body)', fontWeight: active ? 600 : 400, flex: '1 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.date}</span>
                        <span style={{ fontSize: 11, color: 'var(--ink2)', background: active ? 'var(--scale-0)' : 'var(--card-bg)', border: '1px solid var(--line-soft)', padding: '2px 7px', borderRadius: 20, flex: 'none' }}>{c.count}篇</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ flex: '1 1 auto', minWidth: 0, padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>已选日期</div>
              <div className="serc" style={{ fontSize: 18, color: 'var(--ink-deep)', marginTop: 4 }}>{selectedDate} {today === selectedDate && <span style={{ fontSize: 12, color: 'var(--accent)', marginLeft: 8, background: 'rgba(120,90,255,0.1)', padding: '2px 8px', borderRadius: 20 }}>今天</span>}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 8 }}>{loadingEntries ? '正在翻日记…' : entries.length === 0 ? '这一天还没有日记，在列表里点“写一篇”' : `共 ${entries.length} 篇 · 纵向时间线展开在下方`}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink2)', marginTop: 10, background: 'var(--scale-0)', borderRadius: 10, padding: '8px 10px', border: '1px dashed var(--line-soft)' }}>提示：左侧按时间线纵向划分日期，选中日期后右侧及下方列表按时间线展开当日条目。</div>
            </div>
          </div>
        </div>
      <div style={{ ...glassStyle, padding: 0, marginBottom: 16, display: 'none' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink2)', flex: 'none' }}>时间线</span>
          {loadingDates ? (
            <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>正在翻历…</span>
          ) : dates.length === 0 ? (
            <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>还没有日记，点「＋ 写日记」记下今天</span>
          ) : (
            dates.map((c) => (
              <button
                key={c.date}
                className="serc"
                onClick={() => openDate(c.date)}
                style={{
                  ...pillStyle, fontSize: 13, whiteSpace: 'nowrap',
                  background: selectedDate === c.date ? 'var(--scale-3)' : 'var(--card-bg)',
                  color: selectedDate === c.date ? 'var(--card-bg)' : 'var(--ink-body)',
                }}
              >
                {c.date}
                <span style={{ fontSize: 11, opacity: 0.85 }}>{c.count}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {showForm ? (
        /* ── 编辑/新建表单 ── */
        <div className="card" style={{ ...cardStyle, padding: '20px 22px' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ flex: '1 1 150px', minWidth: 130 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>日期</div>
              <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ flex: '1 1 200px', minWidth: 180 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>标题（可选）</div>
              <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="如：今天去了琉璃塔…" style={inputStyle} maxLength={200} />
            </div>
            <div style={{ flex: '1 1 140px', minWidth: 120 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>谁的日记（角色，可选）</div>
              <input value={editing.charKey} onChange={(e) => setEditing({ ...editing, charKey: e.target.value })} placeholder="如：Yuki" style={inputStyle} maxLength={100} />
            </div>
            <div style={{ flex: '1 1 140px', minWidth: 120 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>项目（可选）</div>
              <input value={editing.project} onChange={(e) => setEditing({ ...editing, project: e.target.value })} placeholder="如：琉璃塔" style={inputStyle} maxLength={100} />
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>正文</div>
          <textarea
            value={editing.content}
            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
            placeholder={'以【日记】开头的第一人称过程还原叙事：按时间线回放当天的准备→经过→细节→情绪→内心独白，不逐字复述对话。'}
            style={textareaStyle}
            maxLength={200000}
          />

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <div style={{ flex: '1 1 130px', minWidth: 110 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>好感度（0-1000，可选）</div>
              <input type="number" min={0} max={1000} value={editing.affection} onChange={(e) => setEditing({ ...editing, affection: e.target.value })} placeholder="如：760" style={inputStyle} />
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 170 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>对话引用（conversationId，反向递归锚点）</div>
              <input value={editing.conversationId} onChange={(e) => setEditing({ ...editing, conversationId: e.target.value })} placeholder="关联的对话 id（可选）" style={inputStyle} maxLength={200} />
            </div>
            <div style={{ flex: '1 1 130px', minWidth: 110 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>对话条数（可选）</div>
              <input type="number" min={0} value={editing.conversationLength} onChange={(e) => setEditing({ ...editing, conversationLength: e.target.value })} placeholder="如：42" style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <button className="serc" onClick={saveDiary} disabled={saving} style={{ ...btnPrimaryStyle, opacity: saving ? 0.6 : 1 }}>{saving ? '保存中…' : '保存日记'}</button>
            <button className="serc" onClick={cancelEdit} style={pillStyle}>取消</button>
            {editingId && (
              <button className="serc" onClick={() => removeDiary(editingId)} style={{ ...btnDangerStyle, marginLeft: 'auto' }}>删除</button>
            )}
          </div>
        </div>
      ) : selected ? (
        /* ── 查看单篇 ── */
        <div className="card" style={{ ...cardStyle, padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            <span className="serc" style={{ fontSize: 18, color: 'var(--ink-deep)' }}>{selected.title || `日记 · ${selected.date}`}</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
              {selected.date}{selected.time ? ` · ${selected.time}` : ''}
              {selected.charKey ? ` · ${selected.charKey}` : ''}
              {selected.project ? ` · ${selected.project}` : ''}
              {selected.affection !== null && ` · 好感 ${selected.affection}`}
            </span>
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <button className="serc" onClick={() => openEdit(selected)} style={pillStyle}>编辑</button>
              <button className="serc" onClick={() => removeDiary(selected.id)} style={btnDangerStyle}>删除</button>
              <button className="serc" onClick={() => setSelected(null)} style={pillStyle}>收起</button>
            </div>
          </div>
          {selected.conversationId && (
            <div style={{ fontSize: 11.5, color: 'var(--ink2)', marginBottom: 10 }}>
              对话引用：{selected.conversationId}{selected.conversationLength !== null ? `（${selected.conversationLength} 条）` : ''}
            </div>
          )}
          <div style={{ fontSize: 14.5, color: 'var(--ink-body)', whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{selected.content}</div>
        </div>
      ) : (
        /* ── 当日条目列表 · 垂直时间线 ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative', paddingLeft: 22 }}>
            <div style={{ position: 'absolute', left: 5, top: 36, bottom: 12, width: 2, background: 'var(--line-soft)', borderRadius: 1 }} />
          <div className="serc" style={{ fontSize: 15.5, color: 'var(--ink-deep)' }}>
            {selectedDate}
            {today === selectedDate && <span style={{ fontSize: 12, color: 'var(--ink2)', marginLeft: 10 }}>今天</span>}
          </div>
          {loadingEntries ? (
            <div className="card" style={{ ...cardStyle, padding: '18px 22px', fontSize: 13, color: 'var(--ink2)' }}>正在翻日记…</div>
          ) : entries.length === 0 ? (
            <div className="card" style={{ ...cardStyle, padding: '18px 22px', fontSize: 13, color: 'var(--ink2)' }}>
              这一天还没有日记
              <button className="serc" onClick={openNew} style={{ ...btnPrimaryStyle, marginLeft: 12 }}>写一篇</button>
            </div>
          ) : (
            entries.map((row) => (
              <div
                key={row.id}
                onClick={() => openView(row)}
                className="card"
                style={{ ...cardStyle, padding: '15px 18px', cursor: 'pointer', marginTop: 12, position: 'relative' as const }}
              >
                  <div style={{ position: 'absolute', left: -17, top: 22, width: 10, height: 10, borderRadius: '50%', background: 'var(--card-bg)', border: '2.5px solid var(--accent)', boxShadow: '0 0 0 3px rgba(120,90,255,0.12)' }} />
                  <div style={{ position: 'absolute', left: -12, top: 27, width: 14, height: 2, background: 'var(--line-soft)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="serc" style={{ fontSize: 15, color: 'var(--ink-deep)' }}>{row.title || `日记 · ${row.date}`}</span>
                  {row.charKey && <span style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{row.charKey}</span>}
                  {row.affection !== null && <span style={{ fontSize: 11.5, color: 'var(--ink2)' }}>好感 {row.affection}</span>}
                  <span style={{ fontSize: 11.5, color: 'var(--ink2)', marginLeft: 'auto' }}>{row.time || row.updatedAt.slice(0, 10)}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-body)', marginTop: 6, whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.preview}</div>
              </div>
            ))
          )}
        </div>
      )}
      <FloatingTaskBall task={floating.task} onAbort={() => floating.abort()} />
    </div>
  );
}