package com.example.labelMark.DTO;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.util.List;

/**
 * @Description
 * @Author wh
 * @Date 2025/11/17
 */
@Data
public class CorrectionsDTO {

    @JsonProperty("deleted_feature_ids")
    private List<String> deletedFeatureIds; // 使用 String 类型来接收 ID 更安全，可以兼容数字、UUID 等

    @JsonProperty("reclassified_features")
    private List<ReclassifiedFeatureDTO> reclassifiedFeatures;

    @JsonProperty("added_features")
    private List<AddedFeatureDTO> addedFeatures;

    @JsonProperty("modified_features")
    private List<ModifiedFeatureDTO> modifiedFeatures;
}
