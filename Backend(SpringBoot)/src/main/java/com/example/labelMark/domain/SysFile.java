package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.io.Serializable;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * <p>
 *
 * </p>
 *
 */
@Getter
@Setter
@TableName("file")
@ApiModel(value = "File对象", description = "")
public class SysFile implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "file_id", type = IdType.AUTO)
    private Integer fileId;

    @TableField("file_name")
    private String fileName;

    @TableField("update_time")
    private String updateTime;

    @TableField("status")
    private Integer status;

    @TableField("size")
    private String size;

    @ApiModelProperty("用户ID")
    @TableField("user_id")
    private Integer userId;

    @ApiModelProperty("影像集名称")
    @TableField("set_name")
    private String setName;
    @ApiModelProperty("数据集ID")
    @TableField("dataset_id")
    private Integer datasetId;

    // ==== upload-time metadata fields (from file_metadata join) ====
    @TableField(exist = false)
    private String crsCode;

    @TableField(exist = false)
    private String crsName;

    @TableField(exist = false)
    private String acquisitionTimeStart;

    @TableField(exist = false)
    private String acquisitionTimeEnd;

    @TableField(exist = false)
    private String timePrecision;

    @TableField(exist = false)
    private String timeZone;

    @TableField(exist = false)
    private String sensorPlatform;

    @TableField(exist = false)
    private String provider;

    @TableField(exist = false)
    private Integer bandCount;

    @TableField(exist = false)
    private String bandsJson;

    @TableField(exist = false)
    private Integer widthPx;

    @TableField(exist = false)
    private Integer heightPx;

    @TableField(exist = false)
    private Double pixelSizeX;

    @TableField(exist = false)
    private Double pixelSizeY;

    @TableField(exist = false)
    private String dataType;

    @TableField(exist = false)
    private String nodataValue;

    @TableField(exist = false)
    private Double cloudCover;

    @TableField(exist = false)
    private String processingLevel;

    @TableField(exist = false)
    private String license;

    @TableField(exist = false)
    private String usageScope;

    @TableField(exist = false)
    private String uploadDescription;

    @TableField(exist = false)
    private String remark;

    @TableField(exist = false)
    private String ext;

}
