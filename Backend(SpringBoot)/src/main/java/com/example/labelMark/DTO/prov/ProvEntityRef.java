package com.example.labelMark.DTO.prov;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

// 用于描述输入/输出实体，业务代码不需要创建完整的 ProvEntity 对象
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ProvEntityRef {
    private String businessId; // 必填：业务ID (如 taskId)
    private String entityType; // 必填：类型 (如 TASK)
    private String label;      // 选填：展示名称
    private String location;   // 选填
    private Map<String, Object> attributes; // 选填

    // 快捷构造
    public static ProvEntityRef of(String bizId, String type, String label) {
        return new ProvEntityRef(bizId, type, label, null, null);
    }
}
