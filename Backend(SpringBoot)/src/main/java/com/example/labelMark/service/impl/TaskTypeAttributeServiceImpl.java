package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.domain.TaskTypeAttribute;
import com.example.labelMark.mapper.TaskTypeAttributeMapper;
import com.example.labelMark.service.TaskTypeAttributeService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class TaskTypeAttributeServiceImpl extends ServiceImpl<TaskTypeAttributeMapper, TaskTypeAttribute> implements TaskTypeAttributeService {
    private static final Map<Integer, List<Map<String, Object>>> TASK_TYPE_ATTR_CACHE = new ConcurrentHashMap<>();

    @Resource
    private TaskTypeAttributeMapper taskTypeAttributeMapper;

    @Override
    public void replaceTaskTypeAttributes(Integer taskId, List<Map<String, Object>> configList) {
        if (taskId == null) {
            return;
        }
        this.remove(new QueryWrapper<TaskTypeAttribute>().eq("task_id", taskId));

        if (configList != null && !configList.isEmpty()) {
            int seq = 1;
            for (Map<String, Object> row : configList) {
                Integer typeId = parseInteger(row.get("typeId"));
                Integer attrId = parseInteger(row.get("attrId"));
                if (typeId == null || attrId == null) {
                    continue;
                }
                TaskTypeAttribute entity = new TaskTypeAttribute();
                entity.setTaskId(taskId);
                entity.setTypeId(typeId);
                entity.setAttrId(attrId);
                entity.setIsRequired(parseBoolean(row.get("isRequired")));
                Integer displayOrder = parseInteger(row.get("displayOrder"));
                entity.setDisplayOrder(displayOrder == null ? seq : displayOrder);
                entity.setPlaceholder(parseString(row.get("placeholder")));
                entity.setRemark(parseString(row.get("remark")));
                this.save(entity);
                seq++;
            }
        }
        TASK_TYPE_ATTR_CACHE.remove(taskId);
    }

    @Override
    public List<Map<String, Object>> getTaskTypeAttributeDetails(Integer taskId, Integer typeId) {
        if (taskId == null) {
            return new ArrayList<>();
        }
        List<Map<String, Object>> cached = TASK_TYPE_ATTR_CACHE.get(taskId);
        if (cached == null) {
            List<Map<String, Object>> fromDb = taskTypeAttributeMapper.selectTaskTypeAttributeDetails(taskId, null);
            cached = fromDb == null ? new ArrayList<>() : normalizeRows(fromDb);
            TASK_TYPE_ATTR_CACHE.put(taskId, cached);
        }
        if (typeId == null) {
            return new ArrayList<>(cached);
        }
        final Integer expect = typeId;
        return cached.stream()
                .filter(row -> expect.equals(parseInteger(row.get("typeId"))))
                .collect(Collectors.toList());
    }

    private List<Map<String, Object>> normalizeRows(List<Map<String, Object>> rows) {
        List<Map<String, Object>> list = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> normalized = new HashMap<>();
            normalized.put("id", row.get("id"));
            normalized.put("taskId", parseInteger(row.get("task_id")));
            normalized.put("typeId", parseInteger(row.get("type_id")));
            normalized.put("attrId", parseInteger(row.get("attr_id")));
            normalized.put("isRequired", parseBoolean(row.get("is_required")));
            normalized.put("displayOrder", parseInteger(row.get("display_order")));
            normalized.put("placeholder", parseString(row.get("placeholder")));
            normalized.put("remark", parseString(row.get("remark")));
            normalized.put("attrKey", parseString(row.get("attr_key")));
            normalized.put("attrName", parseString(row.get("attr_name")));
            normalized.put("dataType", parseString(row.get("data_type")));
            normalized.put("enumOptionsJson", parseString(row.get("enum_options_json")));
            normalized.put("unit", parseString(row.get("unit")));
            list.add(normalized);
        }
        return list;
    }

    private Integer parseInteger(Object raw) {
        if (raw == null) return null;
        try {
            return Integer.valueOf(String.valueOf(raw));
        } catch (Exception ignored) {
            return null;
        }
    }

    private Boolean parseBoolean(Object raw) {
        if (raw == null) return false;
        if (raw instanceof Boolean) return (Boolean) raw;
        String val = String.valueOf(raw).trim();
        if (val.isEmpty()) return false;
        if ("1".equals(val)) return true;
        return "true".equalsIgnoreCase(val) || "yes".equalsIgnoreCase(val);
    }

    private String parseString(Object raw) {
        if (raw == null) return null;
        String val = String.valueOf(raw);
        return val.trim().isEmpty() ? null : val;
    }
}

