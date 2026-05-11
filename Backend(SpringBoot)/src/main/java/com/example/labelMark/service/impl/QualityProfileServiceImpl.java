package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.DTO.quality.QualityProfileSaveRequest;
import com.example.labelMark.domain.QualityProfile;
import com.example.labelMark.mapper.QualityProfileMapper;
import com.example.labelMark.service.QualityProfileService;
import com.example.labelMark.utils.QualityDefaults;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class QualityProfileServiceImpl extends ServiceImpl<QualityProfileMapper, QualityProfile> implements QualityProfileService {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public List<Map<String, Object>> listProfiles(String taskType, Boolean onlyActive) {
        QueryWrapper<QualityProfile> wrapper = new QueryWrapper<>();
        if (taskType != null && !taskType.trim().isEmpty()) {
            wrapper.eq("task_type", taskType.trim());
        }
        if (Boolean.TRUE.equals(onlyActive)) {
            wrapper.eq("is_active", true);
        }
        wrapper.orderByDesc("updated_time").orderByDesc("id");
        List<QualityProfile> profiles = list(wrapper);
        List<Map<String, Object>> result = new ArrayList<>();
        for (QualityProfile profile : profiles) {
            result.add(toMap(profile));
        }
        return result;
    }

    @Override
    public Map<String, Object> getProfileDetail(Long id) {
        QualityProfile profile = getById(id);
        return profile == null ? null : toMap(profile);
    }

    @Override
    public Map<String, Object> saveProfile(QualityProfileSaveRequest request, String operator) {
        QualityProfile entity = request.getId() == null ? new QualityProfile() : getById(request.getId());
        if (entity == null) {
            entity = new QualityProfile();
        }
        String profileName = trimToNull(request.getProfileName());
        if (profileName == null) {
            profileName = trimToNull(request.getName());
        }
        entity.setName(profileName == null ? "默认质量模板" : profileName);
        entity.setTaskType(trimToNull(request.getTaskType()));
        entity.setExpectedBands(writeJson(request.getExpectedBands()));
        entity.setExpectedExportFormat(trimToNull(request.getExpectedExportFormat()));
        entity.setExpectedAnnotationFormat(trimToNull(request.getExpectedAnnotationFormat()));
        entity.setRequiredFields(writeJson(request.getRequiredFields()));
        entity.setTopologyRules(writeJson(request.getTopologyRules()));
        entity.setAttributeAuditMode(trimToNull(request.getAttributeAuditMode()));
        List<Map<String, Object>> normalizedDimensionConfigs = normalizeDimensionConfigs(request.getDimensionConfigs(), request.getEnabledDimensions());
        entity.setDimensionConfigs(writeJson(normalizedDimensionConfigs));
        Map<String, Object> metricRules = request.getMetricRules() == null ? QualityDefaults.defaultMetricRules() : request.getMetricRules();
        entity.setWeights(writeJson(metricRules));
        entity.setIsActive(request.getIsActive() == null ? true : request.getIsActive());
        entity.setVersion(request.getVersion() == null ? 1 : request.getVersion());
        if (entity.getId() == null) {
            entity.setCreatedBy(operator);
            entity.setCreatedTime(new Date());
        }
        entity.setUpdatedTime(new Date());
        saveOrUpdate(entity);
        return toMap(entity);
    }

    @Override
    public Map<String, Object> updateProfile(Long id, QualityProfileSaveRequest request, String operator) {
        if (id == null) {
            throw new IllegalArgumentException("质量模板ID不能为空");
        }
        request.setId(id);
        return saveProfile(request, operator);
    }

    private Map<String, Object> toMap(QualityProfile profile) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", profile.getId());
        map.put("profileName", profile.getName());
        map.put("name", profile.getName());
        map.put("taskType", profile.getTaskType());
        map.put("expectedBands", parseList(profile.getExpectedBands()));
        map.put("expectedExportFormat", profile.getExpectedExportFormat());
        map.put("expectedAnnotationFormat", profile.getExpectedAnnotationFormat());
        map.put("requiredFields", parseList(profile.getRequiredFields()));
        map.put("topologyRules", parseList(profile.getTopologyRules()));
        map.put("attributeAuditMode", profile.getAttributeAuditMode());
        List<Map<String, Object>> dimensionConfigs = parseObjectList(profile.getDimensionConfigs());
        map.put("dimensionConfigs", dimensionConfigs);
        List<String> enabledDimensions = dimensionConfigs.stream()
                .filter(item -> asBoolean(item.get("enabled"), true))
                .map(item -> String.valueOf(item.get("key")))
                .collect(Collectors.toList());
        map.put("enabledDimensions", enabledDimensions);
        Map<String, Object> metricRules = parseMap(profile.getWeights());
        if (metricRules.isEmpty()) {
            metricRules = QualityDefaults.defaultMetricRules();
        }
        map.put("metricRules", metricRules);
        map.put("weights", metricRules);
        map.put("isActive", profile.getIsActive());
        map.put("version", profile.getVersion());
        map.put("createdBy", profile.getCreatedBy());
        map.put("createdTime", profile.getCreatedTime());
        map.put("updatedTime", profile.getUpdatedTime());
        return map;
    }

    private String writeJson(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ignored) {
            return null;
        }
    }

    private List<String> parseList(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return new ArrayList<>();
        }
        try {
            return objectMapper.readValue(raw, new TypeReference<List<String>>() {});
        } catch (Exception ignored) {
            return new ArrayList<>();
        }
    }

    private List<Map<String, Object>> parseObjectList(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return new ArrayList<>();
        }
        try {
            return objectMapper.readValue(raw, new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception ignored) {
            return new ArrayList<>();
        }
    }

    private Map<String, Object> parseMap(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return Collections.emptyMap();
        }
        try {
            return objectMapper.readValue(raw, new TypeReference<Map<String, Object>>() {});
        } catch (Exception ignored) {
            return Collections.emptyMap();
        }
    }

    private String trimToNull(String raw) {
        if (raw == null) {
            return null;
        }
        String val = raw.trim();
        return val.isEmpty() ? null : val;
    }

    private List<Map<String, Object>> normalizeDimensionConfigs(List<Map<String, Object>> dimensionConfigs, List<String> enabledDimensions) {
        List<Map<String, Object>> base = (dimensionConfigs == null || dimensionConfigs.isEmpty())
                ? QualityDefaults.defaultDimensionConfigs()
                : dimensionConfigs;
        Set<String> enabledSet = enabledDimensions == null
                ? Collections.emptySet()
                : enabledDimensions.stream().filter(item -> item != null && !item.trim().isEmpty()).collect(Collectors.toSet());
        List<Map<String, Object>> normalized = new ArrayList<>();
        for (Map<String, Object> item : base) {
            if (item == null) {
                continue;
            }
            Map<String, Object> row = new LinkedHashMap<>(item);
            if (!enabledSet.isEmpty() && row.get("key") != null) {
                row.put("enabled", enabledSet.contains(String.valueOf(row.get("key"))));
            } else if (row.get("enabled") == null) {
                row.put("enabled", true);
            }
            Object keyRaw = row.get("key");
            String dimensionKey = keyRaw == null ? null : String.valueOf(keyRaw);
            row.put("indicators", sanitizeIndicators(dimensionKey, row.get("indicators")));
            normalized.add(row);
        }
        return normalized;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> sanitizeIndicators(String dimensionKey, Object indicatorsRaw) {
        if (!(indicatorsRaw instanceof List)) {
            return new ArrayList<>();
        }
        List<Map<String, Object>> sanitized = new ArrayList<>();
        for (Object raw : (List<?>) indicatorsRaw) {
            if (!(raw instanceof Map)) {
                continue;
            }
            Map<String, Object> indicator = new LinkedHashMap<>((Map<String, Object>) raw);
            if (shouldDropAuditIndicator(dimensionKey, indicator)) {
                continue;
            }
            sanitized.add(indicator);
        }
        return sanitized;
    }

    @SuppressWarnings("unchecked")
    private boolean shouldDropAuditIndicator(String dimensionKey, Map<String, Object> indicator) {
        if ("usabilityQuality".equals(dimensionKey)) {
            return false;
        }
        String key = parseString(indicator.get("key"));
        if (key != null && key.toLowerCase().startsWith("audit")) {
            return true;
        }
        String sourceType = parseString(indicator.get("sourceType"));
        if ("audit".equalsIgnoreCase(sourceType)) {
            return true;
        }
        Object sourcesRaw = indicator.get("sources");
        if (sourcesRaw instanceof List) {
            for (Object source : (List<?>) sourcesRaw) {
                if (source != null && "audit".equalsIgnoreCase(String.valueOf(source))) {
                    return true;
                }
            }
        }
        return false;
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

    private String parseString(Object raw) {
        if (raw == null) {
            return null;
        }
        String val = String.valueOf(raw).trim();
        return val.isEmpty() ? null : val;
    }
}
