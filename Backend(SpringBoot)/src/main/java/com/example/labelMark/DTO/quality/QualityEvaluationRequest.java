package com.example.labelMark.DTO.quality;

import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
public class QualityEvaluationRequest {
    private Integer sampleSetId;
    private Long qualityProfileId;
    private List<String> selectedDimensions;
    private Map<String, Object> overrides;
    private QualityReferenceConfigDTO referenceModel;
    private Long evaluationJobId;
}
