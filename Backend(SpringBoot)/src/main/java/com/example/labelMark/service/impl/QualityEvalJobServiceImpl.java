package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.DTO.quality.QualityEvaluationRequest;
import com.example.labelMark.DTO.quality.QualityEvaluationResultDTO;
import com.example.labelMark.domain.QualityEvalJob;
import com.example.labelMark.mapper.QualityEvalJobMapper;
import com.example.labelMark.service.QualityEvalJobService;
import com.example.labelMark.service.QualityEvaluationProgressListener;
import com.example.labelMark.service.QualityEvaluationService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ThreadPoolExecutor;

@Service
public class QualityEvalJobServiceImpl extends ServiceImpl<QualityEvalJobMapper, QualityEvalJob> implements QualityEvalJobService {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Resource
    private QualityEvaluationService qualityEvaluationService;

    @Resource
    private ThreadPoolExecutor qualityEvaluationExecutor;

    @Override
    public Map<String, Object> submitJob(QualityEvaluationRequest request, String operator) {
        QualityEvalJob job = new QualityEvalJob();
        job.setSampleSetId(request.getSampleSetId());
        job.setQualityProfileId(request.getQualityProfileId());
        job.setReferenceModelId(request.getReferenceModel() == null ? null : request.getReferenceModel().getModelId());
        job.setStatus("QUEUED");
        job.setStage("排队中");
        job.setProgress(0);
        job.setProcessedCount(0);
        job.setTotalCount(0);
        job.setMessage("质量评价任务已提交，等待执行");
        job.setCreator(operator);
        job.setCreatedTime(new Date());
        job.setUpdatedTime(new Date());
        job.setRequestJson(writeJson(request));
        save(job);

        request.setEvaluationJobId(job.getId());
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        qualityEvaluationExecutor.submit(() -> runJobWithSecurityContext(job.getId(), request, operator, authentication));

        return toStatusMap(job);
    }

    @Override
    public Map<String, Object> getJobStatus(Long jobId) {
        QualityEvalJob job = getById(jobId);
        return job == null ? null : toStatusMap(job);
    }

    @Override
    public Map<String, Object> getJobResult(Long jobId) {
        QualityEvalJob job = getById(jobId);
        if (job == null) {
            return null;
        }
        Map<String, Object> map = toStatusMap(job);
        map.put("result", parseMap(job.getResultJson()));
        return map;
    }

    @Override
    public void updateJobProgress(Long jobId,
                                  String status,
                                  String stage,
                                  Integer progress,
                                  Integer processedCount,
                                  Integer totalCount,
                                  String message) {
        updateProgress(jobId, status, stage, progress, processedCount, totalCount, message);
    }

    private void runJobWithSecurityContext(Long jobId,
                                           QualityEvaluationRequest request,
                                           String operator,
                                           Authentication authentication) {
        try {
            if (authentication != null) {
                SecurityContext context = SecurityContextHolder.createEmptyContext();
                context.setAuthentication(authentication);
                SecurityContextHolder.setContext(context);
            }
            runJob(jobId, request, operator);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    private void runJob(Long jobId, QualityEvaluationRequest request, String operator) {
        updateProgress(jobId, "RUNNING", "初始化评价", 5, 0, 0, "任务已开始执行");
        try {
            QualityEvaluationResultDTO result = qualityEvaluationService.evaluate(
                    request,
                    operator,
                    (stage, progress, processedCount, totalCount, message) ->
                            updateProgress(jobId, "RUNNING", stage, progress, processedCount, totalCount, message)
            );
            QualityEvalJob job = getById(jobId);
            if (job == null) {
                return;
            }
            job.setStatus("SUCCESS");
            job.setStage("已完成");
            job.setProgress(100);
            job.setMessage("质量评价已完成");
            job.setResultJson(writeJson(result));
            job.setReportId(result.getReportId());
            job.setEndTime(new Date());
            job.setUpdatedTime(new Date());
            updateById(job);
        } catch (Exception e) {
            QualityEvalJob job = getById(jobId);
            if (job == null) {
                return;
            }
            job.setStatus("FAILED");
            job.setStage("执行失败");
            job.setMessage(e.getMessage());
            job.setEndTime(new Date());
            job.setUpdatedTime(new Date());
            updateById(job);
        }
    }

    private void updateProgress(Long jobId,
                                String status,
                                String stage,
                                Integer progress,
                                Integer processedCount,
                                Integer totalCount,
                                String message) {
        QualityEvalJob job = getById(jobId);
        if (job == null) {
            return;
        }
        job.setStatus(status);
        job.setStage(stage);
        job.setProgress(progress == null ? job.getProgress() : progress);
        if (processedCount != null) {
            job.setProcessedCount(processedCount);
        }
        if (totalCount != null) {
            job.setTotalCount(totalCount);
        }
        if (message != null) {
            job.setMessage(message);
        }
        if (job.getStartTime() == null && "RUNNING".equals(status)) {
            job.setStartTime(new Date());
        }
        job.setUpdatedTime(new Date());
        updateById(job);
    }

    private Map<String, Object> toStatusMap(QualityEvalJob job) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", job.getId());
        map.put("sampleSetId", job.getSampleSetId());
        map.put("qualityProfileId", job.getQualityProfileId());
        map.put("referenceModelId", job.getReferenceModelId());
        map.put("status", job.getStatus());
        map.put("stage", job.getStage());
        map.put("progress", job.getProgress());
        map.put("processedCount", job.getProcessedCount());
        map.put("totalCount", job.getTotalCount());
        map.put("message", job.getMessage());
        map.put("reportId", job.getReportId());
        map.put("createdTime", job.getCreatedTime());
        map.put("startTime", job.getStartTime());
        map.put("endTime", job.getEndTime());
        map.put("updatedTime", job.getUpdatedTime());
        return map;
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("质量评价任务序列化失败", e);
        }
    }

    private Map<String, Object> parseMap(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return null;
        }
        try {
            return objectMapper.readValue(raw, new TypeReference<Map<String, Object>>() {});
        } catch (Exception ignored) {
            return null;
        }
    }
}
