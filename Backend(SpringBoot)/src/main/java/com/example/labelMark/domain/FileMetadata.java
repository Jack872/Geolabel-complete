package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

@Getter
@Setter
@TableName("file_metadata")
public class FileMetadata implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "file_id", type = IdType.INPUT)
    private Integer fileId;

    @TableField("crs_code")
    private String crsCode;

    @TableField("crs_name")
    private String crsName;

    @TableField("acquisition_time_start")
    private String acquisitionTimeStart;

    @TableField("acquisition_time_end")
    private String acquisitionTimeEnd;

    @TableField("time_precision")
    private String timePrecision;

    @TableField("time_zone")
    private String timeZone;

    @TableField("sensor_platform")
    private String sensorPlatform;

    @TableField("provider")
    private String provider;

    @TableField("band_count")
    private Integer bandCount;

    @TableField("bands_json")
    private String bandsJson;

    @TableField("width_px")
    private Integer widthPx;

    @TableField("height_px")
    private Integer heightPx;

    @TableField("pixel_size_x")
    private Double pixelSizeX;

    @TableField("pixel_size_y")
    private Double pixelSizeY;

    @TableField("data_type")
    private String dataType;

    @TableField("nodata_value")
    private String nodataValue;

    @TableField("cloud_cover")
    private Double cloudCover;

    @TableField("processing_level")
    private String processingLevel;

    @TableField("license")
    private String license;

    @TableField("usage_scope")
    private String usageScope;

    @TableField("upload_description")
    private String uploadDescription;

    @TableField("remark")
    private String remark;

    @TableField("ext")
    private String ext;
}
