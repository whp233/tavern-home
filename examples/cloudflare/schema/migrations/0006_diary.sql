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
CREATE INDEX diaries_project_char_idx ON diaries(project, char_key, updated_at DESC);