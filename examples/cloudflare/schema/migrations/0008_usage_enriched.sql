-- 0008_usage_enriched.sql
-- Token 消耗看板：按供应商/模型/项目/角色/对话维度聚合，需在 usage_log 上补维度列
ALTER TABLE usage_log ADD COLUMN project TEXT;
ALTER TABLE usage_log ADD COLUMN char_key TEXT;
ALTER TABLE usage_log ADD COLUMN window_id TEXT;
ALTER TABLE usage_log ADD COLUMN provider_id TEXT;
CREATE INDEX IF NOT EXISTS idx_usage_log_created_at ON usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_log_project ON usage_log(project);
CREATE INDEX IF NOT EXISTS idx_usage_log_char ON usage_log(char_key);
CREATE INDEX IF NOT EXISTS idx_usage_log_window ON usage_log(window_id);
