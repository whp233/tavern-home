'use client';

import { useCallback, useRef, useState } from 'react';

export type FloatingTaskState = {
  id: string;
  label: string;
  detail?: string;
  running: boolean;
  progress?: { done: number; total?: number };
};

export function useFloatingTask(defaultLabel = '处理中') {
  const [task, setTask] = useState<FloatingTaskState | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  const start = useCallback((label?: string, opts?: { total?: number; detail?: string }) => {
    const ac = new AbortController();
    ctrlRef.current = ac;
    setTask({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label: label || defaultLabel,
      detail: opts?.detail,
      running: true,
      progress: opts?.total !== undefined ? { done: 0, total: opts.total } : undefined,
    });
    return ac.signal;
  }, [defaultLabel]);

  const setProgress = useCallback((done: number, total?: number) => {
    setTask((prev) => {
      if (!prev) return prev;
      return { ...prev, progress: { done, total: total ?? prev.progress?.total } };
    });
  }, []);

  const update = useCallback((patch: Partial<FloatingTaskState>) => {
    setTask((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const abort = useCallback(() => {
    ctrlRef.current?.abort();
    setTask((prev) => (prev ? { ...prev, running: false } : prev));
  }, []);

  const dismiss = useCallback(() => {
    ctrlRef.current = null;
    setTask(null);
  }, []);

  const complete = useCallback(() => {
    setTask((prev) => (prev ? { ...prev, running: false } : prev));
  }, []);

  return { task, start, setProgress, update, abort, dismiss, complete, controllerRef: ctrlRef, get signal() { return ctrlRef.current?.signal; } };
}

export function FloatingTaskBall({ task, onOpen, onAbort }: { task: FloatingTaskState | null; onOpen?: () => void; onAbort: () => void }) {
  if (!task || !task.running) return null;
  const hasProgress = task.progress && task.progress.total !== undefined && task.progress.total > 0;
  const label = hasProgress ? `${task.label} ${Math.min((task.progress!.done ?? 0) + 1, task.progress!.total!)}/${task.progress!.total}` : task.label;
  return (
    <div style={{ position: 'fixed', right: 18, bottom: 96, zIndex: 30, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        onClick={() => onOpen?.()}
        title={task.detail || '后台任务进行中，点开查看/回到前台'}
        style={{
          width: 58,
          height: 58,
          borderRadius: '50%',
          border: '1px solid var(--line-soft)',
          background: 'var(--card-bg)',
          boxShadow: '0 8px 24px var(--card-shadow2)',
          color: 'var(--accent)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontFamily: 'inherit',
          fontWeight: 600,
          lineHeight: 1.2,
          textAlign: 'center',
          padding: 4,
        }}
      >
        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{label}</span>
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onAbort(); }}
        title="终止任务"
        style={{
          fontSize: 11,
          color: 'var(--ink2)',
          background: 'var(--card-bg)',
          border: '1px solid var(--line-soft)',
          borderRadius: 20,
          padding: '2px 10px',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        × 终止
      </button>
    </div>
  );
}