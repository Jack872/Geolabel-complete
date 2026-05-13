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
@TableName("task_item")
@ApiModel(value = "TaskItem对象", description = "任务影像项")
public class TaskItem implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "task_item_id", type = IdType.AUTO)
    private Integer taskItemId;

    @TableField("task_id")
    @ApiModelProperty("所属任务ID")
    private Integer taskId;

    @TableField("item_index")
    @ApiModelProperty("任务内影像顺序")
    private Integer itemIndex;

    @TableField("item_name")
    @ApiModelProperty("影像项显示名称")
    private String itemName;

    @TableField("task_source")
    @ApiModelProperty("影像来源：geoserver/local")
    private String taskSource;

    @TableField("server_id")
    @ApiModelProperty("GeoServer服务ID")
    private Integer serverId;

    @TableField("map_server")
    @ApiModelProperty("GeoServer服务名称")
    private String mapServer;

    @TableField("local_image_path")
    @ApiModelProperty("本地影像绝对路径")
    private String localImagePath;

    @TableField("status")
    @ApiModelProperty("影像项状态")
    private Integer status;
}
