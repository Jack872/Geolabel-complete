package com.example.labelMark.vo;

import lombok.Data;

import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * @Description 用于getTaskInfo方法数据接收
 * 
 * @Date 2024/5/14
 */
@Data
public class TaskInfoDTO {
    private int taskid;
    private String taskname;
    private String type;
    private String mapserver;
    private String daterange;
    private Integer status;
    private String auditfeedback;
    private int userid;
    private String username;
    private int id;
    private String typeArr;
    private List<Map<String, Object>> userArr;
    private Integer taskClass; // 0为团队任务；1为非团队任务
    private Integer score; // 任务积分
    private String taskSource; // geoserver/local
    private Integer serverId; // GeoServer服务ID
    private String coordinateSystem; // 当前任务影像坐标系
    private String batchId; // 批次ID
    private Integer batchIndex; // 批次序号
    private Object annotationSchema; // 任务标注属性约束
    private Integer annotationSchemaVersion; // 约束版本
    private Integer myTotalItems; // 我负责的影像数
    private Integer myEditableItems; // 我可编辑影像数(status=3/2)
    private Integer myFinishedUnsubmittedItems; // 我已完成但影像未提交
    private Integer myPendingAuditItems; // 待审核影像数(status=0)
    private Integer myApprovedItems; // 审核通过影像数(status=1)
    private Integer myRejectedItems; // 审核退回影像数(status=2)
    private Boolean canStartMark; // 是否可进入标注
}
