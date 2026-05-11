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
@TableName(value = "prov_activity", autoResultMap = true)
@ApiModel(value = "ProvActivity对象", description = "溯源活动表：记录数据处理的具体动作")
public class ProvActivity implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.ASSIGN_UUID)
    @ApiModelProperty("活动ID (UUID)")
    private String id;

    @TableField("act_type")
    @ApiModelProperty("活动类型 (UPLOAD, ANNOTATE, REVIEW, GENERATE)")
    private String actType;

    @TableField("description")
    @ApiModelProperty("活动描述")
    private String description;

    @TableField("agent_id")
    @ApiModelProperty("关联代理ID (FK -> ProvAgent)")
    private String agentId;

    @TableField("start_time")
    @ApiModelProperty("开始时间")
    private Date startTime;

    @TableField("end_time")
    @ApiModelProperty("结束时间")
    private Date endTime;

    @TableField(value = "parameters", typeHandler = JacksonTypeHandler.class)
    @ApiModelProperty("执行参数 (JSON格式)")
    private Map<String, Object> parameters;

    @TableField("status")
    @ApiModelProperty("状态 (SUCCESS, FAILED)")
    private String status;
}
