-- =====================================================
-- 数据库迁移脚本：影像集类型 + 批次任务支持
-- 创建日期：2026-03-30
-- 描述：
-- 1) dataset 新增 set_type，区分 service/local
-- 2) task 新增 batch_id、batch_index，支持按影像集批量建任务并折叠展示
-- =====================================================

-- 1. dataset 表新增 set_type 字段 (默认追加到表尾)
ALTER TABLE dataset
    ADD COLUMN set_type VARCHAR(20) NOT NULL DEFAULT 'service';

-- 单独为字段添加注释
COMMENT ON COLUMN dataset.set_type IS '影像集类型: service=服务文件夹, local=本地文件夹';

-- 2. task 表新增 batch 字段
ALTER TABLE task
    ADD COLUMN batch_id VARCHAR(64),
ADD COLUMN batch_index INT;

-- 单独为字段添加注释
COMMENT ON COLUMN task.batch_id IS '批次ID（同一批任务共用）';
COMMENT ON COLUMN task.batch_index IS '批次内序号，从1开始';

-- 3. 可选索引（建议）
CREATE INDEX idx_task_batch_id ON task (batch_id);

-- =====================================================
-- 数据修复（可选）
-- =====================================================
-- 若历史数据 set_type 为空，则补成 service
UPDATE dataset SET set_type = 'service' WHERE set_type IS NULL OR set_type = '';
