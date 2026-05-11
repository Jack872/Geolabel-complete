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
public class AddedFeatureDTO {
    @JsonProperty("geometry")
    private Map<String, Object> geometry;

    @JsonProperty("typeId")
    private String typeId;
}
