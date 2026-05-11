package com.example.labelMark.controller;

import com.example.labelMark.DTO.quality.QualityEvaluationRequest;
import com.example.labelMark.DTO.quality.QualityReferenceRunRequest;
import com.example.labelMark.DTO.quality.QualityProfileSaveRequest;
import com.example.labelMark.service.QualityEvalJobService;
import com.example.labelMark.service.QualityEvaluationService;
import com.example.labelMark.service.QualityProfileService;
import com.example.labelMark.service.QualityReportService;
import com.example.labelMark.utils.QualityDefaults;
import com.example.labelMark.utils.ResultGenerator;
import com.example.labelMark.vo.LoginUser;
import com.example.labelMark.vo.constant.Result;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/quality")
public class QualityController {

    @Resource
    private QualityProfileService qualityProfileService;
    @Resource
    private QualityEvaluationService qualityEvaluationService;
    @Resource
    private QualityEvalJobService qualityEvalJobService;
    @Resource
    private QualityReportService qualityReportService;

    @GetMapping("/profile/list")
    public Result listProfiles(@RequestParam(required = false) String taskType,
                               @RequestParam(required = false) Boolean onlyActive) {
        return ResultGenerator.getSuccessResult(qualityProfileService.listProfiles(taskType, onlyActive));
    }

    /**
     * 新接口别名：listQualityProfiles
     */
    @GetMapping("/profiles")
    public Result listQualityProfiles(@RequestParam(required = false) String taskType,
                                      @RequestParam(required = false) Boolean onlyActive) {
        return ResultGenerator.getSuccessResult(qualityProfileService.listProfiles(taskType, onlyActive));
    }

    @GetMapping("/profile/{id}")
    public Result getProfile(@PathVariable Long id) {
        return ResultGenerator.getSuccessResult(qualityProfileService.getProfileDetail(id));
    }

    /**
     * 新接口别名：getQualityProfileDetail
     */
    @GetMapping("/profiles/{id}")
    public Result getQualityProfileDetail(@PathVariable Long id) {
        return ResultGenerator.getSuccessResult(qualityProfileService.getProfileDetail(id));
    }

    @PostMapping("/profile/save")
    public Result saveProfile(@RequestBody QualityProfileSaveRequest request) {
        String operator = "system";
        try {
            Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
            if (principal instanceof LoginUser) {
                operator = ((LoginUser) principal).getUsername();
            }
        } catch (Exception ignored) {
        }
        return ResultGenerator.getSuccessResult(qualityProfileService.saveProfile(request, operator));
    }

    /**
     * 新接口：saveQualityProfile
     */
    @PostMapping("/profile")
    public Result saveQualityProfile(@RequestBody QualityProfileSaveRequest request) {
        return saveProfile(request);
    }

    /**
     * 新接口：updateQualityProfile
     */
    @PutMapping("/profile/{id}")
    public Result updateQualityProfile(@PathVariable Long id, @RequestBody QualityProfileSaveRequest request) {
        String operator = resolveOperator();
        return ResultGenerator.getSuccessResult(qualityProfileService.updateProfile(id, request, operator));
    }

    @GetMapping("/dimension-template")
    public Result getDimensionTemplate() {
        Map<String, Object> data = new HashMap<>();
        data.put("dimensionConfigs", QualityDefaults.defaultDimensionConfigs());
        data.put("enabledDimensions", QualityDefaults.defaultEnabledDimensions());
        data.put("metricRules", QualityDefaults.defaultMetricRules());
        data.put("weights", QualityDefaults.defaultWeights());
        return ResultGenerator.getSuccessResult(data);
    }

    @PostMapping("/evaluate")
    public Result evaluate(@RequestBody QualityEvaluationRequest request) {
        String operator = resolveOperator();
        return ResultGenerator.getSuccessResult(qualityEvaluationService.evaluate(request, operator));
    }

    /**
     * 新接口：runQualityEvaluation（同步）
     */
    @PostMapping("/evaluation/run")
    public Result runQualityEvaluation(@RequestBody QualityEvaluationRequest request) {
        return evaluate(request);
    }

    @PostMapping("/evaluate/submit")
    public Result submitEvaluate(@RequestBody QualityEvaluationRequest request) {
        String operator = resolveOperator();
        return ResultGenerator.getSuccessResult(qualityEvalJobService.submitJob(request, operator));
    }

    /**
     * 新接口别名：异步执行
     */
    @PostMapping("/evaluation/submit")
    public Result submitQualityEvaluation(@RequestBody QualityEvaluationRequest request) {
        return submitEvaluate(request);
    }

    @GetMapping("/evaluate/job/{id}")
    public Result getEvaluateJob(@PathVariable Long id) {
        return ResultGenerator.getSuccessResult(qualityEvalJobService.getJobStatus(id));
    }

    @GetMapping("/evaluate/job/{id}/result")
    public Result getEvaluateJobResult(@PathVariable Long id) {
        return ResultGenerator.getSuccessResult(qualityEvalJobService.getJobResult(id));
    }

    /**
     * 新接口：getQualityEvaluationDetail
     */
    @GetMapping("/evaluation/{id}")
    public Result getQualityEvaluationDetail(@PathVariable Long id) {
        return ResultGenerator.getSuccessResult(qualityEvalJobService.getJobResult(id));
    }

    private String resolveOperator() {
        String operator = "system";
        try {
            Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
            if (principal instanceof LoginUser) {
                operator = ((LoginUser) principal).getUsername();
            }
        } catch (Exception ignored) {
        }
        return operator;
    }

    @GetMapping("/report/{id}")
    public Result getReport(@PathVariable Long id) {
        return ResultGenerator.getSuccessResult(qualityReportService.getReportDetail(id));
    }

    @GetMapping(value = "/report/{id}/html", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> getReportHtml(@PathVariable Long id) {
        return ResponseEntity.ok(qualityReportService.renderReportHtml(id));
    }

    @PostMapping("/reference/run")
    public Result runQualityReference(@RequestBody QualityReferenceRunRequest request) {
        String operator = resolveOperator();
        return ResultGenerator.getSuccessResult(qualityEvaluationService.runReferenceEvaluationOnly(request, operator));
    }

    @GetMapping("/reference/preview/list")
    public Result listQualityReferencePreview(@RequestParam Integer sampleSetId,
                                              @RequestParam Integer modelId,
                                              @RequestParam(defaultValue = "8") Integer limit) {
        List<Map<String, Object>> records = qualityEvaluationService.listReferencePreview(sampleSetId, modelId, limit);
        Map<String, Object> data = new HashMap<>();
        data.put("records", records);
        data.put("total", records.size());
        return ResultGenerator.getSuccessResult(data);
    }

    @GetMapping("/reference/preview/{previewId}")
    public Result getQualityReferencePreview(@PathVariable String previewId,
                                             @RequestParam Integer sampleSetId,
                                             @RequestParam Integer modelId) {
        return ResultGenerator.getSuccessResult(
                qualityEvaluationService.getReferencePreview(sampleSetId, modelId, previewId)
        );
    }
}
