package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

@Data
@TableName("quality_eval_job")
public class QualityEvalJob implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    @TableField("sample_set_id")
    private Integer sampleSetId;

    @TableField("quality_profile_id")
    private Long qualityProfileId;

    @TableField("reference_model_id")
    private Integer referenceModelId;

    @TableField("status")
    private String status;

    @TableField("stage")
    private String stage;

    @TableField("progress")
    private Integer progress;

    @TableField("processed_count")
    private Integer processedCount;

    @TableField("total_count")
    private Integer totalCount;

    @TableField("request_json")
    private String requestJson;

    @TableField("result_json")
    private String resultJson;

    @TableField("report_id")
    private Long reportId;

    @TableField("message")
    private String message;

    @TableField("creator")
    private String creator;

    @TableField("created_time")
    private Date createdTime;

    @TableField("start_time")
    private Date startTime;

    @TableField("end_time")
    private Date endTime;

    @TableField("updated_time")
    private Date updatedTime;
}
