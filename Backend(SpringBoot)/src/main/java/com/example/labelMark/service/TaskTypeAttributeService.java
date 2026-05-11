package com.example.labelMark.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.example.labelMark.domain.TaskTypeAttribute;

import java.util.List;
import java.util.Map;

public interface TaskTypeAttributeService extends IService<TaskTypeAttribute> {
    void replaceTaskTypeAttributes(Integer taskId, List<Map<String, Object>> configList);
    List<Map<String, Object>> getTaskTypeAttributeDetails(Integer taskId, Integer typeId);
}

