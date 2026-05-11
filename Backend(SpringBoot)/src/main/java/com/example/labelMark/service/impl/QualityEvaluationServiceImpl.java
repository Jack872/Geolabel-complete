package com.example.labelMark.service.impl;

import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.labelMark.DTO.prov.ProvEntityRef;
import com.example.labelMark.DTO.quality.QualityDimensionResultDTO;
import com.example.labelMark.DTO.quality.QualityEvaluationRequest;
import com.example.labelMark.DTO.quality.QualityEvaluationResultDTO;
import com.example.labelMark.DTO.quality.QualityIndicatorResultDTO;
import com.example.labelMark.DTO.quality.QualityIssueDTO;
import com.example.labelMark.DTO.quality.QualityReferenceConfigDTO;
import com.example.labelMark.DTO.quality.QualityReferenceFusionConfigDTO;
import com.example.labelMark.DTO.quality.QualityReferenceRunRequest;
import com.example.labelMark.DTO.quality.QualityReferenceResultDTO;
import com.example.labelMark.DTO.quality.QualityReferenceSourceDTO;
import com.example.labelMark.DTO.quality.QualityReportSummaryDTO;
import com.example.labelMark.domain.AuditInfo;
import com.example.labelMark.domain.FileMetadata;
import com.example.labelMark.domain.Mark;
import com.example.labelMark.domain.Model;
import com.example.labelMark.domain.ProvActivity;
import com.example.labelMark.domain.ProvEntity;
import com.example.labelMark.domain.ProvRelation;
import com.example.labelMark.domain.QualityReport;
import com.example.labelMark.domain.SampleSet;
import com.example.labelMark.domain.Server;
import com.example.labelMark.domain.SysFile;
import com.example.labelMark.domain.Task;
import com.example.labelMark.mapper.AuditInfoMapper;
import com.example.labelMark.mapper.FileMetadataMapper;
import com.example.labelMark.mapper.ProvActivityMapper;
import com.example.labelMark.mapper.ProvEntityMapper;
import com.example.labelMark.mapper.ProvRelationMapper;
import com.example.labelMark.service.MarkService;
import com.example.labelMark.service.ModelService;
import com.example.labelMark.service.ProvenanceService;
import com.example.labelMark.service.QualityEvaluationProgressListener;
import com.example.labelMark.service.QualityEvaluationService;
import com.example.labelMark.service.QualityProfileService;
import com.example.labelMark.service.QualityReportService;
import com.example.labelMark.service.SampleSetService;
import com.example.labelMark.service.ServerService;
import com.example.labelMark.service.SysFileService;
import com.example.labelMark.service.TaskService;
import com.example.labelMark.service.TaskTypeAttributeService;
import com.example.labelMark.utils.QualityDefaults;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.LineString;
import org.locationtech.jts.geom.MultiLineString;
import org.locationtech.jts.geom.MultiPolygon;
import org.locationtech.jts.geom.Polygon;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.wololo.jts2geojson.GeoJSONReader;

import javax.annotation.Resource;
import java.net.URLEncoder;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;
import java.text.DecimalFormat;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class QualityEvaluationServiceImpl implements QualityEvaluationService {

    private static final DecimalFormat PERCENT_FORMAT = new DecimalFormat("0.0");
    private static final List<String> QUALITY_PROVENANCE_TYPES = Arrays.asList("QUALITY_EVALUATE", "QUALITY_REFERENCE_EVALUATE");
    private static final int MAX_QUALITY_PROVENANCE_RECORDS = 3;

    @Resource
    private SampleSetService sampleSetService;
    @Resource
    private QualityProfileService qualityProfileService;
    @Resource
    private TaskService taskService;
    @Resource
    private MarkService markService;
    @Resource
    private TaskTypeAttributeService taskTypeAttributeService;
    @Resource
    private AuditInfoMapper auditInfoMapper;
    @Resource
    private FileMetadataMapper fileMetadataMapper;
    @Resource
    private SysFileService sysFileService;
    @Resource
    private ServerService serverService;
    @Resource
    private ModelService modelService;
    @Resource
    private ProvenanceService provenanceService;
    @Resource
    private ProvActivityMapper provActivityMapper;
    @Resource
    private ProvEntityMapper provEntityMapper;
    @Resource
    private ProvRelationMapper provRelationMapper;
    @Resource
    private QualityReportService qualityReportService;
    @Resource
    private RestTemplate restTemplate;

    @Value("${quality.fastapi.url:http://localhost:5000}")
    private String qualityFastApiUrl;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<String, List<Map<String, Object>>> referencePreviewCache = new ConcurrentHashMap<>();

    @Override
    public QualityEvaluationResultDTO evaluate(QualityEvaluationRequest request, String operator) {
        return evaluate(request, operator, QualityEvaluationProgressListener.NO_OP);
    }

    @Override
    public QualityEvaluationResultDTO evaluate(QualityEvaluationRequest request,
                                               String operator,
                                               QualityEvaluationProgressListener progressListener) {
        SampleSet sampleSet = sampleSetService.getById(request.getSampleSetId());
        if (sampleSet == null) {
            throw new IllegalArgumentException("样本集不存在: " + request.getSampleSetId());
        }

        progressListener.onProgress("加载样本集与模板", 10, 0, 0, "正在读取样本集、模板和任务上下文");

        Map<String, Object> profile = request.getQualityProfileId() == null
                ? buildFallbackProfile(sampleSet)
                : qualityProfileService.getProfileDetail(request.getQualityProfileId());
        if (profile == null) {
            throw new IllegalArgumentException("质量评价模板不存在: " + request.getQualityProfileId());
        }
        applyOverrides(profile, request.getOverrides());

        List<Integer> taskIds = parseTaskIds(sampleSet.getTaskIds());
        List<Task> tasks = taskIds.stream().map(taskService::selectTaskById).filter(Objects::nonNull).collect(Collectors.toList());
        List<Mark> marks = taskIds.isEmpty() ? new ArrayList<>() : markService.list(new QueryWrapper<Mark>().in("task_id", taskIds));
        List<AuditInfo> audits = taskIds.isEmpty() ? new ArrayList<>() : auditInfoMapper.selectList(new QueryWrapper<AuditInfo>().in("task_id", taskIds));
        List<FileMetadata> metadataList = resolveMetadataForTasks(tasks);
        Map<String, Object> provenance = sampleSetService.getDatasetProvenance(sampleSet.getId());
        Map<Integer, List<Map<String, Object>>> taskAttrConfigMap = new HashMap<>();
        for (Integer taskId : taskIds) {
            taskAttrConfigMap.put(taskId, taskTypeAttributeService.getTaskTypeAttributeDetails(taskId, null));
        }

        progressListener.onProgress("规则型指标计算", 35, 0, 0, "正在计算六个质量维度的规则型指标");

        QualityEvaluationResultDTO result = new QualityEvaluationResultDTO();
        result.setSampleSetId(sampleSet.getId());
        result.setQualityProfileId(request.getQualityProfileId());
        result.setProfileName(asString(profile.get("profileName")) != null ? asString(profile.get("profileName")) : asString(profile.get("name")));
        result.setEvaluatedAt(new Date());
        result.setSampleSetBasicInfo(buildSampleSetBasicInfo(sampleSet, taskIds, tasks, provenance));
        result.setOverallScore(null);
        result.setQualityScore(null);
        result.setConfidenceScore(null);

        Map<String, Object> metricRules = parseMap(profile.get("metricRules"), QualityDefaults.defaultMetricRules());
        result.setWeights(metricRules);
        result.setReferenceModel(runReferenceEvaluation(sampleSet, request, operator, progressListener));

        Set<String> selectedDimensions = request.getSelectedDimensions() == null || request.getSelectedDimensions().isEmpty()
                ? null : new HashSet<>(request.getSelectedDimensions());
        List<Map<String, Object>> dimensionConfigs = parseDimensionConfigs(profile.get("dimensionConfigs"));
        if (dimensionConfigs.isEmpty()) {
            dimensionConfigs = QualityDefaults.defaultDimensionConfigs();
        }

        List<String> enabledDimensions = new ArrayList<>();
        List<String> pendingDimensions = new ArrayList<>();

        for (Map<String, Object> dc : dimensionConfigs) {
            String dk = asString(dc.get("key"));
            String dn = asString(dc.get("label"));
            boolean enabled = asBoolean(dc.get("enabled"), true) && (selectedDimensions == null || selectedDimensions.contains(dk));
            QualityDimensionResultDTO d = new QualityDimensionResultDTO();
            d.setKey(dk);
            d.setLabel(dn);
            d.setDimensionKey(dk);
            d.setDimensionName(dn);
            d.setEnabled(enabled);
            if (!enabled) {
                d.setStatus("pending");
                d.setConclusionText("未评价");
                d.setSuggestionText("该维度未启用，若需要请在模板中开启后重跑评价。");
                d.setEvidenceSummary("维度未启用");
                result.getDimensions().add(d);
                continue;
            }
            enabledDimensions.add(dk);

            switch (dk) {
                case "completeness":
                    buildCompletenessDimension(d, result, profile, marks, taskAttrConfigMap, metricRules, dc, result.getReferenceModel());
                    break;
                case "logicConsistency":
                    buildLogicConsistencyDimension(d, result, profile, sampleSet, metadataList, marks, metricRules, dc);
                    break;
                case "attributeAccuracy":
                    buildAttributeAccuracyDimension(d, result, profile, marks, taskAttrConfigMap, metricRules, dc, result.getReferenceModel());
                    break;
                case "positionalAccuracy":
                    buildPositionalAccuracyDimension(d, result, metricRules, dc, result.getReferenceModel());
                    break;
                case "temporalQuality":
                    buildTemporalQualityDimension(d, result, metadataList, metricRules, dc);
                    break;
                case "usabilityQuality":
                    buildUsabilityQualityDimension(d, result, marks, provenance, audits, taskIds, metricRules, dc, result.getReferenceModel());
                    break;
                default:
                    d.setStatus("pending");
                    d.setConclusionText("未评价");
                    d.setSuggestionText("该维度暂无实现。");
                    d.setEvidenceSummary("缺少计算实现");
                    break;
            }

            if ("pending".equals(d.getStatus())) {
                pendingDimensions.add(dk);
            }
            result.getDimensions().add(d);
        }

        result.setDimensionResults(result.getDimensions());
        result.setPendingDimensions(pendingDimensions);
        result.setEnabledDimensions(enabledDimensions);
        result.setAuditSignals(buildAuditSignals(audits, taskIds));
        result.setFinalSuggestion(buildFinalSuggestion(result.getDimensions()));
        result.setOpinions(buildGlobalOpinions(sampleSet, result.getDimensions(), result.getIssues(), result.getReferenceModel()));
        result.setSummary(buildSummary(sampleSet, result.getDimensions(), result.getFinalSuggestion()));

        progressListener.onProgress("生成报告", 90, 0, 0, "正在生成质量评价报告");
        QualityReport report = qualityReportService.saveReport(
                sampleSet.getId(),
                request.getQualityProfileId(),
                request.getReferenceModel() == null ? null : request.getReferenceModel().getModelId(),
                operator,
                result
        );
        attachReportSummary(result, report);
        progressListener.onProgress("写入溯源", 96, 0, 0, "正在记录质量评价溯源活动");
        recordQualityProvenance(sampleSet, request, profile, result, report, operator);
        progressListener.onProgress("评价完成", 100, 0, 0, "质量评价任务已完成");
        return result;
    }

    @Override
    public Map<String, Object> runReferenceEvaluationOnly(QualityReferenceRunRequest request, String operator) {
        if (request == null || request.getSampleSetId() == null) {
            throw new IllegalArgumentException("sampleSetId不能为空");
        }
        if (request.getModelId() == null && (request.getReferenceSources() == null || request.getReferenceSources().isEmpty())) {
            throw new IllegalArgumentException("modelId和referenceSources不能同时为空");
        }
        SampleSet sampleSet = sampleSetService.getById(request.getSampleSetId());
        if (sampleSet == null) {
            throw new IllegalArgumentException("样本集不存在: " + request.getSampleSetId());
        }
        LocalDateTime startedAt = LocalDateTime.now();

        QualityEvaluationRequest evalReq = new QualityEvaluationRequest();
        evalReq.setSampleSetId(request.getSampleSetId());
        QualityReferenceConfigDTO refCfg = new QualityReferenceConfigDTO();
        refCfg.setModelId(request.getModelId());
        refCfg.setConfidenceThreshold(request.getConfidenceThreshold());
        refCfg.setIouThreshold(request.getIouThreshold());
        refCfg.setBatchSize(request.getBatchSize());
        refCfg.setScopeMode(request.getReferenceScope());
        refCfg.setSampleRatio(request.getSampleRatio());
        refCfg.setPreviewLimit(request.getPreviewLimit());
        refCfg.setInferParams(request.getInferParams());
        refCfg.setReferenceSources(request.getReferenceSources());
        refCfg.setFusionConfig(request.getFusionConfig());
        evalReq.setReferenceModel(refCfg);

        QualityReferenceResultDTO reference = runReferenceEvaluation(sampleSet, evalReq, operator, QualityEvaluationProgressListener.NO_OP);
        List<Map<String, Object>> previews = materializePreviewItems(sampleSet.getId(), reference.getPreviewItems());
        reference.setPreviewItems(previews);
        referencePreviewCache.put(buildPreviewCacheKey(sampleSet.getId(), resolvePreviewModelId(request, reference)), previews);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("sampleSetId", sampleSet.getId());
        data.put("sampleSetName", sampleSet.getName());
        data.put("referenceModel", reference);
        data.put("previewItems", limitPreviewItems(previews, request.getPreviewLimit()));
        data.put("previewCount", previews.size());
        data.put("message", Boolean.TRUE.equals(reference.getSuitable()) ? "参考评估完成" : firstNonBlank(reference.getReason(), "参考评估未通过"));
        recordReferenceRunProvenance(sampleSet, request, reference, previews.size(), startedAt, LocalDateTime.now(), operator);
        return data;
    }

    @Override
    public List<Map<String, Object>> listReferencePreview(Integer sampleSetId, Integer modelId, Integer limit) {
        if (sampleSetId == null || modelId == null) {
            return new ArrayList<>();
        }
        String key = buildPreviewCacheKey(sampleSetId, modelId);
        List<Map<String, Object>> cached = referencePreviewCache.getOrDefault(key, new ArrayList<>());
        if (cached.isEmpty()) {
            try {
                QualityReferenceRunRequest request = new QualityReferenceRunRequest();
                request.setSampleSetId(sampleSetId);
                request.setModelId(modelId);
                request.setConfidenceThreshold(0.3);
                request.setIouThreshold(0.5);
                request.setBatchSize(8);
                request.setReferenceScope("sample");
                request.setSampleRatio(0.2);
                request.setPreviewLimit(limit == null ? 8 : limit);
                runReferenceEvaluationOnly(request, "system");
                cached = referencePreviewCache.getOrDefault(key, new ArrayList<>());
            } catch (Exception ignored) {
                cached = new ArrayList<>();
            }
        }
        return limitPreviewItems(cached, limit);
    }

    @Override
    public Map<String, Object> getReferencePreview(Integer sampleSetId, Integer modelId, String previewId) {
        List<Map<String, Object>> list = listReferencePreview(sampleSetId, modelId, 100);
        if (list.isEmpty()) {
            return null;
        }
        if (previewId == null || previewId.trim().isEmpty()) {
            return list.get(0);
        }
        for (Map<String, Object> item : list) {
            if (previewId.equals(String.valueOf(item.get("id")))) {
                return item;
            }
        }
        return list.get(0);
    }

    private void buildCompletenessDimension(QualityDimensionResultDTO d, QualityEvaluationResultDTO result, Map<String, Object> profile,
                                            List<Mark> marks, Map<Integer, List<Map<String, Object>>> taskAttrConfigMap,
                                            Map<String, Object> metricRules, Map<String, Object> dc, QualityReferenceResultDTO ref) {
        List<String> profileRequiredFields = parseStringList(profile.get("requiredFields"));
        AttributeStats stats = collectAttributeStats(marks, taskAttrConfigMap, profileRequiredFields);
        List<QualityIndicatorResultDTO> metrics = new ArrayList<>();

        if (stats.requiredExpectedCount <= 0) {
            metrics.add(pendingMetric(d, "requiredAttributeMissingRate", "必填属性缺失率", "rule",
                    indicatorThreshold(dc, "requiredAttributeMissingRate", "<=5%通过，5%-20%预警，>20%失败"),
                    "未配置必填属性约束，无法计算", false, true));
        } else {
            double missingRate = safePercent(stats.requiredMissingCount, stats.requiredExpectedCount);
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("missingCount", stats.requiredMissingCount);
            details.put("expectedCount", stats.requiredExpectedCount);
            metrics.add(numberMetric(d, metricRules, "requiredAttributeMissingRate", "必填属性缺失率", "rule",
                    missingRate, formatPercent(missingRate),
                    indicatorThreshold(dc, "requiredAttributeMissingRate", "<=5%通过，5%-20%预警，>20%失败"), details));
            if (stats.requiredMissingCount > 0) {
                addIssue(result, "warning", "REQUIRED_ATTR_MISSING", "存在未填写的必填属性，建议补全后重评。", d.getDimensionKey(), "requiredAttributeMissingRate", details);
            }
        }

        if (stats.totalExpectedCount <= 0) {
            metrics.add(pendingMetric(d, "categoryAttributeCompletionRate", "类别属性完整率", "rule",
                    indicatorThreshold(dc, "categoryAttributeCompletionRate", ">=90%通过，70%-90%预警，<70%失败"),
                    "缺少任务类别属性约束，无法计算", false, true));
        } else {
            double completionRate = safePercent(stats.totalFilledCount, stats.totalExpectedCount);
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("filledCount", stats.totalFilledCount);
            details.put("expectedCount", stats.totalExpectedCount);
            details.put("perTypeCompletion", stats.perTypeCompletion);
            metrics.add(numberMetric(d, metricRules, "categoryAttributeCompletionRate", "类别属性完整率", "rule",
                    completionRate, formatPercent(completionRate),
                    indicatorThreshold(dc, "categoryAttributeCompletionRate", ">=90%通过，70%-90%预警，<70%失败"), details));
        }

        Map<String, Object> refIndicators = ref == null ? Collections.emptyMap() : safeMap(ref.getIndicators());
        metrics.add(optionalReferenceMetric(d, metricRules, "referenceFeatureMissingRate", "参考要素漏检率(可选)", "model",
                refIndicators.get("missingFeatureRate"), indicatorThreshold(dc, "referenceFeatureMissingRate", "参考模型启用时可计算"), true));
        metrics.add(optionalReferenceMetric(d, metricRules, "referenceFeatureRedundancyRate", "参考要素冗余率(可选)", "model",
                refIndicators.get("redundantFeatureRate"), indicatorThreshold(dc, "referenceFeatureRedundancyRate", "参考模型启用时可计算"), true));

        finalizeDimension(d, result, metrics, metricRules);
    }

    private void buildLogicConsistencyDimension(QualityDimensionResultDTO d, QualityEvaluationResultDTO result,
                                                Map<String, Object> profile, SampleSet sampleSet,
                                                List<FileMetadata> metadataList, List<Mark> marks,
                                                Map<String, Object> metricRules, Map<String, Object> dc) {
        List<QualityIndicatorResultDTO> metrics = new ArrayList<>();
        ScoreBundle band = evaluateBandConsistency(metadataList, parseStringList(profile.get("expectedBands")));
        metrics.add(bundleMetric(d, metricRules, "bandConsistencyRate", "波段一致性", "rule", band, indicatorThreshold(dc, "bandConsistencyRate", "一致率越高越好")));
        addBundleIssues(result, d, "bandConsistencyRate", "BAND_CONSISTENCY", band);

        ScoreBundle crsCompleteness = evaluateCrsCompleteness(metadataList);
        metrics.add(bundleMetric(d, metricRules, "crsCompletenessRate", "坐标系完整率", "metadata", crsCompleteness, indicatorThreshold(dc, "crsCompletenessRate", "元数据有值比例")));
        addBundleIssues(result, d, "crsCompletenessRate", "CRS_COMPLETENESS", crsCompleteness);

        ScoreBundle crsConsistency = evaluateCrsConsistency(metadataList);
        metrics.add(bundleMetric(d, metricRules, "crsConsistencyRate", "坐标系一致率", "rule", crsConsistency, indicatorThreshold(dc, "crsConsistencyRate", "以主坐标系为基准")));
        addBundleIssues(result, d, "crsConsistencyRate", "CRS_CONSISTENCY", crsConsistency);

        ScoreBundle ext = evaluateImageFormatConsistency(metadataList);
        metrics.add(bundleMetric(d, metricRules, "imageFormatConsistencyRate", "影像格式一致率", "metadata", ext, indicatorThreshold(dc, "imageFormatConsistencyRate", "以主格式为基准")));
        addBundleIssues(result, d, "imageFormatConsistencyRate", "FORMAT_CONSISTENCY", ext);

        ScoreBundle ann = evaluateAnnotationFormatMatch(asString(profile.get("expectedAnnotationFormat")), marks);
        metrics.add(bundleMetric(d, metricRules, "annotationFormatMatch", "标注格式匹配", "rule", ann, indicatorThreshold(dc, "annotationFormatMatch", "与模板期望一致")));
        addBundleIssues(result, d, "annotationFormatMatch", "ANNOTATION_FORMAT_MATCH", ann);

        ScoreBundle exp = evaluateExportFormatMatch(sampleSet, asString(profile.get("expectedExportFormat")));
        metrics.add(bundleMetric(d, metricRules, "exportFormatMatch", "导出格式匹配", "rule", exp, indicatorThreshold(dc, "exportFormatMatch", "与模板期望一致")));
        addBundleIssues(result, d, "exportFormatMatch", "EXPORT_FORMAT_MATCH", exp);

        ScoreBundle topo = evaluateTopologyPassRate(marks, parseStringList(profile.get("topologyRules")));
        metrics.add(bundleMetric(d, metricRules, "topologyPassRate", "拓扑规则通过率", "rule", topo, indicatorThreshold(dc, "topologyPassRate", "按配置拓扑规则计算")));
        addBundleIssues(result, d, "topologyPassRate", "TOPOLOGY_PASS_RATE", topo);

        finalizeDimension(d, result, metrics, metricRules);
    }

    private void buildAttributeAccuracyDimension(QualityDimensionResultDTO d, QualityEvaluationResultDTO result,
                                                 Map<String, Object> profile, List<Mark> marks,
                                                 Map<Integer, List<Map<String, Object>>> taskAttrConfigMap,
                                                 Map<String, Object> metricRules, Map<String, Object> dc,
                                                 QualityReferenceResultDTO ref) {
        List<QualityIndicatorResultDTO> metrics = new ArrayList<>();
        ScoreBundle validity = evaluateAttributeValueValidity(marks, taskAttrConfigMap, parseStringList(profile.get("requiredFields")));
        metrics.add(bundleMetric(d, metricRules, "attributeValueValidityRate", "属性值合法率", "rule", validity, indicatorThreshold(dc, "attributeValueValidityRate", "按属性类型校验合法性")));
        addBundleIssues(result, d, "attributeValueValidityRate", "ATTRIBUTE_VALIDITY", validity);

        metrics.add(pendingMetric(d, "manualAttributeAuditAccuracyRate", "人工属性审核准确率", "manual",
                indicatorThreshold(dc, "manualAttributeAuditAccuracyRate", "无人工抽检时 pending"), "当前无人工属性抽检结果", true, false));

        Map<String, Object> refIndicators = ref == null ? Collections.emptyMap() : safeMap(ref.getIndicators());
        metrics.add(optionalReferenceMetric(d, metricRules, "referenceClassificationAccuracy", "参考分类准确率(可选)", "model",
                refIndicators.get("classificationAccuracy"), indicatorThreshold(dc, "referenceClassificationAccuracy", "参考模型启用时可计算"), false));

        finalizeDimension(d, result, metrics, metricRules);
    }

    private void buildPositionalAccuracyDimension(QualityDimensionResultDTO d, QualityEvaluationResultDTO result,
                                                  Map<String, Object> metricRules, Map<String, Object> dc,
                                                  QualityReferenceResultDTO ref) {
        List<QualityIndicatorResultDTO> metrics = new ArrayList<>();
        Map<String, Object> refIndicators = ref == null ? Collections.emptyMap() : safeMap(ref.getIndicators());

        metrics.add(optionalReferenceMetric(d, metricRules, "referenceObjectOverlap", "参考对象重叠度(可选)", "model",
                refIndicators.get("objectOverlap"), indicatorThreshold(dc, "referenceObjectOverlap", "参考模型启用时可计算"), false));
        metrics.add(optionalReferenceMetric(d, metricRules, "referenceBoundaryDeviation", "参考边界偏差(可选)", "model",
                refIndicators.get("boundaryDeviation"), indicatorThreshold(dc, "referenceBoundaryDeviation", "参考模型启用时可计算"), true));
        Object boundaryPassRaw = refIndicators.get("boundaryPassRate");
        if (boundaryPassRaw == null && refIndicators.get("boundaryDeviation") instanceof Number) {
            double deviation = ((Number) refIndicators.get("boundaryDeviation")).doubleValue();
            boundaryPassRaw = Math.max(0, 100 - Math.min(deviation, 100));
        }
        metrics.add(optionalReferenceMetric(d, metricRules, "referenceBoundaryPassRate", "参考边界通过率(可选)", "model",
                boundaryPassRaw, indicatorThreshold(dc, "referenceBoundaryPassRate", "参考模型启用时可计算"), false));

        finalizeDimension(d, result, metrics, metricRules);
    }

    private void buildTemporalQualityDimension(QualityDimensionResultDTO d, QualityEvaluationResultDTO result,
                                               List<FileMetadata> metadataList, Map<String, Object> metricRules, Map<String, Object> dc) {
        List<QualityIndicatorResultDTO> metrics = new ArrayList<>();
        ScoreBundle a = evaluateAcquisitionTimeCompleteness(metadataList);
        metrics.add(bundleMetric(d, metricRules, "acquisitionTimeCompletenessRate", "采集时间完整率", "metadata", a, indicatorThreshold(dc, "acquisitionTimeCompletenessRate", "采集起止时间字段完整率")));
        addBundleIssues(result, d, "acquisitionTimeCompletenessRate", "ACQUISITION_TIME_COMPLETENESS", a);

        ScoreBundle b = evaluateTimePrecisionCompleteness(metadataList);
        metrics.add(bundleMetric(d, metricRules, "timePrecisionCompletenessRate", "时间精度字段完整率", "metadata", b, indicatorThreshold(dc, "timePrecisionCompletenessRate", "time_precision 非空比例")));
        addBundleIssues(result, d, "timePrecisionCompletenessRate", "TIME_PRECISION_COMPLETENESS", b);

        ScoreBundle c = evaluateTimePrecisionIndex(metadataList);
        metrics.add(bundleMetric(d, metricRules, "timePrecisionIndex", "时间精度指数", "rule", c, indicatorThreshold(dc, "timePrecisionIndex", "second>minute>hour>day")));
        addBundleIssues(result, d, "timePrecisionIndex", "TIME_PRECISION_INDEX", c);

        ScoreBundle e = evaluateTimeValidity(metadataList);
        metrics.add(bundleMetric(d, metricRules, "timeValidityRate", "时间有效率", "rule", e, indicatorThreshold(dc, "timeValidityRate", "起止时间可解析且起止关系有效")));
        addBundleIssues(result, d, "timeValidityRate", "TIME_VALIDITY", e);

        finalizeDimension(d, result, metrics, metricRules);
    }

    private void buildUsabilityQualityDimension(QualityDimensionResultDTO d, QualityEvaluationResultDTO result,
                                                List<Mark> marks, Map<String, Object> provenance,
                                                List<AuditInfo> audits, List<Integer> taskIds,
                                                Map<String, Object> metricRules, Map<String, Object> dc,
                                                QualityReferenceResultDTO ref) {
        List<QualityIndicatorResultDTO> metrics = new ArrayList<>();
        ScoreBundle a = evaluateClassBalance(marks);
        metrics.add(bundleMetric(d, metricRules, "classBalanceRate", "类别平衡度", "rule", a, indicatorThreshold(dc, "classBalanceRate", "熵归一化，越高越均衡")));
        addBundleIssues(result, d, "classBalanceRate", "CLASS_BALANCE", a);

        ScoreBundle b = evaluateProvenance(provenance);
        metrics.add(bundleMetric(d, metricRules, "provenanceCompletenessRate", "溯源完整率", "prov", b, indicatorThreshold(dc, "provenanceCompletenessRate", "活动/实体/关系/代理完整性")));
        addBundleIssues(result, d, "provenanceCompletenessRate", "PROVENANCE_COMPLETENESS", b);

        metrics.add(bundleMetric(d, metricRules, "auditCoverageRate", "审核覆盖率", "audit",
                evaluateAuditCoverage(audits, taskIds), indicatorThreshold(dc, "auditCoverageRate", "有审核记录任务占比")));
        metrics.add(bundleMetric(d, metricRules, "auditRecordCompletenessRate", "审核记录完整率", "audit",
                evaluateAuditRecordCompleteness(audits), indicatorThreshold(dc, "auditRecordCompletenessRate", "审核关键字段完整率")));
        metrics.add(bundleMetric(d, metricRules, "auditClosureRate", "审核闭环率", "audit",
                evaluateAuditClosureRate(audits, taskIds), indicatorThreshold(dc, "auditClosureRate", "已闭环审核占比")));
        metrics.add(bundleMetric(d, metricRules, "auditIssueDiscoveryRate", "审核问题发现率(信号)", "audit",
                evaluateAuditIssueDiscoveryRate(audits), indicatorThreshold(dc, "auditIssueDiscoveryRate", "仅作为过程信号")));

        Object reliabilityRaw = null;
        if (ref != null && Boolean.TRUE.equals(ref.getSuitable())) {
            if (ref.getReferenceReliability() != null) reliabilityRaw = ref.getReferenceReliability() * 100.0;
            else if (ref.getConfidenceScore() != null) reliabilityRaw = ref.getConfidenceScore();
        }
        metrics.add(optionalReferenceMetric(d, metricRules, "referenceReliabilityLevel", "参考评估可靠性等级", "model",
                reliabilityRaw, indicatorThreshold(dc, "referenceReliabilityLevel", "参考模型启用时可计算"), false));

        finalizeDimension(d, result, metrics, metricRules);
    }

    private void finalizeDimension(QualityDimensionResultDTO d, QualityEvaluationResultDTO result,
                                   List<QualityIndicatorResultDTO> metrics, Map<String, Object> metricRules) {
        d.setMetrics(metrics);
        d.setIndicators(metrics);
        Set<String> sourceSet = new LinkedHashSet<>();
        int pass = 0, warning = 0, fail = 0, pending = 0;
        boolean hardFail = false, hasWarningLike = false, hasCorePending = false, hasCoreMetric = false;

        for (QualityIndicatorResultDTO m : metrics) {
            if (m.getDataSources() != null) sourceSet.addAll(m.getDataSources());
            if (m.getSourceType() != null) sourceSet.add(m.getSourceType());
            Map<String, Object> rule = resolveMetricRule(metricRules, d.getDimensionKey(), m.getMetricKey());
            boolean optional = asBoolean(rule.get("optional"), false);
            boolean hard = asBoolean(rule.get("hard"), true);
            if (!optional) hasCoreMetric = true;

            if ("pass".equals(m.getStatus())) pass++;
            else if ("warning".equals(m.getStatus())) {
                warning++;
                if (!optional) hasWarningLike = true;
            } else if ("fail".equals(m.getStatus())) {
                fail++;
                if (!optional) {
                    if (hard) hardFail = true;
                    else hasWarningLike = true;
                }
            } else {
                pending++;
                if (!optional) hasCorePending = true;
            }
        }

        String status;
        if (metrics.isEmpty()) status = "pending";
        else if (!hasCoreMetric) status = pending == metrics.size() ? "pending" : (fail > 0 || warning > 0 ? "warning" : "pass");
        else if (hasCorePending) status = "pending";
        else if (hardFail) status = "fail";
        else if (hasWarningLike) status = "warning";
        else status = "pass";

        d.setStatus(status);
        d.setScore(null);
        d.setConfidence(null);
        d.setDataSources(new ArrayList<>(sourceSet));
        d.setEvidenceSummary(String.format(Locale.ROOT, "通过%d项，预警%d项，失败%d项，待评%d项；数据来源：%s",
                pass, warning, fail, pending, sourceSet.isEmpty() ? "-" : String.join("、", sourceSet)));
        d.setConclusionText(buildConclusionText(status));
        d.setSuggestionText(String.join("；", buildDimensionSuggestions(d.getDimensionKey(), metrics, status)));

        for (QualityIndicatorResultDTO m : metrics) {
            if (!"warning".equals(m.getStatus()) && !"fail".equals(m.getStatus())) continue;
            addIssue(result, "fail".equals(m.getStatus()) ? "error" : "warning",
                    "QUALITY_METRIC_" + (m.getMetricKey() == null ? "UNKNOWN" : m.getMetricKey().toUpperCase(Locale.ROOT)),
                    String.format(Locale.ROOT, "%s维度指标“%s”状态为%s。", d.getDimensionName(), m.getMetricName(), "fail".equals(m.getStatus()) ? "失败" : "预警"),
                    d.getDimensionKey(), m.getMetricKey(), m.getDetails());
        }
    }

    private String buildConclusionText(String status) {
        if ("pass".equals(status)) return "满足要求";
        if ("warning".equals(status)) return "需复核";
        if ("fail".equals(status)) return "不满足要求";
        return "未评价";
    }

    private List<String> buildDimensionSuggestions(String dimensionKey, List<QualityIndicatorResultDTO> metrics, String status) {
        LinkedHashSet<String> tips = new LinkedHashSet<>();
        if ("pending".equals(status)) tips.add("当前证据不足，建议补充缺失数据后重新评价。");
        for (QualityIndicatorResultDTO m : metrics) {
            if (!"warning".equals(m.getStatus()) && !"fail".equals(m.getStatus()) && !"pending".equals(m.getStatus())) continue;
            String k = m.getMetricKey();
            if (k == null) continue;
            switch (k) {
                case "requiredAttributeMissingRate": tips.add("补全缺失必填属性，并回填历史标注属性值。"); break;
                case "categoryAttributeCompletionRate": tips.add("检查类别属性约束并完善未填写字段。"); break;
                case "referenceFeatureMissingRate": tips.add("复核参考模型提示的高漏标区域。"); break;
                case "referenceFeatureRedundancyRate": tips.add("复核参考模型提示的疑似冗余对象。"); break;
                case "bandConsistencyRate": tips.add("检查波段定义并统一影像元数据。"); break;
                case "crsCompletenessRate":
                case "crsConsistencyRate": tips.add("补全并统一影像坐标系信息。"); break;
                case "imageFormatConsistencyRate": tips.add("统一影像格式，避免混用不同格式。"); break;
                case "annotationFormatMatch": tips.add("确保标注格式与模板配置一致后再导出。"); break;
                case "exportFormatMatch": tips.add("将导出格式调整为模板要求后再发布样本集。"); break;
                case "topologyPassRate": tips.add("对未通过拓扑规则的对象重新检查并修复。"); break;
                case "attributeValueValidityRate": tips.add("按属性类型规则修复非法取值。"); break;
                case "manualAttributeAuditAccuracyRate": tips.add("补充人工属性抽检记录，完成属性准确性复核。"); break;
                case "referenceClassificationAccuracy": tips.add("复核参考模型提示的类别分歧对象。"); break;
                case "referenceObjectOverlap": tips.add("复核低重叠对象，重点检查漏画或错位边界。"); break;
                case "referenceBoundaryDeviation":
                case "referenceBoundaryPassRate": tips.add("对边界偏差较大的对象进行精修。"); break;
                case "acquisitionTimeCompletenessRate": tips.add("补全采集时间字段，确保时间元数据完整。"); break;
                case "timePrecisionCompletenessRate":
                case "timePrecisionIndex": tips.add("统一时间精度填写规范（year/month/day/hour/minute/second）。"); break;
                case "timeValidityRate": tips.add("修正时间范围异常记录（开始时间与结束时间关系）。"); break;
                case "classBalanceRate": tips.add("补充长尾类别样本以改善类别平衡。"); break;
                case "provenanceCompletenessRate": tips.add("补齐溯源活动/实体/关系记录，提升可追溯性。"); break;
                case "auditCoverageRate": tips.add("扩大审核覆盖任务范围，避免未审样本直接入库。"); break;
                case "auditRecordCompletenessRate": tips.add("完善审核记录关键字段，保证审核链路完整。"); break;
                case "auditClosureRate": tips.add("推动未闭环审核任务完成复核与状态更新。"); break;
                case "auditIssueDiscoveryRate": tips.add("关注审核问题发现率变化，并结合样本难度调整审核策略。"); break;
                case "referenceReliabilityLevel": tips.add("参考模型可靠性偏低时，建议提高人工抽检比例。"); break;
                default: break;
            }
        }
        if (tips.isEmpty()) tips.add("维度整体满足要求，建议维持当前规则并进行小规模抽检验证稳定性。");
        return tips.stream().limit(3).collect(Collectors.toList());
    }

    private QualityIndicatorResultDTO bundleMetric(QualityDimensionResultDTO d, Map<String, Object> rules, String key, String name,
                                                   String sourceType, ScoreBundle bundle, String thresholdRule) {
        if (bundle.pending) {
            return pendingMetric(d, key, name, sourceType, thresholdRule, bundle.value, false, false);
        }
        return numberMetric(d, rules, key, name, sourceType, bundle.score, bundle.value, thresholdRule, bundle.details);
    }

    private QualityIndicatorResultDTO optionalReferenceMetric(QualityDimensionResultDTO d, Map<String, Object> rules, String key,
                                                              String name, String sourceType, Object rawValue,
                                                              String thresholdRule, boolean lowerBetter) {
        if (!(rawValue instanceof Number)) {
            return pendingMetric(d, key, name, sourceType, thresholdRule, "参考模型未启用或未返回该指标", true, true);
        }
        double n = ((Number) rawValue).doubleValue();
        if (n <= 1) n = n * 100;
        if (lowerBetter) n = Math.max(0, n);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("rawValue", rawValue);
        details.put("optional", true);
        return numberMetric(d, rules, key, name, sourceType, n, formatPercent(n), thresholdRule, details);
    }

    private QualityIndicatorResultDTO numberMetric(QualityDimensionResultDTO d, Map<String, Object> rules, String key, String name,
                                                   String sourceType, Double numeric, String display, String thresholdRule,
                                                   Map<String, Object> details) {
        QualityIndicatorResultDTO m = baseMetric(key, name, sourceType, thresholdRule);
        m.setScore(round(numeric));
        m.setValue(display);
        m.setDetails(details == null ? new LinkedHashMap<>() : details);
        m.getDetails().put("numericValue", m.getScore());
        Map<String, Object> rule = resolveMetricRule(rules, d.getDimensionKey(), key);
        m.getDetails().put("rule", rule);
        m.setStatus(judgeStatus(m.getScore(), rule));
        return m;
    }

    private QualityIndicatorResultDTO pendingMetric(QualityDimensionResultDTO d, String key, String name, String sourceType,
                                                    String thresholdRule, String reason, boolean optional, boolean notApplicable) {
        QualityIndicatorResultDTO m = baseMetric(key, name, sourceType, thresholdRule);
        m.setScore(null);
        m.setValue(reason);
        m.setStatus("pending");
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("reason", reason);
        details.put("optional", optional);
        details.put("notApplicable", notApplicable);
        m.setDetails(details);
        m.setContributesToScore(false);
        return m;
    }

    private QualityIndicatorResultDTO baseMetric(String key, String name, String sourceType, String thresholdRule) {
        QualityIndicatorResultDTO m = new QualityIndicatorResultDTO();
        m.setMetricKey(key);
        m.setMetricName(name);
        m.setKey(key);
        m.setLabel(name);
        m.setSourceType(sourceType);
        m.setDataSources(Collections.singletonList(sourceType));
        m.setThresholdRule(thresholdRule);
        m.setContributesToScore(false);
        return m;
    }

    private String judgeStatus(Double value, Map<String, Object> rule) {
        if (value == null) return "pending";
        String mode = asString(rule.get("mode"));
        if ("signal".equalsIgnoreCase(mode)) {
            Double warnMax = parseDouble(rule.get("warnMax"));
            if (warnMax == null) warnMax = 5.0;
            return value <= warnMax ? "pass" : "warning";
        }
        String direction = asString(rule.get("direction"));
        if ("low".equalsIgnoreCase(direction)) {
            Double passMax = parseDouble(rule.get("passMax"));
            Double warnMax = parseDouble(rule.get("warnMax"));
            if (passMax == null) passMax = 5.0;
            if (warnMax == null) warnMax = 20.0;
            if (value <= passMax) return "pass";
            if (value <= warnMax) return "warning";
            return "fail";
        }
        Double passMin = parseDouble(rule.get("passMin"));
        Double warnMin = parseDouble(rule.get("warnMin"));
        if (passMin == null) passMin = 90.0;
        if (warnMin == null) warnMin = 70.0;
        if (value >= passMin) return "pass";
        if (value >= warnMin) return "warning";
        return "fail";
    }

    private Map<String, Object> resolveMetricRule(Map<String, Object> rules, String dimKey, String metricKey) {
        String scoped = dimKey + "." + metricKey;
        Map<String, Object> rule = toRuleMap(rules == null ? null : rules.get(scoped));
        if (rule.isEmpty()) rule = toRuleMap(QualityDefaults.defaultMetricRules().get(scoped));
        if (rule.isEmpty()) {
            rule = new LinkedHashMap<>();
            rule.put("direction", "high");
            rule.put("passMin", 90);
            rule.put("warnMin", 70);
            rule.put("hard", true);
            rule.put("optional", false);
        } else {
            if (!rule.containsKey("hard")) rule.put("hard", true);
            if (!rule.containsKey("optional")) rule.put("optional", false);
        }
        return rule;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> toRuleMap(Object raw) {
        if (raw instanceof Map) return new LinkedHashMap<>((Map<String, Object>) raw);
        if (raw == null) return new LinkedHashMap<>();
        try {
            return objectMapper.readValue(String.valueOf(raw), new TypeReference<Map<String, Object>>() {});
        } catch (Exception ignored) {
            return new LinkedHashMap<>();
        }
    }

    private String indicatorThreshold(Map<String, Object> dc, String key, String fallback) {
        List<Map<String, Object>> indicators = parseIndicatorConfigs(dc == null ? null : dc.get("indicators"));
        for (Map<String, Object> i : indicators) {
            if (key.equals(asString(i.get("key")))) {
                String t = asString(i.get("thresholdRule"));
                if (t != null) return t;
            }
        }
        return fallback;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> parseIndicatorConfigs(Object raw) {
        if (raw instanceof List) return (List<Map<String, Object>>) raw;
        return new ArrayList<>();
    }

    private void addBundleIssues(QualityEvaluationResultDTO result, QualityDimensionResultDTO d, String metricKey, String code, ScoreBundle b) {
        if (b == null || b.issues.isEmpty()) return;
        for (String msg : b.issues) {
            addIssue(result, "warning", code, msg, d.getDimensionKey(), metricKey, b.details);
        }
    }

    private void addIssue(QualityEvaluationResultDTO result,
                          String level,
                          String code,
                          String message,
                          String dimensionKey,
                          String indicatorKey,
                          Map<String, Object> details) {
        if (result == null || message == null || message.trim().isEmpty()) {
            return;
        }
        QualityIssueDTO issue = new QualityIssueDTO();
        issue.setLevel(level == null ? "warning" : level);
        issue.setCode(code);
        issue.setMessage(message);
        issue.setDimensionKey(dimensionKey);
        issue.setIndicatorKey(indicatorKey);
        issue.setDetails(details == null ? new LinkedHashMap<>() : new LinkedHashMap<>(details));
        result.getIssues().add(issue);
    }

    private List<Integer> parseTaskIds(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return new ArrayList<>();
        }
        String cleaned = raw.trim().replace("[", "").replace("]", "");
        if (cleaned.isEmpty()) {
            return new ArrayList<>();
        }
        List<Integer> taskIds = new ArrayList<>();
        for (String item : cleaned.split(",")) {
            String val = item == null ? "" : item.trim();
            if (val.isEmpty()) {
                continue;
            }
            try {
                taskIds.add(Integer.parseInt(val));
            } catch (Exception ignored) {
            }
        }
        return taskIds;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> parseDimensionConfigs(Object raw) {
        if (raw instanceof List) {
            List<Map<String, Object>> list = new ArrayList<>();
            for (Object item : (List<?>) raw) {
                if (item instanceof Map) {
                    list.add(new LinkedHashMap<>((Map<String, Object>) item));
                }
            }
            return list;
        }
        if (raw instanceof String) {
            String json = ((String) raw).trim();
            if (json.isEmpty()) {
                return new ArrayList<>();
            }
            try {
                return objectMapper.readValue(json, new TypeReference<List<Map<String, Object>>>() {});
            } catch (Exception ignored) {
            }
        }
        return new ArrayList<>();
    }

    private Map<String, Object> buildFallbackProfile(SampleSet sampleSet) {
        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("id", null);
        profile.put("profileName", "默认规则型模板");
        profile.put("name", "默认规则型模板");
        profile.put("taskType", sampleSet == null ? null : sampleSet.getTaskType());
        profile.put("expectedBands", new ArrayList<String>());
        profile.put("expectedExportFormat", inferExportFormat(sampleSet));
        profile.put("expectedAnnotationFormat", "Polygon");
        profile.put("requiredFields", new ArrayList<String>());
        profile.put("topologyRules", Arrays.asList("polygon_no_self_intersection"));
        profile.put("attributeAuditMode", "optional");
        profile.put("dimensionConfigs", QualityDefaults.defaultDimensionConfigs());
        profile.put("enabledDimensions", QualityDefaults.defaultEnabledDimensions());
        profile.put("metricRules", QualityDefaults.defaultMetricRules());
        profile.put("isActive", true);
        profile.put("version", 1);
        return profile;
    }

    @SuppressWarnings("unchecked")
    private void applyOverrides(Map<String, Object> profile, Map<String, Object> overrides) {
        if (profile == null || overrides == null || overrides.isEmpty()) {
            return;
        }
        for (Map.Entry<String, Object> entry : overrides.entrySet()) {
            if (entry.getValue() != null) {
                profile.put(entry.getKey(), entry.getValue());
            }
        }
        Object rulesRaw = profile.get("metricRules");
        if (!(rulesRaw instanceof Map)) {
            profile.put("metricRules", QualityDefaults.defaultMetricRules());
        } else {
            Map<String, Object> merged = new LinkedHashMap<>(QualityDefaults.defaultMetricRules());
            merged.putAll((Map<String, Object>) rulesRaw);
            profile.put("metricRules", merged);
        }
    }

    private Map<String, Object> buildSampleSetBasicInfo(SampleSet sampleSet,
                                                        List<Integer> taskIds,
                                                        List<Task> tasks,
                                                        Map<String, Object> provenance) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("sampleSetId", sampleSet.getId());
        data.put("sampleSetName", sampleSet.getName());
        data.put("taskType", sampleSet.getTaskType());
        data.put("sampleCount", sampleSet.getNum());
        data.put("createTime", sampleSet.getCreateDate());
        data.put("sourceTaskCount", taskIds == null ? 0 : taskIds.size());
        data.put("sourceTaskIds", taskIds == null ? Collections.emptyList() : taskIds);
        data.put("sourceTasks", buildSourceTaskSummaries(tasks));
        data.put("exportFormat", inferExportFormat(sampleSet));
        boolean hasProv = false;
        if (provenance != null) {
            hasProv = !safeList(provenance.get("activities")).isEmpty()
                    || !safeList(provenance.get("entities")).isEmpty()
                    || !safeList(provenance.get("relations")).isEmpty();
        }
        data.put("hasProvenance", hasProv);
        return data;
    }

    private List<Map<String, Object>> buildSourceTaskSummaries(List<Task> tasks) {
        if (tasks == null || tasks.isEmpty()) {
            return Collections.emptyList();
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (Task task : tasks) {
            if (task == null || task.getTaskId() == null) {
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("taskId", task.getTaskId());
            item.put("taskName", task.getTaskName());
            item.put("taskType", task.getTaskType());
            item.put("status", task.getStatus());
            item.put("batchId", task.getBatchId());
            item.put("batchIndex", task.getBatchIndex());
            item.put("taskSource", task.getTaskSource());
            item.put("submitterId", task.getSubmitterId());
            items.add(item);
        }
        return items;
    }

    private String inferExportFormat(SampleSet sampleSet) {
        if (sampleSet == null || sampleSet.getLabelUrl() == null) {
            return "未记录";
        }
        String labelUrl = sampleSet.getLabelUrl().toLowerCase(Locale.ROOT);
        if (labelUrl.endsWith("annotations.json")) {
            return "COCO";
        }
        if (labelUrl.endsWith(".xml")) {
            return "VOC";
        }
        if (labelUrl.endsWith(".txt")) {
            return "YOLO";
        }
        if (labelUrl.endsWith(".json")) {
            return "项目内部格式";
        }
        return "未记录";
    }

    private QualityReferenceResultDTO runReferenceEvaluation(SampleSet sampleSet,
                                                             QualityEvaluationRequest request,
                                                             String operator,
                                                             QualityEvaluationProgressListener progressListener) {
        QualityReferenceResultDTO ref = new QualityReferenceResultDTO();
        QualityReferenceConfigDTO config = request.getReferenceModel();
        if (config == null) {
            ref.setEnabled(false);
            ref.setSuitable(false);
            ref.setReason("未启用参考模型");
            return ref;
        }

        List<QualityReferenceSourceDTO> normalizedSources = normalizeReferenceSources(config);
        if (normalizedSources.isEmpty()) {
            ref.setEnabled(false);
            ref.setSuitable(false);
            ref.setReason("未配置参考来源");
            return ref;
        }

        Integer primaryModelId = resolvePrimaryModelId(config, normalizedSources);
        ref.setEnabled(true);
        ref.setModelId(primaryModelId);
        ref.setConfidenceThreshold(config.getConfidenceThreshold());
        ref.setIouThreshold(config.getIouThreshold());
        ref.setBatchSize(config.getBatchSize());
        ref.setScopeMode(config.getScopeMode());
        ref.setSampleRatio(config.getSampleRatio());
        if (config.getFusionConfig() != null) {
            ref.setFusionMethod(firstNonBlank(config.getFusionConfig().getMethod(), "staple"));
        }

        Model model = primaryModelId == null ? null : modelService.getById(primaryModelId);
        if (primaryModelId != null && model == null) {
            ref.setSuitable(false);
            ref.setReason("参考模型不存在: " + primaryModelId);
            return ref;
        }

        if (model != null) {
            ref.setModelName(model.getModelName());
            ref.setModelVersion(extractModelVersion(model.getModelDes()));
            ref.setModelType(model.getModelType());
            ref.setTaskType(model.getTaskType());
            ref.setInputChannels(model.getInputNum());
            ref.setDefaultParams(extractModelDefaultInferParams(model.getModelDes()));
        }

        String imageDir = sampleSet.getImageUrl();
        String labelPath = sampleSet.getLabelUrl();
        if (imageDir == null || imageDir.trim().isEmpty() || labelPath == null || labelPath.trim().isEmpty()) {
            ref.setSuitable(false);
            ref.setReason("样本集缺少切片目录或标签元数据路径");
            return ref;
        }

        progressListener.onProgress("参考模型准备", 44, 0, 0, "正在准备参考模型评估参数");

        String endpoint = qualityFastApiUrl.endsWith("/")
                ? qualityFastApiUrl + "quality/reference-evaluate"
                : qualityFastApiUrl + "/quality/reference-evaluate";
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("sampleSetId", sampleSet.getId());
        payload.put("taskType", sampleSet.getTaskType());
        payload.put("imageDir", imageDir);
        payload.put("labelPath", labelPath);
        payload.put("modelId", primaryModelId);
        payload.put("referenceSources", toReferenceSourcesPayload(normalizedSources));
        payload.put("fusionConfig", toFusionConfigPayload(config.getFusionConfig()));
        payload.put("operator", operator == null ? "system" : operator);
        payload.put("confidenceThreshold", config.getConfidenceThreshold() == null ? 0.3 : config.getConfidenceThreshold());
        payload.put("iouThreshold", config.getIouThreshold() == null ? 0.5 : config.getIouThreshold());
        payload.put("batchSize", config.getBatchSize() == null ? 16 : config.getBatchSize());
        payload.put("scopeMode", config.getScopeMode() == null ? "all" : config.getScopeMode());
        payload.put("sampleRatio", config.getSampleRatio() == null ? 0.3 : config.getSampleRatio());
        payload.put("previewLimit", config.getPreviewLimit() == null ? 8 : config.getPreviewLimit());
        payload.put("inferParams", config.getInferParams() == null ? new LinkedHashMap<>() : config.getInferParams());
        payload.put("jobId", request.getEvaluationJobId());

        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> rawResp = restTemplate.postForObject(endpoint, payload, Map.class);
            Map<String, Object> data = rawResp == null ? Collections.emptyMap() : safeMap(rawResp.get("data"));
            ref.setSuitable(asBoolean(data.get("suitable"), false));
            ref.setReason(asString(data.get("reason")));
            ref.setModelName(firstNonBlank(asString(data.get("modelName")), ref.getModelName()));
            ref.setModelVersion(firstNonBlank(asString(data.get("modelVersion")), ref.getModelVersion()));
            ref.setModelType(firstNonBlank(asString(data.get("modelType")), ref.getModelType()));
            ref.setTaskType(firstNonBlank(asString(data.get("taskType")), ref.getTaskType()));
            ref.setFusionMethod(firstNonBlank(asString(data.get("fusionMethod")), ref.getFusionMethod()));
            ref.setEvaluatedSamples(parseInteger(data.get("evaluatedSamples")));
            ref.setTotalSamples(parseInteger(data.get("totalSamples")));
            ref.setConfidenceMean(parseDouble(data.get("confidenceMean")));
            ref.setCoverageRate(parseDouble(data.get("coverageRate")));
            ref.setLowConfidenceRatio(parseDouble(data.get("lowConfidenceRatio")));
            ref.setSampleCoverageRate(parseDouble(data.get("sampleCoverageRate")));
            ref.setClassCoverageRate(parseDouble(data.get("classCoverageRate")));
            ref.setReferenceReliability(parseDouble(data.get("referenceReliability")));
            ref.setReferenceReliabilityLevel(asString(data.get("referenceReliabilityLevel")));
            ref.setConfidenceScore(parseDouble(data.get("confidenceScore")));
            ref.setIndicators(normalizeReferenceIndicators(safeMap(data.get("indicators"))));
            ref.setSourceSummaries(safeList(data.get("sourceSummaries")));
            ref.setProbabilityStats(safeMap(data.get("probabilityStats")));
            ref.setUncertaintyStats(safeMap(data.get("uncertaintyStats")));
            ref.setFusionConfigUsed(safeMap(data.get("fusionConfigUsed")));
            ref.setPreviewItems(safeList(data.get("previewItems")));
            ref.setNotes(parseStringList(data.get("notes")));
        } catch (Exception ex) {
            ref.setSuitable(false);
            ref.setReason("参考模型评估请求失败: " + ex.getMessage());
        }
        return ref;
    }

    private Integer resolvePrimaryModelId(QualityReferenceConfigDTO config, List<QualityReferenceSourceDTO> sources) {
        if (config != null && config.getModelId() != null) {
            return config.getModelId();
        }
        if (sources == null || sources.isEmpty()) {
            return null;
        }
        for (QualityReferenceSourceDTO source : sources) {
            if (source != null && source.getModelId() != null) {
                return source.getModelId();
            }
        }
        return null;
    }

    private Integer resolvePreviewModelId(QualityReferenceRunRequest request, QualityReferenceResultDTO reference) {
        if (request != null && request.getModelId() != null) {
            return request.getModelId();
        }
        if (reference != null && reference.getModelId() != null) {
            return reference.getModelId();
        }
        if (request != null && request.getReferenceSources() != null) {
            for (QualityReferenceSourceDTO source : request.getReferenceSources()) {
                if (source != null && source.getModelId() != null) {
                    return source.getModelId();
                }
            }
        }
        return -1;
    }

    private List<QualityReferenceSourceDTO> normalizeReferenceSources(QualityReferenceConfigDTO config) {
        List<QualityReferenceSourceDTO> result = new ArrayList<>();
        if (config == null) {
            return result;
        }
        if (config.getReferenceSources() != null) {
            for (QualityReferenceSourceDTO raw : config.getReferenceSources()) {
                if (raw == null) {
                    continue;
                }
                QualityReferenceSourceDTO source = new QualityReferenceSourceDTO();
                source.setSourceId(firstNonBlank(raw.getSourceId(), raw.getModelId() == null ? "source" : ("model-" + raw.getModelId())));
                source.setSourceType(firstNonBlank(raw.getSourceType(), "model"));
                source.setModelId(raw.getModelId());
                source.setWeight(raw.getWeight() == null ? 1.0 : raw.getWeight());
                source.setConfidenceCalib(raw.getConfidenceCalib());
                result.add(source);
            }
        }
        if (result.isEmpty() && config.getModelId() != null) {
            QualityReferenceSourceDTO fallback = new QualityReferenceSourceDTO();
            fallback.setSourceId("model-" + config.getModelId());
            fallback.setSourceType("model");
            fallback.setModelId(config.getModelId());
            fallback.setWeight(1.0);
            result.add(fallback);
        }
        return result;
    }

    private List<Map<String, Object>> toReferenceSourcesPayload(List<QualityReferenceSourceDTO> sources) {
        List<Map<String, Object>> list = new ArrayList<>();
        if (sources == null) {
            return list;
        }
        for (QualityReferenceSourceDTO source : sources) {
            if (source == null) {
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("sourceId", source.getSourceId());
            item.put("sourceType", source.getSourceType());
            item.put("modelId", source.getModelId());
            item.put("weight", source.getWeight());
            item.put("confidenceCalib", source.getConfidenceCalib() == null ? new LinkedHashMap<>() : source.getConfidenceCalib());
            list.add(item);
        }
        return list;
    }

    private Map<String, Object> toFusionConfigPayload(QualityReferenceFusionConfigDTO config) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (config == null) {
            map.put("method", "staple");
            map.put("fusionMode", "soft_staple");
            return map;
        }
        map.put("method", firstNonBlank(config.getMethod(), "staple"));
        map.put("fusionMode", firstNonBlank(config.getFusionMode(), "soft_staple"));
        map.put("maxIter", config.getMaxIter());
        map.put("eps", config.getEps());
        map.put("probThreshold", config.getProbThreshold());
        map.put("minAgreement", config.getMinAgreement());
        return map;
    }

    private String buildPreviewCacheKey(Integer sampleSetId, Integer modelId) {
        return String.valueOf(sampleSetId) + "_" + String.valueOf(modelId);
    }

    private List<Map<String, Object>> materializePreviewItems(Integer sampleSetId, List<Map<String, Object>> previewItems) {
        if (previewItems == null || previewItems.isEmpty()) {
            return new ArrayList<>();
        }
        List<Map<String, Object>> list = new ArrayList<>();
        for (Map<String, Object> raw : previewItems) {
            Map<String, Object> item = safeMap(raw);
            String sliceFileName = asString(item.get("sliceFileName"));
            String id = firstNonBlank(asString(item.get("sampleId")), sliceFileName);
            if (id == null) {
                continue;
            }

            String originalImageUrl = null;
            if (!isBlank(sliceFileName)) {
                String encodedName = URLEncoder.encode(sliceFileName, StandardCharsets.UTF_8);
                originalImageUrl = "/wegismarkapi/sampleSet/image/preview?datasetId=" + sampleSetId + "&fileName=" + encodedName;
            }

            List<Map<String, Object>> overlayPolygons = safeList(item.get("overlayPolygons"));
            List<Map<String, Object>> overlayBoxes = safeList(item.get("overlayBoxes"));
            String previewType = firstNonBlank(asString(item.get("previewType")), asString(item.get("overlayType")));
            Map<String, Object> overlayData = new LinkedHashMap<>();
            overlayData.put("width", item.get("width"));
            overlayData.put("height", item.get("height"));
            overlayData.put("polygons", overlayPolygons);
            overlayData.put("boxes", overlayBoxes);
            String overlayMaskFile = asString(item.get("overlayMaskFile"));
            String overlayMaskUrl = null;
            if (!isBlank(overlayMaskFile)) {
                String encodedMask = URLEncoder.encode(overlayMaskFile, StandardCharsets.UTF_8);
                long cacheBust = System.currentTimeMillis();
                overlayMaskUrl = "/wegismarkapi/sampleSet/mask/preview?datasetId=" + sampleSetId + "&fileName=" + encodedMask + "&ts=" + cacheBust;
                overlayData.put("maskImageUrl", overlayMaskUrl);
                if (isBlank(previewType)) {
                    previewType = "heatmap";
                }
            }

            Map<String, Object> normalized = new LinkedHashMap<>();
            normalized.put("id", id);
            normalized.put("sampleId", id);
            normalized.put("sliceFileName", sliceFileName);
            normalized.put("name", firstNonBlank(asString(item.get("sliceFileName")), id));
            normalized.put("originalImageUrl", originalImageUrl);
            normalized.put("sourceImageUrl", originalImageUrl);
            normalized.put("resultImageUrl", originalImageUrl);
            normalized.put("previewType", previewType);
            normalized.put("overlayType", previewType);
            normalized.put("overlayMaskUrl", overlayMaskUrl);
            normalized.put("overlayPolygons", overlayPolygons);
            normalized.put("overlayBoxes", overlayBoxes);
            normalized.put("overlayData", overlayData);
            normalized.put("confidenceSummary", safeMap(item.get("confidenceSummary")));
            normalized.put("classSummary", safeMap(item.get("classSummary")));
            list.add(normalized);
        }
        return list;
    }

    private List<Map<String, Object>> limitPreviewItems(List<Map<String, Object>> list, Integer limit) {
        if (list == null || list.isEmpty()) {
            return new ArrayList<>();
        }
        int actualLimit = (limit == null || limit <= 0) ? list.size() : Math.min(limit, list.size());
        return new ArrayList<>(list.subList(0, actualLimit));
    }

    private Map<String, Object> normalizeReferenceIndicators(Map<String, Object> raw) {
        Map<String, Object> normalized = new LinkedHashMap<>();
        if (raw == null) {
            return normalized;
        }
        normalized.putAll(raw);
        Object missing = raw.get("missingFeatureRate");
        Object redundant = raw.get("redundantFeatureRate");
        Object clsAcc = raw.get("classificationAccuracy");
        Object overlap = raw.get("objectOverlap");
        Object boundaryDev = raw.get("boundaryDeviation");
        Object boundaryPass = raw.get("boundaryPassRate");
        normalized.put("referenceFeatureMissingRate", missing);
        normalized.put("referenceFeatureRedundancyRate", redundant);
        normalized.put("referenceClassificationAccuracy", clsAcc);
        normalized.put("referenceObjectOverlap", overlap);
        normalized.put("referenceBoundaryDeviation", boundaryDev);
        normalized.put("referenceBoundaryPassRate", boundaryPass);
        return normalized;
    }

    private Map<String, Object> buildAuditSignals(List<AuditInfo> audits, List<Integer> taskIds) {
        Map<String, Object> map = new LinkedHashMap<>();
        int totalTasks = taskIds == null ? 0 : taskIds.size();
        int auditedTasks = (int) audits.stream()
                .map(AuditInfo::getTaskId)
                .filter(Objects::nonNull)
                .distinct()
                .count();
        int miss = 0;
        int over = 0;
        int mislabel = 0;
        double iouSum = 0;
        int iouCount = 0;
        double boundarySum = 0;
        int boundaryCount = 0;
        for (AuditInfo audit : audits) {
            miss += safeInt(audit.getMissNum());
            over += safeInt(audit.getOverMarkNum());
            mislabel += safeInt(audit.getMislabelNum());
            if (audit.getIou() != null) {
                iouSum += audit.getIou();
                iouCount++;
            }
            if (audit.getBoundaryError() != null) {
                boundarySum += audit.getBoundaryError();
                boundaryCount++;
            }
        }
        map.put("taskCount", totalTasks);
        map.put("auditedTaskCount", auditedTasks);
        map.put("auditCoverageRate", totalTasks <= 0 ? 0.0 : round(auditedTasks * 100.0 / totalTasks));
        map.put("auditMiss", miss);
        map.put("auditOver", over);
        map.put("auditMislabel", mislabel);
        map.put("auditIoU", iouCount <= 0 ? null : round(iouSum / iouCount));
        map.put("auditBoundary", boundaryCount <= 0 ? null : round(boundarySum / boundaryCount));
        return map;
    }

    private String buildFinalSuggestion(List<QualityDimensionResultDTO> dimensions) {
        if (dimensions == null || dimensions.isEmpty()) {
            return "建议补充评价后再发布";
        }
        boolean hasFail = dimensions.stream().anyMatch(d -> "fail".equals(d.getStatus()));
        boolean hasWarning = dimensions.stream().anyMatch(d -> "warning".equals(d.getStatus()));
        boolean allPass = dimensions.stream()
                .filter(d -> d.getEnabled() == null || d.getEnabled())
                .allMatch(d -> "pass".equals(d.getStatus()));
        if (hasFail) {
            return "不建议发布";
        }
        if (hasWarning) {
            return "建议复核";
        }
        if (allPass) {
            return "可发布";
        }
        return "建议补充评价后再发布";
    }

    private List<String> buildGlobalOpinions(SampleSet sampleSet,
                                             List<QualityDimensionResultDTO> dimensions,
                                             List<QualityIssueDTO> issues,
                                             QualityReferenceResultDTO ref) {
        LinkedHashSet<String> opinions = new LinkedHashSet<>();
        for (QualityDimensionResultDTO d : dimensions) {
            if ("fail".equals(d.getStatus())) {
                opinions.add(String.format(Locale.ROOT, "维度“%s”不满足要求，建议先完成整改后再发布样本集。", d.getDimensionName()));
            } else if ("warning".equals(d.getStatus())) {
                opinions.add(String.format(Locale.ROOT, "维度“%s”存在预警项，建议组织专项复核。", d.getDimensionName()));
            } else if ("pending".equals(d.getStatus())) {
                opinions.add(String.format(Locale.ROOT, "维度“%s”证据不足，建议补充缺失数据后重新评价。", d.getDimensionName()));
            }
            if (d.getSuggestionText() != null && !d.getSuggestionText().trim().isEmpty()) {
                opinions.addAll(Arrays.asList(d.getSuggestionText().split("；")));
            }
        }
        if (ref != null && Boolean.TRUE.equals(ref.getEnabled())) {
            if (!Boolean.TRUE.equals(ref.getSuitable())) {
                opinions.add("参考模型当前不适用于该样本集，模型证据未纳入本次评价结论。");
            } else if (ref.getReferenceReliability() != null && ref.getReferenceReliability() < 0.6) {
                opinions.add("参考模型可靠性较低，建议提高人工抽检比例并降低模型证据权重。");
            }
        }
        if (issues != null && !issues.isEmpty()) {
            long high = issues.stream().filter(i -> "error".equals(i.getLevel())).count();
            if (high > 0) {
                opinions.add(String.format(Locale.ROOT, "发现 %d 项高优先级问题，建议建立整改清单并复测通过后再导出。", high));
            }
        }
        if (opinions.isEmpty()) {
            opinions.add(String.format(Locale.ROOT, "样本集“%s”当前规则型评价结果稳定，建议保持规则并周期抽检。", sampleSet.getName()));
        }
        return opinions.stream().map(String::trim).filter(s -> !s.isEmpty()).limit(6).collect(Collectors.toList());
    }

    private String buildSummary(SampleSet sampleSet, List<QualityDimensionResultDTO> dimensions, String finalSuggestion) {
        long pass = dimensions.stream().filter(d -> "pass".equals(d.getStatus())).count();
        long warning = dimensions.stream().filter(d -> "warning".equals(d.getStatus())).count();
        long fail = dimensions.stream().filter(d -> "fail".equals(d.getStatus())).count();
        long pending = dimensions.stream().filter(d -> "pending".equals(d.getStatus())).count();
        return String.format(Locale.ROOT,
                "样本集“%s”完成规则型质量评价：满足要求 %d 维、需复核 %d 维、不满足要求 %d 维、未评价 %d 维。最终建议：%s。",
                sampleSet.getName(), pass, warning, fail, pending, finalSuggestion);
    }

    private void attachReportSummary(QualityEvaluationResultDTO result, QualityReport report) {
        if (report == null || report.getId() == null) {
            return;
        }
        result.setReportId(report.getId());
        QualityReportSummaryDTO summary = new QualityReportSummaryDTO();
        summary.setReportId(report.getId());
        summary.setGeneratedAt(report.getCreatedTime());
        summary.setJsonUrl("/quality/report/" + report.getId());
        summary.setHtmlUrl("/quality/report/" + report.getId() + "/html");
        result.setReport(summary);
    }

    private void recordQualityProvenance(SampleSet sampleSet,
                                         QualityEvaluationRequest request,
                                         Map<String, Object> profile,
                                         QualityEvaluationResultDTO result,
                                         QualityReport report,
                                         String operator) {
        try {
            List<ProvEntityRef> inputs = new ArrayList<>();
            inputs.add(ProvEntityRef.of(String.valueOf(sampleSet.getId()), "SAMPLE_SET", "样本集#" + sampleSet.getId()));
            if (request.getQualityProfileId() != null) {
                inputs.add(ProvEntityRef.of(String.valueOf(request.getQualityProfileId()), "QUALITY_PROFILE", "质量模板#" + request.getQualityProfileId()));
            }
            if (request.getReferenceModel() != null && request.getReferenceModel().getModelId() != null) {
                inputs.add(ProvEntityRef.of(String.valueOf(request.getReferenceModel().getModelId()), "MODEL", "参考模型#" + request.getReferenceModel().getModelId()));
            }
            ProvEntityRef output = report == null
                    ? null
                    : ProvEntityRef.of(String.valueOf(report.getId()), "QUALITY_REPORT", "质量报告#" + report.getId());

            Map<String, Object> params = new LinkedHashMap<>();
            params.put("sampleSetId", sampleSet.getId());
            params.put("sampleSetName", sampleSet.getName());
            params.put("qualityProfileId", request.getQualityProfileId());
            params.put("profileName", asString(profile.get("profileName")) == null ? asString(profile.get("name")) : asString(profile.get("profileName")));
            params.put("finalSuggestion", result.getFinalSuggestion());
            params.put("enabledDimensions", result.getEnabledDimensions());
            params.put("pendingDimensions", result.getPendingDimensions());
            params.put("reportId", report == null ? null : report.getId());
            provenanceService.recordActivity(
                    "QUALITY_EVALUATE",
                    operator == null ? "system" : operator,
                    "PERSON",
                    inputs,
                    output == null ? Collections.emptyList() : Collections.singletonList(output),
                    params
            );
            trimQualityProvenanceHistory(sampleSet.getId(), MAX_QUALITY_PROVENANCE_RECORDS);
        } catch (Exception ignored) {
        }
    }

    private void recordReferenceRunProvenance(SampleSet sampleSet,
                                              QualityReferenceRunRequest request,
                                              QualityReferenceResultDTO reference,
                                              int previewCount,
                                              LocalDateTime startedAt,
                                              LocalDateTime endedAt,
                                              String operator) {
        try {
            List<ProvEntityRef> inputs = new ArrayList<>();
            inputs.add(ProvEntityRef.of(String.valueOf(sampleSet.getId()), "SAMPLE_SET", "样本集#" + sampleSet.getId()));
            Integer primaryModelId = request.getModelId();
            if (primaryModelId != null) {
                inputs.add(ProvEntityRef.of(String.valueOf(primaryModelId), "MODEL", "参考模型#" + primaryModelId));
            }
            if (request.getReferenceSources() != null) {
                for (QualityReferenceSourceDTO source : request.getReferenceSources()) {
                    if (source != null && source.getModelId() != null) {
                        inputs.add(ProvEntityRef.of(String.valueOf(source.getModelId()), "MODEL", "参考来源模型#" + source.getModelId()));
                    }
                }
            }

            Map<String, Object> params = new LinkedHashMap<>();
            params.put("sampleSetId", sampleSet.getId());
            params.put("sampleSetName", sampleSet.getName());
            params.put("modelId", request.getModelId());
            params.put("referenceSources", request.getReferenceSources());
            params.put("fusionConfig", request.getFusionConfig());
            params.put("confidenceThreshold", request.getConfidenceThreshold());
            params.put("iouThreshold", request.getIouThreshold());
            params.put("batchSize", request.getBatchSize());
            params.put("referenceScope", request.getReferenceScope());
            params.put("sampleRatio", request.getSampleRatio());
            params.put("previewCount", previewCount);
            params.put("suitable", reference == null ? null : reference.getSuitable());
            params.put("reason", reference == null ? null : reference.getReason());
            params.put("coverageRate", reference == null ? null : reference.getCoverageRate());
            params.put("confidenceMean", reference == null ? null : reference.getConfidenceMean());
            params.put("lowConfidenceRatio", reference == null ? null : reference.getLowConfidenceRatio());
            params.put("referenceReliabilityLevel", reference == null ? null : reference.getReferenceReliabilityLevel());
            params.put("startedAt", startedAt == null ? null : startedAt.toString());
            params.put("endedAt", endedAt == null ? null : endedAt.toString());
            provenanceService.recordActivity(
                    "QUALITY_REFERENCE_EVALUATE",
                    operator == null ? "system" : operator,
                    "PERSON",
                    inputs,
                    Collections.emptyList(),
                    params
            );
            trimQualityProvenanceHistory(sampleSet.getId(), MAX_QUALITY_PROVENANCE_RECORDS);
        } catch (Exception ignored) {
        }
    }

    private void trimQualityProvenanceHistory(Integer sampleSetId, int keepCount) {
        if (sampleSetId == null || keepCount <= 0) {
            return;
        }
        List<ProvEntity> sampleSetEntities = provEntityMapper.selectList(
                new QueryWrapper<ProvEntity>()
                        .eq("business_id", String.valueOf(sampleSetId))
                        .eq("entity_type", "SAMPLE_SET")
        );
        if (sampleSetEntities == null || sampleSetEntities.isEmpty()) {
            return;
        }
        Set<String> sampleSetEntityIds = sampleSetEntities.stream()
                .map(ProvEntity::getId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        if (sampleSetEntityIds.isEmpty()) {
            return;
        }

        List<ProvRelation> sampleSetRelations = provRelationMapper.selectList(
                new QueryWrapper<ProvRelation>().in("entity_id", sampleSetEntityIds)
        );
        if (sampleSetRelations == null || sampleSetRelations.isEmpty()) {
            return;
        }
        Set<String> activityIds = sampleSetRelations.stream()
                .map(ProvRelation::getActivityId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        if (activityIds.isEmpty()) {
            return;
        }

        List<ProvActivity> qualityActivities = provActivityMapper.selectList(
                new QueryWrapper<ProvActivity>()
                        .in("id", activityIds)
                        .in("act_type", QUALITY_PROVENANCE_TYPES)
                        .orderByDesc("start_time")
                        .orderByDesc("id")
        );
        if (qualityActivities == null || qualityActivities.size() <= keepCount) {
            return;
        }

        List<String> staleActivityIds = qualityActivities.stream()
                .skip(keepCount)
                .map(ProvActivity::getId)
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
        if (staleActivityIds.isEmpty()) {
            return;
        }

        List<ProvRelation> staleRelations = provRelationMapper.selectList(
                new QueryWrapper<ProvRelation>().in("activity_id", staleActivityIds)
        );
        Set<String> generatedEntityIds = staleRelations == null
                ? Collections.emptySet()
                : staleRelations.stream()
                .filter(rel -> "GENERATED".equalsIgnoreCase(rel.getRelType()))
                .map(ProvRelation::getEntityId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());

        provRelationMapper.delete(new QueryWrapper<ProvRelation>().in("activity_id", staleActivityIds));
        provActivityMapper.delete(new QueryWrapper<ProvActivity>().in("id", staleActivityIds));

        if (!generatedEntityIds.isEmpty()) {
            List<ProvRelation> remainRelations = provRelationMapper.selectList(
                    new QueryWrapper<ProvRelation>().in("entity_id", generatedEntityIds)
            );
            Set<String> aliveEntityIds = remainRelations == null
                    ? Collections.emptySet()
                    : remainRelations.stream()
                    .map(ProvRelation::getEntityId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());
            List<String> orphanEntityIds = generatedEntityIds.stream()
                    .filter(entityId -> !aliveEntityIds.contains(entityId))
                    .collect(Collectors.toList());
            if (!orphanEntityIds.isEmpty()) {
                provEntityMapper.delete(new QueryWrapper<ProvEntity>().in("id", orphanEntityIds));
            }
        }
    }

    private AttributeStats collectAttributeStats(List<Mark> marks,
                                                 Map<Integer, List<Map<String, Object>>> taskAttrConfigMap,
                                                 List<String> profileRequiredFields) {
        AttributeStats stats = new AttributeStats();
        Map<Integer, Integer> perTypeExpected = new HashMap<>();
        Map<Integer, Integer> perTypeFilled = new HashMap<>();
        for (Mark mark : marks) {
            Map<String, Object> attr = extractMarkAttributes(mark);
            List<Map<String, Object>> rows = taskAttrConfigMap.getOrDefault(mark.getTaskId(), Collections.emptyList()).stream()
                    .filter(r -> {
                        Integer cfgTypeId = parseInteger(r.get("typeId"));
                        return cfgTypeId == null || Objects.equals(cfgTypeId, mark.getTypeId());
                    })
                    .collect(Collectors.toList());

            LinkedHashSet<String> expectedKeys = new LinkedHashSet<>();
            LinkedHashSet<String> requiredKeys = new LinkedHashSet<>(profileRequiredFields);
            for (Map<String, Object> row : rows) {
                String attrKey = asString(row.get("attrKey"));
                if (attrKey == null) {
                    continue;
                }
                expectedKeys.add(attrKey);
                if (asBoolean(row.get("isRequired"), false)) {
                    requiredKeys.add(attrKey);
                }
            }
            expectedKeys.addAll(profileRequiredFields);
            if (expectedKeys.isEmpty() && requiredKeys.isEmpty()) {
                continue;
            }

            stats.totalExpectedCount += expectedKeys.size();
            stats.requiredExpectedCount += requiredKeys.size();
            int typeId = mark.getTypeId() == null ? -1 : mark.getTypeId();
            perTypeExpected.put(typeId, perTypeExpected.getOrDefault(typeId, 0) + expectedKeys.size());

            int filledForType = 0;
            for (String key : expectedKeys) {
                if (isFilled(attr.get(key))) {
                    stats.totalFilledCount++;
                    filledForType++;
                }
            }
            for (String key : requiredKeys) {
                if (!isFilled(attr.get(key))) {
                    stats.requiredMissingCount++;
                }
            }
            perTypeFilled.put(typeId, perTypeFilled.getOrDefault(typeId, 0) + filledForType);
        }

        Map<String, Object> perType = new LinkedHashMap<>();
        for (Map.Entry<Integer, Integer> entry : perTypeExpected.entrySet()) {
            Integer typeId = entry.getKey();
            int expected = entry.getValue();
            int filled = perTypeFilled.getOrDefault(typeId, 0);
            perType.put(String.valueOf(typeId), round(safePercent(filled, expected)));
        }
        stats.perTypeCompletion = perType;
        return stats;
    }

    private ScoreBundle evaluateBandConsistency(List<FileMetadata> metadataList, List<String> expectedBands) {
        if (metadataList == null || metadataList.isEmpty()) {
            return ScoreBundle.pending("缺少影像元数据");
        }
        List<List<String>> allBands = metadataList.stream().map(this::extractBands).collect(Collectors.toList());
        List<String> baseline = expectedBands == null ? new ArrayList<>() : expectedBands.stream()
                .filter(Objects::nonNull).map(v -> v.trim().toUpperCase(Locale.ROOT)).filter(v -> !v.isEmpty())
                .collect(Collectors.toList());
        if (baseline.isEmpty()) {
            baseline = allBands.stream().filter(l -> !l.isEmpty()).findFirst().orElse(new ArrayList<>());
        }
        if (baseline.isEmpty()) {
            return ScoreBundle.pending("未找到可用波段定义");
        }

        int pass = 0;
        int total = 0;
        List<Integer> mismatched = new ArrayList<>();
        for (int i = 0; i < metadataList.size(); i++) {
            List<String> bands = allBands.get(i);
            total++;
            if (sameBandSet(bands, baseline)) {
                pass++;
            } else {
                mismatched.add(metadataList.get(i).getFileId());
            }
        }
        double score = safePercent(pass, total);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("expectedBands", baseline);
        details.put("checkedFiles", total);
        details.put("matchedFiles", pass);
        details.put("mismatchedFileIds", mismatched);
        List<String> issues = mismatched.isEmpty()
                ? new ArrayList<>()
                : Collections.singletonList("存在波段定义不一致影像，建议核对 bands_json 与期望波段。");
        return ScoreBundle.done(score, formatPercent(score), details, issues);
    }

    private ScoreBundle evaluateCrsCompleteness(List<FileMetadata> metadataList) {
        if (metadataList == null || metadataList.isEmpty()) {
            return ScoreBundle.pending("缺少影像元数据");
        }
        int has = 0;
        for (FileMetadata metadata : metadataList) {
            if (!isBlank(metadata.getCrsCode()) || !isBlank(metadata.getCrsName())) {
                has++;
            }
        }
        double score = safePercent(has, metadataList.size());
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("hasCrsCount", has);
        details.put("totalCount", metadataList.size());
        return ScoreBundle.done(score, formatPercent(score), details, has == metadataList.size()
                ? new ArrayList<>()
                : Collections.singletonList("部分影像缺少坐标系信息。"));
    }

    private ScoreBundle evaluateCrsConsistency(List<FileMetadata> metadataList) {
        if (metadataList == null || metadataList.isEmpty()) {
            return ScoreBundle.pending("缺少影像元数据");
        }
        Map<String, Integer> freq = new HashMap<>();
        for (FileMetadata metadata : metadataList) {
            String key = normalizeCrs(metadata);
            if (key == null) {
                continue;
            }
            freq.put(key, freq.getOrDefault(key, 0) + 1);
        }
        if (freq.isEmpty()) {
            return ScoreBundle.pending("未找到有效坐标系");
        }
        String major = freq.entrySet().stream().max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse(null);
        int matched = 0;
        int total = 0;
        for (FileMetadata metadata : metadataList) {
            String key = normalizeCrs(metadata);
            if (key == null) {
                continue;
            }
            total++;
            if (Objects.equals(key, major)) {
                matched++;
            }
        }
        double score = safePercent(matched, total);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("majorCrs", major);
        details.put("matchedCount", matched);
        details.put("checkedCount", total);
        return ScoreBundle.done(score, formatPercent(score), details, score >= 100
                ? new ArrayList<>()
                : Collections.singletonList("坐标系存在不一致情况，建议统一 CRS。"));
    }

    private ScoreBundle evaluateImageFormatConsistency(List<FileMetadata> metadataList) {
        if (metadataList == null || metadataList.isEmpty()) {
            return ScoreBundle.pending("缺少影像元数据");
        }
        Map<String, Integer> freq = new HashMap<>();
        for (FileMetadata metadata : metadataList) {
            String ext = isBlank(metadata.getExt()) ? null : metadata.getExt().trim().toLowerCase(Locale.ROOT);
            if (ext != null) {
                freq.put(ext, freq.getOrDefault(ext, 0) + 1);
            }
        }
        if (freq.isEmpty()) {
            return ScoreBundle.pending("未记录影像格式");
        }
        String major = freq.entrySet().stream().max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse(null);
        int matched = 0;
        for (FileMetadata metadata : metadataList) {
            String ext = isBlank(metadata.getExt()) ? null : metadata.getExt().trim().toLowerCase(Locale.ROOT);
            if (Objects.equals(ext, major)) {
                matched++;
            }
        }
        double score = safePercent(matched, metadataList.size());
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("majorExt", major);
        details.put("matchedCount", matched);
        details.put("totalCount", metadataList.size());
        return ScoreBundle.done(score, formatPercent(score), details, score >= 100
                ? new ArrayList<>()
                : Collections.singletonList("影像格式不一致，建议统一导入格式。"));
    }

    private ScoreBundle evaluateAnnotationFormatMatch(String expectedAnnotationFormat, List<Mark> marks) {
        if (marks == null || marks.isEmpty()) {
            return ScoreBundle.pending("无标注对象");
        }
        if (isBlank(expectedAnnotationFormat) || "未记录".equals(expectedAnnotationFormat)) {
            return ScoreBundle.pending("未配置期望标注格式");
        }
        int match = 0;
        int total = 0;
        for (Mark mark : marks) {
            String format = inferMarkFormat(mark);
            if (format == null) {
                continue;
            }
            total++;
            if (isFormatMatch(expectedAnnotationFormat, format)) {
                match++;
            }
        }
        if (total <= 0) {
            return ScoreBundle.pending("标注格式不可识别");
        }
        double score = safePercent(match, total);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("expectedFormat", expectedAnnotationFormat);
        details.put("matchedCount", match);
        details.put("checkedCount", total);
        List<String> issues = score >= 100 ? new ArrayList<>()
                : Collections.singletonList("存在与模板不匹配的标注几何类型。");
        return ScoreBundle.done(score, formatPercent(score), details, issues);
    }

    private ScoreBundle evaluateExportFormatMatch(SampleSet sampleSet, String expectedExportFormat) {
        if (isBlank(expectedExportFormat) || "未记录".equalsIgnoreCase(expectedExportFormat)) {
            return ScoreBundle.pending("未配置期望导出格式");
        }
        String actual = inferExportFormat(sampleSet);
        boolean match = expectedExportFormat.trim().equalsIgnoreCase(actual == null ? "" : actual.trim());
        double score = match ? 100.0 : 0.0;
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("expected", expectedExportFormat);
        details.put("actual", actual);
        List<String> issues = match ? new ArrayList<>() : Collections.singletonList("样本集导出格式与模板要求不一致。");
        return ScoreBundle.done(score, match ? "匹配" : "不匹配", details, issues);
    }

    private ScoreBundle evaluateTopologyPassRate(List<Mark> marks, List<String> topologyRules) {
        if (marks == null || marks.isEmpty()) {
            return ScoreBundle.pending("无标注对象");
        }
        if (topologyRules == null || topologyRules.isEmpty()) {
            return ScoreBundle.pending("未配置拓扑规则");
        }
        Set<String> ruleSet = topologyRules.stream().filter(Objects::nonNull).map(String::trim)
                .filter(v -> !v.isEmpty()).collect(Collectors.toSet());
        if (ruleSet.isEmpty()) {
            return ScoreBundle.pending("未配置拓扑规则");
        }

        int pass = 0;
        int total = 0;
        int invalid = 0;
        Set<String> dedupe = new HashSet<>();
        for (Mark mark : marks) {
            Geometry geometry = extractGeometry(mark);
            if (geometry == null) {
                continue;
            }
            total++;
            boolean ok = true;
            if (ruleSet.contains("polygon_no_self_intersection")) {
                if ((geometry instanceof Polygon || geometry instanceof MultiPolygon) && !geometry.isValid()) {
                    ok = false;
                }
            }
            if (ok && ruleSet.contains("polygon_valid_holes")) {
                if (geometry instanceof Polygon && geometry.getArea() <= 0) {
                    ok = false;
                }
            }
            if (ok && ruleSet.contains("polygon_no_duplicate")) {
                String fp = geometry.norm().toText();
                if (!dedupe.add(fp)) {
                    ok = false;
                }
            }
            if (ok && ruleSet.contains("road_should_connect")) {
                if ((geometry instanceof LineString || geometry instanceof MultiLineString) && geometry.getLength() <= 0) {
                    ok = false;
                }
            }
            if (ok) {
                pass++;
            } else {
                invalid++;
            }
        }
        if (total <= 0) {
            return ScoreBundle.pending("无可校验几何对象");
        }
        double score = safePercent(pass, total);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("rules", topologyRules);
        details.put("passCount", pass);
        details.put("invalidCount", invalid);
        details.put("checkedCount", total);
        List<String> issues = invalid <= 0 ? new ArrayList<>()
                : Collections.singletonList("存在未通过拓扑规则的对象。");
        return ScoreBundle.done(score, formatPercent(score), details, issues);
    }

    private ScoreBundle evaluateAttributeValueValidity(List<Mark> marks,
                                                       Map<Integer, List<Map<String, Object>>> taskAttrConfigMap,
                                                       List<String> profileRequiredFields) {
        if (marks == null || marks.isEmpty()) {
            return ScoreBundle.pending("无标注对象");
        }
        int valid = 0;
        int total = 0;
        int missingRequired = 0;
        int invalidType = 0;

        for (Mark mark : marks) {
            Map<String, Object> attr = extractMarkAttributes(mark);
            List<Map<String, Object>> rows = taskAttrConfigMap.getOrDefault(mark.getTaskId(), Collections.emptyList()).stream()
                    .filter(r -> {
                        Integer cfgTypeId = parseInteger(r.get("typeId"));
                        return cfgTypeId == null || Objects.equals(cfgTypeId, mark.getTypeId());
                    })
                    .collect(Collectors.toList());
            Map<String, Map<String, Object>> rowByKey = new LinkedHashMap<>();
            for (Map<String, Object> row : rows) {
                String key = asString(row.get("attrKey"));
                if (key != null) {
                    rowByKey.put(key, row);
                }
            }
            for (String key : profileRequiredFields) {
                rowByKey.putIfAbsent(key, new LinkedHashMap<>());
            }
            for (Map.Entry<String, Map<String, Object>> entry : rowByKey.entrySet()) {
                String key = entry.getKey();
                Map<String, Object> cfg = entry.getValue();
                boolean required = asBoolean(cfg.get("isRequired"), false) || profileRequiredFields.contains(key);
                Object value = attr.get(key);
                if (!isFilled(value)) {
                    if (required) {
                        total++;
                        missingRequired++;
                    }
                    continue;
                }
                total++;
                if (isAttrValueValid(value, asString(cfg.get("dataType")), asString(cfg.get("enumOptionsJson")))) {
                    valid++;
                } else {
                    invalidType++;
                }
            }
        }
        if (total <= 0) {
            return ScoreBundle.pending("未配置可校验属性");
        }
        double score = safePercent(valid, total);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("validCount", valid);
        details.put("checkedCount", total);
        details.put("missingRequiredCount", missingRequired);
        details.put("invalidTypeCount", invalidType);
        List<String> issues = new ArrayList<>();
        if (missingRequired > 0) {
            issues.add("存在缺失必填属性。");
        }
        if (invalidType > 0) {
            issues.add("存在属性类型或枚举取值非法。");
        }
        return ScoreBundle.done(score, formatPercent(score), details, issues);
    }

    private ScoreBundle evaluateAcquisitionTimeCompleteness(List<FileMetadata> metadataList) {
        if (metadataList == null || metadataList.isEmpty()) {
            return ScoreBundle.pending("缺少影像元数据");
        }
        int complete = 0;
        for (FileMetadata metadata : metadataList) {
            if (!isBlank(metadata.getAcquisitionTimeStart())) {
                complete++;
            }
        }
        double score = safePercent(complete, metadataList.size());
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("completeCount", complete);
        details.put("totalCount", metadataList.size());
        return ScoreBundle.done(score, formatPercent(score), details,
                complete == metadataList.size() ? new ArrayList<>() : Collections.singletonList("存在缺失采集时间的影像。"));
    }

    private ScoreBundle evaluateTimePrecisionCompleteness(List<FileMetadata> metadataList) {
        if (metadataList == null || metadataList.isEmpty()) {
            return ScoreBundle.pending("缺少影像元数据");
        }
        int complete = 0;
        for (FileMetadata metadata : metadataList) {
            if (!isBlank(metadata.getTimePrecision())) {
                complete++;
            }
        }
        double score = safePercent(complete, metadataList.size());
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("completeCount", complete);
        details.put("totalCount", metadataList.size());
        return ScoreBundle.done(score, formatPercent(score), details,
                complete == metadataList.size() ? new ArrayList<>() : Collections.singletonList("存在缺失 time_precision 的影像。"));
    }

    private ScoreBundle evaluateTimePrecisionIndex(List<FileMetadata> metadataList) {
        if (metadataList == null || metadataList.isEmpty()) {
            return ScoreBundle.pending("缺少影像元数据");
        }
        double sum = 0.0;
        int count = 0;
        for (FileMetadata metadata : metadataList) {
            if (isBlank(metadata.getTimePrecision())) {
                continue;
            }
            sum += precisionScore(metadata.getTimePrecision());
            count++;
        }
        if (count <= 0) {
            return ScoreBundle.pending("未记录时间精度");
        }
        double score = sum / count;
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("avgPrecisionScore", round(score));
        details.put("count", count);
        return ScoreBundle.done(score, round(score) + "", details, new ArrayList<>());
    }

    private ScoreBundle evaluateTimeValidity(List<FileMetadata> metadataList) {
        if (metadataList == null || metadataList.isEmpty()) {
            return ScoreBundle.pending("缺少影像元数据");
        }
        int valid = 0;
        int total = 0;
        for (FileMetadata metadata : metadataList) {
            String startRaw = metadata.getAcquisitionTimeStart();
            String endRaw = metadata.getAcquisitionTimeEnd();
            if (isBlank(startRaw) && isBlank(endRaw)) {
                continue;
            }
            total++;
            LocalDateTime start = parseDateTime(startRaw);
            LocalDateTime end = parseDateTime(endRaw);
            boolean ok = start != null && (end == null || !end.isBefore(start));
            if (ok) {
                valid++;
            }
        }
        if (total <= 0) {
            return ScoreBundle.pending("无可校验时间记录");
        }
        double score = safePercent(valid, total);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("validCount", valid);
        details.put("checkedCount", total);
        return ScoreBundle.done(score, formatPercent(score), details,
                valid == total ? new ArrayList<>() : Collections.singletonList("存在时间格式异常或起止关系异常记录。"));
    }

    private ScoreBundle evaluateClassBalance(List<Mark> marks) {
        if (marks == null || marks.isEmpty()) {
            return ScoreBundle.pending("无标注对象");
        }
        Map<Integer, Long> byType = marks.stream()
                .collect(Collectors.groupingBy(mark -> mark.getTypeId() == null ? -1 : mark.getTypeId(), Collectors.counting()));
        int classCount = byType.size();
        if (classCount <= 1) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("classCount", classCount);
            details.put("distribution", byType);
            return ScoreBundle.done(100.0, "100.0", details, Collections.singletonList("当前样本仅覆盖单类别，平衡度指标不敏感。"));
        }
        double total = marks.size();
        double entropy = 0.0;
        for (long c : byType.values()) {
            double p = c / total;
            entropy += -p * Math.log(p);
        }
        double maxEntropy = Math.log(classCount);
        double score = maxEntropy <= 0 ? 0 : (entropy / maxEntropy * 100.0);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("classCount", classCount);
        details.put("distribution", byType);
        details.put("entropy", round(entropy));
        return ScoreBundle.done(score, formatPercent(score), details, new ArrayList<>());
    }

    private ScoreBundle evaluateProvenance(Map<String, Object> provenance) {
        if (provenance == null || provenance.isEmpty()) {
            return ScoreBundle.pending("无溯源数据");
        }
        List<Map<String, Object>> activities = safeList(provenance.get("activities"));
        List<Map<String, Object>> entities = safeList(provenance.get("entities"));
        List<Map<String, Object>> relations = safeList(provenance.get("relations"));
        List<Map<String, Object>> agents = safeList(provenance.get("agents"));

        double score = 0;
        if (!activities.isEmpty()) score += 25;
        if (!entities.isEmpty()) score += 25;
        if (!relations.isEmpty()) score += 20;
        if (!agents.isEmpty()) score += 10;

        boolean hasAnnotate = activities.stream().anyMatch(a -> {
            String t = asString(a.get("actType"));
            if (t == null) t = asString(a.get("act_type"));
            return t != null && t.toUpperCase(Locale.ROOT).contains("ANNOTATE");
        });
        boolean hasAudit = activities.stream().anyMatch(a -> {
            String t = asString(a.get("actType"));
            if (t == null) t = asString(a.get("act_type"));
            return t != null && t.toUpperCase(Locale.ROOT).contains("AUDIT");
        });
        if (hasAnnotate) score += 10;
        if (hasAudit) score += 10;

        Map<String, Object> details = new LinkedHashMap<>();
        details.put("activityCount", activities.size());
        details.put("entityCount", entities.size());
        details.put("relationCount", relations.size());
        details.put("agentCount", agents.size());
        details.put("hasAnnotateActivity", hasAnnotate);
        details.put("hasAuditActivity", hasAudit);
        List<String> issues = new ArrayList<>();
        if (activities.isEmpty()) issues.add("缺少溯源活动记录。");
        if (entities.isEmpty()) issues.add("缺少溯源实体记录。");
        if (relations.isEmpty()) issues.add("缺少溯源关系记录。");
        return ScoreBundle.done(score, formatPercent(score), details, issues);
    }

    private ScoreBundle evaluateAuditCoverage(List<AuditInfo> audits, List<Integer> taskIds) {
        if (taskIds == null || taskIds.isEmpty()) {
            return ScoreBundle.pending("样本集未关联任务");
        }
        Set<Integer> audited = audits.stream().map(AuditInfo::getTaskId).filter(Objects::nonNull).collect(Collectors.toSet());
        double score = safePercent(audited.size(), taskIds.size());
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("auditedTaskCount", audited.size());
        details.put("taskCount", taskIds.size());
        return ScoreBundle.done(score, formatPercent(score), details, new ArrayList<>());
    }

    private ScoreBundle evaluateAuditRecordCompleteness(List<AuditInfo> audits) {
        if (audits == null || audits.isEmpty()) {
            return ScoreBundle.pending("无审核记录");
        }
        int total = audits.size() * 5;
        int filled = 0;
        for (AuditInfo audit : audits) {
            if (audit.getStatus() != null) filled++;
            if (!isBlank(audit.getAuditor())) filled++;
            if (audit.getAuditTime() != null) filled++;
            if (audit.getAuditNum() != null) filled++;
            if (audit.getLabelNum() != null) filled++;
        }
        double score = safePercent(filled, total);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("filledFields", filled);
        details.put("totalFields", total);
        details.put("recordCount", audits.size());
        return ScoreBundle.done(score, formatPercent(score), details, new ArrayList<>());
    }

    private ScoreBundle evaluateAuditClosureRate(List<AuditInfo> audits, List<Integer> taskIds) {
        if (taskIds == null || taskIds.isEmpty()) {
            return ScoreBundle.pending("样本集未关联任务");
        }
        Map<Integer, List<AuditInfo>> byTask = audits.stream()
                .filter(audit -> audit.getTaskId() != null)
                .collect(Collectors.groupingBy(AuditInfo::getTaskId));
        int closed = 0;
        for (Integer taskId : taskIds) {
            List<AuditInfo> rows = byTask.get(taskId);
            if (rows == null || rows.isEmpty()) {
                continue;
            }
            boolean ok = rows.stream().anyMatch(audit ->
                    audit.getStatus() != null && (!isBlank(audit.getAuditOpnion()) || audit.getAuditTime() != null));
            if (ok) {
                closed++;
            }
        }
        double score = safePercent(closed, taskIds.size());
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("closedTaskCount", closed);
        details.put("taskCount", taskIds.size());
        return ScoreBundle.done(score, formatPercent(score), details, new ArrayList<>());
    }

    private ScoreBundle evaluateAuditIssueDiscoveryRate(List<AuditInfo> audits) {
        if (audits == null || audits.isEmpty()) {
            return ScoreBundle.pending("无审核记录");
        }
        int issueCount = 0;
        int labelCount = 0;
        for (AuditInfo audit : audits) {
            issueCount += safeInt(audit.getMissNum()) + safeInt(audit.getOverMarkNum()) + safeInt(audit.getMislabelNum());
            labelCount += Math.max(safeInt(audit.getLabelNum()), 0);
        }
        double rate = labelCount <= 0 ? 0.0 : (issueCount * 100.0 / labelCount);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("issueCount", issueCount);
        details.put("labelCount", labelCount);
        return ScoreBundle.done(rate, formatPercent(rate), details, new ArrayList<>());
    }

    private List<FileMetadata> resolveMetadataForTasks(List<Task> tasks) {
        List<FileMetadata> list = new ArrayList<>();
        Set<Integer> seen = new HashSet<>();
        for (Task task : tasks) {
            FileMetadata metadata = resolveMetadataForTask(task);
            if (metadata == null || metadata.getFileId() == null || !seen.add(metadata.getFileId())) {
                continue;
            }
            list.add(metadata);
        }
        return list;
    }

    private FileMetadata resolveMetadataForTask(Task task) {
        if (task == null) {
            return null;
        }
        try {
            if ("local".equalsIgnoreCase(task.getTaskSource()) && !isBlank(task.getLocalImagePath())) {
                String normalized = task.getLocalImagePath().replace('\\', '/');
                String fileName = Paths.get(normalized).getFileName() == null ? null : Paths.get(normalized).getFileName().toString();
                if (!isBlank(fileName)) {
                    SysFile sysFile = sysFileService.getFileByFileName(fileName);
                    if (sysFile != null && sysFile.getFileId() != null) {
                        return fileMetadataMapper.selectById(sysFile.getFileId());
                    }
                }
            }
            if (task.getServerId() != null && task.getServerId() > 0) {
                Server server = serverService.getById(task.getServerId());
                if (server != null && !isBlank(server.getSerName())) {
                    List<SysFile> files = sysFileService.list(new QueryWrapper<SysFile>()
                            .like("file_name", server.getSerName())
                            .orderByDesc("file_id"));
                    if (files != null) {
                        for (SysFile file : files) {
                            FileMetadata metadata = fileMetadataMapper.selectById(file.getFileId());
                            if (metadata != null) {
                                return metadata;
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private Map<String, Object> extractModelDefaultInferParams(String modelDes) {
        Map<String, Object> spec = safeMap(modelDes);
        Object infer = spec.get("inferParams");
        return infer == null ? new LinkedHashMap<>() : safeMap(infer);
    }

    private String extractModelVersion(String modelDes) {
        Map<String, Object> spec = safeMap(modelDes);
        return asString(spec.get("versionTag"));
    }

    private Map<String, Object> extractMarkAttributes(Mark mark) {
        if (mark == null) {
            return new LinkedHashMap<>();
        }
        if (mark.getAttrJson() != null && !mark.getAttrJson().isEmpty()) {
            return safeMap(mark.getAttrJson());
        }
        if (mark.getGeom() != null) {
            Map<String, Object> geom = safeMap(mark.getGeom());
            Map<String, Object> properties = safeMap(geom.get("properties"));
            if (!properties.isEmpty()) {
                properties.remove("markId");
                return properties;
            }
        }
        return new LinkedHashMap<>();
    }

    private Geometry extractGeometry(Mark mark) {
        if (mark == null || mark.getGeom() == null || mark.getGeom().isEmpty()) {
            return null;
        }
        try {
            Map<String, Object> geomMap = safeMap(mark.getGeom());
            Object geometryObj = geomMap.get("geometry");
            if (geometryObj == null) {
                geometryObj = geomMap;
            }
            String geoJson = objectMapper.writeValueAsString(geometryObj);
            return new GeoJSONReader().read(geoJson);
        } catch (Exception ignored) {
            return null;
        }
    }

    private String inferMarkFormat(Mark mark) {
        Geometry geometry = extractGeometry(mark);
        if (geometry == null) {
            return null;
        }
        if (geometry instanceof Polygon || geometry instanceof MultiPolygon) {
            return "Polygon";
        }
        if (geometry instanceof LineString || geometry instanceof MultiLineString) {
            return "Polyline";
        }
        String type = geometry.getGeometryType();
        if (type == null) {
            return null;
        }
        if (type.toLowerCase(Locale.ROOT).contains("point")) {
            return "Point";
        }
        return type;
    }

    private boolean isFormatMatch(String expected, String actual) {
        if (expected == null || actual == null) {
            return false;
        }
        String exp = expected.trim().toLowerCase(Locale.ROOT);
        String act = actual.trim().toLowerCase(Locale.ROOT);
        if (exp.equals(act)) {
            return true;
        }
        if ("mask".equals(exp) && ("polygon".equals(act) || "multipolygon".equals(act))) {
            return true;
        }
        return exp.contains(act) || act.contains(exp);
    }

    private List<String> extractBands(FileMetadata metadata) {
        if (metadata == null) {
            return new ArrayList<>();
        }
        if (!isBlank(metadata.getBandsJson())) {
            try {
                Object raw = objectMapper.readValue(metadata.getBandsJson(), Object.class);
                if (raw instanceof List) {
                    List<String> bands = new ArrayList<>();
                    for (Object item : (List<?>) raw) {
                        if (item instanceof String) {
                            String val = ((String) item).trim().toUpperCase(Locale.ROOT);
                            if (!val.isEmpty()) {
                                bands.add(val);
                            }
                        } else if (item instanceof Map) {
                            Map<String, Object> row = safeMap(item);
                            String name = asString(row.get("name"));
                            if (name == null) {
                                name = asString(row.get("wavelength"));
                            }
                            if (name == null) {
                                name = asString(row.get("index"));
                            }
                            if (name != null) {
                                bands.add(name.trim().toUpperCase(Locale.ROOT));
                            }
                        }
                    }
                    if (!bands.isEmpty()) {
                        return bands;
                    }
                }
            } catch (Exception ignored) {
            }
        }
        if (metadata.getBandCount() != null && metadata.getBandCount() > 0) {
            List<String> bands = new ArrayList<>();
            for (int i = 1; i <= metadata.getBandCount(); i++) {
                bands.add("B" + i);
            }
            return bands;
        }
        return new ArrayList<>();
    }

    private boolean sameBandSet(List<String> a, List<String> b) {
        if (a == null || b == null || a.isEmpty() || b.isEmpty()) {
            return false;
        }
        return new LinkedHashSet<>(a).equals(new LinkedHashSet<>(b));
    }

    private String normalizeCrs(FileMetadata metadata) {
        if (metadata == null) {
            return null;
        }
        if (!isBlank(metadata.getCrsCode())) {
            return metadata.getCrsCode().trim().toUpperCase(Locale.ROOT);
        }
        if (!isBlank(metadata.getCrsName())) {
            return metadata.getCrsName().trim().toUpperCase(Locale.ROOT);
        }
        return null;
    }

    private boolean isAttrValueValid(Object value, String dataType, String enumOptionsJson) {
        if (value == null) {
            return false;
        }
        String type = dataType == null ? "" : dataType.trim().toLowerCase(Locale.ROOT);
        try {
            switch (type) {
                case "integer":
                    Integer.parseInt(String.valueOf(value));
                    return true;
                case "number":
                    Double.parseDouble(String.valueOf(value));
                    return true;
                case "enum":
                    List<String> enums = parseStringList(enumOptionsJson);
                    if (enums.isEmpty()) {
                        return true;
                    }
                    return enums.stream().anyMatch(item -> Objects.equals(item, String.valueOf(value)));
                case "string":
                default:
                    return isFilled(value);
            }
        } catch (Exception ignored) {
            return false;
        }
    }

    private double precisionScore(String precision) {
        if (precision == null) {
            return 0;
        }
        String p = precision.trim().toLowerCase(Locale.ROOT);
        if (p.contains("second") || "sec".equals(p) || "s".equals(p)) return 100;
        if (p.contains("minute") || "min".equals(p) || "m".equals(p)) return 80;
        if (p.contains("hour") || "h".equals(p)) return 60;
        if (p.contains("day") || "d".equals(p)) return 40;
        if (p.contains("month")) return 25;
        if (p.contains("year")) return 10;
        return 0;
    }

    private LocalDateTime parseDateTime(String raw) {
        if (isBlank(raw)) {
            return null;
        }
        String val = raw.trim();
        try {
            return OffsetDateTime.parse(val, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toLocalDateTime();
        } catch (Exception ignored) {
        }
        try {
            return LocalDateTime.parse(val, DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        } catch (Exception ignored) {
        }
        try {
            return LocalDate.parse(val, DateTimeFormatter.ISO_LOCAL_DATE).atStartOfDay();
        } catch (Exception ignored) {
        }
        try {
            return LocalDateTime.parse(val, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        } catch (Exception ignored) {
        }
        try {
            return LocalDateTime.parse(val, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"));
        } catch (Exception ignored) {
        }
        try {
            return LocalDateTime.parse(val, DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm:ss"));
        } catch (Exception ignored) {
        }
        return null;
    }

    private String formatPercent(double value) {
        return PERCENT_FORMAT.format(round(value)) + "%";
    }

    private double safePercent(double numerator, double denominator) {
        if (denominator <= 0) {
            return 0.0;
        }
        return numerator * 100.0 / denominator;
    }

    private int safeInt(Integer raw) {
        return raw == null ? 0 : raw;
    }

    private Double round(Double raw) {
        if (raw == null) {
            return null;
        }
        return Math.round(raw * 100.0) / 100.0;
    }

    private Double parseDouble(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof Number) {
            return ((Number) raw).doubleValue();
        }
        String str = String.valueOf(raw).trim();
        if (str.isEmpty()) {
            return null;
        }
        try {
            return Double.parseDouble(str);
        } catch (Exception ignored) {
            return null;
        }
    }

    private Integer parseInteger(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof Number) {
            return ((Number) raw).intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(raw).trim());
        } catch (Exception ignored) {
            return null;
        }
    }

    private String asString(Object raw) {
        if (raw == null) {
            return null;
        }
        String val = String.valueOf(raw).trim();
        return val.isEmpty() ? null : val;
    }

    private String firstNonBlank(String a, String b) {
        return isBlank(a) ? b : a;
    }

    private boolean isBlank(String raw) {
        return raw == null || raw.trim().isEmpty();
    }

    private boolean isFilled(Object raw) {
        if (raw == null) {
            return false;
        }
        if (raw instanceof String) {
            return !((String) raw).trim().isEmpty();
        }
        return true;
    }

    private boolean asBoolean(Object raw, boolean defaultValue) {
        if (raw == null) {
            return defaultValue;
        }
        if (raw instanceof Boolean) {
            return (Boolean) raw;
        }
        String value = String.valueOf(raw).trim();
        if (value.isEmpty()) {
            return defaultValue;
        }
        return "1".equals(value) || "true".equalsIgnoreCase(value) || "yes".equalsIgnoreCase(value);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> safeMap(Object raw) {
        if (raw == null) {
            return new LinkedHashMap<>();
        }
        if (raw instanceof Map) {
            return new LinkedHashMap<>((Map<String, Object>) raw);
        }
        if (raw instanceof JSONObject) {
            return new LinkedHashMap<>((JSONObject) raw);
        }
        if (raw instanceof String) {
            String json = ((String) raw).trim();
            if (json.isEmpty()) {
                return new LinkedHashMap<>();
            }
            try {
                return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
            } catch (Exception ignored) {
                return new LinkedHashMap<>();
            }
        }
        try {
            String json = objectMapper.writeValueAsString(raw);
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception ignored) {
            return new LinkedHashMap<>();
        }
    }

    private Map<String, Object> parseMap(Object raw, Map<String, Object> fallback) {
        Map<String, Object> data = safeMap(raw);
        if (data.isEmpty()) {
            return fallback == null ? new LinkedHashMap<>() : new LinkedHashMap<>(fallback);
        }
        if (fallback == null || fallback.isEmpty()) {
            return data;
        }
        Map<String, Object> merged = new LinkedHashMap<>(fallback);
        merged.putAll(data);
        return merged;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> safeList(Object raw) {
        if (raw instanceof List) {
            List<Map<String, Object>> list = new ArrayList<>();
            for (Object item : (List<?>) raw) {
                if (item instanceof Map || item instanceof JSONObject) {
                    list.add(safeMap(item));
                }
            }
            return list;
        }
        return new ArrayList<>();
    }

    @SuppressWarnings("unchecked")
    private List<String> parseStringList(Object raw) {
        if (raw == null) {
            return new ArrayList<>();
        }
        if (raw instanceof List) {
            List<String> out = new ArrayList<>();
            for (Object item : (List<?>) raw) {
                String val = asString(item);
                if (val != null) {
                    out.add(val);
                }
            }
            return out;
        }
        if (raw instanceof String) {
            String value = ((String) raw).trim();
            if (value.isEmpty()) {
                return new ArrayList<>();
            }
            if (value.startsWith("[") && value.endsWith("]")) {
                try {
                    return objectMapper.readValue(value, new TypeReference<List<String>>() {});
                } catch (Exception ignored) {
                }
            }
            return Arrays.stream(value.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .collect(Collectors.toList());
        }
        return new ArrayList<>();
    }

    private static class AttributeStats {
        int requiredExpectedCount = 0;
        int requiredMissingCount = 0;
        int totalExpectedCount = 0;
        int totalFilledCount = 0;
        Map<String, Object> perTypeCompletion = new LinkedHashMap<>();
    }

    private static class ScoreBundle {
        private final Double score;
        private final String value;
        private final Map<String, Object> details;
        private final List<String> issues;
        private final boolean pending;

        private ScoreBundle(Double score, String value, Map<String, Object> details, List<String> issues, boolean pending) {
            this.score = score;
            this.value = value;
            this.details = details == null ? new LinkedHashMap<>() : details;
            this.issues = issues == null ? new ArrayList<>() : issues;
            this.pending = pending;
        }

        static ScoreBundle done(Double score, String value, Map<String, Object> details, List<String> issues) {
            return new ScoreBundle(score, value, details, issues, false);
        }

        static ScoreBundle pending(String reason) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("reason", reason);
            return new ScoreBundle(null, reason, details, new ArrayList<>(), true);
        }
    }
}
