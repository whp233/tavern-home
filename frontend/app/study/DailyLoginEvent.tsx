'use client';

// 每日登录事件（task-17）：「每天登录弹一次」剧情/提醒的外观组件。
// 原理：进书房（本组件挂载=页面加载）向后端 claim 一次——后端比对上次触发日期（oc_state 落库），
// 同日不重复、跨日重置；命中则弹窗展示预设剧情。可配置：开关（enabled）/ 哪天（triggerDate，
// 留空=每天首次都弹）/ 剧情标题与正文。后端契约见 docs/daily-login-trigger.md：
//   GET  /api/oc/desk/daily-login          （拉当前配置与状态）
//   POST /api/oc/desk/daily-login/claim    （登录/启动钩子：判定+标记今日，返回是否触发）
//   PUT  /api/oc/desk/daily-login/config   （保存开关/日期/内容）
//   POST /api/oc/desk/daily-login/reset    （清空状态：管理/测试用）
// 颜色只走 var(--xxx) token、样式类沿用书房现有写法；fetch 一律 try/catch + res.ok/body.success 双验。

import { useEffect, useRef, useState } from 'react';

type DailyLoginCfg = { enabled: boolean; title: string; content: string; triggerDate: string };

/** 本地日期键 YYYY-MM-DD：跨日重置按用户当地日期算，不随后端时区漂移。 */
function localToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const fieldStyle: React.CSSProperties = {
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

export default function DailyLoginEvent({ base, envOk }: { base: string; envOk: boolean }) {
  const claimedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [setting, setSetting] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventContent, setEventContent] = useState('');
  const [cfg, setCfg] = useState<DailyLoginCfg>({ enabled: true, title: '每日问候', content: '', triggerDate: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // 登录钩子：挂载时 claim 一次（同日只判定一次；后端记日期，同页反复挂载不会重复弹）。
  useEffect(() => {
    if (!envOk || claimedRef.current) return;
    claimedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`${base}/api/oc/desk/daily-login/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ today: localToday() }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json().catch(() => null);
        if (!d || d.success === false) throw new Error(d?.error || '后端报错');
        if (d.triggered) {
          setEventTitle(d.event?.title || '');
          setEventContent(d.event?.content || '');
          setOpen(true);
        }
      } catch {
        // 每日提醒打不响不打扰用户：静默失败，下次进书房再试。
      }
    })();
  }, [base, envOk]);

  async function loadCfg() {
    setBusy(true); setError(''); setInfo('');
    try {
      const res = await fetch(`${base}/api/oc/desk/daily-login`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json().catch(() => null);
      if (!d || d.success === false) throw new Error(d?.error || '后端报错');
      if (d.config) setCfg({
        enabled: d.config.enabled !== false,
        title: typeof d.config.title === 'string' ? d.config.title : '',
        content: typeof d.config.content === 'string' ? d.config.content : '',
        triggerDate: typeof d.config.triggerDate === 'string' ? d.config.triggerDate : '',
      });
    } catch (e: any) {
      setError(e.message || '配置拉不出来');
    } finally {
      setBusy(false);
    }
  }

  function openSettings() {
    setSetting(true); setError(''); setInfo('');
    loadCfg();
  }

  async function saveCfg() {
    setBusy(true); setError(''); setInfo('');
    try {
      const res = await fetch(`${base}/api/oc/desk/daily-login/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json().catch(() => null);
      if (!d || d.success === false) throw new Error(d?.error || '后端报错');
      setInfo('已保存，明天首次进书房生效（今天不重复弹）');
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function resetToday() {
    setBusy(true); setError(''); setInfo('');
    try {
      const res = await fetch(`${base}/api/oc/desk/daily-login/reset`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json().catch(() => null);
      if (!d || d.success === false) throw new Error(d?.error || '后端报错');
      setInfo('已重置今日状态，刷新页面即可重新验证「每日首次弹一次」');
    } catch (e: any) {
      setError(e.message || '重置失败');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6 box-border max-[760px]:px-2.5" onClick={() => { if (!busy) setOpen(false); }}>
      <div className="absolute inset-0" style={{ background: 'rgba(50,55,40,0.4)', backdropFilter: 'blur(2px)' }} />
      <div
        className="relative w-full flex flex-col overflow-hidden"
        style={{ maxWidth: 520, maxHeight: '84vh', background: 'var(--card-bg)', borderRadius: 22, boxShadow: '0 20px 50px var(--card-shadow2)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex-none flex items-center justify-between" style={{ padding: '20px 24px 14px' }}>
          <span className="serc" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-deep)' }}>
            {setting ? '每日剧情设置' : (eventTitle || '每日问候')}
          </span>
          <button
            onClick={() => setOpen(false)}
            className="serc leading-none cursor-pointer hover:opacity-70"
            style={{ fontSize: 13, color: 'var(--ink2)', background: 'none', border: 'none' }}
          >
            关闭
          </button>
        </div>
        <div style={{ margin: '0 24px', borderTop: '1px dashed var(--dash-line)' }} />

        {/* 正文 */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '16px 24px 22px' }}>
          {setting ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-body)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={cfg.enabled}
                  onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
                  style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: 'pointer' }}
                />
                启用每日剧情（关掉后不再弹）
              </label>
              <div>
                <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>指定日期（留空 = 每天首次登录都弹）</div>
                <input
                  type="date"
                  value={cfg.triggerDate}
                  onChange={(e) => setCfg({ ...cfg, triggerDate: e.target.value })}
                  style={{ ...fieldStyle, cursor: 'pointer' }}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>标题</div>
                <input
                  value={cfg.title}
                  onChange={(e) => setCfg({ ...cfg, title: e.target.value })}
                  placeholder="每日问候"
                  style={fieldStyle}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>剧情内容（一段式独白/提醒，弹窗展示）</div>
                <textarea
                  value={cfg.content}
                  onChange={(e) => setCfg({ ...cfg, content: e.target.value })}
                  rows={9}
                  placeholder={'比如：「今天也来书房陪妹妹坐一会儿吧？」——整点语音风格的短剧情或一句开场白。'}
                  style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.7 }}
                />
              </div>
            </div>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, color: 'var(--ink-body)', lineHeight: 1.9 }}>
              {eventContent || (
                <span style={{ color: 'var(--ink2)' }}>
                  （还没有剧情内容——点下面「设置」写一段，明天首次进书房就会弹出来）
                </span>
              )}
            </div>
          )}

          {error && <div style={{ fontSize: 12.5, color: '#c2693f', marginTop: 12 }}>{error}</div>}
          {info && <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 12 }}>{info}</div>}
        </div>

        {/* 底部按钮 */}
        <div className="flex-none flex items-center gap-3" style={{ padding: '0 24px 20px', flexWrap: 'wrap' }}>
          {setting ? (
            <>
              <button
                onClick={saveCfg}
                disabled={busy}
                className="serc"
                style={{
                  fontSize: 13, color: 'var(--card-bg)', background: 'var(--accent)', border: 'none',
                  padding: '9px 18px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
                }}
              >
                {busy ? '保存中…' : '保存'}
              </button>
              <button
                onClick={resetToday}
                disabled={busy}
                className="serc"
                style={{
                  fontSize: 12.5, color: 'var(--ink2)', background: 'var(--card-bg)',
                  border: '1px solid var(--line-soft)', padding: '8px 14px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                重置今日状态
              </button>
              <button
                onClick={() => { setSetting(false); setError(''); setInfo(''); }}
                className="serc"
                style={{ fontSize: 12.5, color: 'var(--ink2)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto' }}
              >
                ← 返回
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setOpen(false)}
                className="serc"
                style={{
                  fontSize: 13, color: 'var(--card-bg)', background: 'var(--accent)', border: 'none',
                  padding: '9px 18px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                知道了
              </button>
              <button
                onClick={openSettings}
                className="serc"
                style={{ fontSize: 12.5, color: 'var(--ink2)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto' }}
              >
                ⚙ 设置每日剧情
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}