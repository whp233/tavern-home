export interface ModelUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

// 图片附件：打字桌上传图片走这条（多模态模型直接收图）。data 是不含 data: 前缀的 base64。
// 只做"当次请求"传递（不落库，楼层里不留引用）——回看重放时不带图。
export interface DeskImageAttachment {
  kind: 'image';
  name: string;  // 文件名（错误提示/诊断用）
  mime: string;  // image/jpeg | image/png | image/gif | image/webp
  data: string;  // base64
}

export type ModelStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'usage'; usage: Partial<ModelUsage> }
  | { type: 'ping' };

export interface StreamChatArgs {
  system: Array<{ text: string; cache: boolean }>;
  prompt: string;
  model: string;
  images?: DeskImageAttachment[];  // 图片附件；不传/空=原行为（content 保持字符串）
  signal?: AbortSignal;
  onEvent?: (event: ModelStreamEvent) => void | Promise<void>;
}

// 纯文本模型判定：图片附件只在多模态模型可用。已知纯文本系（DeepSeek / stepfun 主序列）明确拦，
// 已知视觉系（deepseek-vl / step-1v）放行，未知模型不拦（交给 API 裁决，避免误伤新模型）。
export function isTextOnlyModel(model: string): boolean {
  const m = String(model || '').toLowerCase();
  if (!m) return false;
  if (m.includes('deepseek') && !m.includes('vl')) return true;
  if (m.startsWith('step') && !m.includes('-1v')) return true;
  return false;
}

export type StreamChatResult =
  // Backends may return this variant only after their protocol-specific clean terminal was observed.
  | { ok: true; terminal: 'clean'; text: string; thinking: string; usage: ModelUsage; stopReason?: string }
  | { ok: false; kind: 'config' | 'http' | 'timeout' | 'aborted' | 'protocol' | 'limit' | 'empty' | 'fetch'; detail?: string; usage?: ModelUsage };

export interface ModelBackend {
  // An aborted request must never resolve to the successful clean-terminal variant.
  streamChat(args: StreamChatArgs): Promise<StreamChatResult>;
}
