package com.example.labelMark.DTO.quality;

import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
public class QualityReferenceConfigDTO {
    private Integer modelId;
    private Double confidenceThreshold;
    private Double iouThreshold;
    private Integer batchSize;
    private String scopeMode;
    private Double sampleRatio;
    private Integer previewLimit;
    private Map<String, Object> inferParams;
    private List<QualityReferenceSourceDTO> referenceSources;
    private QualityReferenceFusionConfigDTO fusionConfig;
}
