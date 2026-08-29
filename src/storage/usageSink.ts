export interface UsageTokens {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export type UsageStatus = 'ok' | 'failed';

export interface UsageMeta {
  project?: string | null;
  charKey?: string | null;
  windowId?: string | null;
  providerId?: string | null;
}

export interface UsageSink {
  logUsage(
    channel: string,
    model: string | undefined | null,
    usage: UsageTokens | undefined | null,
    status?: UsageStatus,
    meta?: UsageMeta,
  ): Promise<void>;
}

interface UsageSinkEnv {
  OC_DB: D1Database;
}

const CHANNELS = new Set(['desk', 'desk-timeline', 'desk-board-refresh', 'desk-book']);

export function makeD1UsageSink(env: UsageSinkEnv): UsageSink {
  return {
    async logUsage(channel, model, usage, status = 'ok', meta?: UsageMeta): Promise<void> {
      try {
        if (!CHANNELS.has(channel)) return;
        const input = Number(usage?.input) || 0;
        const output = Number(usage?.output) || 0;
        const cacheRead = Number(usage?.cache_read) || 0;
        const cacheWrite = Number(usage?.cache_write) || 0;
        if (status === 'ok' && !input && !output && !cacheRead && !cacheWrite) return;
        const project = meta?.project ? String(meta.project).trim().slice(0, 100) : null;
        const charKey = meta?.charKey ? String(meta.charKey).trim().slice(0, 100) : null;
        const windowId = meta?.windowId ? String(meta.windowId).trim().slice(0, 100) : null;
        const providerId = meta?.providerId ? String(meta.providerId).trim().slice(0, 100) : null;
        // 兼容旧库（未跑 0008 迁移时无新增列）：先试新 schema，列不存在则回落旧 schema
        try {
          await env.OC_DB.prepare(
            `INSERT INTO usage_log
               (id, channel, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, status, project, char_key, window_id, provider_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            `ug_${crypto.randomUUID()}`,
            channel,
            model || null,
            input,
            output,
            cacheRead,
            cacheWrite,
            status,
            project,
            charKey,
            windowId,
            providerId,
          ).run();
        } catch {
          await env.OC_DB.prepare(
            `INSERT INTO usage_log
               (id, channel, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            `ug_${crypto.randomUUID()}`,
            channel,
            model || null,
            input,
            output,
            cacheRead,
            cacheWrite,
            status,
          ).run();
        }
      } catch (error) {
        console.error('[usage] Failed to record model usage:', channel, error);
      }
    },
  };
}
