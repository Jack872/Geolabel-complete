package com.example.labelMark.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.example.labelMark.DTO.quality.QualityEvaluationRequest;
import com.example.labelMark.domain.QualityEvalJob;

import java.util.Map;

public interface QualityEvalJobService extends IService<QualityEvalJob> {
    Map<String, Object> submitJob(QualityEvaluationRequest request, String operator);

    Map<String, Object> getJobStatus(Long jobId);

    Map<String, Object> getJobResult(Long jobId);

    void updateJobProgress(Long jobId,
                           String status,
                           String stage,
                           Integer progress,
                           Integer processedCount,
                           Integer totalCount,
                           String message);
}
