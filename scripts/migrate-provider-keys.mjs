#!/usr/bin/env node
// 26E T7: env 优先 + 迁 .dev.vars（或 AES-GCM 二选一）
// 把 D1 oc_state 中 provider_config:* 的明文 apiKey 迁到 .dev.vars，库内清明文
// 用法：
//   node scripts/migrate-provider-keys.mjs              # 本地 D1 迁 .dev.vars（wrangler local）
//   node scripts/migrate-provider-keys.mjs --dry        # 只预览不写
//   node scripts/migrate-provider-keys.mjs --remote     # 远端 D1（需 wrangler 登录）
// 依赖：npx wrangler d1 execute，需在项目根执行且 wrangler.toml 已配 d1 绑定 OT_DB / OC_DB

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const isDry = args.includes('--dry');
const isRemote = args.includes('--remote');
const wranglerDbFlag = isRemote ? '--remote' : '--local';

// 尝试从 wrangler.toml 猜 DB 名称，回落 OC_DB / D1
function guessDbName() {
  try {
    const toml = readFileSync(resolve('wrangler.toml'), 'utf8');
    const m = toml.match(/d1_databases[\s\S]*?binding\s*=\s*["']([^"']+)["']/);
    if (m) return m[1];
  } catch {}
  return 'OC_DB';
}
const DB = process.env.D1_DB || guessDbName();

function d1All(sql) {
  const cmd = `npx wrangler d1 execute ${DB} ${wranglerDbFlag} --command "${sql.replace(/"/g, '\\"')}" --json`;
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const j = JSON.parse(out);
  // wrangler --json 返回数组，取第一个 result
  const row = Array.isArray(j) ? j[0] : j;
  return row?.results || row?.result?.results || [];
}

// oc_state key = provider_config:<id>, value = JSON {id, apiKey, baseUrl, model, ...}
const rows = d1All(`SELECT key, value FROM oc_state WHERE key LIKE 'provider_config:%'`);
if (!rows.length) {
  console.log('[migrate] 没有 provider_config 行，无需迁移');
  process.exit(0);
}

console.log(`[migrate] 发现 ${rows.length} 条 provider_config`);

// 解析并映射到 env 前缀
const PREFIX_MAP = { opencode: 'OPENAI', anthropic: 'ANTHROPIC', deepseek: 'DEEPSEEK', siliconflow: 'SILICONFLOW' };
let devVarsPath = resolve('.dev.vars');
let devVars = existsSync(devVarsPath) ? readFileSync(devVarsPath, 'utf8') : '';
const toAppend = [];
const toDeleteKeys = [];

for (const r of rows) {
  const key = String(r.key);
  const id = key.replace(/^provider_config:/, '');
  let obj = null;
  try { obj = JSON.parse(String(r.value)); } catch { continue; }
  const prefix = PREFIX_MAP[id] || null;
  // 自定义 custom:* 不迁 .dev.vars，保留 DB（env 无前缀）
  if (!prefix) {
    console.log(` - skip custom ${id}（保留 DB，不迁 env）`);
    continue;
  }
  const apiKey = obj.apiKey || obj.api_key || '';
  if (!apiKey) {
    console.log(` - ${id} 无 apiKey，跳过`);
    continue;
  }
  const envKey = `${prefix}_API_KEY`;
  if (devVars.includes(envKey)) {
    console.log(` - ${id} -> ${envKey} 已在 .dev.vars，跳过写入`);
  } else {
    toAppend.push(`${envKey}=${apiKey}`);
    console.log(` - ${id} -> ${envKey} 待写入`);
  }
  // 其它字段按需迁（baseUrl/model 仅当 .dev.vars 没有时）
  for (const [field, suffix] of [['baseUrl','BASE_URL'],['model','MODEL'],['maxTokens','MAX_TOKENS']]) {
    const v = obj[field];
    if (v === undefined || v === '') continue;
    const ek = `${prefix}_${suffix}`;
    if (!devVars.includes(ek)) toAppend.push(`${ek}=${String(v)}`);
  }
  toDeleteKeys.push(key);
}

if (!toAppend.length) {
  console.log('[migrate] 无需写入 .dev.vars');
} else if (isDry) {
  console.log('[migrate][dry] 将写入 .dev.vars:');
  console.log(toAppend.join('\n'));
} else {
  const appendText = (devVars && !devVars.endsWith('\n') ? '\n' : '') + toAppend.join('\n') + '\n';
  writeFileSync(devVarsPath, devVars + appendText, 'utf8');
  console.log(`[migrate] 已写入 ${toAppend.length} 行到 .dev.vars`);
}

// 清库内明文：把 apiKey 置空（保留行以免前端列表消失，apiKey 空即视为未配置，env 生效）
if (!toDeleteKeys.length) process.exit(0);
if (isDry) {
  console.log('[migrate][dry] 将清空 DB 中 apiKey（保留行）：', toDeleteKeys.join(', '));
  process.exit(0);
}
for (const k of toDeleteKeys) {
  try {
    const row = rows.find(r => String(r.key)===k);
    const obj = JSON.parse(String(row.value));
    obj.apiKey = '';
    const newVal = JSON.stringify(obj).replace(/'/g, "''").replace(/"/g, '""');
    // 使用 wrangler execute 更新
    const sql = `UPDATE oc_state SET value='${JSON.stringify(obj).replace(/'/g, "''")}' WHERE key='${k}'`;
    execSync(`npx wrangler d1 execute ${DB} ${wranglerDbFlag} --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
  } catch (e) {
    console.error('清空失败', k, e.message);
  }
}
console.log('[migrate] 库内明文已清空，env 优先生效');
