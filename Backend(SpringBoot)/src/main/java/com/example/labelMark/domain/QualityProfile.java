package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

@Data
@TableName("quality_profile")
public class QualityProfile implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    @TableField("name")
    private String name;

    @TableField("task_type")
    private String taskType;

    @TableField("expected_bands")
    private String expectedBands;

    @TableField("expected_export_format")
    private String expectedExportFormat;

    @TableField("expected_annotation_format")
    private String expectedAnnotationFormat;

    @TableField("required_fields")
    private String requiredFields;

    @TableField("topology_rules")
    private String topologyRules;

    @TableField("attribute_audit_mode")
    private String attributeAuditMode;

    @TableField("dimension_configs")
    private String dimensionConfigs;

    @TableField("weights")
    private String weights;

    @TableField("is_active")
    private Boolean isActive;

    @TableField("version")
    private Integer version;

    @TableField("created_by")
    private String createdBy;

    @TableField("created_time")
    private Date createdTime;

    @TableField("updated_time")
    private Date updatedTime;
}
