package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.*;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Data;
import java.io.Serializable;
import java.util.Date;

@Data
@TableName("prov_relation")
@ApiModel(value = "ProvRelation对象", description = "溯源关系表：记录输入输出流向")
public class ProvRelation implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    @ApiModelProperty("自增主键")
    private Long id;

    @TableField("activity_id")
    @ApiModelProperty("关联活动ID")
    private String activityId;

    @TableField("entity_id")
    @ApiModelProperty("关联实体ID")
    private String entityId;

    @TableField("rel_type")
    @ApiModelProperty("关系类型 (USED:输入, GENERATED:输出)")
    private String relType;

    @TableField("role")
    @ApiModelProperty("在活动中的角色 (可选)")
    private String role;

    @TableField(value = "created_at", fill = FieldFill.INSERT)
    @ApiModelProperty("创建时间")
    private Date createdAt;
}
