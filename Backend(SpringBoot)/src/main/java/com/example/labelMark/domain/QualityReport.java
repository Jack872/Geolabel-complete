package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

@Data
@TableName("quality_report")
public class QualityReport implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    @TableField("sample_set_id")
    private Integer sampleSetId;

    @TableField("quality_profile_id")
    private Long qualityProfileId;

    @TableField("reference_model_id")
    private Integer referenceModelId;

    @TableField("creator")
    private String creator;

    @TableField("summary")
    private String summary;

    @TableField("result_json")
    private String resultJson;

    @TableField("created_time")
    private Date createdTime;
}
