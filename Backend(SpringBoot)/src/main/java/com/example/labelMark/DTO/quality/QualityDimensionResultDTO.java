package com.example.labelMark.DTO.quality;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class QualityDimensionResultDTO {
    /**
     * 兼容字段
     */
    private String key;
    /**
     * 兼容字段
     */
    private String label;
    /**
     * 新字段：维度唯一键
     */
    private String dimensionKey;
    /**
     * 新字段：维度名称
     */
    private String dimensionName;
    private Boolean enabled;
    /**
     * 规则型评价不再计算维度分数，保留字段兼容历史前端
     */
    private Double score;
    /**
     * 维度状态：pass / warning / fail / pending
     */
    private String status;
    /**
     * 规则型评价不再计算维度置信总分，保留字段兼容
     */
    private Double confidence;
    /**
     * 兼容字段：历史前端使用 indicators
     */
    private List<QualityIndicatorResultDTO> indicators = new ArrayList<>();
    /**
     * 新字段：指标列表（与 indicators 同步）
     */
    private List<QualityIndicatorResultDTO> metrics = new ArrayList<>();
    /**
     * 新字段：自动结论文案
     */
    private String conclusionText;
    /**
     * 新字段：自动建议文案（1~3 条可拼接）
     */
    private String suggestionText;
    /**
     * 新字段：本维度数据来源汇总
     */
    private List<String> dataSources = new ArrayList<>();
    /**
     * 新字段：证据摘要
     */
    private String evidenceSummary;
}
