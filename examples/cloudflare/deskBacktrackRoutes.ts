// 回溯场景独立路由（task-13）。
// 主逻辑在 src/core/deskService.ts：回溯 = 把源窗口复制到锚点楼为止的新分支窗口，
// 源窗口原样保留，新窗口在 vars.branch 里记录父窗口/锚点元数据。
// 这里只做 D1 方言的路由壳，避免把分支查询塞进大热的 index.ts / deskWindows.ts。

import { DeskService } from '../../src/core/deskService.ts';
import { D1DeskStorage } from './adapters/d1DeskStorage.ts';

function parseObject(raw: unknown): Record<string, unknown> {
  try {
    const value = JSON.parse(String(raw ?? '{}'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

interface BacktrackEnv {
  OC_DB: D1Database;
  [k: string]: any;
}

// POST /api/oc/desk/windows/:id/backtrack { floor_id, title?, label? }
export async function deskBacktrackCreate(env: BacktrackEnv, windowId: string, body: any): Promise<any> {
  if (!windowId) return { success: false, error: '缺 window id' };
  if (!body || typeof body !== 'object' || typeof body.floor_id !== 'string' || !body.floor_id.trim()) {
    return { success: false, error: 'floor_id 必填' };
  }
  if (body.title !== undefined && typeof body.title !== 'string') return { success: false, error: 'title 必须是字符串' };
  if (body.label !== undefined && typeof body.label !== 'string') return { success: false, error: 'label 必须是字符串' };
  try {
    const service = new DeskService(new D1DeskStorage(env.OC_DB));
    return await service.branchWindow(windowId, body.floor_id.trim(), {
      title: typeof body.title === 'string' ? body.title : undefined,
      label: typeof body.label === 'string' ? body.label : undefined,
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// GET /api/oc/desk/windows/:id/branches
export async function deskBacktrackList(env: BacktrackEnv, windowId: string): Promise<any> {
  if (!windowId) return { success: false, error: '缺 window id' };
  try {
    const results = await env.OC_DB.prepare(
      `SELECT id, project, title, recipe_id, vars, created_at, updated_at
       FROM desk_windows
       WHERE json_extract(vars, '$.branch.parentWindowId') = ?
       ORDER BY updated_at DESC, id DESC`,
    ).bind(windowId).all<any>();
    const rows = results.results || [];
    return {
      success: true,
      count: rows.length,
      branches: rows.map((row: any) => {
        const vars = parseObject(row.vars);
        const branch = vars.branch && typeof vars.branch === 'object' && !Array.isArray(vars.branch)
          ? vars.branch as Record<string, unknown>
          : {};
        return {
          id: row.id,
          project: row.project || '',
          title: row.title || '',
          recipe_id: row.recipe_id || '',
          parent_window_id: windowId,
          anchor_floor_id: typeof branch.anchorFloorId === 'string' ? branch.anchorFloorId : '',
          anchor_index: typeof branch.anchorIndex === 'number' ? branch.anchorIndex : null,
          label: typeof branch.label === 'string' ? branch.label : '',
          created_at: row.created_at,
          updated_at: row.updated_at || row.created_at,
        };
      }),
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}