package com.example.labelMark.utils;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class QualityDefaults {

    private QualityDefaults() {
    }

    public static List<Map<String, Object>> defaultDimensionConfigs() {
        List<Map<String, Object>> list = new ArrayList<>();
        list.add(dimension("completeness", "完整性", true, Arrays.asList(
                indicator("requiredAttributeMissingRate", "必填属性缺失率", "rule", "<=5%通过，5%-20%预警，>20%失败"),
                indicator("categoryAttributeCompletionRate", "类别属性完整率", "rule", ">=90%通过，70%-90%预警，<70%失败"),
                indicator("referenceFeatureMissingRate", "参考要素漏检率(可选)", "model", "参考模型启用时可计算"),
                indicator("referenceFeatureRedundancyRate", "参考要素冗余率(可选)", "model", "参考模型启用时可计算")
        )));
        list.add(dimension("logicConsistency", "逻辑一致性", true, Arrays.asList(
                indicator("bandConsistencyRate", "波段一致性", "rule", "一致率越高越好"),
                indicator("crsCompletenessRate", "坐标系完整率", "metadata", "元数据有值比例"),
                indicator("crsConsistencyRate", "坐标系一致率", "rule", "以主坐标系为基准"),
                indicator("imageFormatConsistencyRate", "影像格式一致率", "metadata", "以主格式为基准"),
                indicator("annotationFormatMatch", "标注格式匹配", "rule", "与模板期望一致"),
                indicator("exportFormatMatch", "导出格式匹配", "rule", "与模板期望一致"),
                indicator("topologyPassRate", "拓扑规则通过率", "rule", "按配置拓扑规则计算")
        )));
        list.add(dimension("attributeAccuracy", "属性准确性", true, Arrays.asList(
                indicator("attributeValueValidityRate", "属性值合法率", "rule", "按属性类型校验合法性"),
                indicator("manualAttributeAuditAccuracyRate", "人工属性审核准确率", "manual", "无人工抽检时 pending"),
                indicator("referenceClassificationAccuracy", "参考分类准确率(可选)", "model", "参考模型启用时可计算")
        )));
        list.add(dimension("positionalAccuracy", "位置精度", true, Arrays.asList(
                indicator("referenceObjectOverlap", "参考对象重叠度(可选)", "model", "参考模型启用时可计算"),
                indicator("referenceBoundaryDeviation", "参考边界偏差(可选)", "model", "参考模型启用时可计算"),
                indicator("referenceBoundaryPassRate", "参考边界通过率(可选)", "model", "参考模型启用时可计算")
        )));
        list.add(dimension("temporalQuality", "时间质量", true, Arrays.asList(
                indicator("acquisitionTimeCompletenessRate", "采集时间完整率", "metadata", "采集起止时间字段完整率"),
                indicator("timePrecisionCompletenessRate", "时间精度字段完整率", "metadata", "time_precision 非空比例"),
                indicator("timePrecisionIndex", "时间精度指数", "rule", "second>minute>hour>day"),
                indicator("timeValidityRate", "时间有效率", "rule", "起止时间可解析且起止关系有效")
        )));
        list.add(dimension("usabilityQuality", "使用质量", true, Arrays.asList(
                indicator("classBalanceRate", "类别平衡度", "rule", "熵归一化，越高越均衡"),
                indicator("provenanceCompletenessRate", "溯源完整率", "prov", "活动/实体/关系/代理完整性"),
                indicator("auditCoverageRate", "审核覆盖率", "audit", "有审核记录任务占比"),
                indicator("auditRecordCompletenessRate", "审核记录完整率", "audit", "审核关键字段完整率"),
                indicator("auditClosureRate", "审核闭环率", "audit", "已闭环审核占比"),
                indicator("auditIssueDiscoveryRate", "审核问题发现率(信号)", "audit", "仅作为过程信号"),
                indicator("referenceReliabilityLevel", "参考评估可靠性等级", "model", "参考模型启用时可计算")
        )));
        return list;
    }

    /**
     * 历史接口兼容：不再用于总分加权，返回空映射。
     */
    public static Map<String, Object> defaultWeights() {
        return new LinkedHashMap<>();
    }

    /**
     * 新版模板默认指标规则。
     */
    public static Map<String, Object> defaultMetricRules() {
        Map<String, Object> map = new LinkedHashMap<>();

        map.put("completeness.requiredAttributeMissingRate", lowerBetterRule(5, 20, true, false));
        map.put("completeness.categoryAttributeCompletionRate", higherBetterRule(90, 70, true, false));
        map.put("completeness.referenceFeatureMissingRate", lowerBetterRule(10, 25, false, true));
        map.put("completeness.referenceFeatureRedundancyRate", lowerBetterRule(10, 25, false, true));

        map.put("logicConsistency.bandConsistencyRate", higherBetterRule(90, 70, true, false));
        map.put("logicConsistency.crsCompletenessRate", higherBetterRule(95, 80, true, false));
        map.put("logicConsistency.crsConsistencyRate", higherBetterRule(95, 80, true, false));
        map.put("logicConsistency.imageFormatConsistencyRate", higherBetterRule(95, 80, true, false));
        map.put("logicConsistency.annotationFormatMatch", higherBetterRule(100, 100, true, false));
        map.put("logicConsistency.exportFormatMatch", higherBetterRule(100, 100, true, false));
        map.put("logicConsistency.topologyPassRate", higherBetterRule(98, 90, true, false));

        map.put("attributeAccuracy.attributeValueValidityRate", higherBetterRule(95, 85, true, false));
        map.put("attributeAccuracy.manualAttributeAuditAccuracyRate", higherBetterRule(95, 85, false, true));
        map.put("attributeAccuracy.referenceClassificationAccuracy", higherBetterRule(90, 75, false, true));

        map.put("positionalAccuracy.referenceObjectOverlap", higherBetterRule(85, 70, false, true));
        map.put("positionalAccuracy.referenceBoundaryDeviation", lowerBetterRule(15, 30, false, true));
        map.put("positionalAccuracy.referenceBoundaryPassRate", higherBetterRule(85, 70, false, true));

        map.put("temporalQuality.acquisitionTimeCompletenessRate", higherBetterRule(95, 80, true, false));
        map.put("temporalQuality.timePrecisionCompletenessRate", higherBetterRule(95, 80, true, false));
        map.put("temporalQuality.timePrecisionIndex", higherBetterRule(80, 60, true, false));
        map.put("temporalQuality.timeValidityRate", higherBetterRule(95, 80, true, false));

        map.put("usabilityQuality.classBalanceRate", higherBetterRule(80, 60, true, false));
        map.put("usabilityQuality.provenanceCompletenessRate", higherBetterRule(85, 65, true, false));
        map.put("usabilityQuality.auditCoverageRate", higherBetterRule(85, 60, true, false));
        map.put("usabilityQuality.auditRecordCompletenessRate", higherBetterRule(90, 70, true, false));
        map.put("usabilityQuality.auditClosureRate", higherBetterRule(90, 70, true, false));
        map.put("usabilityQuality.auditIssueDiscoveryRate", signalRule());
        map.put("usabilityQuality.referenceReliabilityLevel", higherBetterRule(75, 55, false, true));

        return map;
    }

    public static List<String> defaultEnabledDimensions() {
        return Arrays.asList(
                "completeness",
                "logicConsistency",
                "attributeAccuracy",
                "positionalAccuracy",
                "temporalQuality",
                "usabilityQuality"
        );
    }

    private static Map<String, Object> higherBetterRule(double passMin, double warnMin, boolean hard, boolean optional) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("direction", "high");
        map.put("passMin", passMin);
        map.put("warnMin", warnMin);
        map.put("hard", hard);
        map.put("optional", optional);
        return map;
    }

    private static Map<String, Object> lowerBetterRule(double passMax, double warnMax, boolean hard, boolean optional) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("direction", "low");
        map.put("passMax", passMax);
        map.put("warnMax", warnMax);
        map.put("hard", hard);
        map.put("optional", optional);
        return map;
    }

    private static Map<String, Object> signalRule() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("mode", "signal");
        map.put("hard", false);
        map.put("optional", true);
        return map;
    }

    private static Map<String, Object> dimension(String key, String label, boolean enabled, List<Map<String, Object>> indicators) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("key", key);
        map.put("label", label);
        map.put("enabled", enabled);
        map.put("indicators", indicators);
        return map;
    }

    private static Map<String, Object> indicator(String key, String label, String sourceType, String thresholdRule) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("key", key);
        map.put("label", label);
        map.put("sourceType", sourceType);
        map.put("thresholdRule", thresholdRule);
        return map;
    }
}
