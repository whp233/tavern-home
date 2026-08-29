'use client';

// TRPG 剧情模式房门（task-21）：列剧本  开始  选动作  GM 叙述/判定  状态机结算。
// 对接 /api/oc/trpg/*；fetch 一律 try/catch，res.ok 和 body.success 都要验（书房家法）。

import { useCallback, useEffect, useState } from 'react';

type TrpgScenarioSummary = {
  id: string;
  name: string;
  info: string;
  difficulty: string;
  estimatedTime: string;
  tags: string[];
};

type TrpgAction = {
  id: string;
  label: string;
  description: string;
  kind?: string;
  difficulty?: number;
  requiresItem?: string;
};

type TrpgGameEvent = {
  type: string;
  message: string;
  data?: Record<string, unknown>;
};

type TrpgState = {
  locationId: string;
  stamina: number;
  time: number;
  coins: number;
  affection: number;
  trust: number;
  flags: Record<string, unknown>;
  items: Record<string, number>;
  phase: 'active' | 'victory' | 'failure' | 'ending';
};

type TrpgSessionView = {
  sessionId: string;
  scenarioId: string;
  state: TrpgState;
  availableActions: TrpgAction[];
  ended: boolean;
};

type TrpgResult = {
  sessionId: string;
  actionId: string;
  narration: string;
  demo: boolean;
  parseWarning?: string;
  dice?: { d20: number; bonus: number; total: number; target: number; success: boolean; critical: string } | null;
  state: TrpgState;
  stateChanges: Record<string, unknown>;
  events: TrpgGameEvent[];
  ending?: { id: string; name: string; description: string } | null;
  rewards?: Record<string, unknown> | null;
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
const inputStyle: React.CSSProperties = {
  fontSize: 13.5, color: 'var(--ink-body)', background: 'var(--card-bg)',
  border: '1px solid var(--line-soft)', borderRadius: 12, padding: '9px 14px',
  fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
};

function eventBadge(type: string): string {
  if (type === 'DICE_CRITICAL_SUCCESS') return '';
  if (type === 'DICE_CRITICAL_FAILURE') return '';
  if (type === 'ENDING_TRIGGERED') return '';
  if (type === 'KEY_EVENT_TRIGGERED') return '';
  if (type === 'LOCATION_CHANGED') return '';
  if (type === 'DICE_SUCCESS') return '';
  if (type === 'DICE_FAILURE') return '';
  return '';
}

export default function TrpgRoom({ base, envOk, onGoBack }: { base: string; envOk: boolean; onGoBack: () => void }) {
  const [scenarios, setScenarios] = useState<TrpgScenarioSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [session, setSession] = useState<TrpgSessionView | null>(null);
  const [result, setResult] = useState<TrpgResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  // 定制：玩家偏好 + 多角色卡
  const [preferences, setPreferences] = useState('');
  const [customProject, setCustomProject] = useState('default');
  const [projectOptions, setProjectOptions] = useState<string[]>(['default']);
  const [charCards, setCharCards] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedChars, setSelectedChars] = useState<string[]>([]);
  const [charsLoading, setCharsLoading] = useState(false);

  const api = useCallback(async (path: string, opts?: RequestInit): Promise<any> => {
    if (!envOk) throw new Error('环境变量没配好');
    const res = await fetch(`${base}${path}`, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json().catch(() => null);
    if (!d || d.success === false) throw new Error(d?.error || '后端报错');
    return d;
  }, [base, envOk]);

  const loadScenarios = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const d = await api('/api/oc/trpg/scenarios');
      setScenarios(Array.isArray(d.scenarios) ? d.scenarios : []);
      if (Array.isArray(d.scenarios) && d.scenarios.length && !selectedId) {
        setSelectedId(d.scenarios[0].id);
      }
    } catch (e: any) {
      setError(e.message || '剧本列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [api, selectedId]);

  // 定制：拉项目列表 + 角色卡
  useEffect(() => {
    if (!envOk) return;
    (async () => {
      try {
        const res = await fetch(`${base}/api/oc/stats`);
        const d = await res.json().catch(() => null);
        if (res.ok && d?.by_project) {
          const opts = Object.keys(d.by_project).filter((p: string) => p.trim()).sort((a: string, b: string) => a.localeCompare(b, 'zh'));
          if (opts.length) { setProjectOptions(opts); if (!opts.includes(customProject)) setCustomProject(opts[0]); }
        }
      } catch {}
    })();
  }, [base, envOk]);

  useEffect(() => {
    if (!envOk || !customProject) return;
    setCharsLoading(true);
    (async () => {
      try {
        const res = await fetch(`${base}/api/oc/desk/lore?${new URLSearchParams({ project: customProject })}`);
        const d = await res.json().catch(() => null);
        if (res.ok && d?.success) {
          const rows: any[] = Array.isArray(d.lore) ? d.lore : [];
          const chars = rows.filter((r) => !!r?.is_char && typeof r?.name === 'string' && r.name).map((r: any) => ({ id: r.id, name: r.name }));
          setCharCards(chars);
          setSelectedChars((prev) => prev.filter((n) => chars.some((c) => c.name === n)));
        } else setCharCards([]);
      } catch { setCharCards([]); }
      finally { setCharsLoading(false); }
    })();
  }, [base, envOk, customProject]);

  useEffect(() => {
    loadScenarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSession(sessionId: string) {
    try {
      const d = await api(`/api/oc/trpg/session/${encodeURIComponent(sessionId)}`);
      setSession(d.session || null);
    } catch (e: any) {
      setError(e.message || '会话加载失败');
    }
  }

  async function startGame() {
    if (!selectedId) { setError('请先选一个剧本'); return; }
    setActing(true); setError(''); setResult(null);
    try {
      const d = await api('/api/oc/trpg/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: selectedId, preferences: preferences.trim() || undefined, charNames: selectedChars.length ? selectedChars : undefined, project: selectedChars.length ? customProject : undefined }),
      });
      setSession(d.session || null);
    } catch (e: any) {
      setError(e.message || '开局失败');
    } finally {
      setActing(false);
    }
  }

  async function doAction(action: TrpgAction) {
    if (!session) return;
    setActing(true); setError('');
    try {
      const d = await api('/api/oc/trpg/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, actionId: action.id }),
      });
      setResult(d.result || null);
      if (d.result?.sessionId) await loadSession(d.result.sessionId);
    } catch (e: any) {
      setError(e.message || '行动失败');
    } finally {
      setActing(false);
    }
  }

  async function settle() {
    if (!session) return;
    setActing(true); setError('');
    try {
      const d = await api('/api/oc/trpg/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      setResult((prev) => prev ? {
        ...prev,
        narration: d.settlement?.message || prev.narration,
        events: [...(prev?.events || []), { type: 'ENDING_TRIGGERED', message: d.settlement?.message || '已结算' }],
      } : prev);
    } catch (e: any) {
      setError(e.message || '结算失败');
    } finally {
      setActing(false);
    }
  }

  function resetGame() {
    setSession(null);
    setResult(null);
    setError('');
  }

  const selected = scenarios.find((s) => s.id === selectedId) || null;

  return (
    <div style={{ maxWidth: 1080 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <button className="serc" onClick={onGoBack} style={pillStyle}> 回书架</button>
        <span className="serc" style={{ fontSize: 20, color: 'var(--ink-deep)' }}>TRPG 剧情模式</span>
        <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>GM 双 prompt + D20 判定 + 程序状态机（task-21）</span>
        {session && (
          <button className="serc" onClick={resetGame} style={{ ...pillStyle, marginLeft: 'auto' }}>重新开始</button>
        )}
      </div>

      {error && (
        <div className="card" style={{ ...cardStyle, padding: '14px 18px', marginBottom: 16, fontSize: 13, color: '#c2693f' }}>{error}</div>
      )}

      {!session && (
        <div className="card" style={{ ...cardStyle, padding: '20px 22px', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-deep)', marginBottom: 10 }}>选择剧本</div>
          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--ink2)' }}>正在加载剧本</div>
          ) : scenarios.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink2)' }}>还没有内置剧本。</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
                {scenarios.map((s) => (
                  <button
                    key={s.id}
                    className="serc"
                    onClick={() => setSelectedId(s.id)}
                    style={{
                      ...pillStyle,
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      textAlign: 'left',
                      padding: '14px 16px',
                      height: 'auto',
                      whiteSpace: 'normal',
                      background: selectedId === s.id ? 'var(--scale-3)' : 'var(--card-bg)',
                      color: selectedId === s.id ? 'var(--card-bg)' : 'var(--ink-body)',
                    }}
                  >
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{s.name}</span>
                    <span style={{ fontSize: 11.5, opacity: 0.9, marginTop: 4 }}>{s.info}</span>
                    <span style={{ fontSize: 11.5, opacity: 0.8, marginTop: 6 }}>
                      {s.difficulty}  {s.estimatedTime}  {s.tags.join(' / ')}
                    </span>
                  </button>
                ))}
              </div>
              {/* ── 定制：玩家偏好 + 多角色卡 ── */}
              <div style={{ ...glassStyle, padding: '14px 16px', marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-deep)', marginBottom: 8 }}>定制生成（可选）</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink2)', marginBottom: 8 }}>偏好会在模型生成时注入 GM 叙述；角色卡勾选后 GM 会按该角色的性格/口吻/关系做定制，允许多选。</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div style={{ flex: '1 1 160px', minWidth: 140 }}>
                    <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>归属项目</div>
                    <select value={customProject} onChange={(e) => setCustomProject(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                      {projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: '1 1 260px', minWidth: 220 }}>
                    <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>玩家偏好（自定义）</div>
                    <input value={preferences} onChange={(e) => setPreferences(e.target.value)} placeholder="如：偏悬疑/轻喜剧、节奏慢、重视对话与心理描写" style={inputStyle} maxLength={800} />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 6 }}>为哪些角色卡定制（多选，留空=通用）</div>
                {charsLoading ? (
                  <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>正在翻角色卡…</div>
                ) : charCards.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>该项目还没有角色卡（is_char），可先去书架/抽屉建世界书并勾“作为角色卡”。</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                    {charCards.map((c) => {
                      const checked = selectedChars.includes(c.name);
                      return (
                        <button key={c.id} onClick={() => setSelectedChars((prev) => checked ? prev.filter((x) => x !== c.name) : [...prev, c.name])} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: '14px 16px', borderRadius: 16, border: checked ? '2px solid var(--accent)' : '1px solid var(--line-soft)', background: checked ? 'rgba(120,90,255,0.08)' : 'var(--card-bg)', cursor: 'pointer', fontSize: 13, color: 'var(--ink-body)', boxShadow: checked ? '0 4px 14px var(--card-shadow)' : '0 2px 8px var(--card-shadow)', textAlign: 'left', transition: 'all 0.16s' }}>
                          <span style={{ fontSize: 15, fontWeight: 600, color: checked ? 'var(--accent)' : 'var(--ink-deep)' }}>{c.name}</span>
                            <span style={{ fontSize: 11.5, color: checked ? 'var(--accent)' : 'var(--ink2)' }}>{checked ? '✓ 已选择 · 再点取消' : '点一下选择'}</span>
                         
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedChars.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--ink2)', marginTop: 6 }}>已选 {selectedChars.length} 位：{selectedChars.join('、')} 将在开局及后续每步 GM 生成中作为参考。</div>}
              </div>
              <button className="serc" onClick={startGame} disabled={acting || !selectedId} style={{ ...btnPrimaryStyle, marginTop: 16, opacity: acting || !selectedId ? 0.6 : 1 }}>
                {acting ? '开局中' : `开始「${selected?.name || '未选'}」${selectedChars.length ? ` · 为 ${selectedChars.join('、')} 定制` : ''}`}
              </button>
            </>
          )}
        </div>
      )}

      {session && (
        <>
          {/*  状态面板  */}
          <div className="card" style={{ ...cardStyle, padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="serc" style={{ fontSize: 15, color: 'var(--ink-deep)' }}>{selected?.name || 'TRPG'}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>地点：{session.state.locationId}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>体力：{session.state.stamina}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>时间：{session.state.time}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>金币：{session.state.coins}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>好感：{session.state.affection}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>信任：{session.state.trust}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 8 }}>
              道具：{Object.keys(session.state.items).length ? Object.entries(session.state.items).map(([k, v]) => `${k}${v}`).join('、') : '无'}
            </div>
          </div>

          {/*  旁白区  */}
          <div className="card" style={{ ...cardStyle, padding: '20px 22px', marginBottom: 16, whiteSpace: 'pre-wrap', lineHeight: 1.8, fontSize: 14.5, color: 'var(--ink-body)' }}>
            {result?.narration || selected?.info || '（等待行动）'}
            {result?.demo && <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink2)' }}>演示模式：未接入模型供应商，使用预设推进。</div>}
            {result?.parseWarning && <div style={{ marginTop: 10, fontSize: 11.5, color: '#c2693f' }}>{result.parseWarning}</div>}
          </div>

          {/*  骰子结果  */}
          {result?.dice && (
            <div className="card" style={{ ...glassStyle, padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 24 }}></span>
              <span className="mono" style={{ fontSize: 15, color: 'var(--ink-deep)' }}>
                {result.dice.d20} + {result.dice.bonus} = {result.dice.total} vs DC {result.dice.target}
              </span>
              <span
                className="serc"
                style={{
                  fontSize: 12.5, padding: '4px 12px', borderRadius: 20,
                  background: result.dice.success ? 'rgba(46,160,67,0.14)' : 'rgba(194,105,63,0.14)',
                  color: result.dice.success ? '#2ea043' : '#c2693f',
                }}
              >
                {result.dice.success ? (result.dice.critical === 'success' ? '大成功！' : '成功') : (result.dice.critical === 'failure' ? '大失败' : '失败')}
              </span>
            </div>
          )}

          {/*  演出事件（轻量演出槽位）  */}
          {result && result.events.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {result.events.map((ev, i) => (
                <div
                  key={`${ev.type}-${i}`}
                  className="card"
                  style={{
                    ...glassStyle,
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: 'var(--ink-body)',
                    background: ev.type === 'DICE_CRITICAL_SUCCESS' || ev.type === 'ENDING_TRIGGERED' ? 'rgba(46,160,67,0.08)' : 'var(--card-bg)',
                  }}
                >
                  <span>{eventBadge(ev.type)}</span>
                  <span>{ev.message}</span>
                </div>
              ))}
            </div>
          )}

          {/*  行动按钮 / 结局结算  */}
          {session.state.phase === 'active' ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {session.availableActions.map((a) => (
                <button
                  key={a.id}
                  className="serc"
                  onClick={() => doAction(a)}
                  disabled={acting}
                  title={a.description}
                  style={{
                    ...pillStyle,
                    padding: '10px 18px',
                    background: acting ? 'var(--scale-0)' : 'var(--card-bg)',
                    color: 'var(--ink-body)',
                    border: '1px solid var(--line-soft)',
                    opacity: acting ? 0.6 : 1,
                  }}
                >
                  {a.label}
                  {a.difficulty ? `（DC ${a.difficulty}）` : ''}
                </button>
              ))}
            </div>
          ) : (
            <div className="card" style={{ ...cardStyle, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-deep)' }}>
                {result?.ending ? `结局：${result.ending.name}` : '本局结束'}
              </span>
              <span style={{ fontSize: 13, color: 'var(--ink2)', flex: '1 1 240px' }}>
                {result?.ending?.description || '结算完成，可以重新开始。'}
              </span>
              <button className="serc" onClick={settle} disabled={acting} style={{ ...btnPrimaryStyle, opacity: acting ? 0.6 : 1 }}>
                {acting ? '结算中' : '结算'}
              </button>
              <button className="serc" onClick={resetGame} style={pillStyle}>重新开始</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}