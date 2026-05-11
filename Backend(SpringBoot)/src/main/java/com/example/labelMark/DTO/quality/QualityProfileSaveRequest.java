package com.example.labelMark.DTO.quality;

import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
public class QualityProfileSaveRequest {
    private Long id;
    /**
     * 新字段（推荐）：模板名称
     */
    private String profileName;
    /**
     * 兼容字段：历史前端仍可能传 name
     */
    private String name;
    private String taskType;
    private List<String> expectedBands;
    private String expectedExportFormat;
    private String expectedAnnotationFormat;
    private List<String> requiredFields;
    private List<String> topologyRules;
    private String attributeAuditMode;
    /**
     * 可选：显式启用的维度（未传时由 dimensionConfigs.enabled 推导）
     */
    private List<String> enabledDimensions;
    /**
     * 指标规则（阈值/判定方式）
     */
    private Map<String, Object> metricRules;
    private List<Map<String, Object>> dimensionConfigs;
    /**
     * 兼容字段：历史逻辑使用 weights；当前规则型评价中不再用于总分
     */
    private Map<String, Object> weights;
    private Boolean isActive;
    private Integer version;
}
