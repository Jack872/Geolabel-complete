package com.example.labelMark.DTO;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

/**
 * @Description
 * @Author wh
 * @Date 2025/9/17
 */
@Getter
@Setter
@NoArgsConstructor
public class MergeMultipartRequest {
    private String fileName;
    private String uploadId;
    private String setName;
    private String fileSize;
    private Integer datasetId;
    private List<PartETagDTO> partETags;
    private String description;
    private String coordinateSystem;

    // file_metadata fields
    private String crsName;
    private String acquisitionTimeStart;
    private String acquisitionTimeEnd;
    private String timePrecision;
    private String timeZone;
    private String sensorPlatform;
    private String provider;
    private Integer bandCount;
    private String bandsJson;
    private Integer widthPx;
    private Integer heightPx;
    private Double pixelSizeX;
    private Double pixelSizeY;
    private String dataType;
    private String nodataValue;
    private Double cloudCover;
    private String processingLevel;
    private String license;
    private String usageScope;
    private String remark;
}
