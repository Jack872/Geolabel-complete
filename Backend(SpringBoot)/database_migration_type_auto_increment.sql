-- =====================================================
-- GeoLabel migration: type_id 改为数据库自增
-- PostgreSQL 10+
-- 请在你的数据库中执行此脚本
-- =====================================================

-- 创建自增序列（如果不存在）
CREATE SEQUENCE IF NOT EXISTS public.type_type_id_seq;

-- 将 type_id 默认值设为序列的下一个值
ALTER TABLE public.type ALTER COLUMN type_id SET DEFAULT nextval('public.type_type_id_seq');

-- 将序列当前值设为当前最大 type_id，避免与已有数据冲突
SELECT setval('public.type_type_id_seq', COALESCE((SELECT MAX(type_id) FROM public.type), 1));

-- 验证
SELECT currval('public.type_type_id_seq') AS current_seq_value;
