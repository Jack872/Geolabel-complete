package com.example.labelMark.service;

import com.example.labelMark.DTO.quality.QualityEvaluationRequest;
import com.example.labelMark.DTO.quality.QualityEvaluationResultDTO;
import com.example.labelMark.DTO.quality.QualityReferenceRunRequest;

import java.util.List;
import java.util.Map;

public interface QualityEvaluationService {
    QualityEvaluationResultDTO evaluate(QualityEvaluationRequest request, String operator);

    QualityEvaluationResultDTO evaluate(QualityEvaluationRequest request, String operator, QualityEvaluationProgressListener progressListener);

    Map<String, Object> runReferenceEvaluationOnly(QualityReferenceRunRequest request, String operator);

    List<Map<String, Object>> listReferencePreview(Integer sampleSetId, Integer modelId, Integer limit);

    Map<String, Object> getReferencePreview(Integer sampleSetId, Integer modelId, String previewId);
}
