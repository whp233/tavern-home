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
