PRAGMA foreign_keys = ON;

CREATE TABLE schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO schema_versions(version) VALUES (1);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK(category IN ('world','plot','outline','session')),
  title TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  chapter TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  lore_keys TEXT NOT NULL DEFAULT '[]',
  lore_position TEXT NOT NULL DEFAULT 'before',
  is_char INTEGER NOT NULL DEFAULT 0 CHECK(is_char IN (0,1)),
  lore_constant INTEGER NOT NULL DEFAULT 0 CHECK(lore_constant IN (0,1)),
  trigger_mode TEXT NOT NULL DEFAULT 'scan' CHECK(trigger_mode IN ('scan','presence')),
  lore_enabled INTEGER NOT NULL DEFAULT 1 CHECK(lore_enabled IN (0,1)),
  lore_fields TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX memories_project_category ON memories(project, category, updated_at DESC);

CREATE TABLE oc_chapters (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  chapter_no TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX chapters_published ON oc_chapters(project, status, chapter_no, id);

CREATE TABLE oc_comments (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES oc_chapters(id) ON DELETE CASCADE,
  reply_to TEXT REFERENCES oc_comments(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_type TEXT NOT NULL CHECK(author_type IN ('owner','ai')),
  display_name TEXT NOT NULL,
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX comments_chapter_cursor ON oc_comments(chapter_id, created_at, id);

CREATE TABLE comment_rate_buckets (
  dimension TEXT NOT NULL CHECK(dimension IN ('actor','ip')),
  subject TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(dimension, subject, minute_bucket)
);
CREATE TRIGGER comment_rate_limit_guard
BEFORE UPDATE OF request_count ON comment_rate_buckets
WHEN NEW.request_count > 5
BEGIN
  SELECT RAISE(ABORT, 'comment_rate_limited');
END;

CREATE TRIGGER comments_reply_same_chapter_insert
BEFORE INSERT ON oc_comments
WHEN NEW.reply_to IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM oc_comments parent WHERE parent.id = NEW.reply_to AND parent.chapter_id = NEW.chapter_id
)
BEGIN
  SELECT RAISE(ABORT, 'reply_must_belong_to_same_chapter');
END;

CREATE TRIGGER comments_reply_same_chapter_update
BEFORE UPDATE OF chapter_id, reply_to ON oc_comments
WHEN NEW.reply_to IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM oc_comments parent WHERE parent.id = NEW.reply_to AND parent.chapter_id = NEW.chapter_id
)
BEGIN
  SELECT RAISE(ABORT, 'reply_must_belong_to_same_chapter');
END;

CREATE TABLE oc_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE usage_log (id TEXT PRIMARY KEY, channel TEXT NOT NULL, model TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE desk_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, raw_json TEXT NOT NULL, params TEXT NOT NULL DEFAULT '{}', block_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE desk_blocks (id TEXT PRIMARY KEY, preset_id TEXT NOT NULL, identifier TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'system', content TEXT NOT NULL DEFAULT '', marker INTEGER NOT NULL DEFAULT 0, injection TEXT NOT NULL DEFAULT '{}', in_queue INTEGER NOT NULL DEFAULT 0, queue_pos INTEGER, enabled_default INTEGER NOT NULL DEFAULT 0, UNIQUE(preset_id, identifier));
CREATE TABLE desk_recipes (id TEXT PRIMARY KEY, project TEXT NOT NULL, name TEXT NOT NULL, preset_id TEXT NOT NULL, weight TEXT NOT NULL DEFAULT 'heavy' CHECK(weight IN ('light','heavy')), overrides TEXT NOT NULL DEFAULT '{}', regex_ids TEXT NOT NULL DEFAULT '[]', params TEXT NOT NULL DEFAULT '{}', light_system TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE desk_regex (id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('preset','global')), preset_id TEXT, name TEXT NOT NULL DEFAULT '', find TEXT NOT NULL, replace TEXT NOT NULL DEFAULT '', flags TEXT NOT NULL DEFAULT '', direction TEXT NOT NULL CHECK(direction IN ('up','down','both')), enabled INTEGER NOT NULL DEFAULT 1, meta TEXT NOT NULL DEFAULT '{}', sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE desk_windows (id TEXT PRIMARY KEY, project TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', recipe_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', note_depth INTEGER NOT NULL DEFAULT 3, state_board TEXT NOT NULL DEFAULT '{}', timeline_state TEXT NOT NULL DEFAULT '{}', vars TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE desk_floors (id TEXT PRIMARY KEY, window_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL DEFAULT '', variants TEXT NOT NULL DEFAULT '[]', active_variant INTEGER NOT NULL DEFAULT 0, thinking TEXT, report TEXT, created_at TEXT NOT NULL);
CREATE INDEX desk_blocks_preset ON desk_blocks(preset_id);
CREATE INDEX desk_recipes_project ON desk_recipes(project);
CREATE INDEX desk_windows_project ON desk_windows(project);
CREATE INDEX desk_floors_window_created ON desk_floors(window_id, created_at);
-- 0002_desk_chapter_floors.sql
-- 功能一：desk_chapter_floors 映射表——记录"哪些打字桌楼层进了哪一章"，用于：
--   ①重新生成某一章  ②楼层被编辑/truncate 后判断哪些章过期  ③幂等防重复成书
-- 功能二：oc_chapters 软删除——deleted_at 非空 = 进了回收站，恢复置 NULL，彻底删除才真删行

-- 自动成书映射表（功能一）
CREATE TABLE IF NOT EXISTS desk_chapter_floors (
  chapter_id TEXT NOT NULL REFERENCES oc_chapters(id) ON DELETE CASCADE,
  window_id  TEXT NOT NULL,
  floor_id   TEXT NOT NULL,
  seq        INTEGER NOT NULL,   -- 楼层在章内的顺序
  PRIMARY KEY (chapter_id, floor_id)
);
CREATE INDEX IF NOT EXISTS desk_chapter_floors_window ON desk_chapter_floors(window_id);

-- 章节软删除字段（功能二）
ALTER TABLE oc_chapters ADD COLUMN deleted_at TEXT;
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
-- 0004_desk_memory_module.sql
-- 打字桌记忆模块：对话中自动提炼的关键信息，按主题分组、按 desk_window 隔离，支持手动 Compact
-- 一键压缩（智能提炼、删重复、合并同主题）+ 压缩结果可回退。
-- desk_memories 是"当前生效"的记忆条目集合；每次手动 Compact 会先把整窗记忆集快照进
-- desk_memory_snapshots，压缩后可随时回退到任一历史快照（data 列存 JSON 数组快照）。
CREATE TABLE desk_memories (
  id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT '其他',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX desk_memories_window_theme ON desk_memories(window_id, theme, updated_at DESC);

CREATE TABLE desk_memory_snapshots (
  id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX desk_memory_snapshots_window ON desk_memory_snapshots(window_id, created_at);
-- 0005_cross_character_memory.sql
-- 跨角色记忆重构（task-10）：将 desk_memories 的作用域从「按 desk_window 隔离」升级为
-- 「项目 ×（角色|共享）+ 分层」，并让 desk_windows 声明所属角色。
-- 新增列：
--   desk_memories.project     命名空间（隔离项目，防跨项目串记忆；由来源窗口 backfill）
--   desk_memories.char_key    角色作用域键：非空=角色作用域；空串=共享作用域（项目内所有角色可见）
--   desk_memories.layer       分层：anchor 人设锚定区 / plot 剧情摘要区 / general 通用区（默认 plot）
--   desk_windows.char_key     窗口声明的角色名（供同角色跨窗口聚合与聊天注入取用）
--   desk_memory_snapshots.project / char_key  快照定位到原作用域（快照按 scope 粒度存取）
-- 老数据归置：project = 来源窗口的 project；char_key 留 ''（默认入共享区），window_id 保留溯源。
-- 保持既有 task-7/9 行为：window_id 仍保留并可供溯源查询。

ALTER TABLE desk_memories ADD COLUMN project TEXT NOT NULL DEFAULT '';
ALTER TABLE desk_memories ADD COLUMN char_key TEXT NOT NULL DEFAULT '';
ALTER TABLE desk_memories ADD COLUMN layer TEXT NOT NULL DEFAULT 'plot';
CREATE INDEX desk_memories_scope_idx ON desk_memories(project, char_key, layer, updated_at DESC);

ALTER TABLE desk_memory_snapshots ADD COLUMN project TEXT NOT NULL DEFAULT '';
ALTER TABLE desk_memory_snapshots ADD COLUMN char_key TEXT NOT NULL DEFAULT '';
CREATE INDEX desk_memory_snapshots_scope ON desk_memory_snapshots(project, char_key, created_at);

ALTER TABLE desk_windows ADD COLUMN char_key TEXT NOT NULL DEFAULT '';
CREATE INDEX desk_windows_char_idx ON desk_windows(project, char_key);

-- 老记忆 backfill：把 window_id 溯源到的窗的 project 填进 project 列（char_key 缺省留空→共享区）。
UPDATE desk_memories
  SET project = (SELECT dw.project FROM desk_windows dw WHERE dw.id = desk_memories.window_id)
  WHERE project = '';
-- 0006_diary.sql
-- 酒馆之家「日记」功能（task-12）：按日期组织的个人+剧情日记，持久化于 D1。
-- 字段对齐妹居存档实测格式（date "2026/6/27" / time "下午3:35:11" / affection / content /
-- conversationLength + diaryId），在此之上扩展关联与反向递归锚点：
--   project            可选关联项目（命名空间，与 memories/desk_memories 同口径，空串=未指定）
--   char_key           可选角色关联（「谁的日记」，空串=未指定）
--   title              可选标题（默认空串）
--   conversation_id    反向递归锚点：关联对话 id（可从日记反查剧情节点，联动 task-13/14）
--   conversation_length 对话条数（可空）
-- 日期列存妹居格式 "YYYY/M/D"（无前导零）；排序在工具层按年月日数值比较（见 src/tools/diary.ts）。
CREATE TABLE diaries (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL DEFAULT '',
  char_key TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  affection INTEGER,
  conversation_id TEXT NOT NULL DEFAULT '',
  conversation_length INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX diaries_date_idx ON diaries(date, updated_at DESC);
CREATE INDEX diaries_project_char_idx ON diaries(project, char_key, updated_at DESC);-- 0007_custom_cg.sql
-- 酒馆之家「自定义 CG」（task-14）：用户可为角色/剧情配置 CG 图（data URL / URL）或占位，
-- 并带场景键 + 状态表达式条件（对齐妹居「事件→条件→组件」的最小可落地形态）。
CREATE TABLE custom_cg (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL DEFAULT '',
  char_key TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  scene_key TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  placeholder TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX custom_cg_project_char_idx ON custom_cg(project, char_key, enabled, updated_at DESC);
CREATE INDEX custom_cg_scene_idx ON custom_cg(scene_key, enabled, updated_at DESC);