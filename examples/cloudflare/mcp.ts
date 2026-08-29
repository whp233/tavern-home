// examples/cloudflare/mcp.ts
// MCP Server 被控端（类 TAVO，task-32）：把酒馆现有工具层映射为 MCP Tools，供外部 Agent 通过 Streamable HTTP 调用。
// 设计约束：
// - 零额外依赖，不引 @modelcontextprotocol/sdk（Workers fetch 模型与 Node http 不一致，手动实现 JSON-RPC 更可控）
// - 鉴权复用外层 authenticate()/path-token 双轨（index.ts 已在入口处验过，这里只做 scope 校验）
// - 工具描述清晰，让外部 Agent 自描述可用（name/description/inputSchema）
// - 每个 tool/call 直接复用 src/tools/* 现有函数或 D1 存储，不另起落库路径

import { parseCharacterCard } from '../../src/core/characterCard.ts';
import { compactMemories, normalizeLayer, normalizeTheme } from '../../src/core/deskMemory.ts';
import type { DeskMemory } from '../../src/core/types.ts';
import { D1DeskStorage } from './adapters/d1DeskStorage.ts';
import { D1DeskMemoryStorage } from './adapters/d1DeskMemoryStorage.ts';
import {
  deskListPresets,
  importCharacterCard,
} from '../../src/tools/desk.ts';
import {
  deskLoreList,
  deskLoreCreate,
  deskLoreUpdate,
  deskLoreDelete,
} from '../../src/tools/deskPanels.ts';
import {
  deskWindowList,
  deskWindowGet,
  deskWindowCreate,
  deskWindowUpdate,
  deskWindowDelete,
} from '../../src/tools/deskWindows.ts';
import {
  diaryList,
  diaryGet,
  diaryCreate,
  diaryUpdate,
  diaryDelete,
  diaryDates,
} from '../../src/tools/diary.ts';
import {
  cgList,
  cgCreate,
  cgUpdate,
  cgDelete,
} from '../../src/tools/cg.ts';
import {
  stickyNotesList,
  stickyNotesCreate,
  stickyNotesUpdate,
  stickyNotesDelete,
} from '../../src/tools/stickyNotes.ts';

type Env = any;

// ---------- Tool definitions (MCP tools/list 返回) ----------
export const TOOL_DEFINITIONS: Array<{
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, any>; required?: string[] };
}> = [
  {
    name: 'list_presets',
    description: '列出打字桌预设包（preset packs），可用于创建写作配方/窗口前的选型',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'import_character_card',
    description: '导入 SillyTavern 角色卡（chara_card v2/v3 JSON，字段 card），可选 project 归属；返回 lore 条目',
    inputSchema: {
      type: 'object',
      properties: {
        card: { type: 'object', description: '角色卡 JSON（SillyTavern v2/v3）' },
        project: { type: 'string', description: '归属项目名，缺省为默认项目' },
      },
      required: ['card'],
    },
  },
  {
    name: 'list_lore',
    description: '列出世界书/角色卡条目（等价 GET /api/oc/desk/lore?project=...），project 必填',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '项目名' },
      },
      required: ['project'],
    },
  },
  {
    name: 'create_lore',
    description: '新建世界书/角色条目（等价 POST /api/oc/desk/lore），需 project/title/content，可选 is_char/keys 等触发配置',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string', description: '条目正文/设定' },
        is_char: { type: 'boolean', description: '是否为角色卡条目' },
        lore_keys: { type: 'string', description: '触发关键词，逗号分隔' },
        lore_position: { type: 'string', description: '插入位置 before_char/after_char 等' },
        trigger_mode: { type: 'string', description: '触发模式 constant/normal 等' },
      },
      required: ['project', 'title', 'content'],
    },
  },
  {
    name: 'update_lore',
    description: '更新世界书条目（PUT /api/oc/desk/lore/:id）',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        is_char: { type: 'boolean' },
        lore_keys: { type: 'string' },
      },
    },
  },
  {
    name: 'delete_lore',
    description: '删除世界书条目（DELETE /api/oc/desk/lore/:id）',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'list_windows',
    description: '列出打字桌写作窗（desk windows），可选按 project 过滤',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } } },
  },
  {
    name: 'get_window',
    description: '获取单个写作窗详情（含 vars/stateBoard），可按需附带楼层',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '窗口 id' },
        include_floors: { type: 'boolean', description: '是否附带楼层列表' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_window',
    description: '创建打字桌写作窗（等价 POST /api/oc/desk/windows），需 project，可选 title/char_key/recipe_id 等',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '所属项目' },
        title: { type: 'string', description: '窗口标题' },
        char_key: { type: 'string', description: '绑定角色 key，缺省共享区' },
        recipe_id: { type: 'string', description: '配方/预设关联 id' },
        note: { type: 'string', description: '导演小纸条（初始 prompt）' },
      },
      required: ['project'],
    },
  },
  {
    name: 'update_window',
    description: '更新写作窗（PUT /api/oc/desk/windows/:id），可改 title/vars/stateBoard/char_key',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        char_key: { type: 'string' },
        vars: { type: 'object', description: '窗口 vars JSON（selected_char_keys 等）' },
        stateBoard: { type: 'object', description: '状态板 JSON' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_window',
    description: '删除写作窗（DELETE /api/oc/desk/windows/:id）',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'list_floors',
    description: '列出指定窗口的楼层（消息）列表',
    inputSchema: { type: 'object', properties: { window_id: { type: 'string' } }, required: ['window_id'] },
  },
  {
    name: 'create_floor',
    description: '在窗口中追加楼层（消息），role=user/assistant/system，content 为正文',
    inputSchema: {
      type: 'object',
      properties: {
        window_id: { type: 'string' },
        role: { type: 'string', description: 'user|assistant|system' },
        content: { type: 'string' },
      },
      required: ['window_id', 'content'],
    },
  },
  {
    name: 'edit_floor',
    description: '就地编辑楼层正文（PUT /api/oc/desk/floors/:id）',
    inputSchema: {
      type: 'object',
      properties: {
        floor_id: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['floor_id', 'content'],
    },
  },
  {
    name: 'list_memories',
    description: '列出记忆条目（按 project+charKey+layer 作用域，或按 window_id 兼容溯源）；project 或 window_id 二选一必填',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        char_key: { type: 'string', description: '角色 key，空=共享区' },
        layer: { type: 'string', description: 'anchor|plot|general，缺省全层' },
        window_id: { type: 'string', description: '兼容旧式窗溯源' },
      },
    },
  },
  {
    name: 'create_memory',
    description: '新建记忆条目（POST /api/oc/desk/memories），需 project+content，可选 title/theme/char_key/layer/window_id',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        content: { type: 'string' },
        title: { type: 'string' },
        theme: { type: 'string', description: '用户画像|故事情节|角色设定|世界观|其他' },
        char_key: { type: 'string' },
        layer: { type: 'string', description: 'anchor|plot|general' },
        window_id: { type: 'string' },
      },
      required: ['project', 'content'],
    },
  },
  {
    name: 'update_memory',
    description: '更新记忆条目（PUT /api/oc/desk/memories/:id）',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        content: { type: 'string' },
        title: { type: 'string' },
        theme: { type: 'string' },
        layer: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_memory',
    description: '删除记忆条目（DELETE /api/oc/desk/memories/:id）',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'compact_memories',
    description: '压缩记忆（POST /api/oc/desk/memories/compact），按作用域或单窗，返回合并后记忆与统计',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        char_key: { type: 'string' },
        layer: { type: 'string' },
        window_id: { type: 'string' },
        title: { type: 'string', description: '快照标题' },
      },
    },
  },
  {
    name: 'diary_list',
    description: '列出日记（GET /api/oc/diary），可按 project/charKey/date 过滤',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        char_key: { type: 'string' },
        date: { type: 'string', description: 'YYYY/M/D' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'diary_create',
    description: '新建日记（POST /api/oc/diary），需 project/date/content',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        date: { type: 'string', description: 'YYYY/M/D' },
        content: { type: 'string' },
        title: { type: 'string' },
        char_key: { type: 'string' },
        time: { type: 'string' },
      },
      required: ['project', 'date', 'content'],
    },
  },
  {
    name: 'sticky_notes_list',
    description: '列出便签（GET /api/oc/sticky-notes），可按 project/char_key 过滤',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        char_key: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'sticky_notes_create',
    description: '新建便签（POST /api/oc/sticky-notes），需 project/content',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        content: { type: 'string' },
        title: { type: 'string' },
        char_key: { type: 'string' },
        color: { type: 'string' },
        pinned: { type: 'boolean' },
      },
      required: ['project', 'content'],
    },
  },
];

// ---------- helpers ----------
function jsonOk(data: any) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function jsonError(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }, null, 2) }], isError: true };
}

// ---------- dispatch tools/call ----------
export async function dispatchToolCall(env: Env, name: string, args: any): Promise<any> {
  const a = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'list_presets': {
      const r = await deskListPresets(env as any);
      return jsonOk(r);
    }
    case 'import_character_card': {
      const cardRaw = a.card;
      const parsed = parseCharacterCard(cardRaw);
      if (!parsed.ok) return jsonError(parsed.error);
      const projectRaw = typeof a.project === 'string' ? a.project : undefined;
      const r = await importCharacterCard(env as any, parsed.card, projectRaw);
      if (r.success) (r as any).warnings = [...parsed.warnings, ...((r as any).warnings || [])];
      return jsonOk(r);
    }
    case 'list_lore': {
      if (!a.project || typeof a.project !== 'string' || !a.project.trim()) return jsonError('project 必填');
      const r = await deskLoreList(env as any, { project: a.project.trim() });
      return jsonOk(r);
    }
    case 'create_lore': {
      if (!a.project || !a.title || !a.content) return jsonError('project/title/content 必填');
      const r = await deskLoreCreate(env as any, a);
      return jsonOk(r);
    }
    case 'update_lore': {
      if (!a.id) return jsonError('id 必填');
      const { id, ...patch } = a;
      const r = await deskLoreUpdate(env as any, String(id), patch);
      return jsonOk(r);
    }
    case 'delete_lore': {
      if (!a.id) return jsonError('id 必填');
      const r = await deskLoreDelete(env as any, String(a.id));
      return jsonOk(r);
    }
    case 'list_windows': {
      const r = await deskWindowList(env as any, { project: typeof a.project === 'string' ? a.project : undefined });
      return jsonOk(r);
    }
    case 'get_window': {
      if (!a.id) return jsonError('id 必填');
      const r = await deskWindowGet(env as any, String(a.id));
      if (!(r as any).success) return jsonOk(r);
      if (a.include_floors) {
        const storage = new D1DeskStorage(env.OC_DB);
        const floors = await storage.listFloors(String(a.id));
        return jsonOk({ ...(r as any), floors });
      }
      return jsonOk(r);
    }
    case 'create_window': {
      if (!a.project) return jsonError('project 必填');
      const r = await deskWindowCreate(env as any, {
        project: String(a.project),
        title: typeof a.title === 'string' ? a.title : undefined,
        char_key: typeof a.char_key === 'string' ? a.char_key : undefined,
        recipe_id: typeof a.recipe_id === 'string' ? a.recipe_id : undefined,
        note: typeof a.note === 'string' ? a.note : undefined,
        vars: a.vars && typeof a.vars === 'object' ? a.vars : undefined,
      } as any);
      return jsonOk(r);
    }
    case 'update_window': {
      if (!a.id) return jsonError('id 必填');
      const patch: any = {};
      if (a.title !== undefined) patch.title = a.title;
      if (a.char_key !== undefined) patch.char_key = a.char_key;
      if (a.vars !== undefined) patch.vars = a.vars;
      if (a.stateBoard !== undefined) patch.stateBoard = a.stateBoard;
      const r = await deskWindowUpdate(env as any, String(a.id), patch);
      return jsonOk(r);
    }
    case 'delete_window': {
      if (!a.id) return jsonError('id 必填');
      const r = await deskWindowDelete(env as any, String(a.id));
      return jsonOk(r);
    }
    case 'list_floors': {
      if (!a.window_id) return jsonError('window_id 必填');
      const storage = new D1DeskStorage(env.OC_DB);
      const floors = await storage.listFloors(String(a.window_id));
      return jsonOk({ success: true, floors });
    }
    case 'create_floor': {
      if (!a.window_id || !a.content) return jsonError('window_id/content 必填');
      const storage = new D1DeskStorage(env.OC_DB);
      const roleRaw = typeof a.role === 'string' ? a.role : 'user';
      const role = roleRaw === 'assistant' ? 'assistant' : 'user';
      const floor: any = {
        id: `floor_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        windowId: String(a.window_id),
        role,
        content: String(a.content),
        variants: [],
        activeVariant: 0,
        thinking: null,
        report: null,
        createdAt: new Date().toISOString(),
      };
      await storage.createFloor(floor);
      return jsonOk({ success: true, floor });
    }
    case 'edit_floor': {
      if (!a.floor_id || a.content === undefined) return jsonError('floor_id/content 必填');
      // deskWindows 的楼层编辑走 deskWindow 的 truncate 栅栏，这里直接 update
      const storage = new D1DeskStorage(env.OC_DB);
      const updated = await storage.updateFloor(String(a.floor_id), { content: String(a.content) } as any);
      if (!updated) return jsonOk({ success: false, error: '楼层不存在' });
      return jsonOk({ success: true, floor: updated });
    }
    case 'list_memories': {
      const store = new D1DeskMemoryStorage(env.OC_DB);
      if (a.window_id) {
        const rows = await store.listMemories(String(a.window_id));
        return jsonOk({ success: true, memories: rows });
      }
      if (!a.project) return jsonError('project 或 window_id 必填');
      const rows = await store.listByScope({
        project: String(a.project),
        charKey: typeof a.char_key === 'string' ? a.char_key : '',
        layer: a.layer === 'anchor' || a.layer === 'plot' || a.layer === 'general' ? a.layer : undefined,
      });
      return jsonOk({ success: true, memories: rows });
    }
    case 'create_memory': {
      if (!a.project || !a.content) return jsonError('project/content 必填');
      const store = new D1DeskMemoryStorage(env.OC_DB);
      const now = new Date().toISOString();
      const mem: DeskMemory = {
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        windowId: typeof a.window_id === 'string' ? a.window_id : '',
        project: String(a.project),
        charKey: typeof a.char_key === 'string' ? a.char_key : '',
        layer: normalizeLayer(a.layer),
        theme: normalizeTheme(a.theme),
        title: typeof a.title === 'string' ? a.title : '',
        content: String(a.content),
        createdAt: now,
        updatedAt: now,
      };
      await store.createMemory(mem);
      return jsonOk({ success: true, memory: mem });
    }
    case 'update_memory': {
      if (!a.id) return jsonError('id 必填');
      const store = new D1DeskMemoryStorage(env.OC_DB);
      const patch: any = { updatedAt: new Date().toISOString() };
      if (a.content !== undefined) patch.content = String(a.content);
      if (a.title !== undefined) patch.title = String(a.title);
      if (a.theme !== undefined) patch.theme = normalizeTheme(a.theme);
      if (a.layer !== undefined) patch.layer = normalizeLayer(a.layer);
      const updated = await store.updateMemory(String(a.id), patch);
      if (!updated) return jsonOk({ success: false, error: '记忆不存在' });
      return jsonOk({ success: true, memory: updated });
    }
    case 'delete_memory': {
      if (!a.id) return jsonError('id 必填');
      const store = new D1DeskMemoryStorage(env.OC_DB);
      const ok = await store.deleteMemory(String(a.id));
      return jsonOk({ success: ok });
    }
    case 'compact_memories': {
      const store = new D1DeskMemoryStorage(env.OC_DB);
      // 复用 index.ts 的 compact 逻辑简化版：按作用域取 before，compact，再 replaceScope
      let before: DeskMemory[];
      let scopeRef: { project: string; charKey: string };
      if (a.window_id) {
        before = await store.listMemories(String(a.window_id));
        const w = await (env.OC_DB.prepare('SELECT project, char_key FROM desk_windows WHERE id = ?').bind(String(a.window_id)).first() as Promise<any>);
        scopeRef = { project: w ? String(w.project) : '', charKey: w ? String(w.char_key || '') : '' };
      } else {
        if (!a.project) return jsonError('project 或 window_id 必填');
        before = await store.listByScope({
          project: String(a.project),
          charKey: typeof a.char_key === 'string' ? a.char_key : '',
          layer: a.layer === 'anchor' || a.layer === 'plot' || a.layer === 'general' ? a.layer : undefined,
        });
        scopeRef = { project: String(a.project), charKey: typeof a.char_key === 'string' ? a.char_key : '' };
      }
      const snapTitle = typeof a.title === 'string' && a.title.trim() ? a.title.trim() : `compact ${new Date().toISOString()}`;
      const snapId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      await store.createSnapshot({ id: snapId, windowId: typeof a.window_id === 'string' ? a.window_id : '', project: scopeRef.project, charKey: scopeRef.charKey, title: snapTitle, data: before, createdAt: new Date().toISOString() });
      const { next } = compactMemories(before);
      await store.replaceScope({ project: scopeRef.project, charKey: scopeRef.charKey, memories: next });
      const after = a.window_id ? await store.listMemories(String(a.window_id)) : await store.listByScope({ project: scopeRef.project, charKey: scopeRef.charKey });
      return jsonOk({ success: true, memories: after, beforeCount: before.length, afterCount: after.length });
    }
    case 'diary_list': {
      const r = await diaryList(env as any, {
        project: a.project,
        charKey: a.char_key,
        date: a.date,
        limit: a.limit,
      });
      return jsonOk(r);
    }
    case 'diary_create': {
      if (!a.project || !a.date || !a.content) return jsonError('project/date/content 必填');
      const r = await diaryCreate(env as any, {
        project: String(a.project),
        date: String(a.date),
        content: String(a.content),
        title: typeof a.title === 'string' ? a.title : undefined,
        char_key: typeof a.char_key === 'string' ? a.char_key : undefined,
        time: typeof a.time === 'string' ? a.time : undefined,
      });
      return jsonOk(r);
    }
    case 'sticky_notes_list': {
      const r = await stickyNotesList(env as any, { project: a.project, charKey: a.char_key, limit: a.limit });
      return jsonOk(r);
    }
    case 'sticky_notes_create': {
      if (!a.project || !a.content) return jsonError('project/content 必填');
      const r = await stickyNotesCreate(env as any, a);
      return jsonOk(r);
    }
    default:
      return jsonError(`未知工具: ${name}`);
  }
}

// ---------- MCP JSON-RPC handler ----------
export async function handleMcpPost(request: Request, env: Env): Promise<Response> {
  // 读取 JSON-RPC 请求（支持单条与批量）
  let payload: any;
  try {
    const text = await request.text();
    if (!text) return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: empty body' }, id: null }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    payload = JSON.parse(text);
  } catch {
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const isBatch = Array.isArray(payload);
  const requests = isBatch ? payload : [payload];
  const responses: any[] = [];

  for (const req of requests) {
    const id = req?.id ?? null;
    const method = req?.method;
    const params = req?.params || {};

    // 通知（无 id）不返回响应，按 MCP 规范返回 202
    const isNotification = req?.id === undefined;

    try {
      let result: any = null;
      switch (method) {
        case 'initialize': {
          result = {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
            serverInfo: { name: 'tavern-study', version: '0.2.0' },
          };
          break;
        }
        case 'notifications/initialized':
        case 'notifications/cancelled': {
          // 通知类：不响应
          if (isNotification) continue;
          result = {};
          break;
        }
        case 'ping': {
          result = {};
          break;
        }
        case 'tools/list': {
          result = { tools: TOOL_DEFINITIONS };
          break;
        }
        case 'tools/call': {
          const name = params?.name;
          const args = params?.arguments || params?.args || {};
          if (!name || typeof name !== 'string') {
            throw { code: -32602, message: 'tools/call: name 必填' };
          }
          result = await dispatchToolCall(env, name, args);
          break;
        }
        case 'resources/list':
          result = { resources: [] };
          break;
        case 'prompts/list':
          result = { prompts: [] };
          break;
        default: {
          // 未知方法按 JSON-RPC 错误返回
          const err = { code: -32601, message: `Method not found: ${method}` };
          if (isNotification) continue;
          responses.push({ jsonrpc: '2.0', id, error: err });
          continue;
        }
      }
      if (isNotification) continue;
      responses.push({ jsonrpc: '2.0', id, result });
    } catch (e: any) {
      if (isNotification) continue;
      const code = typeof e?.code === 'number' ? e.code : -32603;
      const message = typeof e?.message === 'string' ? e.message : String(e?.message || e);
      responses.push({ jsonrpc: '2.0', id, error: { code, message } });
    }
  }

  if (responses.length === 0) {
    // 全为通知
    return new Response(null, { status: 202 });
  }
  const body = isBatch ? responses : responses[0];
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
