package com.example.labelMark.DTO.TDML;

import lombok.Data;

import java.util.HashMap;
import java.util.Map;

@Data
public class TdmlExportOptions {
    private String shareMode = "relative_path";
    private String baseUrl;
    private boolean validateSchema = false;
    private String schemaPath;
    private String defaultSplit = "train";
    private Map<String, String> splitMapping = new HashMap<>();
}
