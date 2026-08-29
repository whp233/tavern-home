'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

type Daily = { date: string; input: number; output: number; cacheRead: number; cacheWrite: number; count: number; hitRate: number };
type Hourly = { hour: string; input: number; output: number; cacheRead: number; cacheWrite: number; count: number; total: number };
type ByChar = { charKey: string; input: number; output: number; count: number; cacheRead: number; hitRate: number };
type ByWindow = { windowId: string; input: number; output: number; count: number; charKey: string; project: string };

const pillStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink2)',
  background: 'var(--card-bg)', border: '1px solid var(--line-soft)', padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
};
const cardStyle: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--line-soft)', borderRadius: 16, boxShadow: '0 4px 12px var(--card-shadow)' };
const glassStyle: React.CSSProperties = { background: 'var(--glass-bg)', border: '1.5px dashed var(--dash-line)', borderRadius: 16, boxShadow: '0 4px 12px var(--card-shadow)' };

// usage-curve-spec 颜色（蓝/绿/橙/紫/红虚）
const C = {
  input: '#2f7be5',
  output: '#2e9e5b',
  cacheWrite: '#e5a13b',
  cacheRead: '#7c5cff',
  count: '#e5484d',
};

export default function TokenUsagePanel({ base, envOk }: { base: string; envOk: boolean }) {
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d');
  const [trendMode, setTrendMode] = useState<'pie' | 'line'>('line');
  const [pieDate, setPieDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<{ total: any; daily: Daily[]; hourly?: Hourly[]; byChar: ByChar[]; byWindow: ByWindow[] } | null>(null);

  const days = range === 'today' ? 1 : range === '7d' ? 7 : 30;

  const load = useCallback(async () => {
    if (!envOk) { setError('环境未就绪'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${base}/api/oc/usage/summary?days=${days}`);
      const d = await res.json().catch(() => null);
      if (!res.ok || !d || d.success === false) throw new Error(d?.error || `HTTP ${res.status}`);
      setData({ total: d.total, daily: d.daily || [], hourly: d.hourly || [], byChar: d.byChar || [], byWindow: d.byWindow || [] });
    } catch (e: any) {
      setError(e.message || '用量拉取失败');
    } finally { setLoading(false); }
  }, [base, envOk, days]);

  useEffect(() => { load(); }, [load]);

  const total = data?.total;
  const daily = data?.daily || [];
  const hourly = data?.hourly || [];

  // 默认饼的日期：选最新一天
  useEffect(() => {
    if (!pieDate && daily.length) setPieDate(daily[daily.length - 1].date);
  }, [daily, pieDate]);

  const pieSource = useMemo(() => {
    const d = daily.find((x) => x.date === pieDate) || daily[daily.length - 1];
    if (!d) return null;
    return d;
  }, [daily, pieDate]);

  const pieData = useMemo(() => {
    if (!pieSource) return [];
    const tot = pieSource.input + pieSource.output + pieSource.cacheRead + pieSource.cacheWrite;
    if (tot === 0) return [];
    return [
      { name: '输入', value: pieSource.input, color: C.input },
      { name: '输出', value: pieSource.output, color: C.output },
      { name: '写入', value: pieSource.cacheWrite, color: C.cacheWrite },
      { name: '命中', value: pieSource.cacheRead, color: C.cacheRead },
    ];
  }, [pieSource]);

  const lineData = useMemo(() => {
    if (range === 'today') {
      // 用 hourly；若空则回落为单日 daily 拆成 1 点
      if (hourly.length) {
        return hourly.map((h) => ({
          label: h.hour.slice(11, 16), // "14:00"
          fullLabel: h.hour,
          input: h.input,
          output: h.output,
          cacheRead: h.cacheRead,
          cacheWrite: h.cacheWrite,
          count: h.count,
          total: h.total,
        }));
      }
      const d = daily[0];
      if (!d) return [];
      return [{ label: d.date.slice(5), fullLabel: d.date, input: d.input, output: d.output, cacheRead: d.cacheRead, cacheWrite: d.cacheWrite, count: d.count, total: d.input + d.output + d.cacheRead + d.cacheWrite }];
    }
    return daily.map((d) => ({
      label: d.date.slice(5),
      fullLabel: d.date,
      input: d.input,
      output: d.output,
      cacheRead: d.cacheRead,
      cacheWrite: d.cacheWrite,
      count: d.count,
      total: d.input + d.output + d.cacheRead + d.cacheWrite,
    }));
  }, [range, daily, hourly]);

  const pieTotal = pieSource ? pieSource.input + pieSource.output + pieSource.cacheRead + pieSource.cacheWrite : 0;

  return (
    <div style={{ ...glassStyle, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="serc" style={{ fontSize: 15, color: 'var(--ink-deep)' }}>Token 消耗</span>
        <span style={{ fontSize: 11.5, color: 'var(--ink2)' }}>最近趋势 · 按角色/对话区分</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {trendMode === 'line' && (
            <>
              <button onClick={() => setRange('today')} style={{ ...pillStyle, background: range === 'today' ? 'var(--scale-3)' : 'var(--card-bg)', color: range === 'today' ? 'var(--card-bg)' : 'var(--ink2)' }}>今日(小时)</button>
              <button onClick={() => setRange('7d')} style={{ ...pillStyle, background: range === '7d' ? 'var(--scale-3)' : 'var(--card-bg)', color: range === '7d' ? 'var(--card-bg)' : 'var(--ink2)' }}>近7天</button>
              <button onClick={() => setRange('30d')} style={{ ...pillStyle, background: range === '30d' ? 'var(--scale-3)' : 'var(--card-bg)', color: range === '30d' ? 'var(--card-bg)' : 'var(--ink2)' }}>近30天</button>
            </>
          )}
          <button onClick={load} style={pillStyle}>刷新</button>
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--ink2)' }}>正在统计用量…</div>
      ) : error ? (
        <div style={{ fontSize: 13, color: '#c2693f' }}>{error}</div>
      ) : !total || total.count === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink2)' }}>暂无用量记录（新库或近{days}天无模型调用）。发一条消息后这里会出现趋势与分维度明细。</div>
      ) : (
        <>
          {/* 汇总卡 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 14 }}>
            <div style={{ ...cardStyle, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--ink2)' }}>总 Tokens</div>
              <div style={{ fontSize: 18, color: 'var(--ink-deep)', fontWeight: 600 }}>{total.totalTokens ?? (total.input + total.output + total.cacheRead + total.cacheWrite)}</div>
              <div style={{ fontSize: 11, color: 'var(--ink2)' }}>{total.count} 次调用 · ok {total.ok}</div>
            </div>
            <div style={{ ...cardStyle, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--ink2)' }}>输入 / 输出</div>
              <div style={{ fontSize: 14, color: 'var(--ink-body)' }}>{total.input} / {total.output}</div>
              <div style={{ fontSize: 11, color: 'var(--ink2)' }}>命中 {total.cacheRead} · 写入 {total.cacheWrite}</div>
            </div>
            <div style={{ ...cardStyle, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--ink2)' }}>命中率</div>
              <div style={{ fontSize: 18, color: 'var(--ink-deep)', fontWeight: 600 }}>{(total.hitRate * 100).toFixed(1)}%</div>
              <div style={{ fontSize: 11, color: 'var(--ink2)' }}>cacheRead / (input+cache)</div>
            </div>
            <div style={{ ...cardStyle, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--ink2)' }}>日均</div>
              <div style={{ fontSize: 14, color: 'var(--ink-body)' }}>{Math.round((total.input + total.output) / Math.max(1, daily.length))} /天</div>
              <div style={{ fontSize: 11, color: 'var(--ink2)' }}>{days}天窗口</div>
            </div>
          </div>

          {/* 趋势：双形态切换 */}
          <div style={{ ...cardStyle, padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-deep)' }}>趋势</div>
              <div style={{ display: 'flex', gap: 6, marginLeft: 6 }}>
                <button onClick={() => setTrendMode('pie')} style={{ ...pillStyle, background: trendMode === 'pie' ? 'var(--scale-3)' : 'var(--card-bg)', color: trendMode === 'pie' ? 'var(--card-bg)' : 'var(--ink2)' }}>饼状(单日占比)</button>
                <button onClick={() => setTrendMode('line')} style={{ ...pillStyle, background: trendMode === 'line' ? 'var(--scale-3)' : 'var(--card-bg)', color: trendMode === 'line' ? 'var(--card-bg)' : 'var(--ink2)' }}>折线趋势</button>
              </div>
              {trendMode === 'pie' && daily.length > 0 && (
                <select value={pieDate} onChange={(e) => setPieDate(e.target.value)} style={{ marginLeft: 'auto', fontSize: 12, padding: '6px 10px', borderRadius: 20, border: '1px solid var(--line-soft)', background: 'var(--card-bg)', color: 'var(--ink-body)' }}>
                  {daily.slice().reverse().map((d) => (
                    <option key={d.date} value={d.date}>{d.date} · {d.input + d.output + d.cacheRead + d.cacheWrite} tok</option>
                  ))}
                </select>
              )}
              {trendMode === 'line' && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink2)' }}>{range === 'today' ? '按小时' : '按日'} · 双 Y 轴</span>}
            </div>

            {trendMode === 'pie' ? (
              pieTotal === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink2)', textAlign: 'center', padding: '30px 0' }}>该日无数据</div>
              ) : (
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <div style={{ width: 260, height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88} innerRadius={36} label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                          {pieData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} stroke="var(--card-bg)" strokeWidth={2} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: any, n: any) => [`${v} tok`, String(n)]} contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid var(--line-soft)' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ minWidth: 180, fontSize: 12, color: 'var(--ink-body)', lineHeight: 1.8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{pieSource?.date} · 总 {pieTotal} tok · {pieSource?.count} 次</div>
                    {pieData.map((p) => (
                      <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color }} />
                        <span style={{ flex: '1 1 auto' }}>{p.name}</span>
                        <span style={{ color: 'var(--ink2)' }}>{p.value} · {(pieTotal ? (p.value / pieTotal * 100).toFixed(1) : '0')}%</span>
                      </div>
                    ))}
                    <div style={{ fontSize: 11, color: 'var(--ink2)', marginTop: 8 }}>命中率 {(pieSource ? (pieSource.hitRate * 100).toFixed(1) : '0')}% · 输入+命中合计占比饼图</div>
                  </div>
                </div>
              )
            ) : lineData.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--ink2)', textAlign: 'center', padding: '30px 0' }}>无数据（所选范围内无调用）</div>
            ) : (
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lineData} margin={{ top: 8, right: 28, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--ink2)' }} axisLine={{ stroke: 'var(--line-soft)' }} tickLine={false} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--ink2)' }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: C.count }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid var(--line-soft)' }} formatter={(v: any, n: any) => {
                      const map: Record<string, string> = { input: '输入', output: '输出', cacheRead: '命中', cacheWrite: '写入', count: '次数' };
                      return [`${String(v)}`, map[String(n)] || String(n)];
                    }} labelFormatter={(l) => String(l)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line yAxisId="left" type="monotone" dataKey="input" name="输入" stroke={C.input} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    <Line yAxisId="left" type="monotone" dataKey="output" name="输出" stroke={C.output} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    <Line yAxisId="left" type="monotone" dataKey="cacheRead" name="命中" stroke={C.cacheRead} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    <Line yAxisId="left" type="monotone" dataKey="cacheWrite" name="写入" stroke={C.cacheWrite} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    <Line yAxisId="right" type="monotone" dataKey="count" name="次数" stroke={C.count} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--ink2)', marginTop: 8, flexWrap: 'wrap' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.input, borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />输入</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.output, borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />输出</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.cacheWrite, borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />写入</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.cacheRead, borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />命中</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.count, borderRadius: 2, verticalAlign: 'middle', marginRight: 4, border: '1px dashed #e5484d' }} />次数(右轴虚线)</span>
            </div>
          </div>

          {/* 分角色 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
            <div style={{ ...cardStyle, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-deep)', marginBottom: 8 }}>按角色</div>
              {data.byChar.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink2)' }}>暂无分角色数据（旧记录无 char_key，新调用会自动带上）</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {data.byChar.map((r) => (
                    <div key={r.charKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--ink-body)', borderBottom: '1px dashed var(--dash-line)', paddingBottom: 6 }}>
                      <span style={{ fontWeight: 600, minWidth: 80 }}>{r.charKey}</span>
                      <span style={{ color: 'var(--ink2)', flex: '1 1 auto', textAlign: 'right' }}>{r.input} in / {r.output} out · {r.count}次 · 命中 {(r.hitRate * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ ...cardStyle, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-deep)', marginBottom: 8 }}>按对话（窗口）</div>
              {data.byWindow.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink2)' }}>暂无分对话数据（旧记录无 window_id，新调用会自动带上）</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {data.byWindow.map((r) => (
                    <div key={r.windowId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--ink-body)', borderBottom: '1px dashed var(--dash-line)', paddingBottom: 6 }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto' }}>{r.windowId.slice(0, 8)} {r.charKey !== '(未区分)' ? `·${r.charKey}` : ''} {r.project ? `·${r.project}` : ''}</span>
                      <span style={{ color: 'var(--ink2)', whiteSpace: 'nowrap' }}>{r.input + r.output} tok · {r.count}次</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 每日明细 */}
          <div style={{ ...cardStyle, padding: '12px 14px', marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-deep)', marginBottom: 8 }}>每日明细</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', color: 'var(--ink-body)' }}>
                <thead>
                  <tr style={{ color: 'var(--ink2)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>日期</th>
                    <th style={{ padding: '6px 8px' }}>输入</th>
                    <th style={{ padding: '6px 8px' }}>输出</th>
                    <th style={{ padding: '6px 8px' }}>命中</th>
                    <th style={{ padding: '6px 8px' }}>写入</th>
                    <th style={{ padding: '6px 8px' }}>命中率</th>
                    <th style={{ padding: '6px 8px' }}>次数</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.slice().reverse().map((d) => (
                    <tr key={d.date} style={{ borderTop: '1px solid var(--line-soft)' }}>
                      <td style={{ padding: '6px 8px' }}>{d.date}</td>
                      <td style={{ padding: '6px 8px' }}>{d.input}</td>
                      <td style={{ padding: '6px 8px' }}>{d.output}</td>
                      <td style={{ padding: '6px 8px' }}>{d.cacheRead}</td>
                      <td style={{ padding: '6px 8px' }}>{d.cacheWrite}</td>
                      <td style={{ padding: '6px 8px' }}>{(d.hitRate * 100).toFixed(1)}%</td>
                      <td style={{ padding: '6px 8px' }}>{d.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
