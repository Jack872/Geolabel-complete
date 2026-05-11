package com.example.labelMark.DTO.quality;

import lombok.Data;

import java.util.Date;

@Data
public class QualityReportSummaryDTO {
    private Long reportId;
    private String jsonUrl;
    private String htmlUrl;
    private Date generatedAt;
}
