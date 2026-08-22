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
