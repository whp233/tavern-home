// src/core/trpg/scenarioData.ts
// 剧本数据装载：registry.json + 内置示范剧本。新增剧本时往 scenarios/ 放文件并在下面数组登记。

import registryJson from './scenarios/registry.json' with { type: 'json' };
import isekaiJson from './scenarios/isekai-demon-lord.json' with { type: 'json' };
import type { TrpgRegistryEntry, TrpgScenario } from './types.ts';

interface RegistryFile {
  scenarios: TrpgRegistryEntry[];
}

const registryFile = registryJson as RegistryFile;
const scenarios: TrpgScenario[] = [
  isekaiJson as TrpgScenario,
];

export function listScenarioSummaries(): TrpgRegistryEntry[] {
  return registryFile.scenarios.map((raw) => ({ ...raw }));
}

export function getScenario(id: string): TrpgScenario | null {
  return scenarios.find((s) => s.id === id) || null;
}

export function getScenarioSummary(id: string): TrpgRegistryEntry | null {
  return registryFile.scenarios.find((s) => s.id === id) || null;
}

export function getAllScenarios(): TrpgScenario[] {
  return scenarios.map((s) => s);
}