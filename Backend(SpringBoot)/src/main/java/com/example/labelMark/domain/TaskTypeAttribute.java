package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

@Getter
@Setter
@TableName("task_type_attribute")
@ApiModel(value = "TaskTypeAttribute对象", description = "任务-类别属性配置")
public class TaskTypeAttribute implements Serializable {
    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    @ApiModelProperty("任务ID")
    @TableField("task_id")
    private Integer taskId;

    @ApiModelProperty("类别ID")
    @TableField("type_id")
    private Integer typeId;

    @ApiModelProperty("属性ID")
    @TableField("attr_id")
    private Integer attrId;

    @ApiModelProperty("是否必填")
    @TableField("is_required")
    private Boolean isRequired;

    @ApiModelProperty("显示顺序")
    @TableField("display_order")
    private Integer displayOrder;

    @ApiModelProperty("输入提示")
    @TableField("placeholder")
    private String placeholder;

    @ApiModelProperty("填写说明")
    @TableField("remark")
    private String remark;
}

