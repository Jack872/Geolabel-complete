-- =====================================================
-- GeoLabel migration: task annotation schema support
-- PostgreSQL 10+
-- =====================================================

ALTER TABLE public.task
  ADD COLUMN IF NOT EXISTS annotation_schema jsonb;

ALTER TABLE public.task
  ADD COLUMN IF NOT EXISTS annotation_schema_version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.task.annotation_schema IS '任务级标注属性约束(JSON Schema-like)';
COMMENT ON COLUMN public.task.annotation_schema_version IS '任务标注属性约束版本';

