-- =====================================================
-- GeoLabel migration: file metadata support
-- PostgreSQL 10+ compatible
-- =====================================================

-- 1) updated_time 自动更新时间函数
CREATE OR REPLACE FUNCTION public.fn_set_updated_time()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_time := NOW();
  RETURN NEW;
END;
$$;

-- 2) file_metadata 表（若不存在则创建）
CREATE TABLE IF NOT EXISTS public.file_metadata (
  file_id                INT PRIMARY KEY,
  crs_code               VARCHAR(64),
  crs_name               VARCHAR(255),
  acquisition_time_start TIMESTAMPTZ,
  acquisition_time_end   TIMESTAMPTZ,
  time_precision         VARCHAR(16),
  time_zone              VARCHAR(64),
  sensor_platform        VARCHAR(255),
  provider               VARCHAR(255),
  band_count             INT,
  bands_json             JSONB,
  width_px               INT,
  height_px              INT,
  pixel_size_x           DOUBLE PRECISION,
  pixel_size_y           DOUBLE PRECISION,
  data_type              VARCHAR(64),
  nodata_value           VARCHAR(64),
  cloud_cover            NUMERIC(5,2),
  processing_level       VARCHAR(64),
  license                VARCHAR(255),
  usage_scope            VARCHAR(255),
  upload_description     TEXT,
  remark                 TEXT,
  ext                    VARCHAR(16),
  created_by             INT,
  created_time           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_time           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) 补齐可能缺失列（兼容旧库）
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS crs_code VARCHAR(64);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS crs_name VARCHAR(255);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS acquisition_time_start TIMESTAMPTZ;
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS acquisition_time_end TIMESTAMPTZ;
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS time_precision VARCHAR(16);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS time_zone VARCHAR(64);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS sensor_platform VARCHAR(255);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS provider VARCHAR(255);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS band_count INT;
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS bands_json JSONB;
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS width_px INT;
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS height_px INT;
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS pixel_size_x DOUBLE PRECISION;
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS pixel_size_y DOUBLE PRECISION;
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS data_type VARCHAR(64);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS nodata_value VARCHAR(64);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS cloud_cover NUMERIC(5,2);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS processing_level VARCHAR(64);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS license VARCHAR(255);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS usage_scope VARCHAR(255);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS upload_description TEXT;
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS remark TEXT;
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS ext VARCHAR(16);
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS created_by INT;
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS created_time TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS updated_time TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 3.1) 纠正历史库中可能存在的列类型漂移
DO $$
DECLARE
  ext_udt_name TEXT;
  bands_udt_name TEXT;
BEGIN
  SELECT c.udt_name INTO ext_udt_name
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'file_metadata' AND c.column_name = 'ext';

  IF ext_udt_name IS NOT NULL AND ext_udt_name <> 'varchar' THEN
    -- 如果 ext 曾被误建成 json/jsonb，ext::text 可能带双引号，这里顺带去掉
    EXECUTE 'ALTER TABLE public.file_metadata
             ALTER COLUMN ext TYPE VARCHAR(16)
             USING NULLIF(TRIM(BOTH ''"'' FROM ext::text), '''')';
  END IF;

  SELECT c.udt_name INTO bands_udt_name
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'file_metadata' AND c.column_name = 'bands_json';

  IF bands_udt_name = 'json' THEN
    EXECUTE 'ALTER TABLE public.file_metadata
             ALTER COLUMN bands_json TYPE jsonb
             USING bands_json::jsonb';
  ELSIF bands_udt_name IS NOT NULL AND bands_udt_name NOT IN ('jsonb', 'json') THEN
    EXECUTE 'ALTER TABLE public.file_metadata
             ALTER COLUMN bands_json TYPE jsonb
             USING CASE
               WHEN bands_json IS NULL OR BTRIM(bands_json::text) = '''' THEN NULL
               WHEN LEFT(BTRIM(bands_json::text), 1) IN (''['', ''{'') THEN bands_json::jsonb
               ELSE to_jsonb(bands_json::text)
             END';
  END IF;
END $$;

-- 4) 外键约束（避免重复创建报错）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_file_metadata_file_id'
  ) THEN
    ALTER TABLE public.file_metadata
      ADD CONSTRAINT fk_file_metadata_file_id
      FOREIGN KEY (file_id) REFERENCES public.file(file_id) ON DELETE CASCADE;
  END IF;
END $$;

-- 5) 索引
CREATE INDEX IF NOT EXISTS idx_file_metadata_crs_code ON public.file_metadata(crs_code);
CREATE INDEX IF NOT EXISTS idx_file_metadata_time_start ON public.file_metadata(acquisition_time_start);
CREATE INDEX IF NOT EXISTS idx_file_metadata_band_count ON public.file_metadata(band_count);
CREATE INDEX IF NOT EXISTS idx_file_metadata_bands_json ON public.file_metadata USING GIN (bands_json);

-- 5.1) 时间精度约束：统一允许 year/month/day/hour/minute/second
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_file_metadata_time_precision'
      AND conrelid = 'public.file_metadata'::regclass
  ) THEN
    ALTER TABLE public.file_metadata DROP CONSTRAINT chk_file_metadata_time_precision;
  END IF;

  ALTER TABLE public.file_metadata
    ADD CONSTRAINT chk_file_metadata_time_precision
    CHECK (
      time_precision IS NULL
      OR time_precision IN ('year', 'month', 'day', 'hour', 'minute', 'second')
    );
END $$;

-- 6) 更新时间触发器（PostgreSQL 10 用 EXECUTE PROCEDURE）
DROP TRIGGER IF EXISTS trg_file_metadata_updated_time ON public.file_metadata;
CREATE TRIGGER trg_file_metadata_updated_time
BEFORE UPDATE ON public.file_metadata
FOR EACH ROW EXECUTE PROCEDURE public.fn_set_updated_time();
