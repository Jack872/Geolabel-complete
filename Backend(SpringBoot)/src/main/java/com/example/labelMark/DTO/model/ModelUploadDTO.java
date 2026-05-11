package com.example.labelMark.DTO.model;

import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
public class ModelUploadDTO {
    private String framework;
    private String arch;
    private String variant;
    private String backbone;
    private String encoder;
    private String checkpointFormat;
    private String weightFormat;
    private Integer inputChannels;
    private Integer numClasses;
    private Map<String, Object> constructorArgs;
    private Map<String, Object> inferParams;
    private Map<String, Object> classMapping;
    private Map<String, Object> supports;
    private List<Object> applicableTypeIds;
    private String versionTag;
    private String description;
}
