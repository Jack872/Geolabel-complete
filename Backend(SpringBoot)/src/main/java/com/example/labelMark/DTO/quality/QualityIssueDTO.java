package com.example.labelMark.DTO.quality;

import lombok.Data;

import java.util.Map;

@Data
public class QualityIssueDTO {
    private String level;
    private String code;
    private String message;
    private String dimensionKey;
    private String indicatorKey;
    private Map<String, Object> details;
}
