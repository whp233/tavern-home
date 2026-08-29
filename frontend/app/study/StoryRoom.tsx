'use client';

// 剧情CG模式（对齐妹居“大纲+开头→沉浸体验+CG”）： outline / start / continue / session / list
// 入口：左廊“剧情”。模型生成大纲+开头后进入沉浸体验，CG 按 sceneKey/condition 自动弹。

import { useCallback, useEffect, useState } from 'react';
import PlotOutlineLauncher from './PlotOutlineLauncher';
import { useFloatingTask, FloatingTaskBall } from './useFloatingTask';

type Outline = { title: string; premise: string; tone?: string; acts: Array<{ act: number; title: string; summary: string; beats?: string[] }>; tags?: string[] };
type Opening = { narration: string; initialState: Record<string, unknown>; suggestedChoices?: string[]; cgEvent?: { sceneKey?: string; condition?: string } };
type StorySession = { id: string; project: string; title: string; outline: Outline; opening: Opening; state: any; history: Array<{ role: string; content: string; at: string }>; createdAt: string; updatedAt: string };

const cardStyle: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--line-soft)', borderRadius: 22, boxShadow: '0 6px 18px var(--card-shadow)', padding: '20px 24px' };
const btnPrimary: React.CSSProperties = { fontSize: 13, color: 'var(--card-bg)', background: 'var(--accent)', border: 'none', padding: '9px 16px', borderRadius: 18, cursor: 'pointer', fontFamily: 'inherit' };
const btnGhost: React.CSSProperties = { fontSize: 13, color: 'var(--ink-body)', background: 'transparent', border: '1px solid var(--line-soft)', padding: '8px 14px', borderRadius: 18, cursor: 'pointer', fontFamily: 'inherit' };
const inputStyle: React.CSSProperties = { fontSize: 13.5, color: 'var(--ink-body)', background: 'var(--card-bg)', border: '1px solid var(--line-soft)', borderRadius: 12, padding: '9px 14px', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' as const };

export default function StoryRoom({ base, envOk, onGoBack, onEnterDesk }: { base: string; envOk: boolean; onGoBack: () => void; onEnterDesk?: (project: string, windowId: string) => void }) {
  const [premise, setPremise] = useState('');
  const [project, setProject] = useState('default');
  const [projectOptions, setProjectOptions] = useState<string[]>(['default']);
  const [charCards, setCharCards] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedChars, setSelectedChars] = useState<string[]>([]);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [session, setSession] = useState<StorySession | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<string[]>([]);
  const [cgHint, setCgHint] = useState('');
  const [list, setList] = useState<StorySession[]>([]);
  // 26C 悬浮球：剧情大纲/开场后台化可终止
  const floating = useFloatingTask('剧情生成中');

  // 项目下拉：取书架统计权威源
  useEffect(() => {
    if (!envOk) return;
    (async () => {
      try {
        const res = await fetch(`${base}/api/oc/stats`);
        const d = await res.json().catch(() => null);
        if (res.ok && d && d.by_project) {
          const opts = Object.keys(d.by_project).filter((p: string) => p.trim()).sort((a: string, b: string) => a.localeCompare(b, 'zh'));
          if (opts.length) { setProjectOptions(opts); if (!opts.includes(project)) setProject(opts[0]); }
        }
      } catch {}
    })();
  }, [base, envOk]);

  // 角色卡：按项目拉 is_char 的 lore
  useEffect(() => {
    if (!envOk || !project) return;
    (async () => {
      try {
        const res = await fetch(`${base}/api/oc/desk/lore?${new URLSearchParams({ project })}`);
        const d = await res.json().catch(() => null);
        if (res.ok && d && d.success) {
          const rows: any[] = Array.isArray(d.lore) ? d.lore : [];
          const chars = rows.filter((r) => !!r?.is_char && typeof r?.name === 'string' && r.name).map((r) => ({ id: r.id, name: r.name }));
          setCharCards(chars);
          setSelectedChars((prev) => prev.filter((n) => chars.some((c) => c.name === n)));
        } else setCharCards([]);
      } catch { setCharCards([]); }
    })();
  }, [base, envOk, project]);

  const loadList = useCallback(async () => {
    if (!envOk) return;
    try {
      const res = await fetch(`${base}/api/oc/story/list?project=${encodeURIComponent(project)}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) setList(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {}
  }, [base, envOk, project]);

  useEffect(() => { void loadList(); }, [loadList]);

  async function genOutline() {
    if (!envOk) { setError('环境未就绪'); return; }
    const signal = floating.start('大纲生成中', { detail: '剧情大纲后台生成中' });
    setBusy(true); setError('');
    try {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const res = await fetch(`${base}/api/oc/story/outline`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ premise: premise || undefined, project, seedHint: premise }), signal });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || '生成大纲失败');
      if (signal.aborted) { setError('已暂停'); return; }
      setOutline(data.outline);
      setCgHint(data.demo ? '（演示大纲：未配置模型时本地生成）' : '');
    } catch (e: any) {
      if (e?.name === 'AbortError' || e?.message === 'aborted') { setError('已暂停'); return; }
      setError(e?.message || '生成大纲失败');
    } finally { setBusy(false); floating.dismiss(); }
  }

  async function startStory() {
    if (!outline) return;
    const signal = floating.start('开场生成中', { detail: '剧情开场后台生成中' });
    setBusy(true); setError('');
    try {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const res = await fetch(`${base}/api/oc/story/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outline, project, charKey: selectedChars[0] || '' }), signal });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || '开场失败');
      setSession(data.session);
      setChoices(data.session?.opening?.suggestedChoices || []);
      setCgHint(data.demo ? '（演示开场：未配置模型）' : (data.session?.opening?.cgEvent ? `CG 场景：${data.session.opening.cgEvent.sceneKey || '—'}` : ''));
      void loadList();
      // 自动开新窗进打字桌（等同用户点“进入剧情”）
      if (onEnterDesk) {
        try {
          // 取一个可用配方（全桌通用）
          const recRes = await fetch(`${base}/api/oc/desk/recipes`);
          const rd = await recRes.json().catch(() => null);
          const recipes: any[] = rd && rd.success ? (rd.recipes || []) : [];
          const recipeId = recipes[0]?.id;
          if (!recipeId) throw new Error('还没有可用配方，请先在打字桌/抽屉里导入或新建一个预设配方');
          const title = outline.title || data.session?.title || '剧情';
          const winRes = await fetch(`${base}/api/oc/desk/windows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, recipe_id: recipeId, title, char_key: selectedChars[0] || '' }) });
          const wd = await winRes.json().catch(() => null);
          if (!winRes.ok || !wd || wd.success !== true) throw new Error(wd?.error || '开新窗失败');
          try {
            await fetch(`${base}/api/oc/desk/windows/${wd.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vars: { storySessionId: data.session.id, storyOutline: outline, storyOpening: data.session.opening, selectedChars } }) });
          } catch {}
          // 把开头旁白落成首楼，进桌即可见
          try {
            await fetch(`${base}/api/oc/story/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ windowId: wd.id, sessionId: data.session.id }) });
          } catch {}
          onEnterDesk(project, wd.id);
        } catch (e: any) {
          setError(`剧情已生成但自动进桌失败：${e?.message || e}`);
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || e?.message === 'aborted') { setError('已暂停'); return; }
      setError(e?.message || '开场失败');
    } finally { setBusy(false); floating.dismiss(); }
  }

  async function doContinue(text?: string) {
    if (!session) return;
    const content = (text ?? input).trim();
    if (!content) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`${base}/api/oc/story/continue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, input: content }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || '续写失败');
      // 更新本地会话：追加历史
      setSession((prev) => prev ? { ...prev, history: data.history || [...prev.history, { role: 'user', content, at: new Date().toISOString() }, { role: 'assistant', content: data.narration, at: new Date().toISOString() }], state: data.state || prev.state, updatedAt: new Date().toISOString() } : prev);
      setChoices(Array.isArray(data.delta?.choices) ? data.delta.choices : Array.isArray(data.choices) ? data.choices : []);
      setCgHint(data.cgShould ? `✨ CG 触发：${data.delta?.cgEvent?.sceneKey || data.state?.sceneKey || ''} ${data.demo ? '（演示）' : ''}` : '');
      setInput('');
    } catch (e: any) { setError(e?.message || '续写失败'); } finally { setBusy(false); }
  }

  async function openSession(id: string) {
    setError('');
    try {
      const res = await fetch(`${base}/api/oc/story/session/${id}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || '加载失败');
      setSession(data.session);
      setOutline(data.session.outline || null);
      setChoices([]);
      setCgHint('');
    } catch (e: any) { setError(e?.message || '加载失败'); }
  }

  async function deleteSession(id: string) {
    if (!window.confirm('确定删除该历史会话/绘画？删了就没有了。')) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`${base}/api/oc/story/session/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || '删除失败');
      if (session?.id === id) { setSession(null); setOutline(null); setChoices([]); setCgHint(''); }
      await loadList();
    } catch (e: any) { setError(e?.message || '删除失败'); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 980 }}>
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px' }}>
          <div className="serc" style={{ fontSize: 18, color: 'var(--ink-deep)', marginBottom: 6 }}>剧情CG模式</div>
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>按妹居“大纲+开头→沉浸体验+CG解锁”复刻：先让模型出大纲与开头，再进剧情自由续写，CG 按场景/条件自动弹。</div>
        </div>
        <button onClick={onGoBack} style={btnGhost}>← 返回书架</button>
      </div>

      {!session && (
        <div style={cardStyle}>
          <div className="serc" style={{ fontSize: 14, color: 'var(--ink-deep)', marginBottom: 10 }}>① 选择项目</div>
          <select value={project} onChange={(e) => setProject(e.target.value)} style={{ ...inputStyle, maxWidth: 360, marginBottom: 12 }}>
            {projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="serc" style={{ fontSize: 14, color: 'var(--ink-deep)', marginBottom: 8 }}>② 选择调用哪些角色卡</div>
          {charCards.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 10 }}>该项目下还没有角色卡（is_char），可先去书架/抽屉里建 world 条目并勾“作为角色卡”</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
              {charCards.map((c) => {
                const checked = selectedChars.includes(c.name);
                return (
                  <button key={c.id} onClick={() => setSelectedChars((prev) => checked ? prev.filter((x) => x !== c.name) : [...prev, c.name])} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: '14px 16px', borderRadius: 16, border: checked ? '2px solid var(--accent)' : '1px solid var(--line-soft)', background: checked ? 'rgba(120,90,255,0.08)' : 'var(--card-bg)', cursor: 'pointer', textAlign: 'left', boxShadow: checked ? '0 4px 14px var(--card-shadow)' : '0 2px 8px var(--card-shadow)', transition: 'all 0.16s', fontSize: 13, color: 'var(--ink-body)' }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: checked ? 'var(--accent)' : 'var(--ink-deep)' }}>{c.name}</span>
                      <span style={{ fontSize: 11.5, color: checked ? 'var(--accent)' : 'var(--ink2)' }}>{checked ? '✓ 已选择 · 再点取消' : '点一下选择'}</span>
                   
                  </button>
                );
              })}
            </div>
          )}
          <div className="serc" style={{ fontSize: 14, color: 'var(--ink-deep)', marginBottom: 8 }}>③ 给个种子（留空也行，模型会编）</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <textarea value={premise} onChange={(e) => setPremise(e.target.value)} placeholder="想演什么？如：雨夜书店重逢 / 校园天台的秘密（可多行，自动换行）" rows={3} style={{ ...inputStyle, flex: '1 1 100%', minHeight: 88, resize: 'vertical', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button disabled={busy} onClick={genOutline} style={btnPrimary}>{busy ? '生成中…' : '生成大纲'}</button>
            {outline && <button disabled={busy} onClick={startStory} style={btnGhost}>用此大纲开场</button>}
            {cgHint && <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{cgHint}</span>}
          </div>
          {outline && (
            <div style={{ marginTop: 14, padding: 12, borderRadius: 14, background: 'var(--scale-0)' }}>
              <div style={{ fontSize: 15, color: 'var(--ink-deep)' }}>{outline.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 4 }}>{outline.premise}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {outline.acts.map((a) => (
                  <div key={a.act} style={{ fontSize: 13, color: 'var(--ink-body)' }}><span style={{ fontWeight: 600 }}>第{a.act}幕 {a.title}</span> — {a.summary}</div>
                ))}
              </div>
            </div>
          )}
          {/* 26A 双分支一键开窗（空种子= B 分支续大纲） */}
          <div style={{ marginTop: 14 }}>
            <PlotOutlineLauncher base={base} envOk={envOk} project={project} charKey={selectedChars[0] || ''} onCreated={(windowId) => { if (onEnterDesk) onEnterDesk(project, windowId); }} />
          </div>

          {list.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 6 }}>历史会话/绘画（{project}）· 可清理</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {list.map((s) => (
                  <div key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button onClick={() => openSession(s.id)} style={{ ...btnGhost, textAlign: 'left', flex: '1 1 auto' }}>{s.title || s.id} · {s.state?.sceneKey || ''} · {s.history?.length || 0} 轮</button>
                    <button onClick={() => deleteSession(s.id)} disabled={busy} title="删除该历史绘画/会话" style={{ ...btnGhost, color: '#c2693f', borderColor: '#e8b4a0', flex: 'none', opacity: busy ? 0.5 : 1 }}>删</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {session && (
        <>
          <div style={cardStyle}>
            <div className="serc" style={{ fontSize: 14, color: 'var(--ink-deep)' }}>{session.title} <span style={{ fontSize: 11, color: 'var(--ink2)' }}>#{session.state?.chapter || 1} · {session.state?.sceneKey || ''}</span></div>
            {cgHint && <div style={{ fontSize: 12, color: '#b35a2a', marginTop: 6 }}>{cgHint}（CG 条件由 custom_cg 表 + sceneKey/condition 判定，见 CG 房）</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, maxHeight: 420, overflowY: 'auto' }}>
              {session.history.map((h, i) => (
                <div key={i} style={{ padding: '10px 12px', borderRadius: 14, background: h.role === 'user' ? 'var(--card-bg)' : 'var(--scale-0)', border: h.role === 'user' ? '1px solid var(--line-soft)' : 'none' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink2)', marginBottom: 4 }}>{h.role === 'user' ? '你' : '旁白'} · {h.at ? new Date(h.at).toLocaleTimeString() : ''}</div>
                  <div style={{ fontSize: 13.5, color: 'var(--ink-body)', whiteSpace: 'pre-wrap' }}>{h.content}</div>
                </div>
              ))}
            </div>
            {choices.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {choices.map((c) => (
                  <button key={c} disabled={busy} onClick={() => doContinue(c)} style={btnGhost}>{c}</button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doContinue(); }} placeholder="输入你的行动/对话，回车发送…" style={inputStyle} />
              <button disabled={busy || !input.trim()} onClick={() => doContinue()} style={btnPrimary}>{busy ? '续写中…' : '发送'}</button>
              <button onClick={() => { setSession(null); setOutline(null); setChoices([]); setCgHint(''); void loadList(); }} style={btnGhost}>新开一局</button>
            </div>
          </div>
        </>
      )}

      {error && <div style={{ ...cardStyle, color: '#c2693f', fontSize: 13 }}>出错了：{error}</div>}
      <FloatingTaskBall task={floating.task} onAbort={() => floating.abort()} />
    </div>
  );
}
