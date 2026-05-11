package com.example.labelMark.DTO;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

/**
 * @Description
 * @Author wh
 * @Date 2025/11/17
 */
@Data
public class ReclassifiedFeatureDTO {
    @JsonProperty("featureId")
    private String featureId;
    @JsonProperty("newTypeId")
    private String newTypeId;
}
