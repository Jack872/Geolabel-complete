package com.example.labelMark.service.impl;

import cn.hutool.core.util.ObjectUtil;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.labelMark.domain.Server;
import com.example.labelMark.domain.Task;
import com.example.labelMark.mapper.ServerMapper;
import com.example.labelMark.mapper.TaskMapper;
import com.example.labelMark.service.TaskService;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.vo.TaskInfoDTO;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * <p>
 *  服务实现类
 * </p>
 *
 *
 * @since 2024-04-25
 */
@Service
public class TaskServiceImpl extends ServiceImpl<TaskMapper, Task> implements TaskService {

    @Resource
    private TaskMapper taskMapper;
    @Resource
    private ServerMapper serverMapper;

    @Override
    public int createTask(String dataRange, String taskName, String taskType
            , String mapServer, Integer userId, Integer taskClass) {
        Task task = new Task();
//        初试状态为未提交
        task.setStatus(3);
        task.setDateRange(dataRange);
        task.setTaskName(taskName);
        task.setTaskType(taskType);
        task.setMapServer(mapServer);
        task.setServerId(serverMapper.selectOne(new QueryWrapper<Server>().eq("ser_name", mapServer)).getSerId());
        task.setTaskSource("geoserver");
        task.setUserId(userId);
        task.setTaskClass(taskClass);
        // 初始化积分为0
        task.setScore(0);
        boolean isSaved = save(task);
//        taskMapper.insert(task);
        return isSaved == true ? task.getTaskId() : -1;
    }

    @Override
    public List<TaskInfoDTO> getTaskInfo(String username) {
        List<Map<String, Object>> mapList = taskMapper.getTaskInfo(username);
        ArrayList<TaskInfoDTO> list = new ArrayList<>();
        for (Map map : mapList) {
            TaskInfoDTO taskInfoDTO = new TaskInfoDTO();
            taskInfoDTO.setTaskid(Integer.valueOf(ObjectUtil.toString(map.get("task_id"))));
            taskInfoDTO.setTaskname(ObjectUtil.toString(map.get("task_name")));
            taskInfoDTO.setType(ObjectUtil.toString(map.get("task_type")));
            taskInfoDTO.setMapserver(ObjectUtil.toString(map.get("map_server")));
            taskInfoDTO.setTaskSource(ObjectUtil.toString(map.get("task_source")));
            taskInfoDTO.setBatchId(ObjectUtil.toString(map.get("batch_id")));
            if (map.get("batch_index") != null && !"null".equals(ObjectUtil.toString(map.get("batch_index")))) {
                taskInfoDTO.setBatchIndex(Integer.valueOf(ObjectUtil.toString(map.get("batch_index"))));
            }
            taskInfoDTO.setDaterange(ObjectUtil.toString(map.get("date_range")));
            taskInfoDTO.setStatus(Integer.valueOf(ObjectUtil.toString(map.get("status"))));
            taskInfoDTO.setAuditfeedback(ObjectUtil.toString(map.get("audit_feedback")));
            taskInfoDTO.setUserid(Integer.valueOf(ObjectUtil.toString(map.get("userid"))));
            taskInfoDTO.setUsername(ObjectUtil.toString(map.get("username")));
            taskInfoDTO.setId(Integer.valueOf(ObjectUtil.toString(map.get("id"))));
            taskInfoDTO.setTypeArr(ObjectUtil.toString(map.get("type_arr")));
            taskInfoDTO.setTaskClass(map.get("task_class") != null ? Integer.valueOf(ObjectUtil.toString(map.get("task_class"))) : 0);
            taskInfoDTO.setScore(map.get("score") != null ? Integer.valueOf(ObjectUtil.toString(map.get("score"))) : 0);
            taskInfoDTO.setAnnotationSchema(parseAnnotationSchema(map.get("annotation_schema")));
            taskInfoDTO.setAnnotationSchemaVersion(parseIntegerValue(map.get("annotation_schema_version"), 1));
            list.add(taskInfoDTO);
        }
        return list;
    }

    @Override
    public List<Integer> getIDs() {
        List<Integer> IDs = taskMapper.getIDs();
        return IDs;
    }

    @Override
    public void updateTaskById(int taskId, String taskName, String dateRange, String taskType, String mapServer) {

        taskMapper.updateTaskById(taskId, taskName, dateRange, taskType, mapServer);
    }

    @Override
    public void deleteTaskById(int taskId) {
        taskMapper.deleteById(taskId);
    }

    @Override
    public Task selectTaskById(int taskId) {
        Task task = taskMapper.selectTaskById(taskId);
        return task;
    }

    @Override
    public void updateTaskStatus(int taskId) {
        taskMapper.updateTaskStatus(taskId);
    }

    @Override
    public void auditTask(int taskId, int status, String auditFeedback) {
        taskMapper.auditTask(taskId, status, auditFeedback);
    }

    @Override
    public int getTotalTasks() {
        return (int) count();
    }

    @Override
    public List<Map<String, Object>> findAllTask() {
        System.out.println(231);
        List<Map<String, Object>> taskDatasetInfos = taskMapper.findAllTask();
        System.out.println(taskDatasetInfos);
        return taskDatasetInfos;
    }

    @Override
    public List<Map<String, Object>> findPublicTask() {
        List<Map<String, Object>> taskDatasetInfos = taskMapper.findPublicTask();
        return taskDatasetInfos;
    }

    @Override
    public List<Map<String, Object>> findTasksByUsername(String username) {
        List<Map<String, Object>> taskAccepted = taskMapper.findTasksByUsername(username);
        return taskAccepted;
    }

    @Override
    public List<String> findUserListByTaskId(int taskId) {
        List<String> usernameList = taskMapper.findUserListByTaskId(taskId);
        return usernameList;
    }

    @Override
    public void updateTask(int taskId, String markIdStr) {
        taskMapper.updateTask(taskId, markIdStr);
    }

    @Override
    public String getServerById(int taskId) {
        String serverName = taskMapper.getServerById(taskId);
        return serverName;
    }

    @Override
    public String getTypeById(int taskId) {
        String taskType = taskMapper.getTypeById(taskId);
        return taskType;
    }

    @Override
    public String getMarkIdById(int taskId) {
        Task task = getById(taskId);
        return ObjectUtil.isNotNull(task) && task.getMarkId() != null ? task.getMarkId() : null;
    }

    /**
     * 获取管理员创建的任务
     *
     * @param creatorUserId 创建者ID
     * @return 任务列表
     */
    @Override
    public List<TaskInfoDTO> getTasksByCreatorId(Integer creatorUserId) {
        List<Map<String, Object>> mapList = taskMapper.getTasksByCreatorId(creatorUserId);
        ArrayList<TaskInfoDTO> list = new ArrayList<>();
        for (Map map : mapList) {
            TaskInfoDTO taskInfoDTO = new TaskInfoDTO();
            taskInfoDTO.setTaskid(Integer.valueOf(ObjectUtil.toString(map.get("task_id"))));
            taskInfoDTO.setTaskname(ObjectUtil.toString(map.get("task_name")));
            taskInfoDTO.setType(ObjectUtil.toString(map.get("task_type")));
            taskInfoDTO.setMapserver(ObjectUtil.toString(map.get("map_server")));
            taskInfoDTO.setTaskSource(ObjectUtil.toString(map.get("task_source")));
            taskInfoDTO.setBatchId(ObjectUtil.toString(map.get("batch_id")));
            if (map.get("batch_index") != null && !"null".equals(ObjectUtil.toString(map.get("batch_index")))) {
                taskInfoDTO.setBatchIndex(Integer.valueOf(ObjectUtil.toString(map.get("batch_index"))));
            }
            taskInfoDTO.setDaterange(ObjectUtil.toString(map.get("date_range")));
            taskInfoDTO.setStatus(Integer.valueOf(ObjectUtil.toString(map.get("status"))));
            taskInfoDTO.setAuditfeedback(ObjectUtil.toString(map.get("audit_feedback")));
            taskInfoDTO.setTaskClass(map.get("task_class") != null ? Integer.valueOf(ObjectUtil.toString(map.get("task_class"))) : 0);
            taskInfoDTO.setScore(map.get("score") != null ? Integer.valueOf(ObjectUtil.toString(map.get("score"))) : 0);
            taskInfoDTO.setAnnotationSchema(parseAnnotationSchema(map.get("annotation_schema")));
            taskInfoDTO.setAnnotationSchemaVersion(parseIntegerValue(map.get("annotation_schema_version"), 1));
            list.add(taskInfoDTO);
        }
        return list;
    }

    /**
     * 更新任务的submitter_id为指定用户ID
     *
     * @param taskId 任务ID
     * @param userId 用户ID
     */
    @Override
    public void updateTaskSubmitter(Integer taskId, Integer userId) {
        taskMapper.updateTaskSubmitter(taskId, userId);
    }

    /**
     * 更新任务的积分
     *
     * @param taskId 任务ID
     * @param score  积分
     */
    @Override
    public void updateTaskScore(Integer taskId, Integer score) {
        taskMapper.updateTaskScore(taskId, score);
    }

    @Override
    public int createLocalTask(String localImagePath, String taskName, String taskType,
                               Integer userId, Integer taskClass, String dateRange) {
        Task task = new Task();
        task.setStatus(3);
        task.setDateRange(dateRange);
        task.setTaskName(taskName);
        task.setTaskType(taskType);
        task.setTaskSource("local");
        task.setLocalImagePath(localImagePath);
        task.setMapServer("local:" + taskName); // 占位，标识本地任务
        task.setServerId(0); // 本地任务无GeoServer服务，用0占位
        task.setUserId(userId);
        task.setTaskClass(taskClass);
        task.setScore(0);
        boolean isSaved = save(task);
        return isSaved ? task.getTaskId() : -1;
    }

    @Override
    public boolean isLocalTask(int taskId) {
        Task task = taskMapper.selectTaskById(taskId);
        return task != null && "local".equals(task.getTaskSource());
    }

    private JSONObject parseAnnotationSchema(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof JSONObject) {
            return (JSONObject) value;
        }
        if (value instanceof Map) {
            return new JSONObject((Map<String, Object>) value);
        }
        String raw = String.valueOf(value).trim();
        if (raw.isEmpty() || "null".equalsIgnoreCase(raw)) {
            return null;
        }
        try {
            return JSON.parseObject(raw);
        } catch (Exception ignored) {
            return null;
        }
    }

    private Integer parseIntegerValue(Object value, Integer defaultValue) {
        if (value == null) {
            return defaultValue;
        }
        try {
            return Integer.valueOf(ObjectUtil.toString(value));
        } catch (Exception ignored) {
            return defaultValue;
        }
    }
}
