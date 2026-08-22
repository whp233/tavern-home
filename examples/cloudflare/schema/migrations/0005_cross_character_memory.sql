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
