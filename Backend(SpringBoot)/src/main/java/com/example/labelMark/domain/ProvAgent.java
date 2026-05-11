package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.*;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Data;
import java.io.Serializable;
import java.util.Date;

@Data
@TableName("prov_agent")
@ApiModel(value = "ProvAgent对象", description = "溯源代理表：记录参与数据处理的人员或算法模型")
public class ProvAgent implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.ASSIGN_UUID)
    @ApiModelProperty("代理ID (UUID)")
    private String id;

    @TableField("agent_name")
    @ApiModelProperty("代理名称 (如: 张三, ResNet-50)")
    private String agentName;

    @TableField("agent_type")
    @ApiModelProperty("代理类型 (PERSON, SOFTWARE, ORGANIZATION)")
    private String agentType;

    @TableField("external_id")
    @ApiModelProperty("关联业务ID (如 UserID, ModelVersion)")
    private String externalId;

    @TableField("description")
    @ApiModelProperty("描述")
    private String description;

    @TableField(value = "created_at", fill = FieldFill.INSERT)
    @ApiModelProperty("创建时间")
    private Date createdAt;
}
