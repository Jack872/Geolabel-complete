package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Data;
import java.io.Serializable;
import java.util.Date;
import java.util.Map;

@Data
@TableName(value = "prov_entity", autoResultMap = true) // autoResultMap 必须为 true 才能自动映射 JSON
@ApiModel(value = "ProvEntity对象", description = "溯源实体表：记录流程中产生的数据产物")
public class ProvEntity implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.ASSIGN_UUID)
    @ApiModelProperty("实体ID (UUID)")
    private String id;

    @TableField("label")
    @ApiModelProperty("实体显示名称 (如: 原始影像.tif)")
    private String label;

    @TableField("entity_type")
    @ApiModelProperty("实体类型 (RAW_IMAGE, TASK, ANNOTATION, SAMPLE_SET)")
    private String entityType;

    @TableField("business_id")
    @ApiModelProperty("关联业务表主键 (如 task_id)")
    private String businessId;

    @TableField("location")
    @ApiModelProperty("数据物理位置或URL")
    private String location;

    @TableField(value = "attributes", typeHandler = JacksonTypeHandler.class)
    @ApiModelProperty("扩展属性 (JSON格式)")
    private Map<String, Object> attributes;

    @TableField(value = "created_at", fill = FieldFill.INSERT)
    @ApiModelProperty("创建时间")
    private Date createdAt;
}
