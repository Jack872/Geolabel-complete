package com.example.labelMark.DTO;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

/**
 * @Description
 * @Author wh
 * @Date 2025/11/17
 */
@Data
public class AuditPassRequestDTO {
    // @JsonProperty 用于将 JSON 中的字段名与 Java 属性名进行映射
    @JsonProperty("taskId")
    private Integer taskId;

    @JsonProperty("corrections")
    private CorrectionsDTO corrections;
}
