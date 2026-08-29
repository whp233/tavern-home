import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIStreamBackend, openAiEndpoint, makeDeskBackend, AnthropicStreamBackend } from '../src/adapters/streamModelBackends.ts';

const args = { system: [{ text: 'system', cache: true }], prompt: 'prompt', model: 'deepseek-chat' };

const fakeFetch = (body: string, status = 200, inspect?: (input: RequestInfo | URL, init?: RequestInit) => void) =>
  (async (input, init) => { inspect?.(input, init); return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } }); }) as typeof fetch;

const sse = (...lines: string[]) => lines.join('\n');

test('openai clean stream yields ok with text/thinking/usage', async () => {
  const body = sse(
    'data: {"choices":[{"index":0,"delta":{"reasoning_content":"step one"},"finish_reason":null}]}',
    'data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
    'data: {"choices":[{"index":0,"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"prompt_cache_hit_tokens":3,"prompt_cache_miss_tokens":7}}',
    'data: [DONE]',
    '',
  );
  const events: string[] = [];
  const result = await new OpenAIStreamBackend({ apiKey: 'key', model: 'deepseek-chat', fetch: fakeFetch(body) }).streamChat({ ...args, onEvent: (ev) => { events.push(ev.type); } });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.terminal, 'clean');
    assert.equal(result.text, 'Hello world');
    assert.equal(result.thinking, 'step one');
    assert.equal(result.stopReason, 'stop');
    assert.deepEqual(result.usage, { input: 10, output: 5, cacheRead: 3, cacheWrite: 7 });
  }
  assert.ok(events.includes('thinking'));
  assert.ok(events.includes('text'));
});

test('openai separate usage tail chunk after finish_reason is accepted', async () => {
  // OpenAI 官方格式:finish_reason 后再发一条 choices:[] + usage 才 [DONE]。该 usage 行不算流异常。
  const body = sse(
    'data: {"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":"stop"}],"usage":null}',
    'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2}}',
    'data: [DONE]',
    '',
  );
  const result = await new OpenAIStreamBackend({ apiKey: 'key', fetch: fakeFetch(body) }).streamChat(args);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.usage, { input: 4, output: 2, cacheRead: 0, cacheWrite: 0 });
});

test('openai eof without [DONE] is protocol failure', async () => {
  const body = 'data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":"stop"}]}\n';
  const result = await new OpenAIStreamBackend({ apiKey: 'key', fetch: fakeFetch(body) }).streamChat(args);
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.kind, 'protocol'); assert.equal(result.detail, 'eof without [DONE]'); }
});

test('openai content after terminal is protocol failure', async () => {
  const body = sse(
    'data: {"choices":[{"index":0,"delta":{"content":"first"},"finish_reason":"stop"}]}',
    'data: {"choices":[{"index":0,"delta":{"content":"after"},"finish_reason":null}]}',
    'data: [DONE]',
    '',
  );
  const result = await new OpenAIStreamBackend({ apiKey: 'key', fetch: fakeFetch(body) }).streamChat(args);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, 'protocol');
});

test('openai unrecognized finish_reason is protocol failure', async () => {
  const body = sse(
    'data: {"choices":[{"index":0,"delta":{"content":"x"},"finish_reason":"content_filter"}]}',
    'data: [DONE]',
    '',
  );
  const result = await new OpenAIStreamBackend({ apiKey: 'key', fetch: fakeFetch(body) }).streamChat(args);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, 'protocol');
});
test('openai length finish_reason is a limit failure, not protocol or clean', async () => {
  const body = sse(
    'data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":"length"}]}',
    'data: [DONE]',
    '',
  );
  const result = await new OpenAIStreamBackend({ apiKey: 'key', fetch: fakeFetch(body) }).streamChat(args);
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.kind, 'limit'); assert.equal(result.detail, 'length'); }
});

test('openai http status is http failure', async () => {
  const result = await new OpenAIStreamBackend({ apiKey: 'key', fetch: fakeFetch('', 400) }).streamChat(args);
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.kind, 'http'); assert.equal(result.detail, '400'); }
});

test('openai empty text is empty failure', async () => {
  const body = sse(
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]',
    '',
  );
  const result = await new OpenAIStreamBackend({ apiKey: 'key', fetch: fakeFetch(body) }).streamChat(args);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, 'empty');
});

test('openai malformed json data line is protocol failure', async () => {
  const body = sse(
    'data: {not json',
    'data: [DONE]',
    '',
  );
  const result = await new OpenAIStreamBackend({ apiKey: 'key', fetch: fakeFetch(body) }).streamChat(args);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, 'protocol');
});

test('openai missing api key or bad endpoint is config failure', async () => {
  {
    const result = await new OpenAIStreamBackend({ apiKey: '', fetch: fakeFetch('') }).streamChat(args);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, 'config');
  }
  {
    const result = await new OpenAIStreamBackend({ apiKey: 'key', baseUrl: 'garbage', fetch: fakeFetch('') }).streamChat(args);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, 'config');
  }
});

test('openai request body never carries thinking/output_config and honors streamUsage=false', async () => {
  let captured: any = null;
  const body = sse(
    'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}',
    'data: [DONE]',
    '',
  );
  const result = await new OpenAIStreamBackend({ apiKey: 'key', model: 'deepseek-chat', streamUsage: false, fetch: fakeFetch(body, 200, (_i, init) => { captured = JSON.parse(String(init?.body)); }) }).streamChat(args);
  assert.equal(result.ok, true);
  assert.ok(captured);
  assert.equal(captured.model, 'deepseek-chat');
  assert.equal(captured.stream, true);
  assert.equal(captured.max_tokens, 16000);
  assert.equal(captured.stream_options, undefined);
  assert.equal(captured.thinking, undefined);
  assert.equal(captured.output_config, undefined);
  assert.equal(captured.messages[0].role, 'system');
  assert.equal(captured.messages[0].content, 'system');
  assert.equal(captured.messages[1].content, 'prompt');
});

test('openAiEndpoint validates https, localhost http exception, and rejects garbage', () => {
  assert.equal(openAiEndpoint(undefined), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(openAiEndpoint('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(openAiEndpoint('https://api.deepseek.com/v1/chat/completions'), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(openAiEndpoint('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
  assert.equal(openAiEndpoint('http://localhost:10999'), null);
  assert.equal(openAiEndpoint('http://localhost:10999', true), 'http://localhost:10999/chat/completions');
  assert.equal(openAiEndpoint('http://127.0.0.1:10999', true), 'http://127.0.0.1:10999/chat/completions');
  assert.equal(openAiEndpoint('http://[::1]:10999', true), 'http://[::1]:10999/chat/completions');
  assert.equal(openAiEndpoint('http://example.com', true), null);
  assert.equal(openAiEndpoint('https://user:pass@api.deepseek.com/v1'), null);
  assert.equal(openAiEndpoint('garbage'), null);
});

test('makeDeskBackend routes by OPENAI channel presence', () => {
  assert.ok(makeDeskBackend({ OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'a' }) instanceof OpenAIStreamBackend);
  assert.ok(makeDeskBackend({ OPENAI_BASE_URL: 'http://localhost:10999' }) instanceof OpenAIStreamBackend);
  assert.ok(makeDeskBackend({ ANTHROPIC_API_KEY: 'a' }) instanceof AnthropicStreamBackend);
  assert.ok(makeDeskBackend({}) instanceof AnthropicStreamBackend);
});
