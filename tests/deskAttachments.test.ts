// 打字桌附件功能测试：isTextOnlyModel / buildAnthropicUserContent / buildOpenAiUserContent /
// normalizeAttachments / handleDeskChat 附件分支（纯文本模型+图片→400、空消息+文本附件放行）。
// desk 链（src/chat/desk.ts → './models'、'../storage/vectorize' 等无扩展名导入）裸 `node --test`
// 的 ESM 解析不认，照 readingTrash.test.ts 先 node:module.register 挂 tests/resolve-ext.mjs
// （只在默认解析失败时补 .ts 扩展名），再动态 import。不改任何 src 文件。

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createMemoryStorage } from '../src/adapters/memoryStorage.ts';

register(new URL('./resolve-ext.mjs', import.meta.url));

const { isTextOnlyModel } = await import('../src/core/modelBackend.ts');
const { buildAnthropicUserContent, buildOpenAiUserContent } = await import('../src/adapters/streamModelBackends.ts');
const { normalizeAttachments, handleDeskChat } = await import('../src/chat/desk.ts');

const baseArgs = { system: [{ text: 'system', cache: true }], prompt: 'prompt', model: 'claude-sonnet-4-6' };

const PNG = { kind: 'image' as const, name: 'pic.png', mime: 'image/png', data: 'cGlj' };
const JPEG = { kind: 'image' as const, name: 'p.jpg', mime: 'image/jpeg', data: 'amZqZg==' };
const TEXT = { kind: 'text' as const, name: 'notes.txt', content: 'attachment body' };
const TEXT2 = { kind: 'text' as const, name: 'more.md', content: 'second body' };

// ===== isTextOnlyModel =====

test('isTextOnlyModel classifies known text-only and vision models', () => {
  const textOnly = ['deepseek-chat', 'deepseek-v4-flash', 'step-3.7-flash'];
  for (const model of textOnly) assert.equal(isTextOnlyModel(model), true, model);
  const vision = ['qwen2.5-vl-7b', 'gpt-4o', 'claude-sonnet-4-5', 'step-1v'];
  for (const model of vision) assert.equal(isTextOnlyModel(model), false, model);
  assert.equal(isTextOnlyModel(''), false);
  assert.equal(isTextOnlyModel(undefined as unknown as string), false);
});

// ===== buildAnthropicUserContent =====

test('buildAnthropicUserContent keeps a plain string when there are no images', () => {
  assert.equal(buildAnthropicUserContent(baseArgs), 'prompt');
  assert.equal(buildAnthropicUserContent({ ...baseArgs, images: [] }), 'prompt');
  assert.equal(buildAnthropicUserContent({ ...baseArgs, images: undefined }), 'prompt');
});

test('buildAnthropicUserContent emits base64 image blocks when images are present', () => {
  const out = buildAnthropicUserContent({ ...baseArgs, images: [PNG, JPEG] });
  assert.ok(Array.isArray(out));
  assert.deepEqual(out, [
    { type: 'text', text: 'prompt' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'cGlj' } },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'amZqZg==' } },
  ]);
});

// ===== buildOpenAiUserContent =====

test('buildOpenAiUserContent keeps a plain string when there are no images', () => {
  assert.equal(buildOpenAiUserContent(baseArgs), 'prompt');
  assert.equal(buildOpenAiUserContent({ ...baseArgs, images: [] }), 'prompt');
});

test('buildOpenAiUserContent emits data-URL image_url blocks when images are present', () => {
  const out = buildOpenAiUserContent({ ...baseArgs, images: [PNG, JPEG] });
  assert.ok(Array.isArray(out));
  assert.deepEqual(out, [
    { type: 'text', text: 'prompt' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,cGlj' } },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,amZqZg==' } },
  ]);
});

// ===== normalizeAttachments =====

test('normalizeAttachments treats undefined/null as empty', () => {
  assert.deepEqual(normalizeAttachments(undefined), { ok: true, texts: [], images: [] });
  assert.deepEqual(normalizeAttachments(null), { ok: true, texts: [], images: [] });
});

test('normalizeAttachments rejects a non-array payload', () => {
  assert.equal(normalizeAttachments('nope').ok, false);
  assert.equal(normalizeAttachments({ kind: 'text', content: 'x' }).ok, false);
  assert.equal(normalizeAttachments(5).ok, false);
});

test('normalizeAttachments rejects more than 8 attachments', () => {
  const nine = Array.from({ length: 9 }, () => ({ ...PNG }));
  assert.equal(normalizeAttachments(nine).ok, false);
});

test('normalizeAttachments rejects an unknown kind and a non-object item', () => {
  assert.equal(normalizeAttachments([{ kind: 'audio', data: 'x' }]).ok, false);
  assert.equal(normalizeAttachments(['x']).ok, false);
});

test('normalizeAttachments rejects an unsupported image mime', () => {
  assert.equal(normalizeAttachments([{ kind: 'image', name: 'x.bmp', mime: 'image/bmp', data: 'AAA' }]).ok, false);
});

test('normalizeAttachments rejects an empty image data', () => {
  assert.equal(normalizeAttachments([{ kind: 'image', name: 'x.png', mime: 'image/png', data: '' }]).ok, false);
});

test('normalizeAttachments rejects an empty text attachment', () => {
  assert.equal(normalizeAttachments([{ kind: 'text', name: 'x.txt', content: '' }]).ok, false);
  assert.equal(normalizeAttachments([{ kind: 'text', name: 'x.txt' }]).ok, false);
});

test('normalizeAttachments accepts text up to 500KB and rejects over 500KB', () => {
  // 上限已从 50KB 放宽到 500KB(2026-08-09):>50KB 的大文件仅当次传不落库,500KB 封顶。
  const okSize = { kind: 'text', name: 'medium.txt', content: 'x'.repeat(500 * 1024) };
  assert.equal(normalizeAttachments([okSize]).ok, true);
  const tooLong = { kind: 'text', name: 'big.txt', content: 'x'.repeat(500 * 1024 + 1) };
  assert.equal(normalizeAttachments([tooLong]).ok, false);
});

test('normalizeAttachments rejects a single image over 8MB', () => {
  const huge = { kind: 'image', name: 'huge.png', mime: 'image/png', data: 'x'.repeat(8 * 1024 * 1024 + 1) };
  assert.equal(normalizeAttachments([huge]).ok, false);
});

test('normalizeAttachments splits a valid mix of texts and images', () => {
  const out = normalizeAttachments([TEXT, PNG, TEXT2]);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.deepEqual(out.texts, [TEXT, TEXT2]);
  assert.deepEqual(out.images, [PNG]);
});

test('normalizeAttachments rejects when total base64 length exceeds 30MB', () => {
  // 单图上限 8MB，4 张顶格图累加必然越过 30MB 总上限（4 × 8388608 = 33554432 > 31457280）。
  const imgs = Array.from({ length: 4 }, () => ({ ...PNG, data: 'x'.repeat(8 * 1024 * 1024) }));
  assert.equal(normalizeAttachments(imgs).ok, false);
});

// ===== handleDeskChat 附件分支 =====
// env 用 provider='opencode'（OPENAI 前缀）走显式供应商分支：model 直接取 params.model，
// 不夹回 claude 白名单，才能让 'deepseek-chat' 触发纯文本模型 + 图片的 400。
// case ② 里 OPENAI_BASE_URL 指向本机拒绝连接端口，后台 pump 的 fetch 立刻失败、
// 不碰真实网络，测试只关心楼层落库与「message 不能为空」不被误报。

function chatStorageFor(seed: Parameters<typeof createMemoryStorage>[0]) {
  const storage = createMemoryStorage(seed);
  return {
    storage,
    chat: { deskStorage: storage.desk, turnStorage: storage.deskTurn, deskAssets: storage.deskAssets, deskStory: storage.deskStory },
  };
}

const deskSeed = {
  deskWindows: [{ id: 'w', project: 'P', title: 'W', recipeId: 'light', note: '', noteDepth: 3, stateBoard: {}, timelineState: {}, vars: {}, createdAt: 't0', updatedAt: 't0' }],
  deskRecipes: [{ id: 'light', presetId: 'p', weight: 'light' as const, overrides: {}, regexIds: [], lightSystem: 'Write the next scene.' }],
  deskPresetIds: ['p'],
};

test('handleDeskChat rejects images with a 400 for a text-only model', async () => {
  const { chat } = chatStorageFor(deskSeed);
  const env = { OPENAI_API_KEY: 'k' };
  const resp = await handleDeskChat(env, {
    window_id: 'w',
    message: 'hello',
    model: 'deepseek-chat',
    provider: 'opencode',
    attachments: [{ kind: 'image', name: 'p.png', mime: 'image/png', data: 'cGlj' }],
  }, chat);
  assert.equal(resp.status, 400);
  const body: any = await resp.json();
  assert.match(String(body.error), /不支持图片/);
});

test('handleDeskChat allows an image-only request for a vision model (passes the text-only gate)', async () => {
  const { chat, storage } = chatStorageFor(deskSeed);
  const env = { OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'https://127.0.0.1:1' };
  const resp = await handleDeskChat(env, {
    window_id: 'w',
    message: '',
    model: 'qwen2.5-vl-7b',
    provider: 'opencode',
    attachments: [{ kind: 'image', name: 'p.png', mime: 'image/png', data: 'cGlj' }],
  }, chat);
  assert.notEqual(resp.status, 400);
  const floors = await storage.desk.listFloors('w');
  assert.equal(floors.length, 1);
  assert.equal(floors[0].role, 'user');
  await resp.text(); // 排空 SSE，让后台 pump 收尾
});

test('handleDeskChat allows an empty message with a text attachment and persists its text into the user floor', async () => {
  const { chat, storage } = chatStorageFor(deskSeed);
  const env = { OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'https://127.0.0.1:1' };
  const resp = await handleDeskChat(env, {
    window_id: 'w',
    message: '',
    model: 'deepseek-chat',
    provider: 'opencode',
    attachments: [{ kind: 'text', name: 'notes.txt', content: 'attachment body' }],
  }, chat);
  assert.notEqual(resp.status, 400, '空消息 + 文本附件不该报「message 不能为空」');
  const floors = await storage.desk.listFloors('w');
  const userFloor = floors[floors.length - 1];
  assert.equal(userFloor.role, 'user');
  assert.match(userFloor.content, /\[文件: notes\.txt\]/);
  assert.ok(userFloor.content.includes('attachment body'));
  await resp.text(); // 排空 SSE，让后台 pump 收尾
});

test('handleDeskChat merges text attachments into the message floor content alongside typed text', async () => {
  const { chat, storage } = chatStorageFor(deskSeed);
  const env = { OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'https://127.0.0.1:1' };
  const resp = await handleDeskChat(env, {
    window_id: 'w',
    message: '开写',
    model: 'deepseek-chat',
    provider: 'opencode',
    attachments: [{ kind: 'text', name: 'outline.md', content: '第一章：入府' }],
  }, chat);
  assert.notEqual(resp.status, 400);
  const floors = await storage.desk.listFloors('w');
  const userFloor = floors[floors.length - 1];
  assert.match(userFloor.content, /^开写/);
  assert.match(userFloor.content, /\[文件: outline\.md\]/);
  assert.ok(userFloor.content.includes('第一章：入府'));
  await resp.text();
});
