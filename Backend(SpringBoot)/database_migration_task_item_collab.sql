-- =====================================================
-- 数据库迁移脚本：多影像多人分工标注（task_item 级）
-- 创建日期：2026-05-19
-- 说明：
-- 1) 保留 task_accepted 作为任务入口级权限
-- 2) 新增/扩展 task_item_type_accepted 作为影像-用户-类别分工表
-- 3) 扩展 task_item，支持影像级提交与审核状态
-- 4) （可选）mark 冲突提示字段
-- PostgreSQL 10+
-- =====================================================

-- 1) 影像-用户-类别分工表
CREATE TABLE IF NOT EXISTS public.task_item_type_accepted (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL,
    task_item_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username VARCHAR(100),
    type_id INTEGER NOT NULL,
    is_finished BOOLEAN NOT NULL DEFAULT FALSE,
    finished_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE public.task_item_type_accepted IS '任务影像-用户-类别分工表';
COMMENT ON COLUMN public.task_item_type_accepted.task_id IS '任务ID';
COMMENT ON COLUMN public.task_item_type_accepted.task_item_id IS '任务影像项ID';
COMMENT ON COLUMN public.task_item_type_accepted.user_id IS '用户ID';
COMMENT ON COLUMN public.task_item_type_accepted.username IS '用户名快照';
COMMENT ON COLUMN public.task_item_type_accepted.type_id IS '类别ID';
COMMENT ON COLUMN public.task_item_type_accepted.is_finished IS '该用户在该影像是否点击标注完成';
COMMENT ON COLUMN public.task_item_type_accepted.finished_at IS '点击完成时间';
COMMENT ON COLUMN public.task_item_type_accepted.created_at IS '创建时间';
COMMENT ON COLUMN public.task_item_type_accepted.updated_at IS '更新时间';

CREATE INDEX IF NOT EXISTS idx_tita_task_id
    ON public.task_item_type_accepted(task_id);
CREATE INDEX IF NOT EXISTS idx_tita_task_item_id
    ON public.task_item_type_accepted(task_item_id);
CREATE INDEX IF NOT EXISTS idx_tita_task_item_user
    ON public.task_item_type_accepted(task_id, task_item_id, user_id);
CREATE INDEX IF NOT EXISTS idx_tita_task_item_user_type
    ON public.task_item_type_accepted(task_id, task_item_id, user_id, type_id);

-- 按本次需求推荐的唯一性（同任务同影像同类别仅一条分工）
CREATE UNIQUE INDEX IF NOT EXISTS uk_task_item_type_unique
    ON public.task_item_type_accepted(task_id, task_item_id, type_id);

-- 外键（幂等添加）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_tita_task'
    ) THEN
        ALTER TABLE public.task_item_type_accepted
            ADD CONSTRAINT fk_tita_task
            FOREIGN KEY (task_id) REFERENCES public.task(task_id) ON DELETE CASCADE;
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_tita_task_item'
    ) THEN
        ALTER TABLE public.task_item_type_accepted
            ADD CONSTRAINT fk_tita_task_item
            FOREIGN KEY (task_item_id) REFERENCES public.task_item(task_item_id) ON DELETE CASCADE;
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_tita_user'
    ) THEN
        ALTER TABLE public.task_item_type_accepted
            ADD CONSTRAINT fk_tita_user
            FOREIGN KEY (user_id) REFERENCES public.sys_user(user_id) ON DELETE CASCADE;
    END IF;
END$$;

-- 2) 扩展 task_item：影像级提交/审核字段
ALTER TABLE public.task_item
    ADD COLUMN IF NOT EXISTS status INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS submitter_id INTEGER,
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS reviewer_id INTEGER,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS audit_feedback TEXT;

COMMENT ON COLUMN public.task_item.status IS '影像状态：3标注中/0待审核/1审核通过/2审核退回';
COMMENT ON COLUMN public.task_item.submitter_id IS '提交该影像的用户ID';
COMMENT ON COLUMN public.task_item.submitted_at IS '影像提交审核时间';
COMMENT ON COLUMN public.task_item.reviewer_id IS '审核员用户ID';
COMMENT ON COLUMN public.task_item.reviewed_at IS '影像审核时间';
COMMENT ON COLUMN public.task_item.audit_feedback IS '影像审核意见';

CREATE INDEX IF NOT EXISTS idx_task_item_task_status
    ON public.task_item(task_id, status);
CREATE INDEX IF NOT EXISTS idx_task_item_submitter
    ON public.task_item(submitter_id);
CREATE INDEX IF NOT EXISTS idx_task_item_reviewer
    ON public.task_item(reviewer_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_task_item_submitter'
    ) THEN
        ALTER TABLE public.task_item
            ADD CONSTRAINT fk_task_item_submitter
            FOREIGN KEY (submitter_id) REFERENCES public.sys_user(user_id) ON DELETE SET NULL;
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_task_item_reviewer'
    ) THEN
        ALTER TABLE public.task_item
            ADD CONSTRAINT fk_task_item_reviewer
            FOREIGN KEY (reviewer_id) REFERENCES public.sys_user(user_id) ON DELETE SET NULL;
    END IF;
END$$;

-- 3) （可选）mark 冲突提示字段（仅 warning 展示）
ALTER TABLE public.mark
    ADD COLUMN IF NOT EXISTS has_conflict BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS conflict_status VARCHAR(30) NOT NULL DEFAULT 'NONE';

COMMENT ON COLUMN public.mark.has_conflict IS '是否检测到与其他用户标注冲突';
COMMENT ON COLUMN public.mark.conflict_status IS '冲突状态：NONE/PENDING/RESOLVED';

-- 4) 审核反馈改为面向 task_item：历史数据兼容回填
-- 如果历史版本的审核反馈仍保存在 task.audit_feedback，则优先回填到每个任务的首张影像。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'task'
          AND column_name = 'audit_feedback'
    ) THEN
        UPDATE public.task_item ti
        SET audit_feedback = t.audit_feedback
        FROM public.task t
        WHERE ti.task_id = t.task_id
          AND (ti.audit_feedback IS NULL OR btrim(ti.audit_feedback) = '')
          AND t.audit_feedback IS NOT NULL
          AND btrim(t.audit_feedback) <> ''
          AND ti.task_item_id = (
              SELECT ti2.task_item_id
              FROM public.task_item ti2
              WHERE ti2.task_id = t.task_id
              ORDER BY COALESCE(ti2.item_index, 2147483647), ti2.task_item_id
              LIMIT 1
          );
    END IF;
END$$;
