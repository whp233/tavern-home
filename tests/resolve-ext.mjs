// 测试专用 Node ESM resolve 钩子:仓库里相对导入多数不带扩展名(desk.ts 的
// '../storage/vectorize' 等),Node 的裸 node --test 不认——这钩子只在默认解析
// 失败时按 .ts/.js/.mjs 补一次扩展名,不改变其它成功路径。
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:')) throw err;
    for (const ext of ['.ts', '.js', '.mjs', '/index.ts']) {
      try {
        return await nextResolve(specifier + ext, context);
      } catch { /* try next */ }
    }
    throw err;
  }
}
