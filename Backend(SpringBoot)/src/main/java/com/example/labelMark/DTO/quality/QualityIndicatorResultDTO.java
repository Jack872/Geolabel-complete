package com.example.labelMark.DTO.quality;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Data
public class QualityIndicatorResultDTO {
    /**
     * 兼容字段
     */
    private String key;
    /**
     * 兼容字段
     */
    private String label;
    /**
     * 新字段：指标唯一键
     */
    private String metricKey;
    /**
     * 新字段：指标名称
     */
    private String metricName;
    /**
     * 兼容字段（首来源）
     */
    private String sourceType;
    /**
     * 新字段：多来源列表
     */
    private List<String> dataSources = new ArrayList<>();
    /**
     * 规则型评价不再计算可信度总分，单指标可选保留
     */
    private Double confidence;
    /**
     * 指标值（可用于展示，不用于总分聚合）
     */
    private Double score;
    private String value;
    /**
     * 状态：pass / warning / fail / pending / not_applicable
     */
    private String status;
    /**
     * 兼容字段：历史总分逻辑使用；规则型评价固定 false
     */
    private Boolean contributesToScore = false;
    /**
     * 新字段：阈值规则（展示）
     */
    private String thresholdRule;
    private List<String> issues = new ArrayList<>();
    private Map<String, Object> details;
}
