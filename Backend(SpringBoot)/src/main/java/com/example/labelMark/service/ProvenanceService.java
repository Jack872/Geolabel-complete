package com.example.labelMark.service;

import com.example.labelMark.DTO.prov.ProvEntityRef;

import java.util.Collections;
import java.util.List;
import java.util.Map;

public interface ProvenanceService {

    /**
     * 核心方法：记录一次完整的溯源活动
     *
     * @param actType 活动类型 (UPLOAD, ANNOTATE...)
     * @param agentId 执行人ID (用户ID 或 系统ID)
     * @param agentType 执行人类型 (PERSON, SOFTWARE)
     * @param inputs 输入实体列表 (USED)
     * @param outputs 输出实体列表 (GENERATED)
     * @param params 活动参数 (如 {cropSize: 256})
     * @return 本次 Activity 的 ID
     */
    String recordActivity(
            String actType,
            String agentId,
            String agentType,
            List<ProvEntityRef> inputs,
            List<ProvEntityRef> outputs,
            Map<String, Object> params
    );

    // 快捷重载：单输入单输出
    default String recordActivity(String actType, String agentId, String agentType,
                                  ProvEntityRef input, ProvEntityRef output, Map<String, Object> params) {
        return recordActivity(actType, agentId, agentType,
                input != null ? Collections.singletonList(input) : Collections.emptyList(),
                output != null ? Collections.singletonList(output) : Collections.emptyList(),
                params);
    }

    /**
     * 根据 business_id + entity_type 精准删除溯源实体，并清理关联关系与孤儿活动
     *
     * @param businessIds 业务主键列表（如 task_id/file_id/sample_set_id）
     * @param entityTypes 实体类型列表（如 TASK/RAW_IMAGE/SAMPLE_SET）
     */
    void deleteByBusinessIdsAndTypes(List<String> businessIds, List<String> entityTypes);
}
