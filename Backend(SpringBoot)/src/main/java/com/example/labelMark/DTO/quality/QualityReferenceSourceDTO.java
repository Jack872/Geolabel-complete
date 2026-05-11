package com.example.labelMark.DTO.quality;

import lombok.Data;

import java.util.Map;

@Data
public class QualityReferenceSourceDTO {
    private String sourceId;
    private String sourceType;
    private Integer modelId;
    private Double weight;
    private Map<String, Object> confidenceCalib;
}
