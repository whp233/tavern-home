import type { DeskStorage } from './storage.ts';
import type { DeskFloor, DeskWindow } from './types.ts';

const MAX_CONTENT = 200_000;
function clean(value: string): string {
  let output = '';
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { output += value[index] + value[++index]; continue; }
      output += '\uFFFD'; continue;
    }
    output += unit >= 0xDC00 && unit <= 0xDFFF ? '\uFFFD' : value[index];
  }
  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// 取锚点之前的最近一条有效 boardAfter；旧数据没有时返回 undefined。
function priorAssistantBoardAfter(floors: DeskFloor[], anchorIndex: number): Record<string, unknown> | undefined {
  for (let i = anchorIndex - 1; i >= 0; i--) {
    const row = floors[i];
    if (row.role !== 'assistant') continue;
    const report = row.report;
    if (isPlainObject(report) && isPlainObject(report.boardAfter)) return report.boardAfter;
  }
  return undefined;
}

// 回溯分支的状态板取点：assistant 锚点优先用该轮生成后的 boardAfter；
// user 锚点优先用下一条 assistant 的 boardBefore（即用户输入未推进前的状态）。
// 旧数据没有这些快照时回退到「锚点之前的最近状态」，尽量不把后续分支的推进带进新分支；
// 再没有才回退到窗口当前状态板，保证分支窗口至少能正常装配。
function resolveBranchStateBoard(floors: DeskFloor[], anchorIndex: number, fallback: Record<string, unknown>): Record<string, unknown> {
  const anchor = floors[anchorIndex];
  if (anchor?.role === 'assistant') {
    const report = anchor.report;
    if (isPlainObject(report) && isPlainObject(report.boardAfter)) return report.boardAfter;
  }
  if (anchor?.role === 'user') {
    for (let i = anchorIndex + 1; i < floors.length; i++) {
      const row = floors[i];
      if (row.role !== 'assistant') continue;
      const report = row.report;
      if (isPlainObject(report) && isPlainObject(report.boardBefore)) return report.boardBefore;
      break;
    }
  }
  return priorAssistantBoardAfter(floors, anchorIndex) ?? fallback;
}

export class DeskService {
  private readonly storage: DeskStorage;
  constructor(storage: DeskStorage) { this.storage = storage; }

  async createWindow(input: { project?: string; title?: string; recipeId?: string; charKey?: string }) {
    if (!input?.project?.trim() || !input?.title?.trim() || !input?.recipeId?.trim()) return { success: false, error: 'project, title, and recipeId are required.' };
    const now = new Date().toISOString();
    const window: DeskWindow = { id: `win_${crypto.randomUUID()}`, project: input.project.trim(), title: input.title.trim(), recipeId: input.recipeId.trim(), charKey: typeof input.charKey === 'string' ? input.charKey.trim() : '', note: '', noteDepth: 3, stateBoard: {}, timelineState: {}, vars: {}, createdAt: now, updatedAt: now };
    await this.storage.createWindow(window);
    return { success: true, window };
  }

  async getWindow(id: string) {
    const window = await this.storage.getWindow(id);
    if (!window) return { success: false, error: 'Desk window not found.' };
    return { success: true, window, floors: await this.storage.listFloors(id) };
  }

  async appendFloor(windowId: string, input: { role?: DeskFloor['role']; content?: string; variants?: string[]; thinking?: string | null; report?: Record<string, unknown> | null; createdAt?: string }) {
    if (!await this.storage.getWindow(windowId)) return { success: false, error: 'Desk window not found.' };
    if (!['user', 'assistant'].includes(input.role || '')) return { success: false, error: 'role must be user or assistant.' };
    if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > MAX_CONTENT) return { success: false, error: 'content must contain 1-200000 characters.' };
    const content = clean(input.content);
    const variants = input.variants?.map(clean) || [content];
    if (!variants.length || variants.some((v) => !v.trim() || v.length > MAX_CONTENT)) return { success: false, error: 'variants must contain non-empty texts.' };
    let activeVariant = variants.indexOf(content);
    if (activeVariant < 0) { variants.push(content); activeVariant = variants.length - 1; }
    const floor: DeskFloor = { id: `floor_${crypto.randomUUID()}`, windowId, role: input.role!, content, variants, activeVariant, thinking: input.thinking ?? null, report: input.report ?? null, createdAt: input.createdAt || new Date().toISOString() };
    await this.storage.createFloor(floor);
    await this.storage.updateWindow(windowId, { updatedAt: floor.createdAt });
    return { success: true, floor };
  }

  async editFloor(id: string, contentInput: string) {
    const floor = await this.storage.getFloor(id);
    if (!floor) return { success: false, error: 'Desk floor not found.' };
    if (typeof contentInput !== 'string' || !contentInput.trim() || contentInput.length > MAX_CONTENT) return { success: false, error: 'content must contain 1-200000 characters.' };
    const content = clean(contentInput); const variants = [...floor.variants]; variants[floor.activeVariant] = content;
    const updated = await this.storage.updateFloor(id, { content, variants });
    if (!updated) return { success: false, error: 'Desk floor changed concurrently. Reload and try again.' };
    return { success: true, floor: updated };
  }

  async switchVariant(id: string, index: number) {
    const floor = await this.storage.getFloor(id);
    if (!floor) return { success: false, error: 'Desk floor not found.' };
    if (!Number.isInteger(index) || index < 0 || index >= floor.variants.length) return { success: false, error: 'Variant index is out of range.' };
    const updated = await this.storage.updateFloor(id, { activeVariant: index, content: floor.variants[index] });
    if (!updated) return { success: false, error: 'Desk floor changed concurrently. Reload and try again.' };
    return { success: true, floor: updated };
  }

  // 回溯场景：把源窗口复制到「锚点楼（含）为止」的新分支窗口。
  // 源窗口原样保留（旧分支可查），新窗口在 vars.branch 里记录父窗口/锚点元数据，
  // 之后继续生成的楼层只落在新窗口上，形成一条可写的新分支。
  async branchWindow(windowId: string, anchorFloorId: string, input: { title?: string; label?: string } = {}) {
    const source = await this.storage.getWindow(windowId);
    if (!source) return { success: false, error: 'Desk window not found.' };
    if (typeof anchorFloorId !== 'string' || !anchorFloorId.trim()) return { success: false, error: 'anchor floor id is required.' };
    const floors = await this.storage.listFloors(windowId);
    const anchorIndex = floors.findIndex((floor) => floor.id === anchorFloorId);
    if (anchorIndex < 0) return { success: false, error: 'Anchor floor was not found in this window.' };

    const now = new Date().toISOString();
    const branchWindowId = `win_${crypto.randomUUID()}`;
    const title = (typeof input?.title === 'string' && input.title.trim())
      ? input.title.trim()
      : `${source.title} · 回溯@第${anchorIndex + 1}楼`;
    const branchVars = {
      ...source.vars,
      branch: {
        parentWindowId: source.id,
        anchorFloorId,
        anchorIndex,
        label: (typeof input?.label === 'string' && input.label.trim()) ? input.label.trim() : `从第 ${anchorIndex + 1} 楼回溯`,
        createdAt: now,
      },
    };
    const branchWindow: DeskWindow = {
      ...source,
      id: branchWindowId,
      title,
      stateBoard: resolveBranchStateBoard(floors, anchorIndex, source.stateBoard),
      vars: branchVars,
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.createWindow(branchWindow);
    for (let i = 0; i <= anchorIndex; i++) {
      const floor = floors[i];
      await this.storage.createFloor({
        ...floor,
        id: `floor_${crypto.randomUUID()}`,
        windowId: branchWindowId,
      });
    }
    return { success: true, window: branchWindow, floors: anchorIndex + 1 };
  }

  async truncate(windowId: string, anchorId: string, inclusive = false) {
    const deleted = await this.storage.truncateFloors(windowId, anchorId, inclusive);
    if (deleted === null) return { success: false, error: 'Anchor floor was not found in this window.' };
    return { success: true, deleted };
  }
}
