// tests/homeSave.test.ts
// 酒馆之家存档（task-16）：纯函数层测试

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHomeSave,
  formatMeijuExportDate,
  detectSaveFormat,
  detectObjectSaveFormat,
  parseSavePayload,
  parseHomeSaveObject,
  convertMeijuBackup,
  planHomeImport,
  emptyExistingSummary,
  diaryKeyOf,
  memoryKeyOf,
  studyKeyOf,
  HOME_SAVE_VERSION,
  emptyGameData,
} from '../src/core/homeSave.ts';
import type { NormalizedImport } from '../src/core/homeSave.ts';

test('buildHomeSave: defaults and slotId', () => {
  const f = buildHomeSave();
  assert.equal(f.version, HOME_SAVE_VERSION);
  assert.ok(f.timestamp);
  assert.ok(f.exportDate);
  assert.equal(f.slotId, 'tavern-home');
  assert.deepEqual(f.data.gameData, emptyGameData());
  assert.deepEqual(f.data.diary, []);
  assert.deepEqual(f.data.deskMemories, []);
});

test('buildHomeSave: custom slotId and data', () => {
  const now = new Date('2026-08-23T12:00:00.000Z');
  const f = buildHomeSave({
    gameData: { windows: [{ id: 'w1' }], floors: [], studyEntries: [], chapters: [], customCg: [], stickyNotes: [] },
    diary: [{ date: '2026/8/23', content: 'hello' }],
    deskMemories: [{ project: 'p1', content: 'm1' }],
    slotId: 'my-slot',
    now,
  });
  assert.equal(f.slotId, 'my-slot');
  assert.equal(f.timestamp, now.toISOString());
  assert.equal((f.data.gameData.windows as unknown[]).length, 1);
  assert.equal(f.data.diary.length, 1);
});

test('formatMeijuExportDate: shape', () => {
  const d = new Date(2026, 7, 23, 15, 35, 11);
  const s = formatMeijuExportDate(d);
  assert.match(s, /^2026\/8\/23 /);
  assert.ok(s.includes('3:35:11') || s.includes('15:35:11'));
});

test('detectSaveFormat: home', () => {
  const raw = JSON.stringify({ version: HOME_SAVE_VERSION, slotId: 'tavern-home', timestamp: new Date().toISOString(), exportDate: '2026/8/23', data: { gameData: {}, diary: [], deskMemories: [], settings: {} } });
  assert.equal(detectSaveFormat(raw), 'home');
});

test('detectSaveFormat: meiju', () => {
  const raw = JSON.stringify({ version: '1.0.0', slotId: 'slot_1', timestamp: new Date().toISOString(), exportDate: '2026/7/12', data: { gameData: {}, diary: [{ date: '2026/6/27', content: 'x' }], settings: {}, prompts: { a: { name: 'Yuki' } } } });
  assert.equal(detectSaveFormat(raw), 'meiju');
});

test('detectSaveFormat: st_chat JSONL', () => {
  const raw = '{"is_user":true,"mes":"hello"}' + "\n" + '{"is_user":false,"mes":"hi"}' + "\n";
  assert.equal(detectSaveFormat(raw), 'st_chat');
});

test('detectSaveFormat: unknown', () => {
  assert.equal(detectSaveFormat('not json at all'), null);
  assert.equal(detectSaveFormat(''), null);
  assert.equal(detectSaveFormat(JSON.stringify({ foo: 'bar' })), null);
});

test('detectObjectSaveFormat: direct', () => {
  assert.equal(detectObjectSaveFormat({ data: { deskMemories: [] } }), 'home');
  assert.equal(detectObjectSaveFormat({ data: { diary: [] } }), 'meiju');
  assert.equal(detectObjectSaveFormat({ data: {} }), null);
  assert.equal(detectObjectSaveFormat(null), null);
});

test('parseSavePayload: home minimal', () => {
  const file = buildHomeSave({ diary: [{ project: '', charKey: '', date: '2026/8/23', time: '下午3:00:00', title: '', content: 'test diary', affection: null, conversationId: '', conversationLength: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
  const raw = JSON.stringify(file);
  const r = parseSavePayload(raw);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.format, 'home');
    assert.ok(r.home);
    assert.equal(r.home!.diaries.length, 1);
    assert.equal(r.home!.diaries[0].content, 'test diary');
  }
});

test('parseSavePayload: meiju prompts -> studyEntries', () => {
  const raw = JSON.stringify({
    version: '1.0.0', slotId: 'slot_1', timestamp: new Date().toISOString(), exportDate: '2026/7/12',
    data: {
      gameData: {}, settings: {},
      diary: [{ date: '2026/6/27', time: '下午3:35:11', content: 'diary content here', affection: 100, diaryId: 'abc' }],
      prompts: { 'sister-1': { name: 'Yuki', creator_notes: 'test' } },
    },
  });
  const r = parseSavePayload(raw);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.format, 'meiju');
    assert.ok(r.home);
    assert.equal(r.home!.diaries.length, 1);
    assert.equal(r.home!.studyEntries.length, 1);
    assert.equal(r.home!.studyEntries[0].title, 'Yuki');
    assert.ok(r.warnings.length > 0);
  }
});

test('parseSavePayload: st_chat', () => {
  const raw = '{"is_user":true,"mes":"user hello"}' + "\n" + '{"is_user":false,"mes":"assistant hi"}' + "\n";
  const r = parseSavePayload(raw);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.format, 'st_chat');
    assert.equal(r.floors.length, 2);
    assert.equal(r.floors[0].role, 'user');
    assert.equal(r.floors[0].content, 'user hello');
    assert.equal(r.floors[1].role, 'assistant');
  }
});

test('parseSavePayload: invalid', () => {
  const r = parseSavePayload('not json and not jsonl');
  assert.equal(r.ok, false);
});

test('parseSavePayload: home with bad diary rows skipped', () => {
  const raw = JSON.stringify({
    version: HOME_SAVE_VERSION, slotId: 'tavern-home', timestamp: new Date().toISOString(), exportDate: '2026/8/23',
    data: {
      gameData: { windows: [], floors: [], studyEntries: [], chapters: [], customCg: [], stickyNotes: [] },
      diary: [
        { date: '2026/8/23', content: 'good' },
        { date: 'bad-date', content: 'bad date row' },
        { content: '' },
      ],
      deskMemories: [], settings: {},
    },
  });
  const r = parseSavePayload(raw);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.home!.diaries.length, 1);
    assert.ok(r.warnings.length >= 2);
  }
});

test('planHomeImport: empty incoming -> nothingToDo', () => {
  const incoming: NormalizedImport = {
    format: 'home', version: HOME_SAVE_VERSION, slotId: 'tavern-home', exportedAt: new Date().toISOString(),
    sourceName: '', windows: [], diaries: [], deskMemories: [], studyEntries: [], chapters: [], customCg: [], stickyNotes: [], settingsRaw: {},
  };
  const plan = planHomeImport(incoming, emptyExistingSummary());
  assert.equal(plan.nothingToDo, true);
  assert.equal(plan.duplicatesSkipped, 0);
});

test('planHomeImport: diary dedup', () => {
  const incoming: NormalizedImport = {
    format: 'home', version: HOME_SAVE_VERSION, slotId: 'tavern-home', exportedAt: new Date().toISOString(),
    sourceName: '', windows: [],
    diaries: [{ project: 'p1', charKey: '', date: '2026/8/23', time: '下午3:00:00', title: '', content: 'hello', affection: null, conversationId: '', conversationLength: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    deskMemories: [], studyEntries: [], chapters: [], customCg: [], stickyNotes: [], settingsRaw: {},
  };
  const existing = emptyExistingSummary();
  existing.diaryKeys.add(diaryKeyOf({ project: 'p1', charKey: '', date: '2026/8/23', content: 'hello' }));
  const plan = planHomeImport(incoming, existing);
  assert.equal(plan.add.diaries, 0);
  assert.equal(plan.duplicatesSkipped, 1);
});

test('planHomeImport: study conflict', () => {
  const incoming: NormalizedImport = {
    format: 'home', version: HOME_SAVE_VERSION, slotId: 'tavern-home', exportedAt: new Date().toISOString(),
    sourceName: '', windows: [], diaries: [], deskMemories: [],
    studyEntries: [{ project: 'p1', category: 'world', title: 'World A', tags: [], chapter: '', content: 'content', lore: { keys: [], position: 'before', isCharacter: false, constant: false, triggerMode: 'scan', enabled: true, fields: {} } }],
    chapters: [], customCg: [], stickyNotes: [], settingsRaw: {},
  };
  const existing = emptyExistingSummary();
  existing.studyKeys.add(studyKeyOf({ project: 'p1', category: 'world', title: 'World A' }));
  const plan = planHomeImport(incoming, existing);
  assert.equal(plan.add.studyEntries, 0);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].domain, 'studyEntries');
});

test('diaryKeyOf / memoryKeyOf stability', () => {
  assert.equal(diaryKeyOf({ project: 'p', charKey: 'c', date: '2026/8/23', content: 'hi' }), 'p' + "\u0000" + 'c' + "\u0000" + '2026/8/23' + "\u0000" + 'hi');
  assert.equal(memoryKeyOf({ project: 'p', charKey: 'c', layer: 'plot', theme: '其他', title: 't', content: 'hi' }), 'p' + "\u0000" + 'c' + "\u0000" + 'plot' + "\u0000" + '其他' + "\u0000" + 't' + "\u0000" + 'hi');
  assert.equal(studyKeyOf({ project: 'p', category: 'world', title: 't' }), 'p' + "\u0000" + 'world' + "\u0000" + 't');
});

test('parseHomeSaveObject: missing data -> error', () => {
  const r = parseHomeSaveObject({ version: '1.0.0', slotId: 'x' });
  assert.equal(r.ok, false);
});

test('convertMeijuBackup: empty -> error', () => {
  const r = convertMeijuBackup({ version: '1.0.0', slotId: 'x', timestamp: new Date().toISOString(), exportDate: '2026/7/12', data: { gameData: {}, settings: {}, diary: [], prompts: {} } });
  assert.equal(r.ok, false);
});