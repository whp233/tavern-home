'use client';

// 供应商房间——左廊第四扇门「商」后面的整页。玻璃卡片风,跟书架/打字桌/读书角一个质感,
// 功能直接放页面里,不做弹层。
// 数据走 /api/oc/desk/provider-config(GET 列已配置 / PUT 增改 / DELETE 删),字段照
// examples/cloudflare/index.ts 的 providerConfigRows 返回 shape:
//   source:'env'  = 注册表里靠 .dev.vars 环境变量配的,只读,删除被禁用(提示去 .dev.vars 移除);
//   source:'override' = 网页端配的(注册表 id 覆盖 or custom:<随机> 自定义),可编辑/删除。
// 「当前」标记 = localStorage.oc_desk_provider(打字桌顶栏「商」弹层也读这一把,两边是同一个默认)。

import { useState, useEffect, useRef } from 'react';

// ── 数据形状(照后端 providerConfigRows / PUT 响应共用 shape) ──
export type ProviderCfgRow = {
  id: string;
  name: string;
  protocol: 'openai' | 'anthropic';
  source: 'override' | 'env';
  hasApiKey: boolean;
  apiKeyTail: string;
  baseUrl: string | null;
  model: string | null;
  maxTokens: number | null;
};

// 新增表单的「选预设」:注册表三个(去掉了 opencode——它不是 OpenAI 兼容渠道,是 env 驱动的内部
// 供应商,不该出现在"新建"预设里) + 自定义 OpenAI 兼容 + 自定义 Anthropic 兼容。
// 注册表 id 照 PROVIDER_REGISTRY_IDS,protocol 照 DESK_PROVIDER_DEFS;自定义支持 openai/anthropic。
type PresetDef = {
  key: string;
  label: string;
  id?: string;
  protocol: 'openai' | 'anthropic';
  custom?: boolean;
};
const PRESETS: PresetDef[] = [
  { key: 'anthropic', label: 'Anthropic', id: 'anthropic', protocol: 'anthropic' },
  { key: 'deepseek', label: 'DeepSeek', id: 'deepseek', protocol: 'openai' },
  { key: 'siliconflow', label: '硅基流动', id: 'siliconflow', protocol: 'openai' },
  { key: 'custom', label: '自定义 OpenAI 兼容', custom: true, protocol: 'openai' },
  { key: 'custom-anthropic', label: '自定义 Anthropic 兼容', custom: true, protocol: 'anthropic' },
];
const PROTOCOL_LABEL: Record<ProviderCfgRow['protocol'], string> = {
  openai: 'OpenAI 兼容',
  anthropic: 'Anthropic',
};

// 各预设的官方 Base URL(选预设时自动填,包括默认 DeepSeek 的初始值)。Anthropic 的 baseUrl 是
// 完整 Messages 端点,OpenAI 兼容渠道是 API base(后端 openAiEndpoint 会再补 /chat/completions)。
const BASE_URL_HINTS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  deepseek: 'https://api.deepseek.com/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  custom: '',
  'custom-anthropic': 'https://api.anthropic.com/v1/messages',
};
const BASE_URL_PLACEHOLDER: Record<string, string> = {
  custom: '你的 OpenAI 兼容网关地址，如 https://…/v1',
  'custom-anthropic': '你的 Anthropic 兼容网关 Messages 端点，如 https://…/v1/messages',
};
const DEFAULT_PRESET_KEY = 'deepseek';

// ── 玻璃卡片小料(照 page.tsx 同款数值抄一份,本仓惯例) ──
const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)', border: '1px solid var(--line-soft)', borderRadius: 22, boxShadow: '0 6px 18px var(--card-shadow)',
};
const glassCardStyle: React.CSSProperties = {
  background: 'var(--glass-bg)', border: '1.5px dashed var(--dash-line)', borderRadius: 22, boxShadow: '0 4px 16px var(--card-shadow)',
};
const pillStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--ink2)',
  background: 'var(--card-bg)', border: '1px solid var(--line-soft)', padding: '7px 16px', borderRadius: 30,
  cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit',
};
const btnPrimaryStyle: React.CSSProperties = {
  fontSize: 13, color: 'var(--card-bg)', background: 'var(--accent)', border: 'none',
  padding: '9px 18px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
};
const inputStyle: React.CSSProperties = {
  fontSize: 13.5, color: 'var(--ink-body)', background: 'var(--card-bg)', border: '1px solid var(--line-soft)',
  borderRadius: 12, padding: '9px 14px', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
};

const monoStyle: React.CSSProperties = { fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace" };

// 「获取模型名称」：调后端代理 POST /api/oc/desk/provider-models(免得浏览器撞 CORS),
// 拉到模型后给一个下拉，选中即回填 model 字段。savedId = 已保存供应商的 id——编辑态没改 key 时
// 靠它走后端已存的 key；apiKey/baseUrl 填了就优先用表单里的(新建态/正在改 key 时)。
function ModelFetch({ base, protocol, baseUrl, apiKey, savedId, onPick }: {
  base: string;
  protocol: 'openai' | 'anthropic';
  baseUrl?: string;
  apiKey?: string;
  savedId?: string;
  onPick: (model: string) => void;
}) {
  const [opts, setOpts] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    if (loading) return;
    setLoading(true); setErr(''); setOpts(null);
    try {
      const body: any = { protocol };
      if (!apiKey && savedId) body.id = savedId;
      if (baseUrl && baseUrl.trim()) body.baseUrl = baseUrl.trim();
      if (apiKey && apiKey.trim()) body.apiKey = apiKey.trim();
      if (!body.id && !body.apiKey) { setErr('先填 API Key 才能拉模型'); return; }
      const res = await fetch(`${base}/api/oc/desk/provider-models`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d || d.success === false) throw new Error(d?.error || `HTTP ${res.status}`);
      if (!Array.isArray(d.models) || d.models.length === 0) { setErr('没拉到模型，检查 Base URL 与 Key'); return; }
      setOpts(d.models as string[]);
    } catch (e: any) {
      setErr(e.message || '获取失败');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div style={{ marginTop: 8 }}>
      <button className="serc" onClick={go} disabled={loading} style={{ ...pillStyle, fontSize: 12.5, padding: '6px 14px' }} title="从该供应商 API 拉模型列表">
        {loading ? '拉取中…' : (opts && opts.length ? `已获取 ${opts.length} 个模型` : '获取模型名称')}
      </button>
      {opts && opts.length > 0 && (
        <select
          value=""
          onChange={(e) => { if (e.target.value) { onPick(e.target.value); setOpts(null); } }}
          style={{ ...inputStyle, marginTop: 8, cursor: 'pointer', width: '100%' }}
        >
          <option value="">点选一个模型即填入</option>
          {opts.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      )}
      {err && <div style={{ fontSize: 12, color: '#c2693f', marginTop: 6 }}>{err}</div>}
    </div>
  );
}

// 「测试连接」：复用 provider-models 代理（mode:'test'），验证这个 API + key 能不能连上。
// 参数同 ModelFetch：savedId = 已存供应商 id（没改 key 时用），baseUrl/apiKey 填了优先用表单里的。
function TestConnect({ base, protocol, baseUrl, apiKey, savedId }: {
  base: string;
  protocol: 'openai' | 'anthropic';
  baseUrl?: string;
  apiKey?: string;
  savedId?: string;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState('');
  async function go() {
    if (state === 'loading') return;
    setState('loading'); setMsg('');
    try {
      const body: any = { protocol, mode: 'test' };
      if (!apiKey && savedId) body.id = savedId;
      if (baseUrl && baseUrl.trim()) body.baseUrl = baseUrl.trim();
      if (apiKey && apiKey.trim()) body.apiKey = apiKey.trim();
      if (!body.id && !body.apiKey) { setState('err'); setMsg('先填 API Key 才能测连接'); return; }
      const res = await fetch(`${base}/api/oc/desk/provider-models`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!d || d.success === false) throw new Error(d?.error || `HTTP ${res.status}`);
      if (d.ok === true) { setState('ok'); setMsg(d.message || '连接正常'); }
      else { setState('err'); setMsg(d.message || '连接失败'); }
    } catch (e: any) {
      setState('err'); setMsg(e.message || '测试失败');
    }
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button className="serc" onClick={go} disabled={state === 'loading'} style={{ ...pillStyle, fontSize: 12.5, padding: '6px 14px' }} title="测试这个 API 能不能连上">
        {state === 'loading' ? '测试中…' : '测试连接'}
      </button>
      {state === 'ok' && <span style={{ fontSize: 12, color: '#3a7d44' }}>✓ {msg}</span>}
      {state === 'err' && <span style={{ fontSize: 12, color: '#c2693f' }}>✗ {msg}</span>}
    </span>
  );
}

export default function ProviderConfigRoom({ base, envOk, onChanged, onGoBack }: {
  base: string;
  envOk: boolean;
  onChanged?: () => void;   // 保存/删除成功后通知书架刷新引导横幅
  onGoBack?: () => void;    // 「← 返回书架」
}) {
  // ── 列表 ──
  const [list, setList] = useState<ProviderCfgRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const seqRef = useRef(0);

  // ── 顶栏/全局反馈 ──
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showFeedback(kind: 'ok' | 'err', text: string) {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback({ kind, text });
    feedbackTimer.current = setTimeout(() => setFeedback(null), 5000);
  }

  // ── 当前默认(localStorage.oc_desk_provider,打字桌弹层同一把) ──
  const [currentId, setCurrentId] = useState('');
  useEffect(() => { try { const p = localStorage.getItem('oc_desk_provider'); if (p) setCurrentId(p); } catch { /* 无localStorage环境无所谓 */ } }, []);

  async function load() {
    const tok = ++seqRef.current;
    setLoading(true); setLoadError('');
    try {
      if (!envOk) throw new Error('环境变量没配好');
      const res = await fetch(`${base}/api/oc/desk/provider-config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json().catch(() => null);
      if (!d || d.success === false) throw new Error(d?.error || '后端报错');
      if (tok !== seqRef.current) return;
      setList(Array.isArray(d.providers) ? d.providers : []);
    } catch (e: any) {
      if (tok === seqRef.current) setLoadError(e.message || '供应商翻不出来');
    } finally {
      if (tok === seqRef.current) setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [base, envOk]);

  // ── 新增表单 ──
  const [presetKey, setPresetKey] = useState(DEFAULT_PRESET_KEY);
  const [apiKey, setApiKey] = useState('');
  // 初始就按默认预设(DeepSeek)预填 Base URL——不然要切一下预设才弹出来,太绕。
  const [baseUrl, setBaseUrl] = useState(() => BASE_URL_HINTS[DEFAULT_PRESET_KEY] ?? '');
  const [model, setModel] = useState('');
  const [customName, setCustomName] = useState('');
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState('');
  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[1];

  async function handleAdd() {
    const key = apiKey.trim();
    if (!key) { setAddError('API Key 必填'); return; }
    if (preset.custom && !customName.trim()) { setAddError('自定义供应商要填显示名'); return; }
    if (savingAdd) return;
    setSavingAdd(true); setAddError('');
    try {
      if (!envOk) throw new Error('环境变量没配好');
      const id = preset.custom ? `custom:${Math.random().toString(36).slice(2, 10)}` : preset.id!;
      const body: any = { id, protocol: preset.protocol, apiKey: key };
      if (preset.custom) body.name = customName.trim();
      const b = baseUrl.trim();
      if (b) body.baseUrl = b;
      const m = model.trim();
      if (m) body.model = m;
      const res = await fetch(`${base}/api/oc/desk/provider-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d || d.success === false) throw new Error(d?.error || `HTTP ${res.status}`);
      const savedName = d.provider && typeof d.provider.name === 'string' ? d.provider.name : (preset.custom ? customName.trim() : preset.label);
      setApiKey(''); setBaseUrl(BASE_URL_HINTS[DEFAULT_PRESET_KEY] ?? ''); setModel(''); setCustomName(''); setPresetKey(DEFAULT_PRESET_KEY);
      await load();
      onChanged?.();
      showFeedback('ok', `已添加供应商「${savedName}」`);
    } catch (e: any) { setAddError(e.message || '保存失败'); }
    finally { setSavingAdd(false); }
  }

  // ── 行内编辑(apiKey 留空 = 不改原 key;baseUrl/model/maxTokens 留空 = 原样不动) ──
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editApiKey, setEditApiKey] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editName, setEditName] = useState('');
  const [editMaxTokens, setEditMaxTokens] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  function openEdit(row: ProviderCfgRow) {
    setEditingId(row.id);
    setEditApiKey(''); setEditBaseUrl(''); setEditModel(''); setEditMaxTokens('');
    setEditName(row.source === 'override' && row.id.startsWith('custom:') ? row.name : '');
    setEditError('');
  }

  async function handleUpdate(row: ProviderCfgRow) {
    if (savingEdit) return;
    const body: any = { id: row.id, protocol: row.protocol };
    const key = editApiKey.trim();
    if (key) body.apiKey = key;
    const b = editBaseUrl.trim();
    if (b) body.baseUrl = b;
    const m = editModel.trim();
    if (m) body.model = m;
    const custom = row.id.startsWith('custom:');
    if (custom) {
      const n = editName.trim();
      if (n) body.name = n;
    }
    let mtNum: number | undefined;
    const mt = editMaxTokens.trim();
    if (mt !== '') {
      const n = Number(mt);
      if (!Number.isFinite(n)) { setEditError('maxTokens 必须是数字'); return; }
      mtNum = n;
      body.maxTokens = n;
    }
    // 全空 = 后端仍会写一条空 override(把 env 源顶成 override 且"配了"但没 key)——空 PUT 是纯副作用,
    // 拦在门口。maxTokens 填 0 也算有改动(0 是合法数字,不是空)。
    const hasChange = key || b || m || (custom && !!editName.trim()) || (mtNum !== undefined);
    if (!hasChange) { setEditError('没填要改的字段（apiKey 留空 = 不改原 key）'); return; }
    setSavingEdit(true); setEditError('');
    try {
      if (!envOk) throw new Error('环境变量没配好');
      const res = await fetch(`${base}/api/oc/desk/provider-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d || d.success === false) throw new Error(d?.error || `HTTP ${res.status}`);
      setEditingId(null);
      await load();
      onChanged?.();
      showFeedback('ok', `已更新供应商「${row.name}」`);
    } catch (e: any) { setEditError(e.message || '保存失败'); }
    finally { setSavingEdit(false); }
  }

  // ── 删除(override 可删,env 只读;两段确认照 page.tsx onDeleteClick 家法) ──
  const [delStage, setDelStage] = useState<Record<string, 0 | 1>>({});
  const delTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});

  function onDeleteClick(row: ProviderCfgRow) {
    if (row.source !== 'override') return;
    const stage = delStage[row.id] || 0;
    if (stage === 0) {
      setDelStage((s) => ({ ...s, [row.id]: 1 }));
      if (delTimers.current[row.id]) clearTimeout(delTimers.current[row.id]);
      delTimers.current[row.id] = setTimeout(() => setDelStage((s) => ({ ...s, [row.id]: 0 })), 3000);
      return;
    }
    if (delTimers.current[row.id]) clearTimeout(delTimers.current[row.id]);
    handleDelete(row);
  }
  async function handleDelete(row: ProviderCfgRow) {
    setDelStage((s) => ({ ...s, [row.id]: 0 }));
    setDeleting((s) => ({ ...s, [row.id]: true }));
    try {
      const res = await fetch(`${base}/api/oc/desk/provider-config?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d || d.success === false) throw new Error(d?.error || `HTTP ${res.status}`);
      await load();
      onChanged?.();
      showFeedback('ok', `已删除供应商「${row.name}」`);
    } catch (e: any) {
      showFeedback('err', `删除失败：${e.message || '未知错误'}`);
    } finally {
      setDeleting((s) => ({ ...s, [row.id]: false }));
    }
  }

  // ── 设为默认(localStorage.oc_desk_provider,打字桌顶栏「商」弹层同读) ──
  function setDefault(row: ProviderCfgRow) {
    try { localStorage.setItem('oc_desk_provider', row.id); } catch { /* 同上 */ }
    setCurrentId(row.id);
    showFeedback('ok', `已将「${row.name}」设为默认`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        {onGoBack && (
          <button className="serc" onClick={onGoBack} style={pillStyle}>← 返回书架</button>
        )}
        <span className="serc" style={{ fontSize: 20, color: 'var(--ink-deep)' }}>供应商</span>
        <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
          模型供应商：写作时 AI 走哪个渠道。配好后打字桌顶栏「商」可切换。
        </span>
      </div>

      {feedback && (
        <div
          className="card"
          style={{
            ...glassCardStyle,
            padding: '12px 18px',
            fontSize: 13,
            color: feedback.kind === 'ok' ? 'var(--ink-deep)' : '#c2693f',
          }}
        >
          {feedback.kind === 'ok' ? '✓ ' : '✗ '}{feedback.text}
        </div>
      )}

      {/* 列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? (
          <div className="card" style={{ ...cardStyle, padding: '20px 24px', fontSize: 13, color: 'var(--ink2)' }}>正在清点供应商…</div>
        ) : loadError ? (
          <div className="card" style={{ ...cardStyle, padding: '20px 24px', fontSize: 13, color: '#c2693f', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>供应商翻不出来：{loadError}</span>
            <button className="serc" onClick={load} style={pillStyle}>重试</button>
          </div>
        ) : !list || list.length === 0 ? (
          <div className="card" style={{ ...glassCardStyle, padding: '26px 28px' }}>
            <div className="serc" style={{ fontSize: 15, color: 'var(--ink-deep)' }}>还没有配置模型供应商，AI 写作暂时不可用</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 8 }}>
              在下面新建一个：选预设 → 填 API Key（Base URL / Model 可空），保存即可在打字桌里开写。
            </div>
          </div>
        ) : (
          list.map((row) => {
            const isCurrent = currentId === row.id;
            const isEditing = editingId === row.id;
            return (
              <div key={row.id} className="card" style={{ ...cardStyle, padding: '18px 22px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="serc" style={{ fontSize: 15, color: 'var(--ink-deep)' }}>{row.name}</span>
                  <span style={{
                    fontSize: 11.5, color: row.source === 'override' ? 'var(--card-bg)' : 'var(--ink2)',
                    background: row.source === 'override' ? 'var(--accent)' : 'var(--scale-0)',
                    borderRadius: 20, padding: '3px 10px',
                  }}>
                    {row.source === 'override' ? '网页配置' : '来自环境配置'}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink2)', background: 'var(--scale-0)', borderRadius: 20, padding: '3px 10px' }}>
                    {PROTOCOL_LABEL[row.protocol]}
                  </span>
                  {isCurrent && (
                    <span style={{ fontSize: 11.5, color: 'var(--accent)' }}>当前</span>
                  )}
                </div>

                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12.5, color: 'var(--ink-body)' }}>
                  <div>
                    <span style={{ color: 'var(--ink2)' }}>API Key：</span>
                    {row.hasApiKey
                      ? <span style={{ ...monoStyle, color: 'var(--ink-deep)' }}>••••{row.apiKeyTail}</span>
                      : <span style={{ color: '#c2693f' }}>未填 key</span>}
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink2)' }}>Base URL：</span>
                    {row.baseUrl
                      ? <span style={monoStyle}>{row.baseUrl}</span>
                      : <span style={{ color: 'var(--ink2)' }}>（未设置，走渠道默认）</span>}
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink2)' }}>Model：</span>
                    {row.model
                      ? <span style={monoStyle}>{row.model}</span>
                      : <span style={{ color: 'var(--ink2)' }}>（用后端默认）</span>}
                  </div>
                  {row.maxTokens != null && (
                    <div>
                      <span style={{ color: 'var(--ink2)' }}>maxTokens：</span><span style={monoStyle}>{row.maxTokens}</span>
                    </div>
                  )}
                  <div style={{ color: 'var(--ink2)' }}>
                    id：<span style={monoStyle}>{row.id}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                  {!isCurrent && (
                    <button className="serc" onClick={() => setDefault(row)} style={pillStyle}>设为默认</button>
                  )}
                  <TestConnect base={base} protocol={row.protocol} savedId={row.id} />
                  {isEditing ? (
                    <>
                      <button className="serc" onClick={() => handleUpdate(row)} disabled={savingEdit} style={{ ...btnPrimaryStyle, opacity: savingEdit ? 0.6 : 1 }}>
                        {savingEdit ? '保存中…' : '保存'}
                      </button>
                      <button className="serc" onClick={() => setEditingId(null)} style={pillStyle}>取消</button>
                      <TestConnect base={base} protocol={row.protocol} baseUrl={editBaseUrl || row.baseUrl || undefined} apiKey={editApiKey || undefined} savedId={row.id} />
                    </>
                  ) : (
                    <button className="serc" onClick={() => openEdit(row)} style={pillStyle}>编辑</button>
                  )}
                  {row.source === 'override' ? (
                    <button
                      className="serc"
                      onClick={() => onDeleteClick(row)}
                      disabled={!!deleting[row.id]}
                      style={{ ...pillStyle, color: delStage[row.id] === 1 ? '#fffdf5' : '#c2693f', background: delStage[row.id] === 1 ? '#c2693f' : 'var(--card-bg)', opacity: deleting[row.id] ? 0.6 : 1 }}
                    >
                      {deleting[row.id] ? '删除中…' : delStage[row.id] === 1 ? '真的删?再点一次' : '删除'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--ink2)' }} title="环境变量配的渠道，改这里没用">删除不可用 · 环境配置的供应商请到 .dev.vars 移除</span>
                  )}
                </div>

                {isEditing && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-soft)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                    {row.id.startsWith('custom:') && (
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>显示名</div>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={row.name} style={inputStyle} />
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>
                        API Key{row.hasApiKey ? `（留空 = 不改原 key，当前尾号 ${row.apiKeyTail}）` : ''}
                      </div>
                      <input type="password" value={editApiKey} onChange={(e) => setEditApiKey(e.target.value)} placeholder={row.hasApiKey ? '留空 = 不改原 key' : '填新 key'} style={inputStyle} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>Base URL（留空 = 不改）</div>
                      <input value={editBaseUrl} onChange={(e) => setEditBaseUrl(e.target.value)} placeholder={row.baseUrl || 'https://…'} style={inputStyle} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>Model（留空 = 不改）</div>
                      <input value={editModel} onChange={(e) => setEditModel(e.target.value)} placeholder={row.model || '不填用后端默认'} style={inputStyle} />
                      <ModelFetch
                        base={base}
                        protocol={row.protocol}
                        baseUrl={editBaseUrl || row.baseUrl || undefined}
                        apiKey={editApiKey || undefined}
                        savedId={row.id}
                        onPick={(m) => setEditModel(m)}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>maxTokens（可选，留空 = 不改）</div>
                      <input value={editMaxTokens} onChange={(e) => setEditMaxTokens(e.target.value)} placeholder={row.maxTokens != null ? String(row.maxTokens) : '数字'} style={inputStyle} />
                    </div>
                  </div>
                )}
                {isEditing && editError && <div style={{ fontSize: 12.5, color: '#c2693f', marginTop: 10 }}>{editError}</div>}
              </div>
            );
          })
        )}
      </div>

      {/* 新增供应商 */}
      <div className="card" style={{ ...glassCardStyle, padding: '20px 24px' }}>
        <div className="serc" style={{ fontSize: 15, color: 'var(--ink-deep)', marginBottom: 12 }}>新增供应商</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>预设</div>
            <select
              value={presetKey}
              onChange={(e) => { const k = e.target.value; setPresetKey(k); setBaseUrl(BASE_URL_HINTS[k] ?? ''); setModel(''); }}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          {preset.custom && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>显示名（必填）</div>
              <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="比如：我的中转站" style={inputStyle} />
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>API Key（必填）</div>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>Base URL{baseUrl ? '（已按预设填好，可改）' : '（可空）'}</div>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={BASE_URL_PLACEHOLDER[presetKey] ?? 'https://api.…（可空 = 用渠道默认）'} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 5 }}>Model（可空）</div>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 deepseek-chat（可空 = 用渠道默认）" style={inputStyle} />
            <ModelFetch
              base={base}
              protocol={preset.protocol}
              baseUrl={baseUrl}
              apiKey={apiKey}
              onPick={(m) => setModel(m)}
            />
          </div>
        </div>
        {addError && <div style={{ fontSize: 12.5, color: '#c2693f', marginTop: 10 }}>{addError}</div>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
          <button className="serc" onClick={handleAdd} disabled={savingAdd} style={{ ...btnPrimaryStyle, opacity: savingAdd ? 0.6 : 1 }}>
            {savingAdd ? '保存中…' : '保存'}
          </button>
          <TestConnect base={base} protocol={preset.protocol} baseUrl={baseUrl} apiKey={apiKey} />
        </div>
      </div>
    </div>
  );
}
