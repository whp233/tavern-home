// src/core/trpg/gmPrompt.ts
// GM 双 prompt 装配：GM 主持人人格（chara_card_v2 + gameplay_rules）
// + 剧本数据摘要 + 当前运行时 state  一次生成请求。

import type { TrpgAction, TrpgScenario, TrpgState } from './types.ts';

function line(value: string): string {
  return String(value ?? '').trim();
}

function actionLines(scenario: TrpgScenario, state: TrpgState): string[] {
  const location = scenario.locations.find((l) => l.id === state.locationId);
  if (!location) return [];
  return location.availableActions
    .filter((a) => !a.requiresItem || (state.items[a.requiresItem] ?? 0) > 0)
    .map((a) => {
      const dc = a.difficulty ? `（DC ${a.difficulty}）` : '';
      return `- ${a.id}：${line(a.label)}${dc}  ${line(a.description)}`;
    });
}

export interface GmPromptRequest {
  system: Array<{ text: string; cache: boolean }>;
  prompt: string;
}

export function buildGmRequest(
  scenario: TrpgScenario,
  state: TrpgState,
  action: TrpgAction,
): GmPromptRequest {
  const location = scenario.locations.find((l) => l.id === state.locationId);
  const locationName = location?.name ?? state.locationId;
  const itemSummary = scenario.items.map((i) => `${i.id}（${line(i.name)}，${line(i.description)}）`).join('；') || '无';
  const keyEventSummary = scenario.keyEvents.map((k) => `${k.id}@${k.requiredLocation}（DC ${k.difficulty ?? '?'}）`).join('；') || '无';
  const endingSummary = scenario.endings.map((e) => `${e.id}：${line(e.name)}（${line(e.condition)}）`).join('；') || '无';

  const persona = `[GM 主持人人格  chara_card_v2]
你是《${scenario.scenario.title}》的游戏主持人（Game Master）。
{
  "spec": "chara_card_v2",
  "data": {
    "name": "TRPG GM",
    "description": "${line(scenario.info)}",
    "personality": "沉稳、细腻、会描写环境与角色情绪；用第二人称推动剧情。",
    "scenario": "${line(scenario.scenario.intro)}",
    "first_mes": "欢迎来到《${scenario.scenario.title}》。",
    "creator_notes": "你只负责本剧本的叙述与建议裁决，不替玩家做选择。"
  },
  "gameplay_rules": {
    "role": "你担任游戏主持人（GM），负责世界观叙事、NPC 台词与剧情推进；同时给出建议裁决。",
    "player_role": "玩家扮演异世界勇者，在本局冒险中从地点列表选择动作。",
    "dice_rules": "D20 判定由程序执行。你可以在 JSON 中建议 requires_dice 与 difficulty；不要自己掷骰。",
    "output_requirements": "先输出 120~200 字第二人称叙述（旁白 + 角色对白），然后在叙述后附加一个 JSON 数据块，不要输出 JSON 以外的解释。"
  }
}`;

  const scenarioAndState = `[剧本数据摘要]
标题：${scenario.scenario.title}
介绍：${line(scenario.scenario.intro)}
地点：${scenario.locations.map((l) => `${l.id}（${line(l.name)}${l.unlocked ? '，已解锁' : '，未解锁'}）`).join('；') || '无'}
道具：${itemSummary}
关键事件：${keyEventSummary}
结局：${endingSummary}

[当前运行时状态]
${JSON.stringify(state, null, 2)}
当前地点：${locationName}
当前位置可用动作：
${actionLines(scenario, state).join('\n') || '暂无动作'}`;

  const prompt = `玩家选择了动作「${line(action.label)}」(${action.id})。
请根据当前状态推进剧情：先第二人称叙述 120~200 字，末尾附 JSON 数据块：
{
  "requires_dice": true,
  "difficulty": ${action.difficulty ?? '? optional'},
  "action_type": "${action.kind ?? 'story'}",
  "narration": "（旁白）",
  "state_changes": {
    "stamina": -${action.staminaCost ?? 0},
    "addItem": {"id":"herb","quantity":1},
    "missionState": {},
    "unlockLocation": "cave"
  }
}
请根据剧情合理性决定是否判定、难度与状态变化；不要替程序掷骰。`;

  return {
    system: [
      { text: persona, cache: true },
      { text: scenarioAndState, cache: true },
    ],
    prompt,
  };
}