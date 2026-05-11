package com.example.labelMark.service.impl;

import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.DTO.*;
import com.example.labelMark.DTO.prov.ProvEntityRef;
import com.example.labelMark.domain.AuditInfo;
import com.example.labelMark.domain.Mark;
import com.example.labelMark.domain.SysUser;
import com.example.labelMark.domain.Task;
import com.example.labelMark.mapper.AuditInfoMapper;
import com.example.labelMark.service.AuditInfoService;
import com.example.labelMark.service.MarkService;
import com.example.labelMark.service.ProvenanceService;
import com.example.labelMark.service.TaskService;
import com.example.labelMark.utils.ResultGenerator;
import com.example.labelMark.vo.LoginUser;
import com.example.labelMark.vo.constant.Result;
import com.example.labelMark.vo.constant.StatusEnum;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.locationtech.jts.geom.Geometry;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import javax.annotation.Resource;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static com.example.labelMark.utils.SampleEvaluateUtils.boundaryError;
import static com.example.labelMark.utils.SampleEvaluateUtils.parseGeoJson;

/**
 * @Description
 * @Author wh
 * @Date 2025/11/17
 */
@Service
public class AuditInfoServiceImpl extends ServiceImpl<AuditInfoMapper, AuditInfo> implements AuditInfoService {
    @Resource
    MarkService markService;

    @Resource
    TaskService taskService;

    @Resource private ProvenanceService provenanceService;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Result submitAuditFail(Map<String, Object> req) {
        Integer taskId = (Integer) req.get("taskId");
        String overallFeedback = (String) req.get("overallFeedback");
        // 转换反馈列表
        ObjectMapper mapper = new ObjectMapper();
        List<FeedbackDTO> feedbackList = mapper.convertValue(
                req.get("featureFeedback"),
                new TypeReference<List<FeedbackDTO>>() {}
        );
        // 1) 把 feedbackList 转为 Map，提高查找效率
        Map<String, String> feedbackMap = feedbackList.stream()
                .collect(Collectors.toMap(FeedbackDTO::getId, FeedbackDTO::getFeedback));
        // 2) 获取当前任务的所有标注记录
        List<Mark> markList = markService.list(
                new QueryWrapper<Mark>().eq("task_id", taskId)
        );
        // 3) 用 feedbackMap 高效更新 mark.feedback
        markList.forEach(mark -> {
            String feedback = feedbackMap.get(String.valueOf(mark.getId()));
            if (feedback != null) {
                mark.setFeedback(feedback);
            }
        });
        // 4) 批量保存，提高效率（如果你用 MyBatis-Plus）
        markService.updateBatchById(markList);
        taskService.update(new UpdateWrapper<Task>()
                .set("audit_feedback", overallFeedback) // 只设置你需要更新的字段
                .set("status", 3) //修改为正在标注
                .eq("task_id", taskId)                      // 指定更新条件
        );

        // 先尝试获取现有记录
        AuditInfo auditInfo = getOne(new QueryWrapper<AuditInfo>().eq("task_id", taskId));

        if (auditInfo == null) {
            // 如果不存在则创建并初始化 audit_num = 1
            AuditInfo newAudit = new AuditInfo();
            newAudit.setTaskId(taskId);                  // 假设实体有 taskId 字段
            newAudit.setAuditNum(1);
            newAudit.setStatus(0);
            // 其它字段可以留空或赋默认值
            save(newAudit);
        } else {
            // 如果存在：使用原子 SQL 自增，避免并发问题
            UpdateWrapper<AuditInfo> update = new UpdateWrapper<>();
            update.eq("task_id", taskId)
                    .set("status",0)
                    .setSql("audit_num = COALESCE(audit_num, 0) + 1");
            update(update);
        }

        // ======= 新增：记录 PROV 溯源 =======
        try {
            // 获取用户ID
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            LoginUser loginUser = (LoginUser) authentication.getPrincipal();
            String userId = loginUser.getSysUser().getUserid().toString();

            ProvEntityRef inputTask = ProvEntityRef.of(taskId.toString(), "TASK", "任务#" + taskId);
            ProvEntityRef outputAudit = ProvEntityRef.of(
                    taskId + "_" + userId + "_" + System.currentTimeMillis(),
                    "AUDIT_REJECT",
                    "审核驳回记录"
            );

            Map<String, Object> provParams = new HashMap<>();
            provParams.put("feedbackItemCount", feedbackList.size());
            provParams.put("overallFeedback", overallFeedback);
            provParams.put("targetStatus", 3); // 状态变为待标注

            provenanceService.recordActivity(
                    "AUDIT_REJECT",      // 活动类型：审核驳回
                    userId,              // 操作人
                    "PERSON",            // 代理类型
                    inputTask,           // 输入：原任务
                    outputAudit,         // 输出：产生的驳回反馈实体
                    provParams           // 额外参数
            );
        } catch (Exception e) {
            log.warn("审核驳回溯源记录失败: " + e.getMessage());
        }
        // ===================================

        return ResultGenerator.getSuccessResult("审核反馈成功");
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Result submitAuditPass(AuditPassRequestDTO request) {

        // 从 request 对象中安全地获取 taskId 和 correctionsDTO
        Integer taskId = request.getTaskId();
        CorrectionsDTO correctionsDTO = request.getCorrections();

        Task task = taskService.getById(taskId);
        // 先尝试获取现有记录
        AuditInfo auditInfo = getOne(new QueryWrapper<AuditInfo>().eq("task_id", taskId));

        if (auditInfo == null){
            auditInfo = new AuditInfo();
            auditInfo.setTaskId(taskId);
        }
        //      获得原来未处理的标注
        List<Mark> marks = markService.list(new QueryWrapper<Mark>().eq("task_id", taskId));
        LinkedHashMap<Integer, JSONObject> marksMap = marks.stream()
                .collect(Collectors.toMap(
                        Mark::getId,                                    // key = id
                        item -> item.getGeom(),      // value = geometry 的 JSONObject
                        (v1, v2) -> v1,                                 // 重复 id 保留第一个
                        LinkedHashMap::new                              // 保证顺序
                ));
//        记录应该正确标注的面积和已经标注的面积
        double[] correctLabelArea= {0.0};
        double labeledArea=0.0;
        labeledArea = marks.stream()
                .mapToDouble(item -> parseGeoJson(item.getGeom()).getArea())
                .sum();
        correctLabelArea[0]+=labeledArea;
//        更新提交审核的原标注数量
        auditInfo.setLabelNum(marks.size());
        if (correctionsDTO != null) {
//            多标的标注id
            List<String> deletedFeatureIds = correctionsDTO.getDeletedFeatureIds();
            auditInfo.setOverMarkNum(deletedFeatureIds.size());
//            删除多标的标注
            deletedFeatureIds.stream().forEach(id->{
                markService.removeById(Integer.valueOf(id));
                correctLabelArea[0]-=parseGeoJson(marksMap.get(Integer.valueOf(id))).getArea();
            });
//          错标的标注
            List<ReclassifiedFeatureDTO> reclassifiedFeatures = correctionsDTO.getReclassifiedFeatures();
            auditInfo.setMislabelNum(reclassifiedFeatures.size());
//            更新错标的类别
            reclassifiedFeatures.stream().forEach(item->{
                Mark mark = markService.getById(Integer.valueOf(item.getFeatureId()));
                mark.setTypeId(Integer.valueOf(item.getNewTypeId()));
                markService.updateById(mark);
                correctLabelArea[0]-=parseGeoJson(marksMap.get(Integer.valueOf(item.getFeatureId()))).getArea();
            });
            //漏标
            List<AddedFeatureDTO> addedFeatures = correctionsDTO.getAddedFeatures();
            auditInfo.setMissNum(addedFeatures.size());
            addedFeatures.stream().forEach(item->{
                Mark mark = new Mark();
                mark.setTypeId(Integer.valueOf(item.getTypeId()));

                Map<String, Object> geomMap = item.getGeometry();
                JSONObject geomJson = new JSONObject(geomMap);
//                为了匹配标注时的格式
                JSONObject geom = new JSONObject();
                geom.put("type", "Feature");
                geom.put("properties", new JSONObject());
                geom.put("geometry", geomJson);
                mark.setGeom(geom);
                mark.setTaskId(taskId);
                mark.setUserId(task.getUserId());
                markService.save(mark);
                double area = parseGeoJson(geom).getArea();
                correctLabelArea[0]+=area;
            });
//            更新正确标注数目,原标+漏标-错标-多标
            auditInfo.setTrueNum(marks.size()+ auditInfo.getMissNum()- auditInfo.getMislabelNum()-auditInfo.getOverMarkNum());
//            边界校正，边界不贴合的正确标注，计算边界误查和IOU，
            List<ModifiedFeatureDTO> modifiedFeatures = correctionsDTO.getModifiedFeatures();

            double totalIntersectionArea = 0.0; // 用于微平均 IoU
            double totalUnionArea = 0.0;        // 用于微平均 IoU
            double totalBoundaryError = 0.0; // 用于归一化边界误差平均
            int validCount = 0;

            for (ModifiedFeatureDTO item : modifiedFeatures) {
                // 读取原始标注
                Mark mark = markService.getById(Integer.valueOf(item.getFeatureId()));
                if (mark == null) continue;

                JSONObject originJson = mark.getGeom();
                JSONObject newJson = new JSONObject(item.getNewGeometry());
                //                为了匹配标注时的格式
                JSONObject geom = new JSONObject();
                geom.put("type", "Feature");
                geom.put("properties", new JSONObject());
                geom.put("geometry", newJson);

                mark.setGeom(geom);
                markService.updateById(mark);
                // 转 Geometry
                Geometry originGeom = parseGeoJson(originJson);
                Geometry newGeom = parseGeoJson(geom);


                // 确保几何体有效且面积不为零（对于归一化计算）
                if (originGeom == null || newGeom == null || !originGeom.isValid() || !newGeom.isValid()) {
                    continue;
                }
//                调整边界会影响标注面积覆盖率
                correctLabelArea[0]+=newGeom.getArea()-originGeom.getArea();
                // --- 1. 累加计算微平均 IoU 所需的面积 ---
                Geometry intersection = originGeom.intersection(newGeom);
                Geometry union = originGeom.union(newGeom);

                totalIntersectionArea += intersection.getArea();
                totalUnionArea += union.getArea();

                // --- 2. 计算并累加边界误差 ---
                // 使用平均欧式距离作为绝对误差
                double absoluteBoundaryError = boundaryError(originGeom, newGeom);
                totalBoundaryError += absoluteBoundaryError;
                validCount++; // 只有成功计算了误差的才计入有效数量
            }

// 微平均 IoU：反映总体面积的标注准确率
            double avgIou = (totalUnionArea > 0) ? totalIntersectionArea / totalUnionArea : 0;

// 平均边界误差：反映平均每个对象的边界误差大小
            double avgBoundaryErr = (validCount > 0) ? totalBoundaryError / validCount : 0;

// 获取当前登录用户信息
            LoginUser loginUser = (LoginUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
            SysUser currentUser = loginUser.getSysUser();
            auditInfo.setAuditor(currentUser.getUsername());
            auditInfo.setAuditTime(LocalDate.now());
            auditInfo.setLabelArea((float)labeledArea);
            auditInfo.setTrueArea((float)correctLabelArea[0]);
            auditInfo.setIouI((float) totalIntersectionArea);
            auditInfo.setIouU((float) totalUnionArea);
            auditInfo.setBoundaryError((float) avgBoundaryErr);
            auditInfo.setIou((float) avgIou);
            auditInfo.setStatus(1);
            auditInfo.setAuditNum(auditInfo.getAuditNum()!=null?auditInfo.getAuditNum()+1:1);
            auditInfo.setLabelCoverRation((float) (labeledArea/correctLabelArea[0]));
            saveOrUpdate(auditInfo);

//            任务通过审核
            task.setStatus(1);
            taskService.updateById(task);

            // ======= 新增：记录 PROV 溯源 =======
            try {
                // 1. 获取当前审核人 ID (从前面代码中已获取的 currentUser 中取)
                // 如果 SysUser 有 getId() 则取 ID，否则取 Username
                String userId = currentUser.getUserid() != null ? String.valueOf(currentUser.getUserid()) : currentUser.getUsername();

                // 2. 定义输入输出引用
                // 输入是当前任务
                ProvEntityRef inputTask = ProvEntityRef.of(taskId.toString(), "TASK", "任务#" + taskId);
                // 输出是审核通过后的最终结果版本
                ProvEntityRef outputRevision = ProvEntityRef.of(
                        taskId + "_" + userId + "_" + System.currentTimeMillis(),
                        "AUDIT_FINAL_RESULT",
                        "审核通过最终结果"
                );

                // 3. 构建溯源参数（记录审核质量指标）
                Map<String, Object> provParams = new HashMap<>();
                provParams.put("iou", auditInfo.getIou());
                provParams.put("boundaryError", auditInfo.getBoundaryError());
                provParams.put("overMarkNum", auditInfo.getOverMarkNum());  // 多标
                provParams.put("mislabelNum", auditInfo.getMislabelNum());  // 错标
                provParams.put("missNum", auditInfo.getMissNum());          // 漏标
                provParams.put("labelCoverRatio", auditInfo.getLabelCoverRation());
                provParams.put("finalStatus", 1); // 已通过

                // 4. 执行记录
                provenanceService.recordActivity(
                        "AUDIT_PASS",       // 活动类型：审核通过
                        userId,          // 代理人：当前审核员
                        "PERSON",           // 代理类型
                        inputTask,          // 源实体
                        outputRevision,     // 目标实体
                        provParams          // 详细参数
                );
            } catch (Exception e) {
                // 使用 log.warn 记录异常，不阻断主流程回滚
                log.warn("审核通过溯源记录失败: " + e.getMessage());
            }
            // ===================================

        }
        return ResultGenerator.getSuccessResult("审核已通过");
    }

    @Override
    public Result getAuditInfo(String taskId){
        AuditInfo auditInfo = getOne(new QueryWrapper<AuditInfo>().eq("task_id", Integer.valueOf(taskId)));
        if (auditInfo!=null){
            return ResultGenerator.getSuccessResult(StatusEnum.SUCCESS,"查询审核信息成功",auditInfo);
        }
        return ResultGenerator.getFailResult("查询审核信息失败");
    }
}
