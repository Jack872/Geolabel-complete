package com.example.labelMark.service;

public interface QualityEvaluationProgressListener {

    void onProgress(String stage, int progress, Integer processedCount, Integer totalCount, String message);

    QualityEvaluationProgressListener NO_OP = (stage, progress, processedCount, totalCount, message) -> {
    };
}
