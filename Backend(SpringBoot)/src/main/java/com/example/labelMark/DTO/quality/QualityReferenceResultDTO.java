package com.example.labelMark.DTO.quality;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Data
public class QualityReferenceResultDTO {
    private Boolean enabled = false;
    private Boolean suitable = false;
    private String reason;
    private Integer modelId;
    private String modelName;
    private String modelVersion;
    private String modelType;
    private String taskType;
    private String fusionMethod;
    private Integer inputChannels;
    private Map<String, Object> defaultParams;
    private Double confidenceThreshold;
    private Double iouThreshold;
    private Integer batchSize;
    private String scopeMode;
    private Double sampleRatio;
    private Integer evaluatedSamples;
    private Integer totalSamples;
    private Double confidenceMean;
    private Double coverageRate;
    private Double lowConfidenceRatio;
    private Double sampleCoverageRate;
    private Double classCoverageRate;
    private Double referenceReliability;
    private String referenceReliabilityLevel;
    private Double confidenceScore;
    private Map<String, Object> indicators;
    private List<Map<String, Object>> sourceSummaries = new ArrayList<>();
    private Map<String, Object> probabilityStats;
    private Map<String, Object> uncertaintyStats;
    private Map<String, Object> fusionConfigUsed;
    private List<Map<String, Object>> previewItems = new ArrayList<>();
    private List<String> notes = new ArrayList<>();
}
