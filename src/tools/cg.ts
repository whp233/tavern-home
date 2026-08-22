// src/tools/cg.ts
// 酒馆之家「自定义 CG」REST 数据层（task-14）：条目 CRUD + 可选 state 解锁判断。
// 口径对齐 src/tools/diary.ts：部署者书房页自己用的 REST 接口，DB 走 D1CgStorage。
// 校验/求值在 src/core/cgService.ts（纯函数）。

import type { CgStorage } from '../core/storage.ts';
import type { CustomCgEntry } from '../core/types.ts';
import { buildCgId, validateCgBody, isCgUnlocked, CG_LIST_LIMIT_MAX } from '../core/cgService.ts';
import { D1CgStorage } from '../../examples/cloudflare/adapters/d1CgStorage.ts';

interface CgEnv {
  OC_DB: D1Database;
}

const LIST_LIMIT_DEFAULT = 200;

function storeOf(env: CgEnv): CgStorage {
  return new D1CgStorage(env.OC_DB);
}

function notFound() {
  return { success: false as const, error: 'CG 条目不存在' };
}

// 列表：可按 project / char_key / scene_key / enabled 筛选；
// 如果 URL 带了 state（JSON 对象字符串），每条会附 unlocked 布尔（当前模拟状态是否解锁）。
export async function cgList(env: CgEnv, params: any): Promise<any> {
  const project = params?.project === undefined || params?.project === null ? undefined : String(params.project);
  const charKey = params?.charKey === undefined || params?.charKey === null ? undefined : String(params.charKey);
  const sceneKey = params?.sceneKey === undefined || params?.sceneKey === null ? undefined : String(params.sceneKey);
  const rawEnabled = params?.enabled;
  const enabled = rawEnabled === undefined || rawEnabled === null ? undefined : String(rawEnabled) === '1' || String(rawEnabled).toLowerCase() === 'true';
  const rawLimit = Number(params?.limit ?? LIST_LIMIT_DEFAULT);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : LIST_LIMIT_DEFAULT, 1), CG_LIST_LIMIT_MAX);

  let state: Record<string, unknown> | null = null;
  if (params?.state !== undefined && params?.state !== null && String(params.state) !== '') {
    try {
      const parsed = JSON.parse(String(params.state));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed as Record<string, unknown>;
    } catch {
      return { success: false, error: 'state 必须是 JSON 对象字符串' };
    }
  }

  try {
    const rows = await storeOf(env).listEntries({ project, charKey, sceneKey, enabled, limit });
    const cgs = state
      ? rows.map((e) => ({ ...e, unlocked: isCgUnlocked(e, state) }))
      : rows;
    return { success: true, count: cgs.length, cgs };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// 单条完整返回（编辑回填用）。
export async function cgGet(env: CgEnv, id: string): Promise<any> {
  if (!id) return { success: false, error: '缺少 CG id' };
  try {
    const entry = await storeOf(env).getEntry(id);
    if (!entry) return notFound();
    return { success: true, cg: entry };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// 新建：title 必填，其余可空；imageUrl 为空时前端显示 placeholder 占位。
export async function cgCreate(env: CgEnv, body: any): Promise<any> {
  const err = validateCgBody(body, { partial: false });
  if (err) return { success: false, error: err };

  const now = new Date().toISOString();
  const entry: CustomCgEntry = {
    id: buildCgId(),
    project: String(body.project ?? '').trim(),
    charKey: String(body.charKey ?? '').trim(),
    title: String(body.title ?? '').trim(),
    sceneKey: String(body.sceneKey ?? '').trim(),
    condition: String(body.condition ?? '').trim(),
    imageUrl: String(body.imageUrl ?? '').trim(),
    placeholder: String(body.placeholder ?? '').trim(),
    enabled: body.enabled === undefined ? true : !!body.enabled,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await storeOf(env).createEntry(entry);
    return { success: true, cg: entry };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// 部分更新：只改给出的字段；updatedAt 总是刷新。
export async function cgUpdate(env: CgEnv, id: string, body: any): Promise<any> {
  if (!id) return { success: false, error: '缺少 CG id' };
  const err = validateCgBody(body, { partial: true });
  if (err) return { success: false, error: err };

  const patch: Partial<Omit<CustomCgEntry, 'id' | 'createdAt'>> = {};
  if (body.title !== undefined) patch.title = String(body.title).trim();
  if (body.project !== undefined) patch.project = String(body.project).trim();
  if (body.charKey !== undefined) patch.charKey = String(body.charKey).trim();
  if (body.sceneKey !== undefined) patch.sceneKey = String(body.sceneKey).trim();
  if (body.condition !== undefined) patch.condition = String(body.condition).trim();
  if (body.imageUrl !== undefined) patch.imageUrl = String(body.imageUrl).trim();
  if (body.placeholder !== undefined) patch.placeholder = String(body.placeholder).trim();
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  patch.updatedAt = new Date().toISOString();

  try {
    const updated = await storeOf(env).updateEntry(id, patch);
    if (!updated) return notFound();
    return { success: true, cg: updated };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// 删除。
export async function cgDelete(env: CgEnv, id: string): Promise<any> {
  if (!id) return { success: false, error: '缺少 CG id' };
  try {
    const ok = await storeOf(env).deleteEntry(id);
    return ok ? { success: true } : notFound();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}