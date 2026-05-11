package com.example.labelMark.DTO.quality;

import lombok.Data;

@Data
public class QualityReferenceFusionConfigDTO {
    private String method;
    private String fusionMode;
    private Integer maxIter;
    private Double eps;
    private Double probThreshold;
    private Double minAgreement;
}
