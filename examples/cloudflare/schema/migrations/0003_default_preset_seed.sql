-- 0003_default_preset_seed.sql
-- 内置默认预设「默认·小说直写」：全新安装自带 1 预设，让"不知道预设是什么"的新用户也能直接开写作窗。
-- 形状照 deskImportPreset（src/tools/desk.ts）的落库结果手工对齐：积木 pk_default:main 在
-- prompt_order 第一份里、enabled=true，所以 in_queue=1 / queue_pos=0 / enabled_default=1，
-- injection 六个键与 parsePresetBlocks 产出的形状一致；raw_json 与前端 public/presets/default-writing.json 同内容。
INSERT INTO desk_presets (id, name, raw_json, params, block_count, created_at) VALUES (
  'pk_default',
  '默认·小说直写',
  '{"name":"默认·小说直写","prompts":[{"identifier":"main","name":"Main","role":"system","content":"Continue the scene faithfully. 直接写小说内容，不要解释。"}],"prompt_order":[{"order":[{"identifier":"main","enabled":true}]}]}',
  '{}',
  1,
  datetime('now')
);
INSERT INTO desk_blocks (id, preset_id, identifier, name, role, content, marker, injection, in_queue, queue_pos, enabled_default) VALUES (
  'pk_default:main', 'pk_default', 'main', 'Main', 'system',
  'Continue the scene faithfully. 直接写小说内容，不要解释。',
  0, '{"injection_position":null,"injection_depth":null,"injection_order":null,"forbid_overrides":false,"system_prompt":false}',
  1, 0, 1
);
