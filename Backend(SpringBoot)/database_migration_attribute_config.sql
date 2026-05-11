-- =====================================================
-- GeoLabel migration: attribute definition + task type attributes
-- PostgreSQL 10+
-- =====================================================

CREATE TABLE IF NOT EXISTS public.attribute_def (
    attr_id            SERIAL PRIMARY KEY,
    attr_key           VARCHAR(64)  NOT NULL UNIQUE,
    attr_name          VARCHAR(100) NOT NULL,
    data_type          VARCHAR(20)  NOT NULL,
    enum_options_json  JSONB,
    unit               VARCHAR(32),
    is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
    remark             VARCHAR(255),
    created_time       TIMESTAMP    NOT NULL DEFAULT now(),
    updated_time       TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_type_attribute (
    id             BIGSERIAL PRIMARY KEY,
    task_id        INTEGER      NOT NULL,
    type_id        INTEGER      NOT NULL,
    attr_id        INTEGER      NOT NULL,
    is_required    BOOLEAN      NOT NULL DEFAULT FALSE,
    display_order  INTEGER      NOT NULL DEFAULT 1,
    placeholder    VARCHAR(255),
    remark         VARCHAR(255),
    created_time   TIMESTAMP    NOT NULL DEFAULT now(),
    updated_time   TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT uk_task_type_attr UNIQUE (task_id, type_id, attr_id),
    CONSTRAINT fk_tta_task FOREIGN KEY (task_id) REFERENCES public.task(task_id) ON DELETE CASCADE,
    CONSTRAINT fk_tta_type FOREIGN KEY (type_id) REFERENCES public.type(type_id) ON DELETE RESTRICT,
    CONSTRAINT fk_tta_attr FOREIGN KEY (attr_id) REFERENCES public.attribute_def(attr_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tta_task_type
    ON public.task_type_attribute(task_id, type_id);

CREATE INDEX IF NOT EXISTS idx_tta_task
    ON public.task_type_attribute(task_id);

COMMENT ON TABLE public.attribute_def IS '属性定义表';
COMMENT ON TABLE public.task_type_attribute IS '任务-类别-属性配置表';

-- 初始化常用属性（按需可继续扩展）
INSERT INTO public.attribute_def (attr_key, attr_name, data_type, enum_options_json, unit, is_active, remark)
VALUES
    ('area', '面积', 'number', NULL, '㎡', TRUE, '要素面积'),
    ('floors', '层数', 'integer', NULL, '层', TRUE, '建筑层数'),
    ('usage', '用途', 'enum', '["住宅","商业","工业","公共"]'::jsonb, NULL, TRUE, '建筑用途'),
    ('road_width', '道路宽度', 'number', NULL, 'm', TRUE, '道路宽度'),
    ('lane_count', '车道数', 'integer', NULL, '条', TRUE, '道路车道数'),
    ('vehicle_type', '车辆类型', 'enum', '["轿车","SUV","货车","客车","工程车","其他"]'::jsonb, NULL, TRUE, '车辆类别')
ON CONFLICT (attr_key) DO NOTHING;

