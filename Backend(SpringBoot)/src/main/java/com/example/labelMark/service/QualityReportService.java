package com.example.labelMark.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.example.labelMark.DTO.quality.QualityEvaluationResultDTO;
import com.example.labelMark.domain.QualityReport;

import java.util.Map;

public interface QualityReportService extends IService<QualityReport> {
    QualityReport saveReport(Integer sampleSetId,
                             Long qualityProfileId,
                             Integer referenceModelId,
                             String creator,
                             QualityEvaluationResultDTO result);

    Map<String, Object> getReportDetail(Long reportId);

    String renderReportHtml(Long reportId);
}
