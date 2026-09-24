// src/core/conditionExpr.ts
// 白名单表达式求值器（2026-09-24）。
//
// ── 为什么必须自己写 ────────────────────────────────────────────────
// 原来 cgService.evaluateCgCondition 用的是：
//     new Function('state', `with (state) { return !!(${expr}); }`)
// 而 **Cloudflare Workers 禁止动态代码求值** —— 官方文档原文：
//     "For security reasons, the following are not allowed: eval(), new Function"
//     https://developers.cloudflare.com/workers/runtime-apis/web-standards/
// workerd 里这行抛 `EvalError: Code generation from strings disallowed for this context`，
// 被函数自己那个 try/catch 吞掉 → **恒返回 false**。
//
// 后果（全部是既有 bug，不是新引入的）：
//   · TRPG `endings[].condition` 永不成立 → 结局永远触发不了
//   · `uiEvents[].condition` 永不成立
//   · 自定义 CG（task-14）`isCgUnlocked` 的条件分支永不解锁
//   · 动作门禁 visibleExp / enableExp 恒为假
//
// 顺带堵掉一个注入面：CG / 剧本里的 condition 是**用户自己写的**，
// 原实现等于在服务端跑任意 JS。白名单求值器把能做的事收窄到比较与逻辑。
//
// ── 语法集（刻意收窄）────────────────────────────────────────────────
//   ||  &&  !  (  )  .  ===  !==  ==  !=  >=  <=  >  <
//   数字  单/双引号字符串  true  false  null  undefined  标识符（含中/日文）
// 不支持：算术、函数调用、下标、赋值、模板串。
// 要复杂逻辑 = 该把它拆成两条数据，而不是把表达式写成程序。
// 这套运算符集与 1room《ActMenuItem》实测到的完全一致（见逆向文档 §10.2）。

/** 与 cgService.CG_CONDITION_MAX 对齐 */
export const CONDITION_MAX_LENGTH = 4000;

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

// 多字符运算符：**长的必须排在短的前面**（=== 先于 ==，!== 先于 !=）。
const MULTI_OPS = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||'];
const SINGLE_OPS = '()!.<>';

// 标识符允许中日文（1room 的变量名就是「眠り」「進行度」这种人类词），
// 也允许**全角字母数字**（1room 实测里有 `挿入ＯＫ`，ＯＫ 是全角）。
const ID_START = /[A-Za-z_$぀-ヿ㐀-鿿０-９Ａ-Ｚａ-ｚ]/;
const ID_PART = /[A-Za-z0-9_$぀-ヿ㐀-鿿０-９Ａ-Ｚａ-ｚ]/;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let s = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) {
          s += src[i + 1];
          i += 2;
          continue;
        }
        s += src[i];
        i++;
      }
      if (i >= src.length) throw new Error('字符串没闭合');
      i++;
      out.push({ t: 'str', v: s });
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`数字不合法：${raw}`);
      out.push({ t: 'num', v: n });
      i = j;
      continue;
    }
    if (ID_START.test(c)) {
      let j = i;
      while (j < src.length && ID_PART.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const multi = MULTI_OPS.find((o) => src.startsWith(o, i));
    if (multi) {
      out.push({ t: 'op', v: multi });
      i += multi.length;
      continue;
    }
    if (SINGLE_OPS.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new Error(`不认识的字符：${c}`);
  }
  return out;
}

/** 序比较：任一侧是 null/undefined 一律 false（与 JS 的 NaN 式行为一致，且 fail-closed）。 */
function compare(op: string, l: unknown, r: unknown): boolean {
  if (l === null || l === undefined || r === null || r === undefined) return false;
  if (typeof l === 'number' && typeof r === 'number') {
    if (op === '>') return l > r;
    if (op === '<') return l < r;
    if (op === '>=') return l >= r;
    return l <= r;
  }
  const a = String(l);
  const b = String(r);
  if (op === '>') return a > b;
  if (op === '<') return a < b;
  if (op === '>=') return a >= b;
  return a <= b;
}

class Parser {
  private p = 0;
  private readonly toks: Token[];
  private readonly scope: Record<string, unknown>;

  // 注意：这里**不能**用 TS 参数属性（constructor(private readonly x)）——
  // 项目跑 `node --test` 用 strip-only 模式，参数属性会报
  // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX。
  constructor(toks: Token[], scope: Record<string, unknown>) {
    this.toks = toks;
    this.scope = scope;
  }

  parse(): unknown {
    const v = this.parseOr();
    if (this.p !== this.toks.length) throw new Error('表达式尾部有多余内容');
    return v;
  }

  private peek(): Token | undefined {
    return this.toks[this.p];
  }

  private eatOp(...ops: string[]): string | null {
    const t = this.peek();
    if (t && t.t === 'op' && ops.includes(t.v)) {
      this.p++;
      return t.v;
    }
    return null;
  }

  private parseOr(): unknown {
    let l = this.parseAnd();
    while (this.eatOp('||')) {
      const r = this.parseAnd();
      l = Boolean(l) || Boolean(r);
    }
    return l;
  }

  private parseAnd(): unknown {
    let l = this.parseNot();
    while (this.eatOp('&&')) {
      const r = this.parseNot();
      l = Boolean(l) && Boolean(r);
    }
    return l;
  }

  private parseNot(): unknown {
    if (this.eatOp('!')) return !this.parseNot();
    return this.parseCmp();
  }

  private parseCmp(): unknown {
    const l = this.parseMember();
    const op = this.eatOp('===', '!==', '==', '!=', '>=', '<=', '>', '<');
    if (!op) return l;
    const r = this.parseMember();
    switch (op) {
      case '===':
        return l === r;
      case '!==':
        return l !== r;
      case '==':
        // eslint-disable-next-line eqeqeq
        return l == r;
      case '!=':
        // eslint-disable-next-line eqeqeq
        return l != r;
      default:
        return compare(op, l, r);
    }
  }

  /** 只走自有属性 —— 顺手挡掉 __proto__ / constructor 这类原型链取值。 */
  private parseMember(): unknown {
    let v = this.parsePrimary();
    while (this.eatOp('.')) {
      const t = this.peek();
      if (!t || t.t !== 'id') throw new Error('`.` 后面要跟名字');
      this.p++;
      v = v !== null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, t.v)
        ? (v as Record<string, unknown>)[t.v]
        : undefined;
    }
    return v;
  }

  private parsePrimary(): unknown {
    const t = this.peek();
    if (!t) throw new Error('表达式不完整');
    if (t.t === 'num' || t.t === 'str') {
      this.p++;
      return t.v;
    }
    if (t.t === 'id') {
      this.p++;
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'null') return null;
      if (t.v === 'undefined') return undefined;
      // `state` 这个特殊名字回落到 scope 本身。
      // cgService 的用法就是这么写的（`state.位置 === "琉璃塔"`），
      // 旧实现靠 `with (state)` 的作用域链也能解析到，这里必须保持兼容。
      if (t.v === 'state' && !Object.prototype.hasOwnProperty.call(this.scope, 'state')) {
        return this.scope;
      }
      // 未定义的变量 → undefined（不抛）。比较类结果与旧的 fail-closed 一致，
      // 但 debug 时能看出「是空」而不是「表达式坏了」。
      return this.scope[t.v];
    }
    if (t.t === 'op' && t.v === '(') {
      this.p++;
      const v = this.parseOr();
      if (!this.eatOp(')')) throw new Error('括号没闭合');
      return v;
    }
    throw new Error(`这里不该出现：${JSON.stringify(t.v)}`);
  }
}

// 表达式字符串 → 已分词结果。剧本/CG 的表达式在每次请求里会被反复求值，缓存是值得的。
const TOKEN_CACHE = new Map<string, Token[]>();
const TOKEN_CACHE_MAX = 500;

function tokensFor(expr: string): Token[] {
  const hit = TOKEN_CACHE.get(expr);
  if (hit) return hit;
  const toks = tokenize(expr);
  if (TOKEN_CACHE.size >= TOKEN_CACHE_MAX) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(expr, toks);
  return toks;
}

/**
 * 求值一个条件表达式。
 * - 空串 / 全空白 → **恒真**（沿用 cgService 旧约定：没写条件就是不设限）
 * - 解析失败 / 求值出错 → **假**（fail-closed，与旧实现的 try/catch 行为一致）
 */
export function evaluateCondition(condition: string, scope: Record<string, unknown>): boolean {
  const expr = String(condition ?? '').trim();
  if (!expr) return true;
  if (expr.length > CONDITION_MAX_LENGTH) return false;
  try {
    return Boolean(new Parser(tokensFor(expr), scope).parse());
  } catch {
    return false;
  }
}
