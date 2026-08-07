export interface DeskChannelConfig { ANTHROPIC_API_KEY?: string; OPENAI_API_KEY?: string }

// 渠道校验:Anthropic 或 OpenAI 兼容任一配齐即通过(打字桌聊天走 makeDeskBackend 分流,
// 时光带/状态板刷新走 completeText 分发)。
export function validateDeskChannelConfig(env: DeskChannelConfig): string | null {
  return env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY ? null : '模型渠道没配(ANTHROPIC_API_KEY 或 OPENAI_API_KEY)';
}
