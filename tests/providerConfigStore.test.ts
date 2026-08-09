import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderConfigStore, ProviderOverride } from '../src/core/providerConfigStore.ts';
import {
  mergeProviderEnv, listProviders, resolveDeskProvider, makeDeskBackend,
  PROVIDER_REGISTRY_IDS, OpenAIStreamBackend, AnthropicStreamBackend,
  providerModelsUrl, parseProviderModels, deskProviderConfigured, isPlaceholderKey,
} from '../src/adapters/streamModelBackends.ts';
import { D1ProviderConfigStore } from '../examples/cloudflare/adapters/d1ProviderConfigStore.ts';

// 网页端供应商配置的后端数据层:ProviderConfigStore 契约 + mergeProviderEnv 合成 + 三个解析函数
// 的 overrides 分支。内存实现测契约行为;fake D1 测 d1ProviderConfigStore 落库/前缀过滤;
// 合并/解析直接打 streamModelBackends(纯函数)。老调用(不传 overrides)行为必须一字不变。

// ===== 内存版 ProviderConfigStore =====
function memoryStore(seed: ProviderOverride[] = []): ProviderConfigStore {
  const rows = new Map<string, ProviderOverride>(seed.map((o) => [o.id, o]));
  return {
    async list() { return [...rows.values()]; },
    async get(id) { return rows.has(id) ? { ...rows.get(id)! } : null; },
    async put(o) { rows.set(o.id, { ...o }); },
    async remove(id) { rows.delete(id); },
  };
}

// ===== 最小 fake D1(只实现 d1ProviderConfigStore 会踩的 4 条查询) =====
function fakeDb(seed: Array<{ key: string; value: string }> = []) {
  const rows = seed.slice();
  const makeStmt = (sql: string, args: any[] = []) => ({
    bind: (...more: any[]) => makeStmt(sql, [...args, ...more]),
    async all() {
      if (!sql.includes('LIKE')) return { results: [] };
      const results = rows.filter((r) => r.key.startsWith('provider_config:'));
      return { results: results.map((r) => ({ ...r })) };
    },
    async first() {
      const key = String(args[0]);
      const row = rows.find((r) => r.key === key);
      return row ? { value: row.value } : null;
    },
    async run() {
      const key = String(args[0]);
      if (sql.startsWith('DELETE')) {
        const i = rows.findIndex((r) => r.key === key);
        if (i >= 0) rows.splice(i, 1);
      } else {
        const i = rows.findIndex((r) => r.key === key);
        const row = { key, value: String(args[1]) };
        if (i >= 0) rows[i] = row; else rows.push(row);
      }
      return { meta: { changes: 1 } };
    },
  });
  return { rows, prepare: (sql: string) => makeStmt(sql) } as any;
}

// ===== ProviderConfigStore 契约(内存实现) =====
test('ProviderConfigStore: put/get/list/remove roundtrip preserves fields', async () => {
  const store = memoryStore();
  const o: ProviderOverride = { id: 'deepseek', protocol: 'openai', apiKey: 'sk-abc', baseUrl: 'https://x/v1', model: 'deepseek-chat', maxTokens: 8000 };
  await store.put(o);
  assert.deepEqual(await store.get('deepseek'), o);
  assert.deepEqual(await store.list(), [o]);
  await store.remove('deepseek');
  assert.equal(await store.get('deepseek'), null);
  assert.deepEqual(await store.list(), []);
});

// ===== D1 适配器(fake D1,验证 SQL 路径 + 前缀过滤) =====
test('d1ProviderConfigStore: writes JSON under provider_config:<id> and lists only that prefix', async () => {
  const db = fakeDb([{ key: 'desk_core:P', value: '{"title":"x"}' }, { key: 'provider_config:deepseek', value: '{"id":"deepseek","protocol":"openai","apiKey":"sk-1"}' }]);
  const store = new D1ProviderConfigStore(db);
  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'deepseek');
  assert.equal(list[0].apiKey, 'sk-1');
  assert.equal((await store.get('deepseek'))?.apiKey, 'sk-1');
  assert.equal(await store.get('nope'), null);
  await store.put({ id: 'custom:abc', protocol: 'openai', name: 'My', apiKey: 'k2' });
  assert.equal((await store.list()).length, 2);
  assert.ok(db.rows.some((r) => r.key === 'provider_config:custom:abc' && r.value.includes('"apiKey":"k2"')));
  await store.remove('deepseek');
  const after = await store.list();
  assert.deepEqual(after.map((r) => r.id), ['custom:abc']);
});

// ===== mergeProviderEnv 合成 =====
test('mergeProviderEnv synthesizes <PREFIX>_* keys for registry overrides only', () => {
  const merged = mergeProviderEnv({ DEEPSEEK_API_KEY: 'env-key', OPENAI_MODEL: 'keep' }, [
    { id: 'deepseek', protocol: 'openai', apiKey: 'override-key', baseUrl: 'https://ds/v1', model: 'deepseek-r1', maxTokens: 4096 },
  ]);
  assert.equal(merged.DEEPSEEK_API_KEY, 'override-key');
  assert.equal(merged.DEEPSEEK_BASE_URL, 'https://ds/v1');
  assert.equal(merged.DEEPSEEK_MODEL, 'deepseek-r1');
  assert.equal(merged.DEEPSEEK_MAX_TOKENS, 4096);
  assert.equal(merged.OPENAI_MODEL, 'keep'); // 无关键原样保留
  assert.equal(merged.DEEPSEEK_API_KEY, 'override-key'); // 覆盖优先于 env
});

test('mergeProviderEnv skips registry keys for custom ids and ignores undefined fields', () => {
  const merged = mergeProviderEnv({ DEEPSEEK_API_KEY: 'env-key' }, [
    { id: 'custom:zz', protocol: 'openai', apiKey: 'k' },   // 非注册表 → 不合成
    { id: 'deepseek', protocol: 'openai' },                 // 字段缺省 → 不写
  ]);
  assert.equal(merged.DEEPSEEK_API_KEY, 'env-key');
  assert.equal(merged.DEEPSEEK_BASE_URL, undefined);
  assert.equal('custom:zz' in merged, false);
});

test('mergeProviderEnv with no overrides returns an equivalent shallow copy', () => {
  const env = { DEEPSEEK_API_KEY: 'k', OPENAI_MODEL: 'm' };
  const merged = mergeProviderEnv(env);
  assert.deepEqual(merged, env);
  assert.notEqual(merged, env); // 拷贝而非同引用
});

// ===== listProviders 含 custom =====
test('listProviders appends custom providers after registry groups', () => {
  const providers = listProviders({ DEEPSEEK_API_KEY: 'd' }, [
    { id: 'custom:local', protocol: 'openai', name: '本地网关', baseUrl: 'http://localhost:11434', model: 'qwen2.5' },
    { id: 'custom:nomodel', protocol: 'openai', name: '无模型', apiKey: 'k' },
  ]);
  const ids = providers.map((p) => p.id);
  assert.deepEqual(ids, ['deepseek', 'custom:local', 'custom:nomodel']);
  const local = providers.find((p) => p.id === 'custom:local');
  assert.equal(local?.name, '本地网关');
  assert.equal(local?.protocol, 'openai');
  assert.deepEqual(local?.models, ['qwen2.5']);
  const nomodel = providers.find((p) => p.id === 'custom:nomodel');
  assert.deepEqual(nomodel?.models, []);
});

test('listProviders custom name falls back to id', () => {
  const providers = listProviders({}, [{ id: 'custom:x', protocol: 'openai', apiKey: 'k' }]);
  assert.equal(providers[0].name, 'custom:x');
});

// ===== resolveDeskProvider:覆盖优先于 env =====
test('resolveDeskProvider: registry override wins over env', () => {
  const cfg = resolveDeskProvider({ DEEPSEEK_API_KEY: 'env-key' }, 'deepseek', [
    { id: 'deepseek', protocol: 'openai', apiKey: 'override-key', baseUrl: 'https://ds/v1', model: 'm1', maxTokens: 1234 },
  ]);
  assert.ok(cfg);
  assert.equal(cfg?.apiKey, 'override-key');
  assert.equal(cfg?.baseUrl, 'https://ds/v1');
  assert.equal(cfg?.model, 'm1');
  assert.equal(cfg?.maxTokens, 1234);
});

test('resolveDeskProvider: override can surface a registry provider absent from env', () => {
  const cfg = resolveDeskProvider({}, 'siliconflow', [
    { id: 'siliconflow', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'DeepSeek-V3' },
  ]);
  assert.ok(cfg);
  assert.equal(cfg?.apiKey, '');
  assert.equal(cfg?.baseUrl, 'https://api.siliconflow.cn/v1');
});

// ===== resolveDeskProvider:custom 解析 =====
test('resolveDeskProvider resolves a custom provider present in overrides', () => {
  const cfg = resolveDeskProvider({}, 'custom:local', [
    { id: 'custom:local', protocol: 'openai', name: '本地网关', apiKey: 'k', baseUrl: 'http://localhost:11434/v1', model: 'qwen', maxTokens: 2048 },
  ]);
  assert.ok(cfg);
  assert.equal(cfg?.id, 'custom:local');
  assert.equal(cfg?.name, '本地网关');
  assert.equal(cfg?.protocol, 'openai');
  assert.equal(cfg?.apiKey, 'k');
  assert.equal(cfg?.baseUrl, 'http://localhost:11434/v1');
  assert.equal(cfg?.model, 'qwen');
  assert.equal(cfg?.maxTokens, 2048);
});

test('resolveDeskProvider returns null for custom not in overrides / without key or baseUrl', () => {
  assert.equal(resolveDeskProvider({}, 'custom:ghost', [{ id: 'custom:other', protocol: 'openai', apiKey: 'k' }]), null);
  assert.equal(resolveDeskProvider({}, 'custom:empty', [{ id: 'custom:empty', protocol: 'openai', name: 'x' }]), null);
  assert.equal(resolveDeskProvider({}, 'custom:any', []), null);
  assert.equal(resolveDeskProvider({}, 'deepseek', [{ id: 'custom:any', protocol: 'openai', apiKey: 'k' }]), null); // 注册表项不受 custom 影响
});

// ===== makeDeskBackend 走 overrides =====
test('makeDeskBackend builds OpenAI backend for custom provider via overrides', () => {
  const backend = makeDeskBackend({}, 'custom:local', [
    { id: 'custom:local', protocol: 'openai', apiKey: 'k', baseUrl: 'https://gw.example.com/v1' },
  ]);
  assert.ok(backend instanceof OpenAIStreamBackend);
});

test('makeDeskBackend throws for unconfigured custom provider via overrides', () => {
  assert.throws(() => makeDeskBackend({}, 'custom:local', []), /模型供应商未配置或不存在: custom:local/);
});

// ===== 向后兼容:无 overrides 时行为同旧 =====
test('backward compat: resolveDeskProvider without overrides behaves like before', () => {
  assert.equal(resolveDeskProvider({ DEEPSEEK_API_KEY: 'k', DEEPSEEK_MODEL: 'deepseek-chat' }, 'deepseek')?.model, 'deepseek-chat');
  assert.equal(resolveDeskProvider({}, 'deepseek'), null);
  assert.equal(resolveDeskProvider({ OPENAI_API_KEY: 'k' }, 'deepseek'), null);
});

test('backward compat: listProviders without overrides returns only registry groups', () => {
  assert.deepEqual(listProviders({ DEEPSEEK_API_KEY: 'd' }).map((p) => p.id), ['deepseek']);
  assert.deepEqual(listProviders({}), []);
});

test('backward compat: makeDeskBackend legacy channel unchanged', () => {
  assert.ok(makeDeskBackend({ OPENAI_API_KEY: 'k' }) instanceof OpenAIStreamBackend);
  assert.ok(makeDeskBackend({ ANTHROPIC_API_KEY: 'a' }) instanceof AnthropicStreamBackend);
  assert.ok(makeDeskBackend({ OPENAI_API_KEY: 'k' }, 'opencode') instanceof OpenAIStreamBackend);
  assert.ok(makeDeskBackend({ ANTHROPIC_API_KEY: 'a' }, 'anthropic') instanceof AnthropicStreamBackend);
});

test('PROVIDER_REGISTRY_IDS matches the registry ids', () => {
  assert.deepEqual(PROVIDER_REGISTRY_IDS, ['opencode', 'anthropic', 'deepseek', 'siliconflow']);
});

// ===== 「获取模型名称」:models 端点 URL 推导 + 响应解析 =====
test('providerModelsUrl: openai 补 /models,anthropic 去 /messages 再拼', () => {
  assert.equal(providerModelsUrl('openai', 'https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/models');
  assert.equal(providerModelsUrl('openai', 'https://api.siliconflow.cn/v1/'), 'https://api.siliconflow.cn/v1/models');
  assert.equal(providerModelsUrl('openai', 'https://gw.example.com/v1/chat/completions'), 'https://gw.example.com/v1/models');
  assert.equal(providerModelsUrl('openai', undefined), 'https://api.deepseek.com/v1/models');
  assert.equal(providerModelsUrl('anthropic', 'https://api.anthropic.com/v1/messages'), 'https://api.anthropic.com/v1/models');
  assert.equal(providerModelsUrl('anthropic', 'https://gw.example.com/v1/messages'), 'https://gw.example.com/v1/models');
  assert.equal(providerModelsUrl('anthropic', undefined), 'https://api.anthropic.com/v1/models');
});

test('parseProviderModels: 抽 { data: [{id}] } 里的 id 列表', () => {
  assert.deepEqual(parseProviderModels({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { nope: 1 }] }), ['deepseek-chat', 'deepseek-reasoner']);
  assert.deepEqual(parseProviderModels({ data: [] }), []);
  assert.deepEqual(parseProviderModels({ data: 'x' }), []);
  assert.deepEqual(parseProviderModels(null), []);
  assert.deepEqual(parseProviderModels(undefined), []);
  assert.deepEqual(parseProviderModels({}), []);
});

// ===== 自定义 Anthropic 兼容供应商(协议可 anthropic) =====
test('custom provider supports anthropic protocol end-to-end', () => {
  const ov: ProviderOverride = { id: 'custom:gw', name: '自家网关', protocol: 'anthropic', apiKey: 'k', baseUrl: 'https://gw.example.com/v1/messages', model: 'claude-x' };
  const listed = listProviders({}, [ov]).find((p) => p.id === 'custom:gw');
  assert.equal(listed?.protocol, 'anthropic');
  assert.equal(listed?.name, '自家网关');
  const cfg = resolveDeskProvider({}, 'custom:gw', [ov]);
  assert.equal(cfg?.protocol, 'anthropic');
  assert.equal(cfg?.baseUrl, 'https://gw.example.com/v1/messages');
  assert.ok(makeDeskBackend({}, 'custom:gw', [ov]) instanceof AnthropicStreamBackend);
});

// ===== 占位 key 判定(模板值不算"已配置",见简报「占位 key 陷阱」) =====
test('isPlaceholderKey recognizes template placeholder keys', () => {
  assert.equal(isPlaceholderKey('put-your-Anthropic-API-Key-here'), true);
  assert.equal(isPlaceholderKey('put-a-strong-password-here'), true);
  assert.equal(isPlaceholderKey('<your-api-key>'), true);
  assert.equal(isPlaceholderKey('REPLACE_WITH_YOUR_KEY'), true);
  assert.equal(isPlaceholderKey('YOUR_API_KEY'), true);
  assert.equal(isPlaceholderKey(''), false);
  assert.equal(isPlaceholderKey(undefined), false);
  assert.equal(isPlaceholderKey(null), false);
});

test('isPlaceholderKey keeps real keys', () => {
  assert.equal(isPlaceholderKey('sk-real-key-123'), false);
  assert.equal(isPlaceholderKey('sk-891eee02d9e74e68bd091ddd73d9602c'), false);
  assert.equal(isPlaceholderKey('ant-key'), false);
});

test('deskProviderConfigured treats placeholder key as not configured', () => {
  const def = { id: 'anthropic', name: 'Anthropic', prefix: 'ANTHROPIC', protocol: 'anthropic' as const, defaultModels: ['claude-sonnet-4-5'] };
  assert.equal(deskProviderConfigured({ ANTHROPIC_API_KEY: 'put-your-Anthropic-API-Key-here' }, def), false);
  assert.equal(deskProviderConfigured({ ANTHROPIC_API_KEY: 'sk-real' }, def), true);
  assert.equal(deskProviderConfigured({ ANTHROPIC_API_KEY: 'put-your-Anthropic-API-Key-here', ANTHROPIC_BASE_URL: 'https://gw.example.com/v1/messages' }, def), true);
  assert.equal(deskProviderConfigured({ ANTHROPIC_BASE_URL: 'https://gw.example.com/v1/messages' }, def), true);
});

test('listProviders excludes providers whose only key is a placeholder', () => {
  const ids = listProviders({ ANTHROPIC_API_KEY: 'put-your-Anthropic-API-Key-here' }).map((p) => p.id);
  assert.ok(!ids.includes('anthropic'), `placeholder-only should not list anthropic, got ${ids}`);
  assert.deepEqual(listProviders({ ANTHROPIC_API_KEY: 'put-your-Anthropic-API-Key-here', DEEPSEEK_API_KEY: 'sk-real' }).map((p) => p.id), ['deepseek']);
});
