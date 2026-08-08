import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDeskBackend, resolveDeskProvider, listProviders,
  OpenAIStreamBackend, AnthropicStreamBackend,
} from '../src/adapters/streamModelBackends.ts';

// 多供应商(「商」切换)分支:makeDeskBackend 按 provider 选供应商,resolveDeskProvider 是唯一事实源,
// listProviders 供前端 GET /desk/providers 拉列表。老渠道(provider 不传)行为保持 openAiStreamBackends.test.ts
// 那套不变,这里只补 provider 分支 + 列表。

test('makeDeskBackend routes by explicit provider id', () => {
  assert.ok(makeDeskBackend({ OPENAI_API_KEY: 'k' }, 'opencode') instanceof OpenAIStreamBackend);
  assert.ok(makeDeskBackend({ ANTHROPIC_API_KEY: 'a' }, 'anthropic') instanceof AnthropicStreamBackend);
  assert.ok(makeDeskBackend({ DEEPSEEK_API_KEY: 'k', DEEPSEEK_MODEL: 'deepseek-chat' }, 'deepseek') instanceof OpenAIStreamBackend);
  assert.ok(makeDeskBackend({ SILICONFLOW_API_KEY: 'k', SILICONFLOW_BASE_URL: 'https://api.siliconflow.cn/v1' }, 'siliconflow') instanceof OpenAIStreamBackend);
});

test('makeDeskBackend throws when provider is unknown or unconfigured (no silent fallback)', () => {
  assert.throws(() => makeDeskBackend({ OPENAI_API_KEY: 'k' }, 'deepseek'), /模型供应商未配置或不存在: deepseek/);
  assert.throws(() => makeDeskBackend({}, 'deepseek'), /模型供应商未配置或不存在: deepseek/);
  assert.throws(() => makeDeskBackend({ ANTHROPIC_API_KEY: 'a' }, 'nope'), /模型供应商未配置或不存在: nope/);
});

test('makeDeskBackend empty-string provider behaves like unset (legacy channel)', () => {
  // handleDeskChat 传的是 `provider || undefined`,空串只会变成 undefined,这里直接验证空串=老行为。
  assert.ok(makeDeskBackend({ OPENAI_API_KEY: 'k' }, '') instanceof OpenAIStreamBackend);
  assert.ok(makeDeskBackend({ ANTHROPIC_API_KEY: 'a' }, '') instanceof AnthropicStreamBackend);
});

test('makeDeskBackend without provider keeps legacy behavior regardless of extra provider keys', () => {
  assert.ok(makeDeskBackend({ OPENAI_API_KEY: 'k', DEEPSEEK_API_KEY: 'd' }) instanceof OpenAIStreamBackend);
  assert.ok(makeDeskBackend({ DEEPSEEK_API_KEY: 'd' }) instanceof AnthropicStreamBackend); // 只有 deepseek 时老渠道回落 Anthropic
  assert.ok(makeDeskBackend({ ANTHROPIC_API_KEY: 'a', SILICONFLOW_API_KEY: 's' }) instanceof AnthropicStreamBackend);
  assert.ok(makeDeskBackend({}) instanceof AnthropicStreamBackend);
});

test('resolveDeskProvider returns full config for a configured provider', () => {
  const cfg = resolveDeskProvider({ DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1', DEEPSEEK_MODEL: 'deepseek-chat', DEEPSEEK_MAX_TOKENS: 8192 }, 'deepseek');
  assert.ok(cfg);
  assert.equal(cfg?.id, 'deepseek');
  assert.equal(cfg?.protocol, 'openai');
  assert.equal(cfg?.apiKey, 'k');
  assert.equal(cfg?.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(cfg?.model, 'deepseek-chat');
  assert.equal(cfg?.maxTokens, 8192);
});

test('resolveDeskProvider returns null for unknown or unconfigured provider', () => {
  assert.equal(resolveDeskProvider({ DEEPSEEK_API_KEY: 'k' }, 'siliconflow'), null); // 没配
  assert.equal(resolveDeskProvider({ OPENAI_API_KEY: 'k' }, 'deepseek'), null);       // 别的供应商配了不算
  assert.equal(resolveDeskProvider({}, 'anthropic'), null);                            // 老渠道没配 key
  assert.equal(resolveDeskProvider({ ANTHROPIC_API_KEY: 'a' }, 'whatever'), null);     // 注册表外 id
});

test('resolveDeskProvider treats baseUrl-only as configured (deferred config error at call time)', () => {
  const cfg = resolveDeskProvider({ SILICONFLOW_BASE_URL: 'https://api.siliconflow.cn/v1' }, 'siliconflow');
  assert.ok(cfg);
  assert.equal(cfg?.apiKey, '');
});

test('listProviders only returns configured groups with their models', () => {
  const all = listProviders({
    OPENAI_API_KEY: 'o', OPENAI_MODEL: 'deepseek-chat',
    ANTHROPIC_API_KEY: 'a',
    DEEPSEEK_API_KEY: 'd', DEEPSEEK_MODEL: 'deepseek-reasoner',
  });
  const ids = all.map((p) => p.id);
  assert.deepEqual(ids, ['opencode', 'anthropic', 'deepseek']);
  const opencode = all.find((p) => p.id === 'opencode');
  assert.deepEqual(opencode?.models, ['deepseek-chat']); // 优先 env 的 OPENAI_MODEL
  const anthropic = all.find((p) => p.id === 'anthropic');
  assert.ok(anthropic && anthropic.models.includes('claude-opus-5')); // anthropic 走 claude 白名单
  const deepseek = all.find((p) => p.id === 'deepseek');
  assert.deepEqual(deepseek?.models, ['deepseek-reasoner']);
});

test('listProviders falls back to registry default models when <PREFIX>_MODEL unset', () => {
  const p = listProviders({ SILICONFLOW_API_KEY: 's' });
  assert.equal(p.length, 1);
  assert.equal(p[0].id, 'siliconflow');
  assert.equal(p[0].models[0], 'deepseek-ai/DeepSeek-V3');
});

test('listProviders returns empty for a bare env', () => {
  assert.deepEqual(listProviders({}), []);
});
