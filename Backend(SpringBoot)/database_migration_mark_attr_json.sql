-- =====================================================
-- GeoLabel migration: mark attr_json support
-- PostgreSQL 10+
-- =====================================================

ALTER TABLE public.mark
  ADD COLUMN IF NOT EXISTS attr_json jsonb;

COMMENT ON COLUMN public.mark.attr_json IS '标注业务属性(JSON)，与几何解耦存储';

-- 兼容历史数据：将 geom.properties.attrJson 回填到 attr_json
UPDATE public.mark
SET attr_json = COALESCE(
    attr_json,
    geom::jsonb -> 'properties' -> 'attrJson',
    geom::jsonb -> 'properties' -> 'attr_json'
)
WHERE attr_json IS NULL
  AND geom IS NOT NULL;

-- 清理几何属性中的业务属性，保留轻量几何相关 properties
UPDATE public.mark
SET geom = jsonb_set(
    geom::jsonb,
    '{properties}',
    (COALESCE(geom::jsonb -> 'properties', '{}'::jsonb) - 'attrJson' - 'attr_json'),
    true
)
WHERE geom IS NOT NULL
  AND (
    (geom::jsonb -> 'properties') ? 'attrJson'
    OR (geom::jsonb -> 'properties') ? 'attr_json'
  );

-- 常见按属性键检索场景可启用 GIN 索引
CREATE INDEX IF NOT EXISTS idx_mark_attr_json_gin
  ON public.mark
  USING GIN (attr_json);
