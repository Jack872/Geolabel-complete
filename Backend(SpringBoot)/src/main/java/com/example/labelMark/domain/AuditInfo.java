package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Data;
import org.springframework.data.annotation.Id;

import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import java.io.Serializable;
import java.time.LocalDate;
import java.util.Date;

/**
 * @Description
 * @Author wh
 * @Date 2025/11/10
 */


/**
 * <p>
 * 审核信息表实体类
 * </p>
 *
 * 说明：记录标注审核过程中的各类统计指标（如错标、多标、漏标、IOU等）
 */
@Data
@TableName("audit_info")
@ApiModel(value = "AuditInfo对象", description = "标注审核信息表")
public class AuditInfo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @TableId(value = "id", type = IdType.AUTO)
    @ApiModelProperty("审核信息表主键")
    private Integer id;

    @ApiModelProperty("任务ID")
    @TableField("task_id")
    private Integer taskId;

    @ApiModelProperty("错标数（类别错误但位置基本正确）")
    @TableField("mislabel_num")
    private Integer mislabelNum;

    @ApiModelProperty("多标数（类别错误且位置错误，不属于任何真实对象）")
    @TableField("over_mark_num")
    private Integer overMarkNum;

    @ApiModelProperty("漏标数目")
    @TableField("miss_num")
    private Integer missNum;

    @ApiModelProperty("正确标注数量（漏标+原标-错标-多标）")
    @TableField("true_num")
    private Integer trueNum;

    @ApiModelProperty("审核次数")
    @TableField("audit_num")
    private Integer auditNum;

    @ApiModelProperty("标注面积覆盖率")
    @TableField("label_cover_ration")
    private Float labelCoverRation;

    @ApiModelProperty("提交审核的标注数量")
    @TableField("label_num")
    private Integer labelNum;

    @ApiModelProperty("边界误差，针对正确标注中的未知错误")
    @TableField("boundary_error")
    private Float boundaryError;

    @ApiModelProperty("交并比(IOU)，针对正确标注中的未知错误")
    @TableField("\"IOU\"")
    private Float iou;

    @ApiModelProperty("交并比(IOU)，交集")
    @TableField("\"IOU_I\"")
    private Float iouI;

    @ApiModelProperty("交并比(IOU)，并集")
    @TableField("\"IOU_U\"")
    private Float iouU;

    @ApiModelProperty("提交审核标注面积")
    @TableField("label_area")
    private Float labelArea;

    @ApiModelProperty("正确标注面积")
    @TableField("true_area")
    private Float trueArea;

    @ApiModelProperty("审核意见，通过或不通过均可填写")
    @TableField("audit_opnion")
    private String auditOpnion;

    @ApiModelProperty("审核状态（1 审核通过，0 审核不通过）")
    @TableField("status")
    private Integer status;

    @ApiModelProperty("审核员")
    @TableField("auditor")
    private String auditor;

    @ApiModelProperty("审核完成时间")
    @JsonFormat(pattern = "yyyy-MM-dd")
    @TableField("audit_time")
    private LocalDate auditTime;
}

