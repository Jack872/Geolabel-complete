package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.domain.Model;
import com.example.labelMark.mapper.ModelMapper;
import com.example.labelMark.service.ModelService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * <p>
 * 模型表 服务实现类
 * </p>
 *
 *
 * @since 2024-07-26
 */
@Service
public class ModelServiceImpl extends ServiceImpl<ModelMapper, Model> implements ModelService {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Resource
    private ModelMapper modelMapper;

    @Override
    public List<Map<String, Object>> getModelMapByUserId(Integer userId, String taskType) {
        // 1. 获取模型实体列表
        List<Model> modelList = getModelListByUserId(userId, taskType);
        return convertModelsToMap(modelList);
    }

    @Override
    public List<Map<String, Object>> getModelMapByTaskType(String taskType) {
        List<Model> modelList = getModelListByTaskType(taskType);
        return convertModelsToMap(modelList);
    }

    private List<Map<String, Object>> convertModelsToMap(List<Model> modelList) {
        return modelList.stream()
                .map(model -> {
                    Map<String, Object> map = new HashMap<>();
                    map.put("id", model.getModelId());
                    map.put("name", model.getModelName());
                    map.put("type", model.getModelType());
                    map.put("taskType", model.getTaskType());
                    map.put("inputNum", model.getInputNum());
                    map.put("outputNum", model.getOutputNum());
                    map.put("status", model.getStatus());

                    Map<String, Object> modelMeta = parseModelDes(model.getModelDes());
                    map.put("description", String.valueOf(modelMeta.getOrDefault("description", "")));
                    map.put("details", buildLegacyDetails(modelMeta)); // 兼容老前端的映射解析逻辑
                    map.put("classMapping", modelMeta.getOrDefault("classMapping", new HashMap<>()));
                    map.put("inferParams", modelMeta.getOrDefault("inferParams", new HashMap<>()));
                    map.put("applicableTypeIds", modelMeta.getOrDefault("applicableTypeIds", Collections.emptyList()));
                    return map;
                })
                .collect(Collectors.toList());
    }

    @Override
    public List<Map<String, Object>> getModelMapByUserId(Integer userId) {
        List<Model> modelList = getModelListByUserIdWithoutTaskType(userId);
        return convertModelsToMap(modelList);
    }

    @Override
    public List<Model> getModelListByUserId(Integer userId, String taskType) {
        return modelMapper.selectByUserId(userId, taskType);
    }

    @Override
    public List<Model> getModelListByTaskType(String taskType) {
        Map<Integer, Model> merged = new LinkedHashMap<>();

        if (taskType != null && !taskType.trim().isEmpty()) {
            QueryWrapper<Model> taskTypeQuery = new QueryWrapper<>();
            taskTypeQuery.eq("task_type", taskType.trim());
            list(taskTypeQuery).forEach(model -> merged.put(model.getModelId(), model));
        }

        QueryWrapper<Model> yoloQuery = new QueryWrapper<>();
        yoloQuery.and(wrapper -> wrapper.like("model_type", "yolo").or().like("model_name", "yolo"));
        list(yoloQuery).forEach(model -> merged.put(model.getModelId(), model));

        return merged.values().stream().collect(Collectors.toList());
    }

    @Override
    public List<Model> getModelListByUserIdWithoutTaskType(Integer userId) {
        // 使用QueryWrapper查询所有属于该用户的模型，不过滤任务类型
        QueryWrapper<Model> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("user_id", userId);
        return list(queryWrapper);
    }


    @Override
    public boolean saveModel(Model model) {
        // 设置默认值
        if (model.getStatus() == null) {
            model.setStatus(1);
        }
        return save(model);
    }

    @Override
    public boolean updateModel(Model model) {
        return updateById(model);
    }

    @Override
    public boolean deleteModel(Integer modelId) {
        return removeById(modelId);
    }

    private Map<String, Object> parseModelDes(String rawModelDes) {
        if (rawModelDes == null || rawModelDes.trim().isEmpty()) {
            return new HashMap<>();
        }
        try {
            return OBJECT_MAPPER.readValue(rawModelDes, new TypeReference<Map<String, Object>>() {});
        } catch (Exception ignored) {
            return new HashMap<>();
        }
    }

    @SuppressWarnings("unchecked")
    private String buildLegacyDetails(Map<String, Object> modelMeta) {
        Object classMappingObj = modelMeta.get("classMapping");
        if (!(classMappingObj instanceof Map)) {
            Object desc = modelMeta.get("description");
            return desc == null ? "" : desc.toString();
        }
        Map<String, Object> classMapping = (Map<String, Object>) classMappingObj;
        if (classMapping.isEmpty()) {
            Object desc = modelMeta.get("description");
            return desc == null ? "" : desc.toString();
        }
        // 兼容 markPage 旧逻辑：details 格式 typeId:classIndex;typeId2:classIndex2
        return classMapping.entrySet().stream()
                .map(entry -> {
                    String classIndex = String.valueOf(entry.getKey()).trim();
                    String typeId = String.valueOf(entry.getValue()).trim();
                    return typeId + ":" + classIndex;
                })
                .collect(Collectors.joining(";"));
    }
}
