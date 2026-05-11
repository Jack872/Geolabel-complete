package com.example.labelMark.DTO.quality;

import lombok.Data;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;

@Data
public class QualityEvaluationResultDTO {
    private Integer sampleSetId;
    private Long qualityProfileId;
    private String profileName;
    private Date evaluatedAt;
    /**
     * 规则型评价结果：样本集基础信息
     */
    private Map<String, Object> sampleSetBasicInfo;
    /**
     * 兼容字段，规则型评价不再输出总分
     */
    private Double overallScore;
    /**
     * 兼容字段，规则型评价不再输出总分
     */
    private Double qualityScore;
    /**
     * 兼容字段，规则型评价不再输出总分
     */
    private Double confidenceScore;
    private String finalSuggestion;
    private Map<String, Object> weights;
    /**
     * 兼容字段
     */
    private List<QualityDimensionResultDTO> dimensions = new ArrayList<>();
    /**
     * 新字段：维度结果列表（与 dimensions 同步）
     */
    private List<QualityDimensionResultDTO> dimensionResults = new ArrayList<>();
    private List<QualityIssueDTO> issues = new ArrayList<>();
    private String summary;
    private Map<String, Object> auditSignals;
    private List<String> pendingDimensions = new ArrayList<>();
    private List<String> enabledDimensions = new ArrayList<>();
    private List<String> opinions = new ArrayList<>();
    private QualityReferenceResultDTO referenceModel;
    private Long reportId;
    private QualityReportSummaryDTO report;
}
