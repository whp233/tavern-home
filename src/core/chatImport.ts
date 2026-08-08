// src/core/chatImport.ts
// 纯解析函数:把 SillyTavern 的 JSONL 聊天记录(每行一个消息对象,无头部行)归一化成打字桌楼层。
// 不碰 D1/env、只吃/吐普通对象——同 characterCard.ts 的家法:纯函数跟落库分开,前端/测试都能
// 直接对着这个函数跑,不用起一整条服务端链路。
//
// 楼层硬不变量(工单§4 A):content === variants[activeVariant](D1DeskStorage.createFloor 硬校验,
// 违反直接 throw)——这里在解析端就保证,不让坏数据漏到落库那一层。
// 容错口径(照 parseCharacterCard):缺字段跳过(不算错)、类型不对 warn 并忽略该字段、核心字段
// mes 缺失才 skip 整行;is_system/is_event 消息跳过(本项目不渲染系统横幅,混进用户楼层会污染装配)。

function describeType(v: any): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export interface ParsedChatFloor {
  role: 'user' | 'assistant';
  content: string;
  variants: string[];
  activeVariant: number;
  createdAt: string; // 已做单调递增兜底的 ISO 串
}

export type ParseChatJsonlResult =
  | { ok: true; floors: ParsedChatFloor[]; warnings: string[]; skipped_lines: number }
  | { ok: false; error: string };

// 超长正文截断上限,照 deskWindows.ts FLOOR_CONTENT_MAX 同一把尺子(落地前先兜一道,免得把
// 畸形长消息整段塞进 content/variants 后卡死装配/渲染)。
const MES_MAX = 50000;

// 码点安全截断(Array.from 切码点、不切开代理对)——比裸 slice 更稳,跟 embedChapterSummary 同款手法。
function truncate(s: string): string {
  return Array.from(s).slice(0, MES_MAX).join('');
}

// 合并判重键:role + content 完全一致算同一消息(用户拍板方案A)。判重不看 swipes 候选版本。
// 合并模式只追加不删除——existing 永远原样保留,只决定 incoming 里哪些算"已有"被滤掉。
// 返回 { floors: 需要新增的楼层(保持 incoming 顺序), skipped: 被判定重复滤掉的条数 }。
export interface MergeFloorsResult {
  floors: ParsedChatFloor[];
  skipped: number;
}

export function mergeFloors(existing: ParsedChatFloor[], incoming: ParsedChatFloor[]): MergeFloorsResult {
  const seen = new Set<string>();
  for (const f of existing) {
    seen.add(`${f.role}\u0000${f.content}`);
  }
  const floors: ParsedChatFloor[] = [];
  let skipped = 0;
  for (const f of incoming) {
    const key = `${f.role}\u0000${f.content}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key); // 同一批内也要去重:文件里同内容出现两次只落一条
    floors.push(f);
  }
  return { floors, skipped };
}

export function parseChatJsonl(raw: string): ParseChatJsonlResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: `聊天记录必须是字符串(JSONL全文),实际收到的是 ${describeType(raw)}` };
  }
  if (!raw.trim()) {
    return { ok: false, error: '聊天记录是空的——没有可导入的楼层' };
  }

  const floors: ParsedChatFloor[] = [];
  const warnings: string[] = [];
  let skippedLines = 0;
  // 相邻行 send_date 相同或不递增时后行顺延 +1ms,保证 created_at 严格递增——
  // 楼层排序按 (created_at ASC, id ASC),同时间戳要靠 id 定序会抖动。
  let lastMs = Number.NEGATIVE_INFINITY;

  const lines = raw.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const line = lines[idx].trim();
    if (!line) continue; // 空行静默跳过,不计入坏行

    let m: any;
    try {
      m = JSON.parse(line);
    } catch {
      warnings.push(`第${lineNo}行: JSON 解析失败,已跳过`);
      skippedLines++;
      continue;
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      warnings.push(`第${lineNo}行: 不是合法的消息对象,已跳过`);
      skippedLines++;
      continue;
    }
    if (m.is_system === true || m.is_event === true) {
      warnings.push(`第${lineNo}行: 系统/事件消息,已跳过`);
      skippedLines++;
      continue;
    }
    if (typeof m.mes !== 'string') {
      warnings.push(`第${lineNo}行: 缺 mes 字段(或类型不对),已跳过`);
      skippedLines++;
      continue;
    }

    // role 判定:is_user===true(或 role==='user')→user,否则 assistant;
    // is_user 缺失且无 role → 按 assistant 落 + warning
    let role: 'user' | 'assistant';
    if (m.is_user === true) role = 'user';
    else if (m.is_user === false) role = 'assistant';
    else if (m.role === 'user') role = 'user';
    else if (m.role === 'assistant') role = 'assistant';
    else {
      role = 'assistant';
      warnings.push(`第${lineNo}行: 无法判定发言者角色(is_user/role 缺失或类型不对),按 assistant 落`);
    }

    // variants:有 swipes 数组就用(滤掉非字符串项),没有就 [mes]
    let variants: string[];
    if (m.swipes !== undefined && m.swipes !== null) {
      if (Array.isArray(m.swipes)) {
        const strs = m.swipes.filter((s: any) => typeof s === 'string');
        if (strs.length !== m.swipes.length) {
          warnings.push(`第${lineNo}行: swipes 里混了非字符串项,已跳过那些项`);
        }
        variants = strs.length > 0 ? strs : [m.mes];
      } else {
        warnings.push(`第${lineNo}行: swipes 类型不对(实际是${describeType(m.swipes)}),已忽略`);
        variants = [m.mes];
      }
    } else {
      variants = [m.mes];
    }

    // activeVariant:Number.isInteger(swipe_id) ? clamp 到 [0, variants.length-1] : 0
    let activeVariant = 0;
    if (Number.isInteger(m.swipe_id)) {
      activeVariant = Math.min(Math.max(m.swipe_id, 0), variants.length - 1);
    }

    // 硬不变量 content === variants[activeVariant]:content 一律取当前激活版本——
    // 合法输入下这就是规格里 user 取 mes / assistant 取 swipes[swipe_id] 的同一份文本;
    // 脏输入(swipes[swipe_id]≠mes、swipe_id 越界)时以不变量为准,不让坏数据漏到落库层。
    let content = String(variants[activeVariant]);

    // 超长正文截断(码点安全)+ 全 variants 一起截,保证截断后 content === variants[activeVariant] 仍成立。
    let truncated = false;
    if (Array.from(content).length > MES_MAX) {
      content = truncate(content);
      truncated = true;
    }
    if (variants.some((v) => Array.from(v).length > MES_MAX)) {
      variants = variants.map(truncate);
      truncated = true;
    }
    if (truncated) warnings.push(`第${lineNo}行: 消息超过${MES_MAX}字符上限,已截断`);

    // createdAt:send_date 是 number 就用,否则连续时间兜底;相同或不递增就后行顺延 +1ms
    let ms: number;
    if (typeof m.send_date === 'number' && Number.isFinite(m.send_date)) {
      ms = m.send_date;
    } else {
      ms = lastMs === Number.NEGATIVE_INFINITY ? Date.now() : lastMs;
    }
    if (ms <= lastMs) ms = lastMs + 1;
    lastMs = ms;
    const createdAt = new Date(ms).toISOString();

    floors.push({ role, content, variants, activeVariant, createdAt });
  }

  return { ok: true, floors, warnings, skipped_lines: skippedLines };
}
