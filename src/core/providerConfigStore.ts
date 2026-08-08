// 模型供应商网页端配置的运行时数据层接口:供应商「覆盖」(override)的存取契约。
// 覆盖 = 用户在网页端配的供应商,按 id 覆盖注册表(env 前缀)里的同名项,或新增 custom:<随机> 自定义项。
// 持久化实现不在 core 层——examples/cloudflare/adapters/d1ProviderConfigStore.ts 用 oc_state 落库;
// 测试可用内存实现。合并/解析逻辑在 adapters/streamModelBackends.ts 的 mergeProviderEnv 系。

export type ProviderProtocol = 'openai' | 'anthropic';

export interface ProviderOverride {
  id: string;              // 注册表 id(如 'deepseek')或 'custom:<随机>'
  name?: string;           // 自定义供应商显示名
  protocol: ProviderProtocol;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
}

export interface ProviderConfigStore {
  list(): Promise<ProviderOverride[]>;
  get(id: string): Promise<ProviderOverride | null>;
  put(o: ProviderOverride): Promise<void>;
  remove(id: string): Promise<void>;
}
