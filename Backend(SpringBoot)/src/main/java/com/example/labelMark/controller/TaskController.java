package com.example.labelMark.controller;
import cn.hutool.core.util.ObjectUtil;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.labelMark.DTO.prov.ProvEntityRef;
import com.example.labelMark.config.MinioConfig;
import com.example.labelMark.domain.Dataset;
import com.example.labelMark.domain.Mark;
import com.example.labelMark.domain.Server;
import com.example.labelMark.domain.SysFile;
import com.example.labelMark.domain.SysUser;
import com.example.labelMark.domain.Task;
import com.example.labelMark.domain.TaskDatasetInfo;
import com.example.labelMark.domain.Type;
import com.example.labelMark.service.DatasetService;
import com.example.labelMark.service.MarkService;
import com.example.labelMark.service.ServerService;
import com.example.labelMark.service.AttributeDefService;
import com.example.labelMark.service.SysFileService;
import com.example.labelMark.service.SysUserService;
import com.example.labelMark.service.TaskAcceptedService;
import com.example.labelMark.service.TaskService;
import com.example.labelMark.service.TaskTypeAttributeService;
import com.example.labelMark.service.ProvenanceService;
import com.example.labelMark.service.TypeService;
import com.example.labelMark.service.TaskExecutorService;
import com.example.labelMark.service.TaskNotificationService;
import com.example.labelMark.utils.ResultGenerator;
import com.example.labelMark.vo.LoginUser;
import com.example.labelMark.vo.TaskInfoDTO;
import com.example.labelMark.vo.constant.Result;
import com.example.labelMark.vo.constant.StatusEnum;
import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.minio.GetObjectArgs;
import io.minio.MinioClient;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.models.auth.In;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.imageio.ImageIO;
import javax.validation.constraints.Pattern;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

import static com.example.labelMark.utils.CoordinateConverter.convertGeojson;

/**
 * <p>
 * 前端控制器
 * </p>
 *
 */
@RestController
@RequestMapping("/task")
@Api(tags = "TASK业务控制器")
public class TaskController {
    private static final Logger log = LoggerFactory.getLogger(TaskController.class);
    private static final Map<Integer, JSONObject> TASK_ANNOTATION_SCHEMA_CACHE = new ConcurrentHashMap<>();

    @Value("${geoserver.localCoverageDir}")
    private String localCoverageDir;

    @Value("${modal.path}")
    private String modalPath;
    @Value("${minio.uploaddir:}")
    private String minioUploadDir;
    @Resource
    private TaskService taskService;
    @Resource
    private TypeService typeService;
    @Resource
    private SysUserService sysUserService;
    @Resource
    private TaskAcceptedService taskAcceptedService;
    @Resource
    private MarkService markService;
    @Resource
    private TaskExecutorService taskExecutorService;
    @Resource
    private TaskNotificationService taskNotificationService;
    @Resource
    private DatasetService datasetService;
    @Resource
    private SysFileService sysFileService;
    @Resource
    private ServerService serverService;
    @Resource
    private ProvenanceService provenanceService;
    @Resource
    private AttributeDefService attributeDefService;
    @Resource
    private TaskTypeAttributeService taskTypeAttributeService;
    @Resource
    private MinioClient minioClient;
    @Resource
    private MinioConfig minioConfig;
    @Resource
    private ApplicationContext applicationContext;


    @PostMapping("/createTask")
    @ApiOperation("创建任务")
    public Result createTask(String dataRange, String taskName, String taskType, String mapServer) {
        // 获取当前登录用户信息
        LoginUser loginUser = (LoginUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        SysUser currentUser = loginUser.getSysUser();
        int taskId = taskService.createTask(dataRange, taskName, taskType, mapServer, currentUser.getUserid(), 0);
        if (taskId != -1) {
            recordTaskCreateProvenance(taskId, currentUser.getUserid());
            return ResultGenerator.getSuccessResult("插入成功");
        }
        return ResultGenerator.getSuccessResult("插入失败");
    }

    @PostMapping("/publishTask")
    @ApiOperation("创建任务,包括保存关联的指定任务用户和类型")
    public Result publishTask(@RequestBody Map<String, Object> map) {
        // 获取当前登录用户信息
        LoginUser loginUser = (LoginUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        SysUser currentUser = loginUser.getSysUser();
        Integer creatorUserId = currentUser.getUserid();
        Integer teamId = currentUser.getTeamId(); // 获取当前用户的teamId
        // Integer userid = currentUser.getUserid(); // creatorUserId 就是当前用户ID，这个可以移除或注释掉

        ArrayList<String> dateRange = (ArrayList<String>) map.get("daterange");
        String taskName = map.get("taskname").toString();
        String taskType = map.get("type").toString();
        String mapServerId = map.get("mapserver").toString();
        String dateRangeStr = dateRange.get(0) + " " + dateRange.get(1);

        // 获取积分值（如果有）
        Integer taskScore = 0;
        if (map.containsKey("score") && map.get("score") != null) {
            try {
                Object scoreObj = map.get("score");
                if (scoreObj instanceof Integer) {
                    taskScore = (Integer) scoreObj;
                } else if (scoreObj instanceof Double) { // 处理前端可能传Double的情况
                    taskScore = ((Double) scoreObj).intValue();
                } else {
                    String scoreStr = scoreObj.toString().trim();
                    if (!scoreStr.isEmpty()) {
                        taskScore = (int) Double.parseDouble(scoreStr);
                    }
                }
                if (taskScore < 0) taskScore = 0; // 确保积分为非负
            } catch (NumberFormatException e) {
                taskScore = 0; // 解析失败默认为0
            }
        }

        // 获取目标用户类型和对应的数据
        String targetUserType = map.get("targetUserType").toString();
        int taskClass = 0; // 0: 团队相关, 1: 非团队相关 (个人或公开)

        // 判断任务类型 (taskClass)
        if (currentUser.getIsadmin() == 0) { // 普通用户发布
            targetUserType = "allNonAdminUsers"; // 普通用户只能发布给所有非管理员
            taskClass = 1; // 标记为非团队任务
        } else { // 管理员发布
            if ("allNonTeamUsers".equals(targetUserType)) {
                taskClass = 1; // 非团队任务
            } else if ("specificTeamUsers".equals(targetUserType) || "allTeamMembers".equals(targetUserType)) {
                taskClass = 0; // 团队任务
            } else {
                return ResultGenerator.getFailResult("无效的目标用户类型");
            }
        }

        // 非团队任务(taskClass=1)且设置了积分(taskScore > 0)，则检查并扣除创建者积分
        if (taskClass == 1 && taskScore > 0) {
            Integer creatorCurrentScore = currentUser.getScore() != null ? currentUser.getScore() : 0;
            if (creatorCurrentScore < taskScore) {
                return ResultGenerator.getFailResult("积分不足，无法创建任务。您需要 " + taskScore + " 积分，当前拥有 " + creatorCurrentScore + " 积分。");
            }
            boolean subtractSuccess = sysUserService.subtractUserScore(creatorUserId, taskScore);
            if (!subtractSuccess) {
                return ResultGenerator.getFailResult("扣除发布者积分失败，请重试");
            }
        }

        // 创建任务
        int taskId = taskService.createTask(dateRangeStr, taskName, taskType, mapServerId, creatorUserId, taskClass);

        if (taskId == -1) {
            // 如果任务创建失败，并且之前扣除了积分，则回滚积分
            if (taskClass == 1 && taskScore > 0) {
                sysUserService.addUserScore(creatorUserId, taskScore); // 归还积分
            }
            return ResultGenerator.getFailResult("创建任务主体失败");
        }

        // 如果任务创建成功，且设置了任务积分，则更新任务表中的score字段
        if (taskScore > 0) {
            taskService.updateTaskScore(taskId, taskScore);
        }
        applyTaskAnnotationSchema(taskId, map);
        applyTaskTypeAttributes(taskId, map);
        recordTaskCreateProvenance(taskId, creatorUserId);

        // ... (后续分配任务给用户的逻辑)
        List<SysUser> targetUsers = new ArrayList<>();
        Integer currentUserId = currentUser.getUserid(); // 用一个新变量存储，避免混淆
        Set<String> assignedUsernames = new LinkedHashSet<>();

        // 普通用户发布任务 (targetUserType 已经固定为 allNonAdminUsers)
        if (currentUser.getIsadmin() == 0) {
            targetUsers = sysUserService.getAllNonAdminUsers();
            targetUsers.removeIf(user -> user.getUserid().equals(currentUserId)); // 排除创建者自己

            List<?> rawSelectedSampleTypes = (List<?>) map.get("selectedSampleTypes");
            List<String> typeIdListForNonAdmin = new ArrayList<>();
            if (rawSelectedSampleTypes != null) {
                for (Object typeId : rawSelectedSampleTypes) {
                    typeIdListForNonAdmin.add(String.valueOf(typeId));
                }
            }
            String commonTypeStr = String.join(",", typeIdListForNonAdmin);
            for (SysUser user : targetUsers) {
                if (!taskAcceptedService.createTaskAccept(taskId, user.getUsername(), commonTypeStr)) {
                    // 注意：部分失败时的处理，是否要回滚已创建的task_accepted记录，或者整个事务回滚
                    return ResultGenerator.getFailResult("为用户 '" + user.getUsername() + "' 分配任务失败");
                }
                assignedUsernames.add(user.getUsername());
            }
        }
        // 管理员发布任务
        else {
            if ("allTeamMembers".equals(targetUserType)) {
                if (teamId == null) return ResultGenerator.getFailResult("管理员无团队信息，无法分配给所有团队成员");
                targetUsers = sysUserService.getUsersByTeamIdAndNotAdmin(teamId);
                targetUsers.removeIf(user -> user.getUserid().equals(currentUserId));

                List<?> rawSelectedSampleTypes = (List<?>) map.get("selectedSampleTypes");
                List<String> typeIdListForAllTeam = new ArrayList<>();
                if (rawSelectedSampleTypes != null) {
                    for (Object typeId : rawSelectedSampleTypes) {
                        typeIdListForAllTeam.add(String.valueOf(typeId));
                    }
                }
                String commonTypeStr = String.join(",", typeIdListForAllTeam);
                for (SysUser user : targetUsers) {
                    if (!taskAcceptedService.createTaskAccept(taskId, user.getUsername(), commonTypeStr)) {
                        return ResultGenerator.getFailResult("为团队成员 '" + user.getUsername() + "' 分配任务失败");
                    }
                    assignedUsernames.add(user.getUsername());
                }
            } else if ("allNonTeamUsers".equals(targetUserType)) {
                targetUsers = sysUserService.getNonTeamUsersAndNotAdmin(teamId); // teamId 用于排除团队成员
                targetUsers.removeIf(user -> user.getUserid().equals(currentUserId));

                List<?> rawSelectedSampleTypes = (List<?>) map.get("selectedSampleTypes");
                List<String> typeIdListForAllNonTeam = new ArrayList<>();
                 if (rawSelectedSampleTypes != null) {
                    for (Object typeId : rawSelectedSampleTypes) {
                        typeIdListForAllNonTeam.add(String.valueOf(typeId));
                    }
                }
                String commonTypeStr = String.join(",", typeIdListForAllNonTeam);
                for (SysUser user : targetUsers) {
                    if (!taskAcceptedService.createTaskAccept(taskId, user.getUsername(), commonTypeStr)) {
                        return ResultGenerator.getFailResult("为非团队用户 '" + user.getUsername() + "' 分配任务失败");
                    }
                    assignedUsernames.add(user.getUsername());
                }
            } else if ("specificTeamUsers".equals(targetUserType)) {
                if (teamId == null) return ResultGenerator.getFailResult("管理员无团队信息，无法分配给指定团队用户");
                ArrayList<Map<String, Object>> specificUserAssignments = (ArrayList<Map<String, Object>>) map.get("specificUserAssignments");
                if (specificUserAssignments == null || specificUserAssignments.isEmpty()) {
                    return ResultGenerator.getFailResult("未指定任何用户进行任务分配");
                }
                for (Map<String, Object> assignment : specificUserAssignments) {
                    String username = assignment.get("username").toString();
                    SysUser targetUser = sysUserService.findByUsername(username);
                    // 确保用户存在且是团队成员 (或者如果允许分配给非团队的特定用户，则调整此逻辑)
                    if (targetUser == null || !teamId.equals(targetUser.getTeamId())) {
                         return ResultGenerator.getFailResult("用户 '" + username + "' 不存在或不属于您的团队");
                    }
//                    if (targetUser.getUserid().equals(currentUserId)) continue; // 不能分配给自己

                    List<?> rawTypeArr = (List<?>) assignment.get("typeArr");
                    List<String> typeStrList = new ArrayList<>();
                    if (rawTypeArr != null) {
                        for (Object typeId : rawTypeArr) {
                            typeStrList.add(String.valueOf(typeId));
                        }
                    }
                    if (typeStrList.isEmpty()) {
                         return ResultGenerator.getFailResult("未给用户 '" + username + "' 分配任何样本类型");
                    }
                    String typeStr = String.join(",", typeStrList);
                    if (!taskAcceptedService.createTaskAccept(taskId, username, typeStr)) {
                        return ResultGenerator.getFailResult("为特定用户 '" + username + "' 分配任务失败");
                    }
                    assignedUsernames.add(username);
                }
            }
        }
        recordTaskAssignProvenance(taskId, creatorUserId, targetUserType, assignedUsernames);
        return ResultGenerator.getSuccessResult("任务创建及分配成功");
    }

    @GetMapping("/getTaskInfo")
    @ApiOperation("获取任务")
    public Map<String, Object> getTaskInfo(@RequestParam(required = false) Integer taskid,
                                           @RequestParam(required = false) Integer current,
                                           @RequestParam(required = false) Integer pageSize,
                                           @RequestParam(required = false) String taskname,
                                           @RequestParam(required = false) String userArr,
                                           @RequestParam(required = false) String userId,
                                           @RequestParam(required = false) Integer status) {

        // 无参时默认值
        if (ObjectUtil.isEmpty(current)) {
            current = 1;
        }
        if (ObjectUtil.isEmpty(pageSize)) {
            pageSize = 5;
        }

        List<TaskInfoDTO> result = new ArrayList<>();
        int taskCount = 0;

        // 无论是普通用户还是管理员，都只能看到自己创建的任务,但是没传输用户信息就不限制
        Integer requestingUserId = null;
        if (ObjectUtil.isNotEmpty(userId)) {
            requestingUserId = Integer.valueOf(userId);
        }
        result = taskService.getTasksByCreatorId(requestingUserId);
        taskCount = result.size();

        // 补充用户和类型信息
        for (TaskInfoDTO taskInfo : result) {
            int taskId = taskInfo.getTaskid();

            // 获取任务相关的用户信息
            List<Map<String, Object>> userArrOrigin = new ArrayList<>();
            List<String> usernames = taskService.findUserListByTaskId(taskId);

            for (String username : usernames) {
                SysUser user = sysUserService.findByUsername(username);
                if (user != null) {
                    // 获取分配给该用户的类型
                    String typeString = taskAcceptedService.getTypeArrByTaskIdAndUsername(taskId, username);
                    List<Type> typeArr = new ArrayList<>();

                    if (typeString != null && !typeString.isEmpty()) {
                        List<Integer> typeIds = Arrays.stream(typeString.split(","))
                                .map(Integer::parseInt)
                                .collect(Collectors.toList());

                        for (Integer typeId : typeIds) {
                            String typeName = typeService.getTypeNameById(typeId);
                            List<Type> types = typeService.getTypes(current, pageSize, typeId, typeName);
                            if (!types.isEmpty()) {
                                typeArr.add(types.get(0));
                            }
                        }
                    }

                    Map<String, Object> info = new HashMap<>();
                    info.put("userid", user.getUserid());
                    info.put("username", user.getUsername());
                    info.put("typeArr", typeArr);
                    userArrOrigin.add(info);
                }
            }

            taskInfo.setUserArr(userArrOrigin);
        }

        // 特定任务ID过滤
        if (taskid != null) {
            result = result.stream()
                    .filter(item -> taskid.equals(item.getTaskid()))
                    .collect(Collectors.toList());
        }

        // 模糊查询：按任务名
        if (taskname != null && !taskname.isEmpty()) {
            result = result.stream()
                    .filter(item -> item.getTaskname().contains(taskname))
                    .collect(Collectors.toList());
        }

        // 状态过滤
        if (status != null) {
            result = result.stream()
                    .filter(item -> status.equals(item.getStatus()))
                    .collect(Collectors.toList());
        }

        List<Mark> marks = new ArrayList<>();
        if (taskid != null) {
            marks = markService.getMarkByTaskId(taskid);
        }

        // 计算过滤后的总数
        int filteredTotal = result.size();

        // 计算起始索引和结束索引，实现分页
        int startIndex = (current - 1) * pageSize;
        int endIndex = Math.min(startIndex + pageSize, result.size());

        // 防止索引越界
        if (startIndex < result.size()) {
            result = result.subList(startIndex, endIndex);
        } else {
            result = new ArrayList<>();
        }

        Map<String, Object> response = new HashMap<>();
        response.put("code", 200);
        response.put("data", result);
        response.put("success", true);
        response.put("markGeoJsonArr", convertGeojson(marks));
        response.put("total", filteredTotal); // 返回过滤后的总数
        return response;
    }

    @PutMapping("/updateTask")
    public Result updateTask(@RequestBody Map<String, Object> map) {
        ArrayList<String> dateRange = (ArrayList<String>) map.get("daterange");
        String taskName = map.get("taskname").toString();
        String taskType = map.get("type").toString();
        ArrayList<String> usernameAndTypeArr = (ArrayList<String>) map.get("userArr");
        String mapServer = map.get("mapserver").toString();
        Integer taskId = Integer.valueOf(map.get("taskid").toString());
//        拼接起止日期
        String dateRangeStr = dateRange.get(0) + " " + dateRange.get(1);

        taskService.updateTaskById(taskId, taskName, dateRangeStr, taskType, mapServer);
        applyTaskAnnotationSchema(taskId, map);
        applyTaskTypeAttributes(taskId, map);

        //        拆解用户和所属类型
        String username, typeArr = "";
        for (String usernameAndType : usernameAndTypeArr) {
            String[] usernameAndTypeStr = usernameAndType.split(",");
            username = usernameAndTypeStr[0];
            for (int i = 1; i < usernameAndTypeStr.length; i++) {
                if (i == usernameAndTypeStr.length - 1) {
                    typeArr += usernameAndTypeStr[i];
                } else {
                    typeArr += usernameAndTypeStr[i] + ",";
                }
            }
            boolean isUpdate = taskAcceptedService.createTaskAccept(taskId, username, typeArr);
//            重置
            typeArr = "";
            if (isUpdate == false) {
                return ResultGenerator.getSuccessResult("插入接收任务失败");
            }
        }
        return ResultGenerator.getSuccessResult("任务更新成功");
        }

    @DeleteMapping("/deleteTask/{taskId}")
    @Transactional(rollbackFor = Exception.class)
    public Result deleteTask(@PathVariable int taskId) {
        taskAcceptedService.deleteTaskAcceptByTaskId(taskId);
        taskService.deleteTaskById(taskId);
        markService.deleteMarkByTaskId(taskId);
        provenanceService.deleteByBusinessIdsAndTypes(
                Collections.singletonList(String.valueOf(taskId)),
                Collections.singletonList("TASK")
        );
        return ResultGenerator.getSuccessResult("任务删除成功");
    }

    @PostMapping("/submitTask")
    public Result submitTask(@RequestBody Map<String, Object> map) {
        Integer taskId = (Integer) map.get("taskid");
        if (markService.GetTaskIdNum(taskId) == 0) {
            return ResultGenerator.getFailResult("未开始标注");
        }
        taskService.updateTaskStatus(taskId);
        return ResultGenerator.getSuccessResult("任务提交成功，审核中");
    }

    @PostMapping("/auditTask")
    public Result auditTask(@RequestBody Map<String, Object> map) {
        Integer taskId = Integer.valueOf(map.get("taskId").toString());
        Integer status = Integer.valueOf(map.get("status").toString());
        String auditFeedback = ObjectUtil.toString(map.get("auditFeedback"));

        taskService.auditTask(taskId, status, auditFeedback);

        // 如果审核通过 (status == 1)，给提交者增加积分
        if (status == 1) {
            Task task = taskService.selectTaskById(taskId);
            if (task != null && task.getSubmitterId() != null && task.getScore() != null && task.getScore() > 0) {
                Integer submitterId = task.getSubmitterId();
                Integer taskScore = task.getScore();
                boolean addScoreSuccess = sysUserService.addUserScore(submitterId, taskScore);
                if (!addScoreSuccess) {
                    // 记录日志或进行其他错误处理，但通常不应阻止审核通过的流程
                    System.err.println("为用户 " + submitterId + " 增加积分 " + taskScore + " 失败，任务ID: " + taskId);
                }
            }
        }
        return ResultGenerator.getSuccessResult("审核成功");
    }

    @GetMapping("/getPersonalTaskList")
    @ApiOperation("获取分配给当前用户的任务列表")
    public Map<String, Object> getPersonalTaskList(@RequestParam(required = false) Integer taskid,
                                           @RequestParam(required = false) Integer current,
                                           @RequestParam(required = false) Integer pageSize,
                                           @RequestParam(required = false) String taskname,
                                           @RequestParam(required = false) Integer taskClass) {

        // 获取当前登录用户信息
        LoginUser loginUser = (LoginUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        SysUser currentUser = loginUser.getSysUser();
        String username = currentUser.getUsername();
        Integer userId = currentUser.getUserid();
        // 无参时默认值
        if (ObjectUtil.isEmpty(current)) {
            current = 1;
        }
        if (ObjectUtil.isEmpty(pageSize)) {
            pageSize = 5;
        }

        // 获取分配给当前用户的任务
        List<TaskInfoDTO> list = taskService.getTaskInfo(username);

        List<TaskInfoDTO> result = new ArrayList<>();

        // 处理任务信息
        for (TaskInfoDTO taskInfo : list) {
            // 标记已经存在的同一任务taskInfo对象
            TaskInfoDTO existingObj = null;
            int index = -1;
            for (int i = 0; i < result.size(); i++) {
                if (ObjectUtil.equals(result.get(i).getTaskid(), taskInfo.getTaskid())) {
                    existingObj = result.get(i);
                    index = i;
                }
            }
            // 处理typestring得到有效信息
            String typestring = taskInfo.getTypeArr();
            // 标注地图时才需要遍历标签方案
            List<Integer> type = new ArrayList<>();
            if (typestring != null && !typestring.isEmpty()) {
                type = Arrays.stream(typestring.split(","))
                        .map(Integer::parseInt)
                        .collect(Collectors.toList());
            }
            List<Type> typeArr = new ArrayList<>();
            if (ObjectUtil.isNotNull(taskInfo.getTaskid())) {
                for (Integer typeId : type) {
                    Type safeType = resolveTypeById(typeId);
                    if (safeType != null) {
                        typeArr.add(safeType);
                    }
                }
            }
            Map<String, Object> info = new HashMap<>();
            info.put("userid", taskInfo.getUserid());
            info.put("username", taskInfo.getUsername());
            info.put("id", taskInfo.getId());
            info.put("typeArr", typeArr);
            if (existingObj != null) {
                // 如果已经存在，直接将用户信息添加到 userArr 数组中
                List<Map<String, Object>> userArrOrigin = existingObj.getUserArr();
                userArrOrigin.add(info);
                taskInfo.setUserArr(userArrOrigin);
                // 确保保留taskClass值
                taskInfo.setTaskClass(existingObj.getTaskClass());
                result.set(index, taskInfo);
            } else {
                List<Map<String, Object>> userArrOrigin = new ArrayList<>();
                userArrOrigin.add(info);
                taskInfo.setUserArr(userArrOrigin);
                // 确保从数据库获取的taskClass值已经设置
                if (taskInfo.getTaskClass() == null) {
                    Task task = taskService.selectTaskById(taskInfo.getTaskid());
                    if (task != null) {
                        taskInfo.setTaskClass(task.getTaskClass());
                    } else {
                        // 默认为团队任务
                        taskInfo.setTaskClass(0);
                    }
                }
                result.add(taskInfo);
            }
        }

        // 后端过滤：排除状态为1（审核通过）的任务
        result = result.stream()
                .filter(item -> item.getStatus() != 1)
                .collect(Collectors.toList());

        // 后端过滤：按任务类型过滤
        if (taskClass != null) {
            result = result.stream()
                    .filter(item -> {
                        Integer itemTaskClass = item.getTaskClass();
                        if (itemTaskClass == null) {
                            itemTaskClass = 0; // 默认为团队任务
                        }
                        return taskClass.equals(itemTaskClass);
                    })
                    .collect(Collectors.toList());
        }

        // 模糊查询：按任务名
        if (taskname != null && !taskname.isEmpty()) {
            result = result.stream()
                    .filter(item -> item.getTaskname().contains(taskname))
                    .collect(Collectors.toList());
        }

        // 特定任务ID过滤
        if (taskid != null) {
            result = result.stream()
                    .filter(item -> taskid.equals(item.getTaskid()))
                    .collect(Collectors.toList());
        }

        // 计算过滤后的总数
        int filteredTotal = result.size();

        List<Mark> marks = new ArrayList<>();
        if (taskid != null) {
            marks = markService.getMarkByTaskId(taskid);
        }

        // 计算起始索引和结束索引，实现分页
        int startIndex = (current - 1) * pageSize;
        int endIndex = Math.min(startIndex + pageSize, result.size());

        // 防止索引越界
        if (startIndex < result.size()) {
            result = result.subList(startIndex, endIndex);
        } else {
            result = new ArrayList<>();
        }

        Map<String, Object> response = new HashMap<>();
        response.put("code", 200);
        response.put("data", result);
        response.put("success", true);
        response.put("markGeoJsonArr", convertGeojson(marks));
        response.put("total", filteredTotal); // 返回过滤后的总数
        return response;
    }

    @GetMapping("/getMarkTaskDetail")
    @ApiOperation("获取标注页面所需的任务详情，专用于标注界面")
    public Map<String, Object> getMarkTaskDetail(@RequestParam Integer taskid) {
        // 获取当前登录用户信息
        LoginUser loginUser = (LoginUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        SysUser currentUser = loginUser.getSysUser();
        String username = currentUser.getUsername();
        Integer userId = currentUser.getUserid();

        // 获取任务详情
        Task task = taskService.selectTaskById(taskid);
        if (task == null) {
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("code", 400);
            errorResponse.put("message", "任务不存在");
            return errorResponse;
        }

        // 创建标准化的任务信息对象
        TaskInfoDTO taskInfo = new TaskInfoDTO();
        taskInfo.setTaskid(task.getTaskId());
        taskInfo.setTaskname(task.getTaskName());
        taskInfo.setType(task.getTaskType());
        taskInfo.setMapserver(task.getMapServer());
        taskInfo.setDaterange(task.getDateRange());
        taskInfo.setStatus(task.getStatus());
        taskInfo.setAuditfeedback(task.getAuditFeedback());
        taskInfo.setTaskClass(task.getTaskClass());
        taskInfo.setScore(task.getScore());
        taskInfo.setAnnotationSchema(getCachedTaskAnnotationSchema(task));
        taskInfo.setAnnotationSchemaVersion(task.getAnnotationSchemaVersion() == null ? 1 : task.getAnnotationSchemaVersion());

        // 获取与该任务关联的用户信息
        List<Map<String, Object>> userArrOrigin = new ArrayList<>();
        List<String> usernames = taskService.findUserListByTaskId(taskid);

        for (String user : usernames) {
            SysUser userObj = sysUserService.findByUsername(user);
            if (userObj != null) {
                // 获取分配给该用户的类型
                String typeString = taskAcceptedService.getTypeArrByTaskIdAndUsername(taskid, user);
                List<Type> typeArr = new ArrayList<>();

                if (typeString != null && !typeString.isEmpty()) {
                    List<Integer> typeIds = Arrays.stream(typeString.split(","))
                            .map(Integer::parseInt)
                            .collect(Collectors.toList());

                    for (Integer typeId : typeIds) {
                        Type safeType = resolveTypeById(typeId);
                        if (safeType != null) {
                            typeArr.add(safeType);
                        }
                    }
                }

                Map<String, Object> info = new HashMap<>();
                info.put("userid", userObj.getUserid());
                info.put("username", userObj.getUsername());
                info.put("typeArr", typeArr);
                userArrOrigin.add(info);
            }
        }

        taskInfo.setUserArr(userArrOrigin);
        // 获取标注数据
        List<Mark> marks = markService.getMarkByTaskId(taskid);

        // 构建响应
        Map<String, Object> response = new HashMap<>();
        List<TaskInfoDTO> resultList = new ArrayList<>();
        resultList.add(taskInfo);

        response.put("code", 200);
        response.put("data", resultList);
        response.put("success", true);
        response.put("markGeoJsonArr", convertGeojson(marks));
        response.put("taskTypeAttributes", taskTypeAttributeService.getTaskTypeAttributeDetails(taskid, null));
        // 返回任务来源信息，前端据此决定加载GeoServer还是本地图片
        response.put("taskSource", task.getTaskSource() != null ? task.getTaskSource() : "geoserver");
        response.put("localImagePath", task.getLocalImagePath());
        return response;
    }

    @PostMapping("/publishLocalTask")
    @ApiOperation("创建本地图片任务（无需GeoServer，支持无坐标系TIF）")
    public Result publishLocalTask(@RequestBody Map<String, Object> map) {
        LoginUser loginUser = (LoginUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        SysUser currentUser = loginUser.getSysUser();
        Integer creatorUserId = currentUser.getUserid();
        Integer teamId = currentUser.getTeamId();

        String taskName = map.get("taskname").toString();
        String taskType = map.get("type").toString();
        String localImagePath = resolveExistingLocalImagePath(String.valueOf(map.get("localImagePath")));
        ArrayList<String> dateRange = (ArrayList<String>) map.get("daterange");
        String dateRangeStr = dateRange.get(0) + " " + dateRange.get(1);

        String targetUserType = String.valueOf(map.getOrDefault("targetUserType", ""));
        if (currentUser.getIsadmin() == 0) {
            targetUserType = "allNonAdminUsers";
        }
        int taskClass = currentUser.getIsadmin() == 0 ? 1 :
                ("allNonTeamUsers".equals(targetUserType) ? 1 : 0);
        Integer scorePerTask = parseScore(map.get("score"));

        // 验证本地文件是否存在
        File imageFile = new File(localImagePath);
        if (!imageFile.exists() || !imageFile.isFile()) {
            return ResultGenerator.getFailResult("本地图片文件不存在: " + localImagePath);
        }

        if (taskClass == 1 && scorePerTask > 0) {
            Integer creatorCurrentScore = currentUser.getScore() != null ? currentUser.getScore() : 0;
            if (creatorCurrentScore < scorePerTask) {
                return ResultGenerator.getFailResult("积分不足，无法创建任务。您需要 " + scorePerTask + " 积分，当前拥有 " + creatorCurrentScore + " 积分。");
            }
            boolean subtractSuccess = sysUserService.subtractUserScore(creatorUserId, scorePerTask);
            if (!subtractSuccess) {
                return ResultGenerator.getFailResult("扣除发布者积分失败，请重试");
            }
        }

        int taskId = taskService.createLocalTask(localImagePath, taskName, taskType,
                creatorUserId, taskClass, dateRangeStr);
        if (taskId == -1) {
            if (taskClass == 1 && scorePerTask > 0) {
                sysUserService.addUserScore(creatorUserId, scorePerTask);
            }
            return ResultGenerator.getFailResult("创建本地任务失败");
        }

        if (scorePerTask > 0) {
            taskService.updateTaskScore(taskId, scorePerTask);
        }
        applyTaskAnnotationSchema(taskId, map);
        applyTaskTypeAttributes(taskId, map);
        recordTaskCreateProvenance(taskId, creatorUserId);

        Result assignResult = assignUsersForTask(taskId, map, currentUser, targetUserType, teamId, creatorUserId);
        if (assignResult.getCode() != 200) {
            return assignResult;
        }

        return ResultGenerator.getSuccessResult("本地任务创建成功");
    }

    @PostMapping("/publishTaskBySet")
    @ApiOperation("按影像集批量创建任务：服务影像集走GeoServer，本地影像集走本地任务")
    public Result publishTaskBySet(@RequestBody Map<String, Object> map) {
        LoginUser loginUser = (LoginUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        SysUser currentUser = loginUser.getSysUser();
        Integer creatorUserId = currentUser.getUserid();
        Integer teamId = currentUser.getTeamId();

        List<String> dateRange = (List<String>) map.get("daterange");
        if (dateRange == null || dateRange.size() != 2) {
            return ResultGenerator.getFailResult("任务期限参数无效");
        }
        String dateRangeStr = dateRange.get(0) + " " + dateRange.get(1);
        String taskName = String.valueOf(map.getOrDefault("taskname", "")).trim();
        String taskType = String.valueOf(map.getOrDefault("type", "")).trim();
        if (taskName.isEmpty() || taskType.isEmpty()) {
            return ResultGenerator.getFailResult("任务名称或任务类型不能为空");
        }

        List<String> setNames = (List<String>) map.get("setNames");
        if (setNames == null || setNames.isEmpty()) {
            return ResultGenerator.getFailResult("至少选择一个影像集");
        }

        String targetUserType = String.valueOf(map.getOrDefault("targetUserType", ""));
        if (currentUser.getIsadmin() == 0) {
            targetUserType = "allNonAdminUsers";
        }
        int taskClass = currentUser.getIsadmin() == 0 ? 1 :
                ("allNonTeamUsers".equals(targetUserType) ? 1 : 0);
        Integer scorePerTask = parseScore(map.get("score"));
        List<String> failReasons = new ArrayList<>();

        // 仅用于定位“当前用户可访问的本地影像集”
        List<Dataset> ownDatasets = datasetService.list(
                new QueryWrapper<Dataset>()
                        .eq("user_id", creatorUserId)
                        .in("name", setNames)
        );
        Map<String, Dataset> ownDatasetByName = new LinkedHashMap<>();
        for (Dataset ds : ownDatasets) {
            if (ds.getName() != null) {
                ownDatasetByName.put(ds.getName(), ds);
            }
        }

        // 用于判定影像集类型（service/local），不限制 user_id，避免服务影像集因缺少 dataset 记录而误判
        List<Dataset> allNamedDatasets = datasetService.list(
                new QueryWrapper<Dataset>()
                        .in("name", setNames)
        );
        Map<String, String> setTypeByName = new HashMap<>();
        Map<String, Dataset> anyDatasetByName = new HashMap<>();
        for (Dataset ds : allNamedDatasets) {
            if (ds.getName() == null) continue;
            anyDatasetByName.putIfAbsent(ds.getName(), ds);
            String setType = ds.getSetType() == null ? "" : ds.getSetType().trim().toLowerCase();
            // local 优先级更高：同名存在 local 时按 local 处理
            if ("local".equals(setType) || !setTypeByName.containsKey(ds.getName())) {
                setTypeByName.put(ds.getName(), setType.isEmpty() ? "service" : setType);
            }
        }

        Map<String, List<String>> serviceSetMap = serverService.getServersBySetName(creatorUserId);
        List<Map<String, Object>> taskUnits = new ArrayList<>();

        for (String setName : setNames) {
            String setType = setTypeByName.getOrDefault(setName, "service");
            if ("local".equals(setType)) {
                Dataset ds = ownDatasetByName.get(setName);
                if (ds == null) {
                    ds = anyDatasetByName.get(setName);
                }
                // 本地影像集优先按“当前用户 + 影像集名”查文件，兼容 dataset 不归当前用户但文件由当前用户上传的情况
                List<SysFile> files = sysFileService.list(
                        new QueryWrapper<SysFile>()
                                .eq("user_id", creatorUserId)
                                .eq("set_name", setName)
                                .orderByAsc("file_id")
                );
                // 兼容历史数据：若 set_name 未写入，则回退到 dataset_id
                if ((files == null || files.isEmpty()) && ds != null) {
                    files = sysFileService.list(
                            new QueryWrapper<SysFile>()
                                    .eq("user_id", creatorUserId)
                                    .eq("dataset_id", ds.getId())
                                    .orderByAsc("file_id")
                    );
                }
                if (files == null || files.isEmpty()) {
                    failReasons.add("影像集无可用本地影像: " + setName);
                    continue;
                }
                for (SysFile file : files) {
                    Map<String, Object> unit = new HashMap<>();
                    unit.put("source", "local");
                    unit.put("localImagePath", buildLocalImagePath(file.getFileName()));
                    unit.put("setName", setName);
                    taskUnits.add(unit);
                }
            } else {
                List<String> mapservers = serviceSetMap.getOrDefault(setName, Collections.emptyList());
                for (String mapserver : mapservers) {
                    Map<String, Object> unit = new HashMap<>();
                    unit.put("source", "geoserver");
                    unit.put("mapserver", mapserver);
                    unit.put("setName", setName);
                    taskUnits.add(unit);
                }
            }
        }

        if (taskUnits.isEmpty()) {
            if (!failReasons.isEmpty()) {
                return ResultGenerator.getFailResult("所选影像集内没有可创建任务的影像：" + String.join("；", failReasons));
            }
            return ResultGenerator.getFailResult("所选影像集内没有可创建任务的影像");
        }

        if (taskClass == 1 && scorePerTask > 0) {
            int totalNeedScore = scorePerTask * taskUnits.size();
            Integer creatorCurrentScore = currentUser.getScore() != null ? currentUser.getScore() : 0;
            if (creatorCurrentScore < totalNeedScore) {
                return ResultGenerator.getFailResult("积分不足，需 " + totalNeedScore + "，当前 " + creatorCurrentScore);
            }
            boolean subtractSuccess = sysUserService.subtractUserScore(creatorUserId, totalNeedScore);
            if (!subtractSuccess) {
                return ResultGenerator.getFailResult("扣除发布者积分失败，请重试");
            }
        }

        String batchId = UUID.randomUUID().toString().replace("-", "");
        int successCount = 0;

        for (int i = 0; i < taskUnits.size(); i++) {
            Map<String, Object> unit = taskUnits.get(i);
            int batchIndex = i + 1;
            String currentTaskName = taskName + "_" + batchIndex;
            Integer taskId;

            if ("local".equals(unit.get("source"))) {
                String localImagePath = String.valueOf(unit.get("localImagePath"));
                taskId = taskService.createLocalTask(localImagePath, currentTaskName, taskType,
                        creatorUserId, taskClass, dateRangeStr);
            } else {
                String mapserver = String.valueOf(unit.get("mapserver"));
                taskId = taskService.createTask(dateRangeStr, currentTaskName, taskType, mapserver, creatorUserId, taskClass);
            }

            if (taskId == null || taskId == -1) {
                failReasons.add("创建任务失败: " + currentTaskName);
                continue;
            }

            Task createdTask = taskService.selectTaskById(taskId);
            if (createdTask != null) {
                createdTask.setBatchId(batchId);
                createdTask.setBatchIndex(batchIndex);
                taskService.updateById(createdTask);
            }

            if (scorePerTask > 0) {
                taskService.updateTaskScore(taskId, scorePerTask);
            }
            applyTaskAnnotationSchema(taskId, map);
            applyTaskTypeAttributes(taskId, map);
            recordTaskCreateProvenance(taskId, creatorUserId);

            Result assignResult = assignUsersForTask(taskId, map, currentUser, targetUserType, teamId, creatorUserId);
            if (assignResult.getCode() != 200) {
                failReasons.add("任务分配失败: " + currentTaskName + "，" + assignResult.getMessage());
                continue;
            }
            successCount++;
        }

        if (successCount == 0) {
            return ResultGenerator.getFailResult("批量任务创建失败：" + String.join("；", failReasons));
        }
        if (!failReasons.isEmpty()) {
            return ResultGenerator.getSuccessResult("部分成功：成功 " + successCount + " 个，失败 " + failReasons.size() + " 个");
        }
        return ResultGenerator.getSuccessResult("批量任务创建成功，共 " + successCount + " 个");
    }

    private JSONObject parseAnnotationSchema(Object rawSchema) {
        if (rawSchema == null) {
            return null;
        }
        if (rawSchema instanceof JSONObject) {
            return (JSONObject) rawSchema;
        }
        if (rawSchema instanceof Map) {
            return new JSONObject((Map<String, Object>) rawSchema);
        }
        String raw = String.valueOf(rawSchema).trim();
        if (raw.isEmpty() || "null".equalsIgnoreCase(raw)) {
            return null;
        }
        try {
            return JSONObject.parseObject(raw);
        } catch (Exception ignored) {
            return null;
        }
    }

    private Integer parseAnnotationSchemaVersion(Object rawVersion) {
        if (rawVersion == null) {
            return 1;
        }
        try {
            return Integer.valueOf(String.valueOf(rawVersion));
        } catch (Exception ignored) {
            return 1;
        }
    }

    private void applyTaskAnnotationSchema(Integer taskId, Map<String, Object> requestMap) {
        if (taskId == null || requestMap == null) {
            return;
        }
        Task task = taskService.selectTaskById(taskId);
        if (task == null) {
            return;
        }

        JSONObject schema = parseAnnotationSchema(requestMap.get("annotationSchema"));
        Integer schemaVersion = parseAnnotationSchemaVersion(requestMap.get("annotationSchemaVersion"));
        task.setAnnotationSchema(schema);
        task.setAnnotationSchemaVersion(schemaVersion);
        taskService.updateById(task);

        if (schema != null) {
            TASK_ANNOTATION_SCHEMA_CACHE.put(taskId, schema);
        } else {
            TASK_ANNOTATION_SCHEMA_CACHE.remove(taskId);
        }
    }

    @GetMapping("/getAttributeDefs")
    @ApiOperation("获取可选属性定义")
    public Map<String, Object> getAttributeDefs() {
        Map<String, Object> response = new HashMap<>();
        response.put("code", 200);
        response.put("success", true);
        response.put("data", attributeDefService.listActiveAttributeDefs());
        return response;
    }

    @GetMapping("/getTaskTypeAttributes")
    @ApiOperation("获取任务类别属性配置")
    public Map<String, Object> getTaskTypeAttributes(@RequestParam Integer taskId,
                                                     @RequestParam(required = false) Integer typeId) {
        Map<String, Object> response = new HashMap<>();
        response.put("code", 200);
        response.put("success", true);
        response.put("data", taskTypeAttributeService.getTaskTypeAttributeDetails(taskId, typeId));
        return response;
    }

    private void applyTaskTypeAttributes(Integer taskId, Map<String, Object> requestMap) {
        if (taskId == null || requestMap == null) {
            return;
        }
        if (!requestMap.containsKey("taskTypeAttributes")) {
            return;
        }
        List<Map<String, Object>> list = parseTaskTypeAttributeList(requestMap.get("taskTypeAttributes"));
        taskTypeAttributeService.replaceTaskTypeAttributes(taskId, list);
    }

    private List<Map<String, Object>> parseTaskTypeAttributeList(Object raw) {
        if (raw == null) {
            return new ArrayList<>();
        }
        if (raw instanceof List) {
            List<?> source = (List<?>) raw;
            List<Map<String, Object>> list = new ArrayList<>();
            for (Object item : source) {
                if (item instanceof Map) {
                    list.add((Map<String, Object>) item);
                } else if (item != null) {
                    try {
                        Map<String, Object> parsed = new ObjectMapper().convertValue(item, new TypeReference<Map<String, Object>>() {});
                        list.add(parsed);
                    } catch (Exception ignored) {
                    }
                }
            }
            return list;
        }
        if (raw instanceof String) {
            String text = ((String) raw).trim();
            if (text.isEmpty()) {
                return new ArrayList<>();
            }
            try {
                return new ObjectMapper().readValue(text, new TypeReference<List<Map<String, Object>>>() {});
            } catch (Exception ignored) {
                return new ArrayList<>();
            }
        }
        return new ArrayList<>();
    }

    private Type resolveTypeById(Integer typeId) {
        if (typeId == null) {
            return null;
        }
        try {
            Type direct = typeService.getTypeById(typeId);
            if (direct != null) {
                return direct;
            }
        } catch (Exception ignored) {
        }
        try {
            String typeName = typeService.getTypeNameById(typeId);
            List<Type> list = typeService.getTypes(1, 100, typeId, typeName);
            if (list != null && !list.isEmpty()) {
                return list.get(0);
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private JSONObject getCachedTaskAnnotationSchema(Task task) {
        if (task == null || task.getTaskId() == null) {
            return null;
        }
        Integer taskId = task.getTaskId();
        JSONObject cached = TASK_ANNOTATION_SCHEMA_CACHE.get(taskId);
        if (cached != null) {
            return cached;
        }
        JSONObject fromDb = task.getAnnotationSchema();
        if (fromDb != null) {
            TASK_ANNOTATION_SCHEMA_CACHE.put(taskId, fromDb);
        }
        return fromDb;
    }

    private void recordTaskCreateProvenance(Integer taskId, Integer operatorUserId) {
        if (taskId == null || operatorUserId == null) {
            return;
        }
        try {
            Task task = taskService.selectTaskById(taskId);
            if (task == null) {
                return;
            }

            List<ProvEntityRef> inputs = new ArrayList<>();
            if ("local".equals(task.getTaskSource())) {
                String rawBusinessId = resolveLocalRawImageBusinessId(task.getLocalImagePath(), operatorUserId);
                if (rawBusinessId != null && !rawBusinessId.trim().isEmpty()) {
                    ProvEntityRef rawImage = ProvEntityRef.of(
                            rawBusinessId,
                            "RAW_IMAGE",
                            resolveFileName(task.getLocalImagePath())
                    );
                    Map<String, Object> attrs = new HashMap<>();
                    attrs.put("path", task.getLocalImagePath());
                    rawImage.setAttributes(attrs);
                    inputs.add(rawImage);
                }
            } else {
                Integer serverId = task.getServerId();
                if (serverId != null && serverId > 0) {
                    inputs.add(ProvEntityRef.of(
                            serverId.toString(),
                            "MAP_SERVICE",
                            task.getMapServer()
                    ));
                }
            }

            ProvEntityRef outputTask = ProvEntityRef.of(
                    taskId.toString(),
                    "TASK",
                    "任务#" + taskId
            );

            Map<String, Object> params = new HashMap<>();
            params.put("taskName", task.getTaskName());
            params.put("taskType", task.getTaskType());
            params.put("taskSource", task.getTaskSource());
            params.put("dateRange", task.getDateRange());

            provenanceService.recordActivity(
                    "TASK_CREATE",
                    operatorUserId.toString(),
                    "PERSON",
                    inputs,
                    Collections.singletonList(outputTask),
                    params
            );
        } catch (Exception e) {
            log.warn("记录任务创建溯源失败, taskId={}, err={}", taskId, e.getMessage());
        }
    }

    private String resolveLocalRawImageBusinessId(String localImagePath, Integer userId) {
        if (localImagePath == null || localImagePath.trim().isEmpty()) {
            return null;
        }
        String fileName = resolveFileName(localImagePath);
        if (fileName == null || fileName.trim().isEmpty()) {
            return null;
        }

        QueryWrapper<SysFile> wrapper = new QueryWrapper<SysFile>()
                .eq("file_name", fileName)
                .orderByDesc("file_id");
        if (userId != null) {
            wrapper.eq("user_id", userId);
        }
        List<SysFile> files = sysFileService.list(wrapper);
        if (files != null && !files.isEmpty() && files.get(0).getFileId() != null) {
            return files.get(0).getFileId().toString();
        }

        SysFile fallback = sysFileService.getFileByFileName(fileName);
        if (fallback != null && fallback.getFileId() != null) {
            return fallback.getFileId().toString();
        }
        return fileName;
    }

    private String resolveFileName(String path) {
        if (path == null || path.trim().isEmpty()) {
            return path;
        }
        try {
            Path p = Paths.get(path.replace('\\', '/'));
            if (p.getFileName() != null) {
                return p.getFileName().toString();
            }
        } catch (Exception ignore) {
        }
        return path;
    }

    @GetMapping("/getSelectableImagesByName")
    @ApiOperation("按影像名称获取可选影像列表，包含服务影像和本地影像")
    public Result getSelectableImagesByName() {
        LoginUser loginUser = (LoginUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        SysUser currentUser = loginUser.getSysUser();
        Integer userId = currentUser.getUserid();

        List<Map<String, Object>> options = new ArrayList<>();
        Set<String> seenValues = new HashSet<>();

        List<Server> servers = serverService.getServers(userId);
        for (Server server : servers) {
            String serName = server.getSerName();
            if (serName == null || serName.trim().isEmpty() || !seenValues.add(serName)) {
                continue;
            }
            String setName = server.getSetName();
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("value", serName);
            item.put("label", serName + "（服务" + (setName != null && !setName.trim().isEmpty() ? " / " + setName : "") + "）");
            item.put("name", serName);
            item.put("source", "service");
            item.put("setName", setName);
            item.put("mapserver", serName);
            options.add(item);
        }

        List<Dataset> localDatasets = datasetService.list(
                new QueryWrapper<Dataset>()
                        .eq("user_id", userId)
                        .eq("set_type", "local")
        );
        Map<Integer, String> localDatasetNameById = new HashMap<>();
        Set<String> localSetNames = new HashSet<>();
        for (Dataset dataset : localDatasets) {
            if (dataset.getId() != null) {
                localDatasetNameById.put(dataset.getId(), dataset.getName());
            }
            if (dataset.getName() != null && !dataset.getName().trim().isEmpty()) {
                localSetNames.add(dataset.getName());
            }
        }

        if (!localDatasetNameById.isEmpty() || !localSetNames.isEmpty()) {
            List<SysFile> userFiles = sysFileService.list(
                    new QueryWrapper<SysFile>()
                            .eq("user_id", userId)
                            .orderByAsc("file_id")
            );
            for (SysFile file : userFiles) {
                boolean belongsToLocalDataset =
                        (file.getDatasetId() != null && localDatasetNameById.containsKey(file.getDatasetId())) ||
                        (file.getSetName() != null && localSetNames.contains(file.getSetName()));
                if (!belongsToLocalDataset || file.getFileId() == null || file.getFileName() == null || file.getFileName().trim().isEmpty()) {
                    continue;
                }

                String optionValue = "local-file:" + file.getFileId();
                if (!seenValues.add(optionValue)) {
                    continue;
                }

                String resolvedSetName = file.getSetName();
                if ((resolvedSetName == null || resolvedSetName.trim().isEmpty()) && file.getDatasetId() != null) {
                    resolvedSetName = localDatasetNameById.get(file.getDatasetId());
                }
                String displayName = Paths.get(file.getFileName().replace("\\", "/")).getFileName().toString();

                Map<String, Object> item = new LinkedHashMap<>();
                item.put("value", optionValue);
                item.put("label", displayName + "（本地" + (resolvedSetName != null && !resolvedSetName.trim().isEmpty() ? " / " + resolvedSetName : "") + "）");
                item.put("name", displayName);
                item.put("source", "local");
                item.put("setName", resolvedSetName);
                item.put("fileId", file.getFileId());
                item.put("fileName", file.getFileName());
                item.put("localImagePath", buildLocalImagePath(file.getFileName()));
                options.add(item);
            }
        }

        options.sort(Comparator.comparing(item -> String.valueOf(item.getOrDefault("label", "")), String.CASE_INSENSITIVE_ORDER));
        return ResultGenerator.getSuccessResult(options);
    }

    private Integer parseScore(Object scoreObj) {
        if (scoreObj == null) return 0;
        try {
            if (scoreObj instanceof Integer) return (Integer) scoreObj;
            if (scoreObj instanceof Double) return ((Double) scoreObj).intValue();
            String scoreStr = scoreObj.toString().trim();
            if (scoreStr.isEmpty()) return 0;
            int score = (int) Double.parseDouble(scoreStr);
            return Math.max(score, 0);
        } catch (Exception ignore) {
            return 0;
        }
    }

    private String buildLocalImagePath(String fileName) {
        return resolveExistingLocalImagePath(fileName);
    }

    private String resolveExistingLocalImagePath(String rawPath) {
        if (rawPath == null || rawPath.trim().isEmpty()) {
            return "";
        }

        String normalized = rawPath.trim().replace("\\", File.separator).replace("/", File.separator);
        LinkedHashSet<String> candidates = new LinkedHashSet<>();
        candidates.add(normalized);

        try {
            Path raw = Paths.get(normalized);
            String baseName = raw.getFileName() != null ? raw.getFileName().toString() : normalized;
            if (minioUploadDir != null && !minioUploadDir.trim().isEmpty()) {
                candidates.add(Paths.get(minioUploadDir.trim(), normalized).toString());
                candidates.add(Paths.get(minioUploadDir.trim(), baseName).toString());
            }
            if (localCoverageDir != null && !localCoverageDir.trim().isEmpty()) {
                candidates.add(Paths.get(localCoverageDir.trim(), normalized).toString());
                candidates.add(Paths.get(localCoverageDir.trim(), baseName).toString());
            }
        } catch (Exception ignore) {
            // ignore and try plain candidates below
        }

        for (String candidate : candidates) {
            if (candidate == null || candidate.trim().isEmpty()) {
                continue;
            }
            try {
                Path candidatePath = Paths.get(candidate);
                if (Files.isRegularFile(candidatePath)) {
                    return candidatePath.toString();
                }
            } catch (Exception ignore) {
                // continue trying other candidates
            }
        }

        // 保持兜底行为，优先返回更可能的本地目录路径，避免只返回裸文件名
        if (minioUploadDir != null && !minioUploadDir.trim().isEmpty()) {
            try {
                String baseName = Paths.get(normalized).getFileName() != null
                        ? Paths.get(normalized).getFileName().toString()
                        : normalized;
                return Paths.get(minioUploadDir.trim(), baseName).toString();
            } catch (Exception ignore) {
                return normalized;
            }
        }
        if (localCoverageDir != null && !localCoverageDir.trim().isEmpty()) {
            try {
                String baseName = Paths.get(normalized).getFileName() != null
                        ? Paths.get(normalized).getFileName().toString()
                        : normalized;
                return Paths.get(localCoverageDir.trim(), baseName).toString();
            } catch (Exception ignore) {
                return normalized;
            }
        }
        return normalized;
    }

    private Result assignUsersForTask(Integer taskId, Map<String, Object> map, SysUser currentUser,
                                      String targetUserType, Integer teamId, Integer creatorUserId) {
        List<SysUser> targetUsers = new ArrayList<>();
        Set<String> assignedUsernames = new LinkedHashSet<>();
        if (currentUser.getIsadmin() == 0) {
            targetUsers = sysUserService.getAllNonAdminUsers();
            targetUsers.removeIf(user -> user.getUserid().equals(creatorUserId));
            List<?> rawSelectedSampleTypes = (List<?>) map.get("selectedSampleTypes");
            String commonTypeStr = toTypeString(rawSelectedSampleTypes);
            for (SysUser user : targetUsers) {
                if (!taskAcceptedService.createTaskAccept(taskId, user.getUsername(), commonTypeStr)) {
                    return ResultGenerator.getFailResult("为用户 '" + user.getUsername() + "' 分配任务失败");
                }
                assignedUsernames.add(user.getUsername());
            }
            recordTaskAssignProvenance(taskId, creatorUserId, targetUserType, assignedUsernames);
            return ResultGenerator.getSuccessResult("OK");
        }

        if ("allTeamMembers".equals(targetUserType)) {
            if (teamId == null) return ResultGenerator.getFailResult("管理员无团队信息");
            targetUsers = sysUserService.getUsersByTeamIdAndNotAdmin(teamId);
            targetUsers.removeIf(user -> user.getUserid().equals(creatorUserId));
            String commonTypeStr = toTypeString((List<?>) map.get("selectedSampleTypes"));
            for (SysUser user : targetUsers) {
                if (!taskAcceptedService.createTaskAccept(taskId, user.getUsername(), commonTypeStr)) {
                    return ResultGenerator.getFailResult("为团队成员 '" + user.getUsername() + "' 分配任务失败");
                }
                assignedUsernames.add(user.getUsername());
            }
            recordTaskAssignProvenance(taskId, creatorUserId, targetUserType, assignedUsernames);
            return ResultGenerator.getSuccessResult("OK");
        }

        if ("allNonTeamUsers".equals(targetUserType)) {
            targetUsers = sysUserService.getNonTeamUsersAndNotAdmin(teamId);
            targetUsers.removeIf(user -> user.getUserid().equals(creatorUserId));
            String commonTypeStr = toTypeString((List<?>) map.get("selectedSampleTypes"));
            for (SysUser user : targetUsers) {
                if (!taskAcceptedService.createTaskAccept(taskId, user.getUsername(), commonTypeStr)) {
                    return ResultGenerator.getFailResult("为非团队用户 '" + user.getUsername() + "' 分配任务失败");
                }
                assignedUsernames.add(user.getUsername());
            }
            recordTaskAssignProvenance(taskId, creatorUserId, targetUserType, assignedUsernames);
            return ResultGenerator.getSuccessResult("OK");
        }

        if ("specificTeamUsers".equals(targetUserType)) {
            List<Map<String, Object>> specificUserAssignments = (List<Map<String, Object>>) map.get("specificUserAssignments");
            if (specificUserAssignments == null || specificUserAssignments.isEmpty()) {
                return ResultGenerator.getFailResult("未指定任何用户进行任务分配");
            }
            for (Map<String, Object> assignment : specificUserAssignments) {
                String username = String.valueOf(assignment.get("username"));
                List<?> rawTypeArr = (List<?>) assignment.get("typeArr");
                String typeStr = toTypeString(rawTypeArr);
                if (!taskAcceptedService.createTaskAccept(taskId, username, typeStr)) {
                    return ResultGenerator.getFailResult("为特定用户 '" + username + "' 分配任务失败");
                }
                assignedUsernames.add(username);
            }
            recordTaskAssignProvenance(taskId, creatorUserId, targetUserType, assignedUsernames);
            return ResultGenerator.getSuccessResult("OK");
        }

        return ResultGenerator.getFailResult("无效的目标用户类型");
    }

    private String toTypeString(List<?> rawTypes) {
        if (rawTypes == null || rawTypes.isEmpty()) return "";
        return rawTypes.stream().map(Object::toString).collect(Collectors.joining(","));
    }

    private void recordTaskAssignProvenance(Integer taskId, Integer operatorUserId, String assignMode, Set<String> usernames) {
        if (taskId == null || operatorUserId == null || usernames == null || usernames.isEmpty()) {
            return;
        }
        try {
            List<ProvEntityRef> outputs = usernames.stream()
                    .filter(Objects::nonNull)
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .map(username -> ProvEntityRef.of(
                            taskId + ":" + username,
                            "TASK_ASSIGNMENT",
                            "任务#" + taskId + " 分配给 " + username
                    ))
                    .collect(Collectors.toList());
            if (outputs.isEmpty()) return;

            Map<String, Object> params = new HashMap<>();
            params.put("taskId", taskId);
            params.put("assignMode", assignMode);
            params.put("assigneeCount", outputs.size());
            params.put("assignees", new ArrayList<>(usernames));

            provenanceService.recordActivity(
                    "TASK_ASSIGN",
                    operatorUserId.toString(),
                    "PERSON",
                    Collections.singletonList(ProvEntityRef.of(taskId.toString(), "TASK", "任务#" + taskId)),
                    outputs,
                    params
            );
        } catch (Exception e) {
            log.warn("记录任务分配溯源失败, taskId={}, err={}", taskId, e.getMessage());
        }
    }

    private String resolveTaskMapfilePath(Task task) {
        if (task == null) return "";
        if ("local".equals(task.getTaskSource())) {
            String localPath = task.getLocalImagePath() == null ? "" : task.getLocalImagePath();
            if (localPath.toLowerCase().endsWith(".tif") || localPath.toLowerCase().endsWith(".tiff")) {
                int idx = localPath.lastIndexOf('.');
                return idx > 0 ? localPath.substring(0, idx) : localPath;
            }
            return localPath;
        }
        String fileName = task.getMapServer();
        if (fileName == null) return "";
        return Path.of(localCoverageDir, fileName).toString();
    }

    @GetMapping("/getLocalImage")
    @ApiOperation("获取本地图片文件，转换为PNG供浏览器显示")
    public void getLocalImage(@RequestParam Integer taskId,
                              javax.servlet.http.HttpServletResponse response) {
        try {
            // 避免 ImageIO 在受限目录创建临时缓存文件导致异常
            ImageIO.setUseCache(false);
            Task task = taskService.selectTaskById(taskId);
            if (task == null || !"local".equals(task.getTaskSource())) {
                response.sendError(404, "任务不存在或非本地任务");
                return;
            }

            String rawPath = task.getLocalImagePath();
            if (rawPath == null || rawPath.trim().isEmpty()) {
                response.sendError(404, "本地影像路径为空");
                return;
            }

            BufferedImage img = null;
            String normalizedPath = rawPath.trim();

            // 1) 尝试直接按 local_image_path 读取
            File imageFile = new File(normalizedPath);
            if (imageFile.exists()) {
                try {
                    img = ImageIO.read(imageFile);
                } catch (Exception e) {
                    // 本地文件可能被锁或无权限，继续尝试其他来源
                    log.warn("读取本地影像失败，将尝试其他来源, taskId={}, path={}, err={}",
                            taskId, normalizedPath, e.getMessage());
                }
            }

            // 2) 若 local_image_path 是相对名，尝试拼接 minio.uploaddir
            if (img == null && !imageFile.isAbsolute() && minioUploadDir != null && !minioUploadDir.trim().isEmpty()) {
                File uploadDirFile = new File(minioUploadDir.trim(), normalizedPath);
                if (uploadDirFile.exists()) {
                    try {
                        img = ImageIO.read(uploadDirFile);
                    } catch (Exception e) {
                        log.warn("读取上传目录影像失败，将尝试 MinIO, taskId={}, path={}, err={}",
                                taskId, uploadDirFile.getAbsolutePath(), e.getMessage());
                    }
                }
            }

            // 3) 本地仍失败时，回退到 MinIO 读取（尝试完整对象名 + basename）
            if (img == null) {
                List<String> objectCandidates = new ArrayList<>();
                objectCandidates.add(normalizedPath.replace('\\', '/'));
                objectCandidates.add(new File(normalizedPath).getName());

                for (String objectName : objectCandidates) {
                    if (objectName == null || objectName.trim().isEmpty()) {
                        continue;
                    }
                    try (InputStream objectStream = minioClient.getObject(
                            GetObjectArgs.builder()
                                    .bucket(minioConfig.getBucketName())
                                    .object(objectName)
                                    .build()
                    )) {
                        img = ImageIO.read(objectStream);
                        if (img != null) {
                            break;
                        }
                    } catch (Exception ignored) {
                        // continue try next candidate
                    }
                }
            }

            if (img == null) {
                response.sendError(404, "图片文件不存在或无法解码: " + rawPath);
                return;
            }

            if (img.getType() == BufferedImage.TYPE_CUSTOM || img.getColorModel().hasAlpha()) {
                BufferedImage rgb = new BufferedImage(img.getWidth(), img.getHeight(), BufferedImage.TYPE_INT_ARGB);
                rgb.getGraphics().drawImage(img, 0, 0, null);
                img = rgb;
            }

            response.setContentType("image/png");
            response.setHeader("Cache-Control", "max-age=3600");
            ImageIO.write(img, "PNG", response.getOutputStream());
        } catch (Exception e) {
            log.error("获取本地影像失败, taskId={}", taskId, e);
            try {
                response.sendError(500, "本地文件加载失败: " + e.getMessage());
            } catch (IOException ignored) {
            }
        }
    }

    @PostMapping("/batchTrain")
    public Map<String, Object> batchTrain(@RequestBody Map<String, Object> request) {
        try {
            // 获取前端传来的参数
            @SuppressWarnings("unchecked")
            List<String> taskIds = (List<String>) request.get("taskids");
            String taskType = request.get("task_type") != null ? request.get("task_type").toString() : "";
            String userId = request.get("user_id") != null ? request.get("user_id").toString() : null;
            String functionName = request.get("functionName") != null ? request.get("functionName").toString() : "";
            String assistInput = request.get("assistInput") != null ? request.get("assistInput").toString() : "";
            String modelName = request.get("modelName") != null ? request.get("modelName").toString() : "";

            @SuppressWarnings("unchecked")
            Map<String, Object> params = (Map<String, Object>) request.get("parameters");

            // 获取参数，处理可能的 null 值
            String param1 = params.get("param1") != null ? params.get("param1").toString() : "";
            String param2 = params.get("param2") != null ? params.get("param2").toString() : "";
            String param3 = params.get("param3") != null ? params.get("param3").toString() : "";
            String param4 = params.get("param4") != null ? params.get("param4").toString() : "";

            // 处理categoryMapping，确保是有效的JSON格式
            String categoryMapping = "{}";
            if (params.get("categoryMapping") != null) {
                try {
                    ObjectMapper objectMapper = new ObjectMapper();
                    Map<String, Object> mappingMap;
                    // 尝试将参数解析为Map
                    if (params.get("categoryMapping") instanceof String) {
                        mappingMap = objectMapper.readValue(params.get("categoryMapping").toString(),
                                                          new TypeReference<Map<String, Object>>() {});
                    } else {
                        mappingMap = (Map<String, Object>) params.get("categoryMapping");
                    }
                    // 转换为标准JSON字符串
                    categoryMapping = objectMapper.writeValueAsString(mappingMap);
                } catch (Exception e) {
                    // 如果解析失败，使用空对象
                    System.err.println("解析categoryMapping失败: " + e.getMessage());
                    categoryMapping = "{}";
                }
            }

            // 构造mapfile_path列表
            List<String> mapfilePaths = new ArrayList<>();
            for (String taskId : taskIds) {
                Task task = taskService.selectTaskById(Integer.parseInt(taskId));
                mapfilePaths.add(resolveTaskMapfilePath(task));
            }

            // 准备请求体
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("taskid", taskIds);
            requestBody.put("mapfile_path", mapfilePaths);
            requestBody.put("functionName", functionName);
            requestBody.put("assistInput", assistInput);
            requestBody.put("modelName", modelName);
            requestBody.put("param1", param1);
            requestBody.put("param2", param2);
            requestBody.put("param3", param3);
            requestBody.put("param4", param4);
            requestBody.put("categoryMapping", categoryMapping);
            requestBody.put("user_id", userId);
            requestBody.put("tasktype", taskType);

            System.out.println("批量训练请求体: " + requestBody);

            // 将任务提交到队列异步执行
            taskExecutorService.executeMultiAssistFunctionAsync(requestBody);

            // 返回任务已提交的响应
            Map<String, Object> response = new HashMap<>();
            response.put("code", 200);
            response.put("message", "批量训练任务已提交，正在后台处理中");
            return response;

        } catch (Exception e) {
            e.printStackTrace();
            Map<String, Object> response = new HashMap<>();
            response.put("code", StatusEnum.FAIL.code);
            response.put("message", "批量训练任务提交失败: " + e.getMessage());
            return response;
        }
    }

    @PostMapping("/batchInference")
    public Map<String, Object> batchInference(@RequestBody Map<String, Object> request) {
        try {
            // 获取前端传来的参数
            @SuppressWarnings("unchecked")
            List<String> taskIds = (List<String>) request.get("taskids");
            String userId = request.get("user_id") != null ? request.get("user_id").toString() : null;
            String model = request.get("model") != null ? request.get("model").toString() : "";

            @SuppressWarnings("unchecked")
            Map<String, Object> params = (Map<String, Object>) request.get("parameters");

            // 获取参数，处理可能的 null 值
            String param1 = params.get("param1") != null ? params.get("param1").toString() : "";
            String param2 = params.get("param2") != null ? params.get("param2").toString() : "";
            String param3 = params.get("param3") != null ? params.get("param3").toString() : "";
            String param4 = params.get("param4") != null ? params.get("param4").toString() : "";

            // 处理categoryMapping，确保是有效的JSON格式
            String categoryMapping = "{}";
            if (params.get("categoryMapping") != null) {
                try {
                    ObjectMapper objectMapper = new ObjectMapper();
                    Map<String, Object> mappingMap;
                    // 尝试将参数解析为Map
                    if (params.get("categoryMapping") instanceof String) {
                        mappingMap = objectMapper.readValue(params.get("categoryMapping").toString(),
                                                          new TypeReference<Map<String, Object>>() {});
                    } else {
                        mappingMap = (Map<String, Object>) params.get("categoryMapping");
                    }
                    // 转换为标准JSON字符串
                    categoryMapping = objectMapper.writeValueAsString(mappingMap);
                } catch (Exception e) {
                    // 如果解析失败，使用空对象
                    System.err.println("解析categoryMapping失败: " + e.getMessage());
                    categoryMapping = "{}";
                }
            }

            System.out.println("批量推理请求体: " + request);

            // 为每个任务创建推理请求并异步执行
            for (String taskId : taskIds) {
                Task task = taskService.selectTaskById(Integer.parseInt(taskId));
                String mapfilePath = resolveTaskMapfilePath(task);
                // 准备单个推理请求体
                Map<String, Object> requestBody = new HashMap<>();
                requestBody.put("taskid", taskId);
                requestBody.put("mapfile_path", mapfilePath);
                requestBody.put("user_id", userId);
                requestBody.put("model", model);
                requestBody.put("param1", param1);
                requestBody.put("param2", param2);
                requestBody.put("param3", param3);
                requestBody.put("param4", param4);
                requestBody.put("categoryMapping", categoryMapping);
                requestBody.put("modelScopeStr", "");

                // 提交到异步执行队列
                taskExecutorService.executeInferenceFunctionAsync(requestBody);
            }

            // 返回任务已提交的响应
            Map<String, Object> response = new HashMap<>();
            response.put("code", 200);
            response.put("message", "批量推理任务已提交，正在后台处理中");
            return response;

        } catch (Exception e) {
            e.printStackTrace();
            Map<String, Object> response = new HashMap<>();
            response.put("code", StatusEnum.FAIL.code);
            response.put("message", "批量推理任务提交失败: " + e.getMessage());
            return response;
        }
    }
}
