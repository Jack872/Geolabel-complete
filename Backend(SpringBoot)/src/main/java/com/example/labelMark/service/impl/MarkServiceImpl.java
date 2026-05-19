package com.example.labelMark.service.impl;

import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.example.labelMark.DTO.prov.ProvEntityRef;
import com.example.labelMark.domain.Mark;
import com.example.labelMark.domain.TaskItem;
import com.example.labelMark.domain.TaskItemTypeAccepted;
import com.example.labelMark.mapper.MarkMapper;
import com.example.labelMark.service.MarkService;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.service.ProvenanceService;
import com.example.labelMark.service.TaskAcceptedService;
import com.example.labelMark.service.TaskItemService;
import com.example.labelMark.service.TaskItemTypeAcceptedService;
import com.example.labelMark.service.TaskService;
import com.example.labelMark.utils.CoordinateConverter;
import org.locationtech.jts.geom.Geometry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.sql.ResultSet;
import java.util.*;
import java.util.stream.Collectors;

import static com.example.labelMark.utils.SampleEvaluateUtils.parseGeoJson;

/**
 * <p>
 *  服务实现类
 * </p>
 *
 *
 * @since 2024-04-28
 */
@Service
public class MarkServiceImpl extends ServiceImpl<MarkMapper, Mark> implements MarkService {

    @Resource
    private MarkMapper markMapper;

    @Resource private TaskService taskService;
    @Resource private TaskItemService taskItemService;
    @Resource private TaskAcceptedService taskAcceptedService;
    @Resource private TaskItemTypeAcceptedService taskItemTypeAcceptedService;
    @Resource private ProvenanceService provenanceService;
    private static final double COVERAGE_RATIO_THRESHOLD = 0.1d;
    private static final double INTERSECTION_AREA_THRESHOLD = 0.1d;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> saveMarkInfoIncremental(Map<String, Object> request) throws Exception {
        // 1. 获取基础参数
        Integer userId = Integer.valueOf(request.get("userid").toString());
        Integer taskId = Integer.valueOf(request.get("id").toString());
        Integer taskItemId = request.get("taskItemId") == null ? null : Integer.valueOf(request.get("taskItemId").toString());
        TaskItem taskItem = taskService.resolveTaskItem(taskId, taskItemId);
        if (taskItem == null) {
            throw new IllegalStateException("TASK_ITEM_NOT_FOUND: 当前影像不存在");
        }
        if (!(Objects.equals(taskItem.getStatus(), 3) || Objects.equals(taskItem.getStatus(), 2))) {
            throw new IllegalStateException("TASK_ITEM_LOCKED: 当前影像已提交审核或审核通过，不能继续编辑。");
        }

        // 2. 检查唯一执行者标志
        boolean setAsSubmitter = false;
        if (request.containsKey("setAsSubmitter")) {
            Object val = request.get("setAsSubmitter");
            setAsSubmitter = val != null && Boolean.parseBoolean(val.toString());
        }
        Set<Integer> assignedTypeIds = taskItemTypeAcceptedService.getAssignedTypeIds(taskId, taskItem.getTaskItemId(), userId);
        List<TaskItemTypeAccepted> assignmentRows = taskItemTypeAcceptedService
                .listByTaskItemAndUser(taskId, taskItem.getTaskItemId(), userId);
        if (!assignmentRows.isEmpty() && assignmentRows.stream().allMatch(row -> Boolean.TRUE.equals(row.getIsFinished()))) {
            throw new IllegalStateException("USER_ALREADY_FINISHED: 当前用户已将负责类别标记为完成，请先撤销完成后再修改。");
        }
        if (assignedTypeIds.isEmpty()) {
            // 兼容旧流程：若未配置细粒度分工，退回到前端透传的 typeArr 权限
            Object rawTypeArr = request.get("typeArr");
            if (rawTypeArr instanceof List) {
                for (Object item : (List<?>) rawTypeArr) {
                    if (!(item instanceof Map)) continue;
                    Object typeId = ((Map<?, ?>) item).get("typeId");
                    if (typeId == null) continue;
                    try {
                        assignedTypeIds.add(Integer.valueOf(String.valueOf(typeId)));
                    } catch (Exception ignore) {
                    }
                }
            }
            if (assignedTypeIds.isEmpty()) {
                throw new IllegalStateException("TYPE_NOT_ASSIGNED: 当前用户未分配该影像标注权限。");
            }
        }

        // 3. 【删除逻辑】处理前端传来的删除列表
        int deleteCount = 0;
        List<?> rawDeleteIds = (List<?>) request.get("deleteMarkIds");
        if (rawDeleteIds != null && !rawDeleteIds.isEmpty()) {
            List<Integer> idsToDelete = new ArrayList<>();
            for (Object idObj : rawDeleteIds) {
                if (idObj != null) {
                    try {
                        idsToDelete.add(Integer.valueOf(idObj.toString()));
                    } catch (NumberFormatException e) {
                        // 忽略非数字ID
                    }
                }
            }
            if (!idsToDelete.isEmpty()) {
                List<Mark> deleteCandidates = listByIds(idsToDelete).stream()
                        .filter(mark -> Objects.equals(mark.getTaskId(), taskId))
                        .filter(mark -> Objects.equals(mark.getUserId(), userId))
                        .filter(mark -> Objects.equals(mark.getTaskItemId(), taskItem.getTaskItemId()))
                        .collect(Collectors.toList());
                List<Integer> safeDeleteIds = deleteCandidates.stream().map(Mark::getId).collect(Collectors.toList());
                boolean delSuccess = safeDeleteIds.isEmpty() || this.removeByIds(safeDeleteIds);
                if (delSuccess) deleteCount = safeDeleteIds.size();
            }
        }

        // 4. 【新增/更新逻辑】
        int insertCount = 0;
        int updateCount = 0;

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> typeIdAndMarkInfoArr = (List<Map<String, Object>>) request.get("jsondataArr");

        if (typeIdAndMarkInfoArr != null && !typeIdAndMarkInfoArr.isEmpty()) {
            // 坐标转换 (GeoJSON -> WKT/Geometry)
            // 注意：确保此工具类不会丢弃原始Map中的 markId
            List<Map<String, Object>> geometryArr = CoordinateConverter.convertCoordinate(typeIdAndMarkInfoArr);

            for (Map<String, Object> markData : geometryArr) {
                Mark mark = new Mark();
                mark.setUserId(userId);
                mark.setTaskId(taskId);
                mark.setTaskItemId(taskItemId);

                // 设置类型ID
                if (markData.get("typeId") != null) {
                    mark.setTypeId(Integer.valueOf(markData.get("typeId").toString()));
                }
                if (!assignedTypeIds.contains(mark.getTypeId())) {
                    throw new IllegalStateException("TYPE_NOT_ASSIGNED: 当前用户没有该影像下此类别的标注权限。");
                }

                // 设置几何信息 (根据你的实体类字段调整，如 setGeometry 或 setMarkInfo)
                String geomJson = (String) markData.get("geom");
                JSONObject geometryObject = JSONObject.parseObject(geomJson);
                JSONObject propertiesObject = new JSONObject();
                Object rawProperties = markData.get("properties");
                if (rawProperties != null) {
                    try {
                        if (rawProperties instanceof JSONObject) {
                            propertiesObject = (JSONObject) rawProperties;
                        } else {
                            propertiesObject = JSONObject.parseObject(rawProperties.toString());
                        }
                    } catch (Exception ignored) {
                        propertiesObject = new JSONObject();
                    }
                }
                propertiesObject.remove("markId");
                JSONObject geom = new JSONObject();
                geom.put("type", "Feature");
                geom.put("properties", propertiesObject);
                geom.put("geometry", geometryObject);
                mark.setGeom(geom);
                JSONObject attrObject = null;
                Object rawAttrJson = markData.get("attrJson");
                if (rawAttrJson != null) {
                    try {
                        if (rawAttrJson instanceof JSONObject) {
                            attrObject = (JSONObject) rawAttrJson;
                        } else {
                            attrObject = JSONObject.parseObject(rawAttrJson.toString());
                        }
                    } catch (Exception ignored) {
                        attrObject = null;
                    }
                }
                mark.setAttrJson(attrObject);
                mark.setStatus(0);

                // 尝试获取 markId
                Integer existingMarkId = null;
                Object markIdObj = markData.get("markId");
                // 兼容有些前端传 null 或 "null" 字符串的情况
                if (markIdObj != null && !"null".equals(markIdObj.toString()) && !"".equals(markIdObj.toString())) {
                    try {
                        existingMarkId = Integer.valueOf(markIdObj.toString());
                    } catch (NumberFormatException e) {
                        // ignore
                    }
                }

                if (existingMarkId != null && existingMarkId > 0) {
                    // --- 更新 ---
                    Mark existed = getById(existingMarkId);
                    if (existed == null
                            || !Objects.equals(existed.getTaskId(), taskId)
                            || !Objects.equals(existed.getUserId(), userId)
                            || !Objects.equals(existed.getTaskItemId(), taskItem.getTaskItemId())) {
                        throw new IllegalStateException("NO_PERMISSION: 不允许修改非本人标注。");
                    }
                    mark.setId(existingMarkId);
                    // updateById 默认只更新非空字段
                    this.updateById(mark);
                    updateCount++;
                } else {
                    // --- 新增 ---
                    this.save(mark);
                    insertCount++;
                }
            }
        }

        // 5. 处理唯一执行者 (Submitter)
        if (setAsSubmitter) {
            taskService.updateTaskSubmitter(taskId, userId);
            taskAcceptedService.deleteOtherUsers(taskId, userId);
        }

        // 6. 记录 PROV 溯源
        try {
            ProvEntityRef inputTask = ProvEntityRef.of(taskId.toString(), "TASK", "任务#" + taskId);
            ProvEntityRef outputRevision = ProvEntityRef.of(
                    taskId + "_" + userId + "_" + System.currentTimeMillis(),
                    "ANNOTATION_REVISION",
                    "标注提交"
            );

            Map<String, Object> provParams = new HashMap<>();
            provParams.put("inserted", insertCount);
            provParams.put("updated", updateCount);
            provParams.put("deleted", deleteCount);
            provParams.put("setAsSubmitter", setAsSubmitter);

            provenanceService.recordActivity(
                    "ANNOTATE",
                    userId.toString(),
                    "PERSON",
                    inputTask,
                    outputRevision,
                    provParams
            );
        } catch (Exception e) {
            log.warn("溯源记录失败"+e.getMessage()); // 使用 @Slf4j 或 LoggerFactory
        }

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("message", String.format("保存成功 (新增:%d, 更新:%d, 删除:%d)", insertCount, updateCount, deleteCount));
        response.put("warning", false);
        response.put("code", "OK");
        return response;
    }

    @Override
    public Map<String, Object> calculateTaskItemConflictSummary(Integer taskId, Integer taskItemId, Integer currentUserId, String taskType) {
        Map<String, Object> summary = new HashMap<>();
        List<Map<String, Object>> conflicts = new ArrayList<>();
        summary.put("taskType", taskType);
        summary.put("hasConflict", false);
        summary.put("conflictCount", 0);
        summary.put("conflicts", conflicts);

        if (taskId == null || taskItemId == null) {
            return summary;
        }
        if ("目标检测".equals(taskType)) {
            summary.put("mode", "detection");
            summary.put("message", "目标检测任务允许覆盖，不返回覆盖冲突。");
            return summary;
        }

        List<Mark> marks = list(new QueryWrapper<Mark>()
                .eq("task_id", taskId)
                .eq("task_item_id", taskItemId));
        if (marks == null || marks.size() < 2) {
            return summary;
        }

        Map<Integer, Geometry> geometryByMarkId = new HashMap<>();
        for (Mark mark : marks) {
            if (mark == null || mark.getId() == null) continue;
            try {
                Geometry geom = parseGeoJson(mark.getGeom());
                if (geom != null && !geom.isEmpty()) {
                    geometryByMarkId.put(mark.getId(), geom);
                }
            } catch (Exception ignore) {
            }
        }

        Set<String> conflictKeys = new HashSet<>();
        for (int i = 0; i < marks.size(); i++) {
            Mark left = marks.get(i);
            if (left == null || left.getId() == null || left.getUserId() == null) continue;
            Geometry leftGeom = geometryByMarkId.get(left.getId());
            if (leftGeom == null || leftGeom.isEmpty()) continue;

            for (int j = 0; j < marks.size(); j++) {
                if (i == j) continue;
                Mark right = marks.get(j);
                if (right == null || right.getId() == null || right.getUserId() == null) continue;
                if (Objects.equals(left.getUserId(), right.getUserId())) continue;
                if (currentUserId != null && !Objects.equals(left.getUserId(), currentUserId)) continue;
                if (currentUserId == null && left.getId() >= right.getId()) continue;

                Geometry rightGeom = geometryByMarkId.get(right.getId());
                if (rightGeom == null || rightGeom.isEmpty()) continue;
                if (!leftGeom.intersects(rightGeom)) continue;

                Geometry intersection;
                try {
                    intersection = leftGeom.intersection(rightGeom);
                } catch (Exception ignore) {
                    continue;
                }
                if (intersection == null || intersection.isEmpty()) continue;

                double intersectionArea = intersection.getArea();
                if (intersectionArea <= INTERSECTION_AREA_THRESHOLD) continue;

                double leftArea = leftGeom.getArea();
                double rightArea = rightGeom.getArea();
                double minArea = Math.min(leftArea, rightArea);
                if (minArea <= 0) continue;

                double coverageRatio = intersectionArea / minArea;
                if (coverageRatio <= COVERAGE_RATIO_THRESHOLD) continue;

                String conflictKey = currentUserId == null
                        ? Math.min(left.getId(), right.getId()) + "_" + Math.max(left.getId(), right.getId())
                        : left.getId() + "_" + right.getId();
                if (!conflictKeys.add(conflictKey)) {
                    continue;
                }

                Map<String, Object> conflict = new HashMap<>();
                conflict.put("selfMarkId", left.getId());
                conflict.put("otherMarkId", right.getId());
                conflict.put("selfUserId", left.getUserId());
                conflict.put("otherUserId", right.getUserId());
                conflict.put("selfTypeId", left.getTypeId());
                conflict.put("otherTypeId", right.getTypeId());
                conflict.put("intersectionArea", intersectionArea);
                conflict.put("coverageRatio", coverageRatio);
                conflicts.add(conflict);
            }
        }

        summary.put("hasConflict", !conflicts.isEmpty());
        summary.put("conflictCount", conflicts.size());
        summary.put("conflicts", conflicts);
        if (!conflicts.isEmpty()) {
            summary.put("message", "存在潜在覆盖冲突，审核员将重点检查。");
        }
        return summary;
    }

    @Override
    public boolean isMark(int taskId, int userId) {
        int count = markMapper.isMark(taskId, userId);
        if(count != 0){
            return true;
        }else {
            return false;
        }
    }

    @Override
    public void insertOrUpdateMark(Mark mark) {
        saveOrUpdate(mark);
    }

    @Override
    public void deleteMarkByTaskId(int taskId) {
        markMapper.deleteMarkByTaskId(taskId);
    }

    @Override
    public long GetTaskIdNum(int taskId) {
//        Integer num = markMapper.GetTaskIdNum(taskId);
        QueryWrapper<Mark> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("task_id", taskId);
        long count = count(queryWrapper);
        return count;
    }

    @Override
    public List<Mark> selectMarkById(int taskId) {
        List<Mark> marks = markMapper.selectMarkById(taskId);
        return marks;
    }

    @Override
    public List<Mark> getMarkByTaskId(Integer taskId) {
        QueryWrapper<Mark> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("task_id", taskId);
        return list(queryWrapper);
    }

    @Override
    public List<Mark> getMarkByTaskItem(Integer taskId, Integer taskItemId) {
        QueryWrapper<Mark> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("task_id", taskId);
        if (taskItemId != null) {
            queryWrapper.eq("task_item_id", taskItemId);
        }
        return list(queryWrapper);
    }

    @Override
    public void deleteMarkByTaskAndUser(int taskId, int userId) {
        markMapper.deleteMarkByTaskAndUserId(taskId, userId);
    }

}
