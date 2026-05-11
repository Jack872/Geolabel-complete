package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.DTO.quality.QualityEvaluationResultDTO;
import com.example.labelMark.domain.QualityReport;
import com.example.labelMark.mapper.QualityReportMapper;
import com.example.labelMark.service.QualityReportService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.text.DecimalFormat;
import java.text.SimpleDateFormat;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class QualityReportServiceImpl extends ServiceImpl<QualityReportMapper, QualityReport> implements QualityReportService {

    private static final DecimalFormat NUMBER_FORMAT = new DecimalFormat("0.00");
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public QualityReport saveReport(Integer sampleSetId,
                                    Long qualityProfileId,
                                    Integer referenceModelId,
                                    String creator,
                                    QualityEvaluationResultDTO result) {
        QualityReport report = new QualityReport();
        report.setSampleSetId(sampleSetId);
        report.setQualityProfileId(qualityProfileId);
        report.setReferenceModelId(referenceModelId);
        report.setCreator(creator);
        report.setSummary(result.getSummary());
        report.setCreatedTime(new Date());
        report.setResultJson(writeJson(result));
        save(report);
        return report;
    }

    @Override
    public Map<String, Object> getReportDetail(Long reportId) {
        QualityReport report = getById(reportId);
        if (report == null) {
            return null;
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("id", report.getId());
        data.put("sampleSetId", report.getSampleSetId());
        data.put("qualityProfileId", report.getQualityProfileId());
        data.put("referenceModelId", report.getReferenceModelId());
        data.put("creator", report.getCreator());
        data.put("summary", report.getSummary());
        data.put("createdTime", report.getCreatedTime());
        data.put("result", parseJson(report.getResultJson()));
        return data;
    }

    @Override
    @SuppressWarnings("unchecked")
    public String renderReportHtml(Long reportId) {
        Map<String, Object> reportData = getReportDetail(reportId);
        if (reportData == null) {
            return "<html><body><h3>报告不存在</h3></body></html>";
        }
        Map<String, Object> result = (Map<String, Object>) reportData.getOrDefault("result", Collections.emptyMap());
        Map<String, Object> sampleInfo = (Map<String, Object>) result.getOrDefault("sampleSetBasicInfo", Collections.emptyMap());
        Map<String, Object> referenceModel = (Map<String, Object>) result.getOrDefault("referenceModel", Collections.emptyMap());
        List<Map<String, Object>> dimensions = (List<Map<String, Object>>) result.getOrDefault("dimensionResults", result.getOrDefault("dimensions", Collections.emptyList()));
        List<Map<String, Object>> issues = (List<Map<String, Object>>) result.getOrDefault("issues", Collections.emptyList());
        List<String> opinions = (List<String>) result.getOrDefault("opinions", Collections.emptyList());
        String generatedAt = reportData.get("createdTime") instanceof Date
                ? new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format((Date) reportData.get("createdTime"))
                : "-";

        StringBuilder html = new StringBuilder();
        html.append("<!DOCTYPE html><html><head><meta charset='UTF-8'><title>质量评价报告</title>");
        html.append("<style>");
        html.append("body{font-family:'Microsoft YaHei',sans-serif;padding:20px;color:#1f2937;background:#f6f8fb;}");
        html.append(".card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:12px;}");
        html.append(".grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}");
        html.append(".muted{color:#6b7280;} .tag{display:inline-block;padding:2px 8px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:12px;}");
        html.append("table{width:100%;border-collapse:collapse;} th,td{border-bottom:1px solid #e5e7eb;padding:8px;text-align:left;}");
        html.append(".status-pass{color:#15803d;font-weight:600;} .status-warning{color:#b45309;font-weight:600;} .status-fail{color:#b91c1c;font-weight:600;} .status-pending{color:#6b7280;font-weight:600;}");
        html.append("h1,h2,h3{margin:0 0 10px;} ul{margin:6px 0 0 18px;} .dim{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:10px;}");
        html.append("</style></head><body>");

        html.append("<div class='card'><h1>质量评价报告</h1>");
        html.append("<div class='muted'>生成时间：").append(generatedAt).append("</div>");
        html.append("<div class='grid'>");
        html.append("<div><strong>样本集名称</strong><div>").append(escapeHtml(String.valueOf(sampleInfo.getOrDefault("sampleSetName", "-")))).append("</div></div>");
        html.append("<div><strong>任务类型</strong><div>").append(escapeHtml(String.valueOf(sampleInfo.getOrDefault("taskType", "-")))).append("</div></div>");
        html.append("<div><strong>样本量</strong><div>").append(escapeHtml(String.valueOf(sampleInfo.getOrDefault("sampleCount", "-")))).append("</div></div>");
        html.append("<div><strong>模板名称</strong><div>").append(escapeHtml(String.valueOf(result.getOrDefault("profileName", "-")))).append("</div></div>");
        html.append("<div><strong>模板ID</strong><div>").append(escapeHtml(String.valueOf(reportData.getOrDefault("qualityProfileId", "-")))).append("</div></div>");
        html.append("<div><strong>最终建议</strong><div>").append(escapeHtml(String.valueOf(result.getOrDefault("finalSuggestion", "-")))).append("</div></div>");
        html.append("</div></div>");

        html.append("<div class='card'><h2>维度结果</h2>");
        if (dimensions == null || dimensions.isEmpty()) {
            html.append("<div class='muted'>暂无维度评价结果</div>");
        } else {
            for (Map<String, Object> dimension : dimensions) {
                String status = String.valueOf(dimension.getOrDefault("status", "pending"));
                String statusCls = "status-" + ("pass".equals(status) ? "pass" : "warning".equals(status) ? "warning" : "fail".equals(status) ? "fail" : "pending");
                html.append("<div class='dim'>");
                html.append("<h3>").append(escapeHtml(String.valueOf(dimension.getOrDefault("dimensionName", dimension.getOrDefault("label", "-"))))).append("</h3>");
                html.append("<div>维度结论：<span class='").append(statusCls).append("'>").append(escapeHtml(String.valueOf(dimension.getOrDefault("conclusionText", status)))).append("</span></div>");
                html.append("<div style='margin-top:6px'>建议：").append(escapeHtml(String.valueOf(dimension.getOrDefault("suggestionText", "-")))).append("</div>");
                html.append("<div class='muted' style='margin-top:4px'>证据：").append(escapeHtml(String.valueOf(dimension.getOrDefault("evidenceSummary", "-")))).append("</div>");
                List<Map<String, Object>> metrics = (List<Map<String, Object>>) dimension.getOrDefault("metrics", dimension.getOrDefault("indicators", Collections.emptyList()));
                html.append("<table><thead><tr><th>指标</th><th>计算值</th><th>阈值/规则</th><th>状态</th><th>来源</th></tr></thead><tbody>");
                for (Map<String, Object> metric : metrics) {
                    html.append("<tr>");
                    html.append("<td>").append(escapeHtml(String.valueOf(metric.getOrDefault("metricName", metric.getOrDefault("label", "-"))))).append("</td>");
                    html.append("<td>").append(escapeHtml(String.valueOf(metric.getOrDefault("value", "-")))).append("</td>");
                    html.append("<td>").append(escapeHtml(String.valueOf(metric.getOrDefault("thresholdRule", "-")))).append("</td>");
                    html.append("<td>").append(escapeHtml(String.valueOf(metric.getOrDefault("status", "-")))).append("</td>");
                    html.append("<td>").append(escapeHtml(String.valueOf(metric.getOrDefault("sourceType", "-")))).append("</td>");
                    html.append("</tr>");
                }
                html.append("</tbody></table>");
                html.append("</div>");
            }
        }
        html.append("</div>");

        html.append("<div class='card'><h2>参考模型证据（非真值）</h2>");
        if (referenceModel == null || referenceModel.isEmpty() || !Boolean.TRUE.equals(referenceModel.get("enabled"))) {
            html.append("<div class='muted'>本次未启用参考模型。</div>");
        } else {
            html.append("<div class='grid'>");
            html.append("<div><strong>模型名称</strong><div>").append(escapeHtml(String.valueOf(referenceModel.getOrDefault("modelName", "-")))).append("</div></div>");
            html.append("<div><strong>模型版本</strong><div>").append(escapeHtml(String.valueOf(referenceModel.getOrDefault("modelVersion", "-")))).append("</div></div>");
            html.append("<div><strong>可靠性等级</strong><div>").append(escapeHtml(String.valueOf(referenceModel.getOrDefault("referenceReliabilityLevel", "-")))).append("</div></div>");
            html.append("<div><strong>coverageRate</strong><div>").append(formatPercent(referenceModel.get("coverageRate"))).append("</div></div>");
            html.append("<div><strong>confidenceMean</strong><div>").append(formatPercent(referenceModel.get("confidenceMean"))).append("</div></div>");
            html.append("<div><strong>lowConfidenceRatio</strong><div>").append(formatPercent(referenceModel.get("lowConfidenceRatio"))).append("</div></div>");
            html.append("</div>");
            List<Map<String, Object>> previewItems = (List<Map<String, Object>>) referenceModel.getOrDefault("previewItems", Collections.emptyList());
            html.append("<div style='margin-top:8px'>样本预览摘要：").append(previewItems == null ? 0 : previewItems.size()).append(" 个样本</div>");
            if (previewItems != null && !previewItems.isEmpty()) {
                html.append("<table style='margin-top:8px'><thead><tr><th>样本</th><th>预览类型</th><th>平均置信度</th><th>类别覆盖率</th></tr></thead><tbody>");
                int limit = Math.min(previewItems.size(), 5);
                for (int i = 0; i < limit; i++) {
                    Map<String, Object> item = previewItems.get(i);
                    Map<String, Object> confidence = item.get("confidenceSummary") instanceof Map
                            ? (Map<String, Object>) item.get("confidenceSummary") : Collections.emptyMap();
                    Map<String, Object> classSummary = item.get("classSummary") instanceof Map
                            ? (Map<String, Object>) item.get("classSummary") : Collections.emptyMap();
                    html.append("<tr>");
                    html.append("<td>").append(escapeHtml(String.valueOf(item.getOrDefault("sliceFileName", item.getOrDefault("sampleId", "-"))))).append("</td>");
                    html.append("<td>").append(escapeHtml(String.valueOf(item.getOrDefault("previewType", item.getOrDefault("overlayType", "-"))))).append("</td>");
                    html.append("<td>").append(escapeHtml(String.valueOf(confidence.getOrDefault("mean", "-")))).append("</td>");
                    html.append("<td>").append(escapeHtml(String.valueOf(classSummary.getOrDefault("classCoverageRate", "-")))).append("</td>");
                    html.append("</tr>");
                }
                html.append("</tbody></table>");
            }
        }
        html.append("</div>");

        html.append("<div class='card'><h2>问题清单与自动意见</h2>");
        html.append("<div><strong>问题清单</strong></div>");
        if (issues == null || issues.isEmpty()) {
            html.append("<div class='muted'>当前未发现问题。</div>");
        } else {
            html.append("<ul>");
            for (Map<String, Object> issue : issues) {
                html.append("<li>").append(escapeHtml(String.valueOf(issue.getOrDefault("message", "-")))).append("</li>");
            }
            html.append("</ul>");
        }
        html.append("<div style='margin-top:10px'><strong>自动意见</strong></div>");
        if (opinions == null || opinions.isEmpty()) {
            html.append("<div class='muted'>暂未生成自动意见。</div>");
        } else {
            html.append("<ul>");
            for (String opinion : opinions) {
                html.append("<li>").append(escapeHtml(opinion)).append("</li>");
            }
            html.append("</ul>");
        }
        html.append("</div>");

        html.append("</body></html>");
        return html.toString();
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("质量报告序列化失败", e);
        }
    }

    private Map<String, Object> parseJson(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return Collections.emptyMap();
        }
        try {
            return objectMapper.readValue(raw, new TypeReference<Map<String, Object>>() {});
        } catch (Exception ignored) {
            return Collections.emptyMap();
        }
    }

    private String formatPercent(Object value) {
        if (!(value instanceof Number)) {
            return "-";
        }
        return NUMBER_FORMAT.format(((Number) value).doubleValue()) + "%";
    }

    private String escapeHtml(String raw) {
        return raw == null ? "" : raw
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }
}
