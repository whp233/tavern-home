// src/core/cgService.ts
// 自定义 CG 纯函数层（task-14）：校验 / ID / 条件求值 / 解锁判断，不带 I/O。
// 对齐妹居参考文档第6节：「CG/演出 = 状态条件解锁的内容资产 + 条件组件引擎」。
// 酒馆最小闭环 = 配置条目（图/占位 + 场景键 + 条件表达式）+ 按 state 计算解锁。

import type { CustomCgEntry } from './types.ts';

export const CG_TITLE_MAX = 200;
export const CG_PROJECT_MAX = 100;
export const CG_CHAR_KEY_MAX = 100;
export const CG_SCENE_KEY_MAX = 200;
export const CG_CONDITION_MAX = 4000;
export const CG_IMAGE_URL_MAX = 4 * 1024 * 1024; // data URL / URL 字符串上限
export const CG_PLACEHOLDER_MAX = 500;
export const CG_LIST_LIMIT_MAX = 500;

export function buildCgId(): string {
  return `cg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// 新建（partial=false）与部分更新（partial=true）共用校验。
// 约定：只校验「给出的字段」；没给的字段不猜、不默认。
export function validateCgBody(body: any, opts: { partial?: boolean } = {}): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '请求体不对';
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.length > CG_TITLE_MAX) return `title 必须是字符串,且不超过${CG_TITLE_MAX}字`;
    if (!String(body.title).trim()) return 'title 不能为空（CG 总得有个名字）';
  } else if (!opts.partial) {
    return 'title 必填';
  }
  if (body.project !== undefined) {
    if (typeof body.project !== 'string' || body.project.length > CG_PROJECT_MAX) return `project 必须是字符串,且不超过${CG_PROJECT_MAX}字`;
  }
  if (body.charKey !== undefined) {
    if (typeof body.charKey !== 'string' || body.charKey.length > CG_CHAR_KEY_MAX) return `charKey 必须是字符串,且不超过${CG_CHAR_KEY_MAX}字`;
  }
  if (body.sceneKey !== undefined) {
    if (typeof body.sceneKey !== 'string' || body.sceneKey.length > CG_SCENE_KEY_MAX) return `sceneKey 必须是字符串,且不超过${CG_SCENE_KEY_MAX}字`;
  }
  if (body.condition !== undefined) {
    if (typeof body.condition !== 'string' || body.condition.length > CG_CONDITION_MAX) return `condition 必须是字符串,且不超过${CG_CONDITION_MAX}字`;
  }
  if (body.imageUrl !== undefined) {
    if (typeof body.imageUrl !== 'string' || body.imageUrl.length > CG_IMAGE_URL_MAX) return `imageUrl 必须是字符串,且不超过${CG_IMAGE_URL_MAX}字符`;
  }
  if (body.placeholder !== undefined) {
    if (typeof body.placeholder !== 'string' || body.placeholder.length > CG_PLACEHOLDER_MAX) return `placeholder 必须是字符串,且不超过${CG_PLACEHOLDER_MAX}字`;
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return 'enabled 必须是布尔值';
  return null;
}

// 从 state 里取「当前场景」：兼容中文协议键（场景/位置）与英文 scene/sceneKey。
export function cgSceneOf(state: Record<string, unknown>): string {
  const raw = state['场景'] ?? state['scene'] ?? state['位置'] ?? state['sceneKey'] ?? '';
  return String(raw ?? '');
}

// 条件表达式求值：空串恒真；带 state 的 JS 表达式用 with(state) 执行（本地用户自配，安全边界同村规）。
export function evaluateCgCondition(condition: string, state: Record<string, unknown>): boolean {
  const expr = String(condition ?? '').trim();
  if (!expr) return true;
  try {
    // new Function 默认非严格模式，with(state) 可让条件直接写 yuki_power >= 50。
    const fn = new Function('state', `with (state) { return !!(${expr}); }`);
    return fn(state);
  } catch {
    return false;
  }
}

// 解锁判断：enabled + 场景键匹配 + 条件表达式。
export function isCgUnlocked(
  entry: Pick<CustomCgEntry, 'enabled' | 'sceneKey' | 'condition'>,
  state: Record<string, unknown>,
): boolean {
  if (!entry.enabled) return false;
  const sceneKey = String(entry.sceneKey ?? '').trim();
  if (sceneKey) {
    const scene = cgSceneOf(state);
    if (String(scene) !== sceneKey && !String(scene).includes(sceneKey) && !sceneKey.includes(String(scene))) {
      return false;
    }
  }
  return evaluateCgCondition(entry.condition, state);
}