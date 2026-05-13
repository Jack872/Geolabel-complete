package com.example.labelMark.service.impl;

import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.example.labelMark.DTO.prov.ProvEntityRef;
import com.example.labelMark.domain.Mark;
import com.example.labelMark.mapper.MarkMapper;
import com.example.labelMark.service.MarkService;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.service.ProvenanceService;
import com.example.labelMark.service.TaskAcceptedService;
import com.example.labelMark.service.TaskService;
import com.example.labelMark.utils.CoordinateConverter;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.sql.ResultSet;
import java.util.*;

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
    @Resource private TaskAcceptedService taskAcceptedService;
    @Resource private ProvenanceService provenanceService;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public String saveMarkInfoIncremental(Map<String, Object> request) throws Exception {
        // 1. 获取基础参数
        Integer userId = Integer.valueOf(request.get("userid").toString());
        Integer taskId = Integer.valueOf(request.get("id").toString());
        Integer taskItemId = request.get("taskItemId") == null ? null : Integer.valueOf(request.get("taskItemId").toString());

        // 2. 检查唯一执行者标志
        boolean setAsSubmitter = false;
        if (request.containsKey("setAsSubmitter")) {
            Object val = request.get("setAsSubmitter");
            setAsSubmitter = val != null && Boolean.parseBoolean(val.toString());
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
                // 执行批量删除
                boolean delSuccess = this.removeByIds(idsToDelete);
                if (delSuccess) deleteCount = idsToDelete.size();
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

        return String.format("保存成功 (新增:%d, 更新:%d, 删除:%d)", insertCount, updateCount, deleteCount);
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
