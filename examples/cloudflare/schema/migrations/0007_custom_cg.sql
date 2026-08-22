-- 0007_custom_cg.sql
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