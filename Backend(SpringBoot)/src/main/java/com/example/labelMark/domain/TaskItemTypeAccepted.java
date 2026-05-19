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
import java.util.Date;

@Getter
@Setter
@TableName("task_item_type_accepted")
@ApiModel(value = "TaskItemTypeAccepted对象", description = "影像-用户-类别分工表")
public class TaskItemTypeAccepted implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Integer id;

    @TableField("task_id")
    @ApiModelProperty("任务ID")
    private Integer taskId;

    @TableField("task_item_id")
    @ApiModelProperty("影像项ID")
    private Integer taskItemId;

    @TableField("user_id")
    @ApiModelProperty("用户ID")
    private Integer userId;

    @TableField("username")
    @ApiModelProperty("用户名")
    private String username;

    @TableField("type_id")
    @ApiModelProperty("类别ID")
    private Integer typeId;

    @TableField("is_finished")
    @ApiModelProperty("是否完成")
    private Boolean isFinished;

    @TableField("finished_at")
    @ApiModelProperty("完成时间")
    private Date finishedAt;

    @TableField("created_at")
    private Date createdAt;

    @TableField("updated_at")
    private Date updatedAt;
}

