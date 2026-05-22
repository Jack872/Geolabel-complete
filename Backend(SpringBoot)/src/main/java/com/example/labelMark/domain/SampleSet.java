package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableField;
import com.fasterxml.jackson.annotation.JsonInclude;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.util.Date;

@Getter
@Setter
@TableName("sampleset") // 请替换为您的实际表名
@ApiModel(value = "SampleSet对象", description = "") // 描述请根据实际情况修改
@JsonInclude(JsonInclude.Include.NON_NULL)
public class SampleSet implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Integer id;

    @TableField("name")
    private String name;

    @TableField("num")
    private Integer num;

    @ApiModelProperty("描述")
    @TableField("description")
    private String description;

    @TableField("task_type")
    private String taskType;

    @TableField("creator")
    private String creator;

    @TableField("type")
    private String type;

    @TableField("task_ids")
    private String taskIds;

    @TableField("width")
    private Integer width;

    @TableField("height") // 注意：原字段名为heigth，这里假设是一个笔误并修正为height
    private Integer height;

    @TableField("thumb_url")
    private String thumbUrl;

    @TableField("label_url")
    private String labelUrl;

    @TableField("image_url")
    private String imageUrl;

    @TableField("export_object_key")
    private String exportObjectKey;

    @TableField("crs")
    private String crs;

    @ApiModelProperty("是否公开")
    @TableField("is_public")
    private Boolean isPublic;

    @ApiModelProperty("创建日期")
    @TableField("create_date")
    private Date createDate; // 类型调整为Date
}
