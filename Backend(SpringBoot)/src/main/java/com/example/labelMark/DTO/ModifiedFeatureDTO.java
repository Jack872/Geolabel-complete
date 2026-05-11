package com.example.labelMark.DTO;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.util.Map;

/**
 * @Description
 * @Author wh
 * @Date 2025/11/17
 */
@Data
public class ModifiedFeatureDTO {
    @JsonProperty("featureId")
    private String featureId;

    @JsonProperty("newGeometry")
    private Map<String, Object> newGeometry;
}
