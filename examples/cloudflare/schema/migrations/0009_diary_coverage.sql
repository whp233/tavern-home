-- 0009_diary_coverage.sql
-- 补写“已写感知”：记录每篇日记覆盖了哪段对话，便于一键补写时跳过已写、从未覆盖处继续
CREATE TABLE IF NOT EXISTS diary_coverage (
  id TEXT PRIMARY KEY,
  diary_id TEXT NOT NULL,
  project TEXT,
  char_key TEXT,
  window_id TEXT,
  floor_start TEXT,
  floor_end TEXT,
  floor_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (diary_id) REFERENCES diaries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_diary_coverage_window ON diary_coverage(window_id);
CREATE INDEX IF NOT EXISTS idx_diary_coverage_char ON diary_coverage(char_key);
CREATE INDEX IF NOT EXISTS idx_diary_coverage_project ON diary_coverage(project);
