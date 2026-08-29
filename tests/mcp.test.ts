import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DEFINITIONS, handleMcpPost } from '../examples/cloudflare/mcp.ts';

// 最小 D1 mock：仅为不触 DB 的方法提供空桩；触 DB 的工具在单测中不调用
function mockEnv() {
  return {
    OC_DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
      batch: async () => [],
    },
  } as any;
}

async function mcpCall(env: any, body: any) {
  const req = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const resp = await handleMcpPost(req, env);
  const text = await resp.text();
  if (!text) return { status: resp.status, body: null };
  return { status: resp.status, body: JSON.parse(text) };
}

describe('mcp tool definitions', () => {
  it('exposes expected core tools', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    for (const must of ['list_presets', 'import_character_card', 'list_lore', 'create_lore', 'list_windows', 'create_window', 'list_memories', 'create_memory', 'diary_list']) {
      assert.ok(names.includes(must), `missing ${must}`);
    }
    assert.ok(TOOL_DEFINITIONS.length >= 18, 'should have at least 18 tools');
  });

  it('each tool has inputSchema', () => {
    for (const t of TOOL_DEFINITIONS) {
      assert.equal(t.inputSchema.type, 'object');
      assert.ok(t.description.length > 10);
    }
  });
});

describe('mcp json-rpc', () => {
  let env: any;
  before(() => { env = mockEnv(); });

  it('initialize returns protocolVersion and capabilities', async () => {
    const { status, body } = await mcpCall(env, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.equal(status, 200);
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 1);
    assert.ok(body.result.protocolVersion);
    assert.ok(body.result.capabilities.tools);
  });

  it('tools/list returns tools', async () => {
    const { status, body } = await mcpCall(env, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.result.tools));
    assert.ok(body.result.tools.length >= 18);
  });

  it('ping returns empty', async () => {
    const { status, body } = await mcpCall(env, { jsonrpc: '2.0', id: 3, method: 'ping', params: {} });
    assert.equal(status, 200);
    assert.deepEqual(body.result, {});
  });

  it('unknown method returns -32601', async () => {
    const { status, body } = await mcpCall(env, { jsonrpc: '2.0', id: 4, method: 'unknown/method', params: {} });
    assert.equal(status, 200);
    assert.equal(body.error.code, -32601);
  });

  it('notifications/initialized with no id returns 202', async () => {
    const req = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });
    const resp = await handleMcpPost(req, env);
    assert.equal(resp.status, 202);
  });

  it('tools/call unknown tool returns error content', async () => {
    const { status, body } = await mcpCall(env, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'no_such_tool', arguments: {} },
    });
    assert.equal(status, 200);
    assert.ok(body.result.content[0].text.includes('未知工具'));
    assert.equal(body.result.isError, true);
  });

  it('batch request returns array', async () => {
    const { status, body } = await mcpCall(env, [
      { jsonrpc: '2.0', id: 10, method: 'ping', params: {} },
      { jsonrpc: '2.0', id: 11, method: 'tools/list', params: {} },
    ]);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 2);
  });
});
