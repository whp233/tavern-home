// src/core/story/storyPrompt.ts
// 剧情CG模式：大纲+开头+续写（通用版，150字标签已回退，保留可选角色感）

import type { StoryOutline } from './types.ts';

function esc(v: unknown): string {
  return String(v ?? '').trim().slice(0, 4000);
}

export function buildOutlinePrompt(input: {
  premise?: string;
  project?: string;
  charKey?: string;
  tone?: string;
  seedHint?: string;
}): { system: Array<{ text: string; cache: boolean }>; prompt: string } {
  const premise = esc(input.premise) || '温馨日常 / 轻冒险';
  const tone = esc(input.tone) || '细腻、治愈、第二人称';
  const persona = `[剧情CG总策划]
你是剧情CG模式的总策划，负责给出“大纲”。输出要求：只输出一个 JSON 数据块，不要额外解释。`;

  const ctx = `[用户请求]
项目：${esc(input.project) || '未指定'}  角色：${esc(input.charKey) || '通用'}  语气：${tone}
前提/种子：${premise}
${input.seedHint ? `补充：${esc(input.seedHint)}` : ''}`;

  const prompt = `请生成大纲 JSON：
{
  "title": "剧情标题（6-14字）",
  "premise": "一句话前提",
  "tone": "${tone}",
  "acts": [
    {"act":1,"title":"幕标题","summary":"本幕 40-80 字梗概","beats":["节拍1","节拍2"]},
    {"act":2,"title":"...","summary":"..."},
    {"act":3,"title":"...","summary":"..."}
  ],
  "tags": ["标签1","标签2"]
}
要求：acts 3-5 幕，中文，summary 40-80字，beats 每幕 2-3 条。请紧扣用户种子“${premise}”生成，Act1 围绕该种子的核心场景展开，保持 premise/标题与种子意图一致；若种子是明确的当下动作（如“我去泡温泉”），请勿改写为“想去/打算去/回忆”等愿望式表述，也尽量不另起无关前置场景。`;

  return { system: [{ text: persona, cache: true }, { text: ctx, cache: true }], prompt };
}

export function buildOpeningPrompt(outline: StoryOutline, input: {
  project?: string;
  charKey?: string;
}): { system: Array<{ text: string; cache: boolean }>; prompt: string } {
  const persona = `[剧情CG编剧]
你是本剧情的编剧/GM，负责写“开头”。输出：先 120-200字第二人称旁白（+少量对白），再附一个 JSON 数据块。`;

  const ctx = `[大纲]
${JSON.stringify(outline, null, 2)}
项目：${esc(input.project)}  角色：${esc(input.charKey) || '通用'}`;

  const prompt = `请写开头：基于上方【大纲】生成开头，先旁白 120-200字（第二人称，细腻带感官），再附 JSON：
{
  "narration": "（与上面旁白同文，纯文本）",
  "initialState": {"sceneKey":"客厅_夜","chapter":1,"mood":"期待"},
  "suggestedChoices": ["上前打招呼","先观察一下","轻声唤她的名字"],
  "cgEvent": {"sceneKey":"客厅_夜","condition":"sceneKey=='客厅_夜'"}
}
要求：JSON 单块，narration 与旁白一致，suggestedChoices 2-4 项，cgEvent 可选。请紧扣所选大纲/种子意图智能展开——开头即呈现大纲 Act1 的核心场景；若大纲种子是明确当下动作（如“泡温泉”），开头应直接呈现该场景正在发生，避免写成“想去/打算去/在别处想起”等延迟表述。`;

  return { system: [{ text: persona, cache: true }, { text: ctx, cache: true }], prompt };
}

export function buildContinuePrompt(session: {
  outline: StoryOutline;
  state: Record<string, unknown>;
  history: Array<{ role: string; content: string }>;
  userInput: string;
}): { system: Array<{ text: string; cache: boolean }>; prompt: string } {
  const persona = `[剧情CG主持]
你是本剧情的主持人，延续故事。先给 120-220字第二人称叙述，再附 JSON。`;

  const outlinePart = `大纲：${JSON.stringify(session.outline, null, 2)}`;
  const statePart = `当前状态：${JSON.stringify(session.state, null, 2)}`;
  const historySlice = session.history.slice(-6).map((h) => `${h.role}: ${esc(h.content).slice(0, 500)}`).join('\n') || '（无）';

  return {
    system: [
      { text: persona, cache: true },
      { text: `${outlinePart}\n${statePart}`, cache: true },
      { text: `近几轮：\n${historySlice}`, cache: false },
    ],
    prompt: `玩家输入：${esc(session.userInput) || '（继续）'}
请基于大纲与当前状态续写：先 120-220字旁白，再附 JSON：
{
  "narration": "（同旁白）",
  "stateChanges": {"sceneKey":"新场景","chapterDelta":0,"flags":{"hasMet":true}},
  "cgEvent": {"sceneKey":"新场景","condition":"chapter>=2"},
  "choices": ["选项A","选项B","选项C"]
}
请尊重玩家输入的当下意图，及时体现其结果（若是明确动作如“去泡温泉”，则直接推进到该场景，而非改写为愿望），只需输出旁白+单 JSON。`,
  };
}
