'use client';
import { useEffect, useState } from 'react';

type Props = { base: string; envOk: boolean; project: string; windowId: string | null; vars: Record<string,string> | null; onSaved?: () => void };

function parseIds(raw: string): string[] {
  if (!raw) return [];
  try { const j = JSON.parse(raw); if (Array.isArray(j)) return j.map(String); } catch {}
  return raw.split(/[,\s，、]+/).map(s=>s.trim()).filter(Boolean);
}

export default function RefBookSelector({ base, envOk, project, windowId, vars, onSaved }: Props) {
  const [ids, setIds] = useState<string[]>(()=> parseIds((vars as any)?.refBookIds || ''));
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(()=> setIds(parseIds((vars as any)?.refBookIds || '')), [vars]);
  const save = async () => {
    if (!windowId) { setMsg('先选一个写作窗'); return; }
    setSaving(true); setMsg('');
    try {
      if (!envOk) throw new Error('环境未就绪');
      const refBookIds = input.trim() ? [...ids, ...parseIds(input)].filter((v,i,a)=>a.indexOf(v)===i) : ids;
      const body = { vars: { ...(vars||{}), refBookIds: refBookIds.length ? JSON.stringify(refBookIds) : '' } };
      const res = await fetch(`${base}/api/oc/desk/windows/${windowId}`, { method: 'PUT', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) });
      const d = await res.json().catch(()=>null);
      if (!res.ok || !d || d.success===false) throw new Error(d?.error||`HTTP ${res.status}`);
      setInput(''); setIds(refBookIds);
      setMsg(refBookIds.length ? `已关联 ${refBookIds.length} 本：${refBookIds.join('、')}` : '已清空关联，未选书不注入');
      onSaved?.();
    } catch(e:any){ setMsg(e.message||'保存失败'); } finally{ setSaving(false); }
  };
  const toggle = (id:string)=> setIds(prev=> prev.includes(id)? prev.filter(x=>x!==id): [...prev, id]);
  return (
    <div style={{ border:'1px solid var(--line-soft)', borderRadius:14, padding:'10px 12px', background:'var(--scale-0)' }}>
      <div style={{ fontSize:12, color:'var(--ink2)', marginBottom:6 }}>参考书显式关联（window.vars.refBookIds）— 未选不注入，仅对选书注入</div>
      {ids.length ? <div style={{ fontSize:12, color:'var(--ink-body)', marginBottom:6 }}>已关联：{ids.join('、')}</div> : <div style={{ fontSize:12, color:'var(--ink2)', marginBottom:6 }}>未关联（不注入）</div>}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:6 }}>
        <input value={input} onChange={e=>setInput(e.target.value)} placeholder="书名/ID，逗号分隔" style={{ flex:'1 1 160px', fontSize:13, padding:'6px 10px', borderRadius:10, border:'1px solid var(--line-soft)' }} />
        <button onClick={save} disabled={saving} style={{ fontSize:12, padding:'6px 12px', borderRadius:10, border:'none', background:'var(--accent)', color:'var(--card-bg)', cursor:'pointer' }}>{saving?'保存中…':'保存关联'}</button>
      </div>
      {msg && <div style={{ fontSize:11.5, color:'#6a7a5a' }}>{msg}</div>}
    </div>
  );
}
