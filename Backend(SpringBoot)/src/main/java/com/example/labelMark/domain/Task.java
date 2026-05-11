package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.alibaba.fastjson.JSONObject;
import com.example.labelMark.config.JsonObjectTypeHandler;
import java.io.Serializable;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;
import org.apache.ibatis.type.JdbcType;
import org.springframework.data.annotation.Id;
import org.springframework.format.annotation.DateTimeFormat;

import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.validation.constraints.Pattern;

/**
 * <p>
 *
 * </p>
 *
 *
 * @since 2024-04-25
 */
@Getter
@Setter
@TableName("task")
@ApiModel(value = "Task对象", description = "")
public class Task implements Serializable {

    private static final long serialVersionUID = 1L;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @TableId(value = "task_id", type = IdType.AUTO)
    private Integer taskId;

    @TableField(value = "server_id")
    private Integer serverId;

    @TableField("task_name")
    private String taskName;

    @TableField("task_type")
    private String taskType;

    @TableField("map_server")
    private String mapServer;

    @TableField("date_range")
    @Pattern(regexp = "^(\\d{4}-\\d{2}-\\d{2}) (\\d{4}-\\d{2}-\\d{2})$", message = "日期范围格式不正确")
    @DateTimeFormat(pattern = "yyyy-MM-dd")
    private String dateRange;

    @ApiModelProperty("0审核中，1审核通过，2审核失败，3未提交")
    @TableField("status")
    private Integer status;

    @ApiModelProperty("标记ID拼接字符")
    @TableField("mark_id")
    private String markId;

    @ApiModelProperty("审核反馈")
    @TableField("audit_feedback")
    private String auditFeedback;

    @ApiModelProperty("0为团队任务；1为非团队任务")
    @TableField("task_class")
    private Integer taskClass;

    @ApiModelProperty("创建者ID")
    @TableField("user_id")
    private Integer userId;

    @ApiModelProperty("完成任务获得积分")
    @TableField("score")
    private Integer score;

    @ApiModelProperty("提交者ID")
    @TableField("submitter_id")
    private Integer submitterId;

    @ApiModelProperty("任务来源: geoserver=GeoServer服务, local=本地图片")
    @TableField("task_source")
    private String taskSource;

    @ApiModelProperty("本地图片绝对路径（task_source=local时使用）")
    @TableField("local_image_path")
    private String localImagePath;

    @ApiModelProperty("任务批次ID（同一批次任务用于前端折叠展示）")
    @TableField("batch_id")
    private String batchId;

    @ApiModelProperty("批次内序号（从1开始）")
    @TableField("batch_index")
    private Integer batchIndex;

    @ApiModelProperty("任务标注属性约束配置(JSON) - 兼容字段，当前不落库")
    @TableField(exist = false)
    private JSONObject annotationSchema;

    @ApiModelProperty("标注属性约束版本 - 兼容字段，当前不落库")
    @TableField(exist = false)
    private Integer annotationSchemaVersion;
}
