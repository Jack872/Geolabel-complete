package com.example.labelMark.controller;

import cn.hutool.core.util.ObjectUtil;
import com.example.labelMark.domain.Mark;
import com.example.labelMark.domain.Type;
import com.example.labelMark.service.MarkService;
import com.example.labelMark.service.TaskService;
import com.example.labelMark.service.ModelService; // 新增导入
import com.example.labelMark.service.TypeService;
import com.example.labelMark.service.TaskAcceptedService;
import com.example.labelMark.utils.CoordinateConverter;
import com.example.labelMark.utils.ResultGenerator;
import com.example.labelMark.vo.constant.Result;
import com.example.labelMark.vo.constant.StatusEnum;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
import com.fasterxml.jackson.core.type.TypeReference;

import javax.annotation.Resource;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

// 导入 Jep 相关的类
//import jep.JepConfig;
//import jep.JepException;
//import jep.SharedInterpreter;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.springframework.web.client.RestTemplate;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.JSON;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Envelope;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.LineString;
import org.locationtech.jts.geom.Polygon;
import org.locationtech.jts.operation.polygonize.Polygonizer;
import org.springframework.transaction.annotation.Transactional;
import org.wololo.jts2geojson.GeoJSONReader;
import org.wololo.jts2geojson.GeoJSONWriter;

import com.example.labelMark.service.TaskExecutorService;

/**
 * <p>
 *  前端控制器
 * </p>
 *

 */
@RestController
@RequestMapping("/mark")
public class MarkController {
    private final GeometryFactory geometryFactory = new GeometryFactory();
    private final GeoJSONReader geoJSONReader = new GeoJSONReader();
    private final GeoJSONWriter geoJSONWriter = new GeoJSONWriter();

    @Value("${modal.path}")
    private String modalPath;

    @Value("${geoserver.localCoverageDir}")
    private String localCoverageDir;

    @Value("${python.service.url:http://localhost:5000}")
    private String pythonServiceUrl;

    @Resource
    private MarkService markService;

    @Resource
    private TaskService taskService;

    @Resource // 新增注入
    private ModelService modelService;

    @Resource
    private TaskAcceptedService taskAcceptedService;

    @Resource
    private TypeService typeService;

    @Resource
    private TaskExecutorService taskExecutorService;

    /**
     * 将任务中的 map_server 字段解析为可被 Python 直接读取的本地栅格路径。
     * 兼容情况：
     * 1) 相对文件名：<localCoverageDir>/<fileName>
     * 2) 绝对文件路径且为文件：直接使用
     * 3) 绝对路径但不是文件（例如 MinIO 对象目录）：回退到 <localCoverageDir>/<basename>
     */
    private String resolveCoveragePath(String fileName) {
        if (fileName == null || fileName.trim().isEmpty()) {
            return fileName;
        }
        try {
            Path rawPath = Paths.get(fileName);
            if (rawPath.isAbsolute()) {
                File rawFile = rawPath.toFile();
                if (rawFile.isFile()) {
                    return rawPath.toString();
                }
                String baseName = rawPath.getFileName() != null ? rawPath.getFileName().toString() : fileName;
                return Path.of(localCoverageDir, baseName).toString();
            }
        } catch (Exception ignore) {
            // ignore and fallback below
        }
        return Path.of(localCoverageDir, fileName).toString();
    }

    private String buildPythonServiceUrl(String endpoint) {
        String baseUrl = pythonServiceUrl == null ? "http://localhost:5000" : pythonServiceUrl.trim();
        if (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }
        if (endpoint.startsWith("/")) {
            return baseUrl + endpoint;
        }
        return baseUrl + "/" + endpoint;
    }

    @PostMapping("/saveMarkInfo")
    public Result saveMarkInfo(@RequestBody Map<String, Object> request) {
        /*Integer userId = Integer.valueOf(request.get("userid").toString());
        Integer taskId = Integer.valueOf(request.get("id").toString());
        List<Map<String, Object>> typeIdAndMarkInfoArr = (List<Map<String, Object>>) request.get("jsondataArr");
        List<Map<String, Object>> typeMapArr = (List<Map<String, Object>>) request.get("typeArr");
        List<String> deleteMarkIds = (List<String>) request.get("deleteMarkIds");
        // 检查是否将当前用户设为唯一执行者
        boolean setAsSubmitter = false;
        if (request.containsKey("setAsSubmitter")) {
            setAsSubmitter = Boolean.valueOf(request.get("setAsSubmitter").toString());
        }

        List<Type> typeArr = new ArrayList<>();
        for (Map typeMap : typeMapArr) {
            Type type = new Type();
            Integer typeId = Integer.valueOf(typeMap.get("typeId").toString());
            String typeName = typeMap.get("typeName").toString();
            String typeColor = typeMap.get("typeColor").toString();
            type.setTypeColor(typeColor);
            type.setTypeName(typeName);
            type.setTypeId(typeId);
            typeArr.add(type);
        }
        List<Map<String, Object>> geometryArr = CoordinateConverter.convertCoordinate(typeIdAndMarkInfoArr);
        List<Map<String, Object>> markInfoArr = geometryArr;
        if (markInfoArr.isEmpty()) {
            return ResultGenerator.getSuccessResult("没有标注信息，已删除多余Type");
        }

        markService.deleteMarkByTaskAndUser(taskId, userId);

        boolean exist = markService.isMark(taskId, userId);


        if(exist) {
            taskService.updateTask(taskId, null);
            updateTaskAndMark(userId, taskId, markInfoArr);

            // 如果需要将当前用户设为唯一执行者
            if (setAsSubmitter) {
                // 1. 更新task表中的submitter_id为当前用户ID
                taskService.updateTaskSubmitter(taskId, userId);

                // 2. 删除task_accepted表中除当前用户外的所有与该任务相关的记录
                taskAcceptedService.deleteOtherUsers(taskId, userId);
            }

            return ResultGenerator.getSuccessResult("已有有标注信息，已完成更新");
        } else {
            updateTaskAndMark(userId, taskId, markInfoArr);

            // 如果需要将当前用户设为唯一执行者
            if (setAsSubmitter) {
                // 1. 更新task表中的submitter_id为当前用户ID
                taskService.updateTaskSubmitter(taskId, userId);

                // 2. 删除task_accepted表中除当前用户外的所有与该任务相关的记录
                taskAcceptedService.deleteOtherUsers(taskId, userId);
            }
        }
        return ResultGenerator.getSuccessResult("mark创建成功");*/
        try {
            String msg = markService.saveMarkInfoIncremental(request);
            return ResultGenerator.getSuccessResult(msg);
        } catch (Exception e) {
            e.printStackTrace();
            return ResultGenerator.getFailResult("保存失败: " + e.getMessage());
        }
    }

    private void updateTaskAndMark(Integer userId, int taskId, List<Map<String, Object>> markInfoArr) {
        for (Map<String, Object> geomAndTypeId : markInfoArr) {
            Mark mark = new Mark();
            Integer markId = ObjectUtil.isNotNull(geomAndTypeId.get("markId"))
                    ? Integer.valueOf(geomAndTypeId.get("markId").toString()) : null;
            mark.setId(markId);
            mark.setTaskId(taskId);
            mark.setUserId(userId);

            // Get the geometry directly from the input
            String geomJson = (String) geomAndTypeId.get("geom");
            // Parse the geometry JSON to use directly without adding additional wrapper
            JSONObject geometryObject = JSONObject.parseObject(geomJson);

            // Create a proper GeoJSON Feature with the geometry
            JSONObject geom = new JSONObject();
            geom.put("type", "Feature");
            geom.put("properties", new JSONObject());
            geom.put("geometry", geometryObject);

            mark.setGeom(geom);
            Object rawAttrJson = geomAndTypeId.get("attrJson");
            if (rawAttrJson != null) {
                try {
                    if (rawAttrJson instanceof JSONObject) {
                        mark.setAttrJson((JSONObject) rawAttrJson);
                    } else {
                        mark.setAttrJson(JSONObject.parseObject(rawAttrJson.toString()));
                    }
                } catch (Exception ignored) {
                    mark.setAttrJson(null);
                }
            } else {
                mark.setAttrJson(null);
            }
            mark.setStatus(0);
            mark.setTypeId(Integer.valueOf(geomAndTypeId.get("typeId").toString()));
            markService.insertOrUpdateMark(mark);

            String markIdStr = taskService.getMarkIdById(taskId);
            markIdStr = markIdStr == null ? mark.getId().toString()
                    : markIdStr + "," + mark.getId().toString();
            taskService.updateTask(taskId, markIdStr);
        }
    }

    @PostMapping("/inferenceFunction")
    public Map<String, Object> PythonScript_inferenceFunction(@RequestBody Map<String, Object> request) {
        // 获取前端传来的参数
        String taskId = request.get("taskid").toString();
        String userId = request.get("user_id").toString();
        String modelId = request.get("model_id") != null ? request.get("model_id").toString() : "";
        Integer taskItemId = request.get("taskItemId") == null ? null : Integer.valueOf(request.get("taskItemId").toString());

// 2. 获取 parameters 对象（做好防空处理）
        @SuppressWarnings("unchecked")
        Map<String, Object> params = (Map<String, Object>) request.getOrDefault("parameters", new HashMap<>());

        // 3. 从 params 中提取算法参数
        String param1 = params.get("param1") != null ? params.get("param1").toString() : "";
        String param2 = params.get("param2") != null ? params.get("param2").toString() : "";
        String param3 = params.get("param3") != null ? params.get("param3").toString() : "";
        String param4 = params.get("param4") != null ? params.get("param4").toString() : "";

        ObjectMapper objectMapper = new ObjectMapper();
        String categoryMappingStr = "{}";
        String modelScopeStr = "[]";

        try {
            // 4. 将前端传来的对象/数组安全地序列化为 JSON 字符串，供 Python 脚本使用
            if (params.get("categoryMapping") != null) {
                categoryMappingStr = objectMapper.writeValueAsString(params.get("categoryMapping"));
            }
            if (params.get("modelScope") != null) {
                modelScopeStr = objectMapper.writeValueAsString(params.get("modelScope"));
            }
        } catch (Exception e) {
            System.err.println("JSON参数序列化失败: " + e.getMessage());
            // 失败时保持默认值 "{}" 和 "[]"
        }

        // 5. 设置文件路径（本地任务直接用 localImagePath，去掉 .tif 后缀）
        String mapfilePathStr;
        com.example.labelMark.domain.Task _task1 = taskService.selectTaskById(Integer.parseInt(taskId));
        com.example.labelMark.domain.TaskItem _taskItem1 = taskService.resolveTaskItem(Integer.parseInt(taskId), taskItemId);
        if (_taskItem1 != null && "local".equals(_taskItem1.getTaskSource()) && _taskItem1.getLocalImagePath() != null) {
            String lp = _taskItem1.getLocalImagePath();
            mapfilePathStr = lp.replaceAll("(?i)\\.tiff?$", "");
        } else {
            String file_name = _taskItem1 != null ? _taskItem1.getMapServer() : taskService.getServerById(Integer.parseInt(taskId));
            // 防御：本地任务的 map_server 形如 "local:xxx"，含冒号，不能用 Path.of
            if (file_name != null && file_name.startsWith("local:")) {
                if (_taskItem1 != null && _taskItem1.getLocalImagePath() != null) {
                    mapfilePathStr = _taskItem1.getLocalImagePath().replaceAll("(?i)\\.tiff?$", "");
                } else {
                    mapfilePathStr = file_name;
                }
            } else {
                mapfilePathStr = resolveCoveragePath(file_name);
            }
        }

        // 准备请求体
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("taskid", taskId);
        requestBody.put("taskItemId", taskItemId);
        requestBody.put("mapfile_path", mapfilePathStr);
        requestBody.put("user_id", userId);
        requestBody.put("model", modelId);
        requestBody.put("param1", param1);
        requestBody.put("param2", param2);
        requestBody.put("param3", param3);
        requestBody.put("param4", param4);
        requestBody.put("categoryMapping", categoryMappingStr); // 使用处理后的JSON字符串
        requestBody.put("modelScopeStr", modelScopeStr);

        // 将任务提交到队列异步执行
        taskExecutorService.executeInferenceFunctionAsync(requestBody);

        // 返回任务已提交的响应
        Map<String, Object> response = new HashMap<>();
        response.put("code", 200);
        response.put("message", "任务已提交，正在后台处理中");
        return response;
    }

    // 在 Java Controller 层面增加并发控制
    private final Semaphore samSemaphore = new Semaphore(1);
    //响应前端辅助功能
    @PostMapping("/assistFunction")
    public Map<String, Object> assistFunction(@RequestBody Map<String, Object> request) {
        // 获取前端传来的参数
        String taskId = request.get("taskid").toString();
        String functionName = request.get("functionName").toString();
        String assistInput = request.get("assistInput") != null ? request.get("assistInput").toString() : "";
        String userId = request.get("user_id") != null ? request.get("user_id").toString() : null;
        String modelName = request.get("modelName") != null ? request.get("modelName").toString() : null;
        String tasktype = request.get("task_type") != null ? request.get("task_type").toString() : "";
        Integer taskItemId = request.get("taskItemId") == null ? null : Integer.valueOf(request.get("taskItemId").toString());

        // 2. 获取业务参数 Map (来自前端的 fixedParameters 或交互参数)
        @SuppressWarnings("unchecked")
        Map<String, Object> params = (Map<String, Object>) request.get("parameters");
        if (params == null) params = new HashMap<>();

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

        // 获取 modelScope 数据
        String modelScopeStr = "";
        if (params.containsKey("modelScope") && params.get("modelScope") != null) {
            Object modelScope = params.get("modelScope");
            try {
                ObjectMapper objectMapper = new ObjectMapper();
                modelScopeStr = objectMapper.writeValueAsString(modelScope);
            } catch (JsonProcessingException e) {
                e.printStackTrace();
                Map<String, Object> response = new HashMap<>();
                response.put("code", StatusEnum.FAIL.code);
                response.put("message", "解析模型作用范围失败: " + e.getMessage());
                return response;
            }
        }

        // 设置文件路径（本地任务直接用 localImagePath，去掉 .tif 后缀）
        String mapfilePathStr2;
        com.example.labelMark.domain.Task _task2 = taskService.selectTaskById(Integer.parseInt(taskId));
        com.example.labelMark.domain.TaskItem _taskItem2 = taskService.resolveTaskItem(Integer.parseInt(taskId), taskItemId);
        if (_taskItem2 != null && "local".equals(_taskItem2.getTaskSource()) && _taskItem2.getLocalImagePath() != null) {
            String lp = _taskItem2.getLocalImagePath();
            mapfilePathStr2 = lp.replaceAll("(?i)\\.tiff?$", "");
        } else {
            String file_name = _taskItem2 != null ? _taskItem2.getMapServer() : taskService.getServerById(Integer.parseInt(taskId));
            // 防御：本地任务的 map_server 形如 "local:xxx"，含冒号，不能用 Path.of
            if (file_name != null && file_name.startsWith("local:")) {
                // 回退：尝试从 task 对象获取 localImagePath
                if (_taskItem2 != null && _taskItem2.getLocalImagePath() != null) {
                    mapfilePathStr2 = _taskItem2.getLocalImagePath().replaceAll("(?i)\\.tiff?$", "");
                } else {
                    mapfilePathStr2 = file_name; // 最后兜底，Python 侧会报错但不会崩 Java
                }
            } else {
                mapfilePathStr2 = resolveCoveragePath(file_name);
            }
        }

        // 准备请求体
        Map<String, Object> requestBody = new HashMap<>();
        // 这样做的好处是：前端增加任何新参数（如线选坐标），Java 都不需要改代码，Python 直接就能收到
        requestBody.putAll(params);
        requestBody.put("taskid", taskId);
        requestBody.put("taskItemId", taskItemId);
        requestBody.put("mapfile_path", mapfilePathStr2);
        requestBody.put("functionName", functionName);
        requestBody.put("assistInput", assistInput);
        requestBody.put("modelName", modelName);
        requestBody.put("categoryMapping", categoryMapping); // 使用处理后的JSON字符串
        requestBody.put("user_id", userId);
        requestBody.put("modelScopeStr", modelScopeStr);
        requestBody.put("tasktype", tasktype);




        // 根据功能名称选择执行方式
        if ("sam_inference".equals(functionName) || "auto_building_sam".equals(functionName)) {
            try {
                /*// 尝试获取许可，如果有人在用，直接返回“系统忙”，或者排队
                if (samSemaphore.tryAcquire(5, TimeUnit.SECONDS)) {
                    try {
                        RestTemplate restTemplate = new RestTemplate();
                        String url = buildPythonServiceUrl("/assistFunction");
                        return restTemplate.postForObject(url, requestBody, Map.class);
                    } finally {
                        samSemaphore.release();
                    }
                } else {
                    return Map.of("code", 500, "message", "服务器繁忙，请稍后再试");
                }*/
                // SAM 增加信号量控制（防止 GPU 溢出）
                boolean acquired = "sam_inference".equals(functionName)
                        ? samSemaphore.tryAcquire(5, TimeUnit.SECONDS)
                        : true;
                if (acquired) {
                    try {
                        RestTemplate restTemplate = new RestTemplate();
                        String url = buildPythonServiceUrl("/assistFunction");
                        return restTemplate.postForObject(url, requestBody, Map.class);
                    } finally {
                        if ("sam_inference".equals(functionName)) samSemaphore.release();
                    }
                } else {
                    return Map.of("code", 500, "message", "系统繁忙，请稍后再试");
                }

            } catch (InterruptedException e) {
                return Map.of("code", 500, "message", "请求超时");
            }
        }
        else if("xgboost".equals(functionName)){
            try {
                String url = buildPythonServiceUrl("/assistFunction");
                RestTemplate restTemplate = new RestTemplate();
                Map<String, Object> response = restTemplate.postForObject(url, requestBody, Map.class);

                if (response != null && response.get("code").equals(200)) {
                    return response;
                } else {
                    Map<String, Object> errorResponse = new HashMap<>();
                    errorResponse.put("code", 500);
                    errorResponse.put("message", "执行失败: " + (response != null ? response.get("message") : "未知错误"));
                    return errorResponse;
                }
            }catch (Exception e) {
                e.printStackTrace();
                Map<String, Object> errorResponse = new HashMap<>();
                errorResponse.put("code", 500);
                errorResponse.put("message", "执行失败: " + e.getMessage());
                return errorResponse;
            }
        }
        else {
            // 其他功能（如深度学习模型训练）仍然使用队列异步执行
            taskExecutorService.executeAssistFunctionAsync(requestBody);

            // 返回任务已提交的响应
            Map<String, Object> response = new HashMap<>();
            response.put("code", 200);
            response.put("message", "任务已提交，正在后台处理中");
            return response;
        }
    }

    @PostMapping("/getModelList")
    public Map<String, Object> getModelList(@RequestBody Map<String, String> request) {
        // 获取前端传来的用户ID和任务类型
        String userIdStr = request.get("user_id");
        String taskType = request.get("task_type"); // 新增任务类型参数
        System.out.println("当前userid为" + userIdStr + ", taskType为" + taskType);

        Map<String, Object> response = new HashMap<>();

        if (userIdStr == null || userIdStr.trim().isEmpty()) {
            response.put("code", StatusEnum.FAIL.code);
            response.put("message", "用户ID不能为空");
            return response;
        }

        try {
            Integer userId = Integer.valueOf(userIdStr);
            List<Map<String, Object>> modelMap;

            // 根据是否传递task_type来决定获取模型的方式
            if (taskType != null && !taskType.trim().isEmpty()) {
                // 按任务类型筛选模型
                modelMap = modelService.getModelMapByUserId(userId, taskType);
                System.out.println("按任务类型筛选 - Model List for user " + userId + " and taskType " + taskType + ": " + modelMap);
            } else {
                // 获取该用户的全部模型数据
                modelMap = modelService.getModelMapByUserId(userId);
                System.out.println("获取全部模型 - Model List for user " + userId + ": " + modelMap);
            }

            if (modelMap.isEmpty()) {
                response.put("code", StatusEnum.SUCCESS.code);
                response.put("message", taskType != null ? "该用户在此任务类型下没有关联的模型" : "该用户没有关联的模型");
                response.put("data", new HashMap<>()); // 返回空 Map
            } else {
                response.put("code", StatusEnum.SUCCESS.code);
                response.put("message", "成功获取模型列表");
                response.put("data", modelMap);
            }

            return response;

        } catch (NumberFormatException e) {
            response.put("code", StatusEnum.FAIL.code);
            response.put("message", "无效的用户ID格式");
            return response;
        } catch (Exception e) {
            e.printStackTrace();
            response.put("code", StatusEnum.FAIL.code);
            response.put("message", "获取模型列表失败: " + e.getMessage());
            return response;
        }
    }

    //响应前端样本更新
    @PostMapping("/update_label")
    public Map<String, Object> PythonScript_updatelabel(@RequestBody Map<String, Object> request) { // 返回 Map
        //得到前端传回的taskid，并且设置python文件以及tif影像所在位置
        Integer taskId = Integer.valueOf(request.get("taskid").toString());
        Integer taskItemId = request.get("taskItemId") == null ? null : Integer.valueOf(request.get("taskItemId").toString());
        com.example.labelMark.domain.TaskItem taskItem = taskService.resolveTaskItem(taskId, taskItemId);
        String mapfilePathStr;
        if (taskItem != null && "local".equals(taskItem.getTaskSource()) && taskItem.getLocalImagePath() != null) {
            mapfilePathStr = taskItem.getLocalImagePath();
        } else {
            String fileName = taskItem != null ? taskItem.getMapServer() : taskService.getServerById(taskId);
            mapfilePathStr = resolveCoveragePath(fileName);
        }

        // 准备请求体
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("taskid", taskId.toString());
        requestBody.put("mapfile_path", mapfilePathStr);
        requestBody.put("taskItemId", taskItemId);

        try {
            // 立即执行更新样本功能，不使用队列
            String url = buildPythonServiceUrl("/update_label");
            RestTemplate restTemplate = new RestTemplate();
            Map<String, Object> response = restTemplate.postForObject(url, requestBody, Map.class);

            if (response != null && response.get("code").equals(200)) {
                return response;
            } else {
                Map<String, Object> errorResponse = new HashMap<>();
                errorResponse.put("code", 500);
                errorResponse.put("message", "更新样本失败: " + (response != null ? response.get("message") : "未知错误"));
                return errorResponse;
            }
        } catch (Exception e) {
            e.printStackTrace();
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("code", 500);
            errorResponse.put("message", "更新样本失败: " + e.getMessage());
            return errorResponse;
        }
    }

    @PostMapping("/geometry/split")
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> splitPolygon(@RequestBody Map<String, Object> request) {
        Map<String, Object> resp = new HashMap<>();
        try {
            Integer markId = Integer.valueOf(String.valueOf(request.get("markId")));
            Mark original = markService.getById(markId);
            if (original == null) {
                resp.put("code", 404);
                resp.put("message", "未找到目标要素");
                return resp;
            }
            Geometry originGeom = toJtsGeometry(original.getGeom());
            if (!(originGeom instanceof Polygon)) {
                resp.put("code", 400);
                resp.put("message", "仅支持切分多边形");
                return resp;
            }

            @SuppressWarnings("unchecked")
            List<List<Number>> erasePolygonCoords = (List<List<Number>>) request.get("erasePolygonCoordinates");
            if (erasePolygonCoords != null && erasePolygonCoords.size() >= 3) {
                // 新模式：绘制多边形后删除与目标多边形的交集（差集）
                List<Coordinate> eraseCoordinates = erasePolygonCoords.stream()
                        .map(pt -> new Coordinate(pt.get(0).doubleValue(), pt.get(1).doubleValue()))
                        .collect(Collectors.toList());

                // 闭合环
                Coordinate first = eraseCoordinates.get(0);
                Coordinate last = eraseCoordinates.get(eraseCoordinates.size() - 1);
                if (!first.equals2D(last)) {
                    eraseCoordinates.add(new Coordinate(first));
                }

                Polygon erasePolygon = geometryFactory.createPolygon(eraseCoordinates.toArray(new Coordinate[0]));
                if (!originGeom.intersects(erasePolygon)) {
                    resp.put("code", 400);
                    resp.put("message", "绘制区域与目标多边形无交集");
                    return resp;
                }

                Geometry diff = originGeom.difference(erasePolygon);
                markService.removeById(markId);

                if (diff == null || diff.isEmpty()) {
                    resp.put("code", 200);
                    resp.put("message", "删除交集成功，目标多边形已全部移除");
                    return resp;
                }

                if (diff instanceof Polygon) {
                    Mark m = cloneMarkWithoutId(original);
                    m.setGeom(toFeatureJson(diff));
                    markService.save(m);
                } else {
                    for (int i = 0; i < diff.getNumGeometries(); i++) {
                        Geometry gi = diff.getGeometryN(i);
                        if (gi instanceof Polygon) {
                            Mark m = cloneMarkWithoutId(original);
                            m.setGeom(toFeatureJson(gi));
                            markService.save(m);
                        }
                    }
                }
                resp.put("code", 200);
                resp.put("message", "删除交集成功");
                return resp;
            }

            // 兼容旧模式：线切分
            @SuppressWarnings("unchecked")
            List<List<Number>> lineCoords = (List<List<Number>>) request.get("lineCoordinates");
            if (lineCoords == null || lineCoords.size() < 2) {
                resp.put("code", 400);
                resp.put("message", "切分线至少需要两个点");
                return resp;
            }
            Coordinate[] coords = lineCoords.stream()
                    .map(pt -> new Coordinate(pt.get(0).doubleValue(), pt.get(1).doubleValue()))
                    .toArray(Coordinate[]::new);
            LineString cutLine = geometryFactory.createLineString(coords);
            LineString effectiveCutLine = extendLineForSplit(cutLine, originGeom);

            Geometry noded = originGeom.getBoundary().union(effectiveCutLine);
            Polygonizer polygonizer = new Polygonizer();
            polygonizer.add(noded);

            @SuppressWarnings("unchecked")
            Collection<Polygon> candidates = polygonizer.getPolygons();
            List<Polygon> resultPolygons = new ArrayList<>();
            for (Polygon p : candidates) {
                if (originGeom.covers(p.getInteriorPoint())) {
                    resultPolygons.add(p);
                }
            }
            if (resultPolygons.size() < 2) {
                resp.put("code", 400);
                resp.put("message", "切分失败：请确保切分线穿过多边形内部");
                return resp;
            }

            markService.removeById(markId);
            for (Polygon p : resultPolygons) {
                Mark m = cloneMarkWithoutId(original);
                m.setGeom(toFeatureJson(p));
                markService.save(m);
            }
            resp.put("code", 200);
            resp.put("message", "切分成功");
            return resp;
        } catch (Exception e) {
            resp.put("code", 500);
            resp.put("message", "切分失败: " + e.getMessage());
            return resp;
        }
    }

    @PostMapping("/geometry/union")
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> unionPolygons(@RequestBody Map<String, Object> request) {
        Map<String, Object> resp = new HashMap<>();
        try {
            Integer markId1 = parseNullableInt(request.get("markId1"));
            Integer markId2 = parseNullableInt(request.get("markId2"));

            Geometry g1;
            Geometry g2;
            Mark m1 = null;
            Mark m2 = null;
            boolean persistMode = markId1 != null && markId2 != null;

            if (persistMode) {
                m1 = markService.getById(markId1);
                m2 = markService.getById(markId2);
                if (m1 == null || m2 == null) {
                    resp.put("code", 404);
                    resp.put("message", "未找到待合并要素");
                    return resp;
                }
                if (!Objects.equals(m1.getTaskId(), m2.getTaskId()) || !Objects.equals(m1.getTypeId(), m2.getTypeId())) {
                    resp.put("code", 400);
                    resp.put("message", "仅支持同任务同类别要素合并");
                    return resp;
                }
                g1 = toJtsGeometry(m1.getGeom());
                g2 = toJtsGeometry(m2.getGeom());
            } else {
                Object featureGeoJson1 = request.get("featureGeoJson1");
                Object featureGeoJson2 = request.get("featureGeoJson2");
                g1 = toJtsGeometry(featureGeoJson1);
                g2 = toJtsGeometry(featureGeoJson2);
                if (g1 == null || g2 == null) {
                    resp.put("code", 400);
                    resp.put("message", "缺少有效几何参数");
                    return resp;
                }
            }

            if (!g1.intersects(g2)) {
                resp.put("code", 400);
                resp.put("message", "两个多边形未相交，无法求并集");
                return resp;
            }

            Geometry union = g1.union(g2);
            if (union == null || union.isEmpty()) {
                resp.put("code", 400);
                resp.put("message", "并集结果为空");
                return resp;
            }

            List<JSONObject> unionFeatures = new ArrayList<>();
            if (union instanceof Polygon) {
                unionFeatures.add(toFeatureJson(union));
            } else {
                for (int i = 0; i < union.getNumGeometries(); i++) {
                    Geometry gi = union.getGeometryN(i);
                    if (gi instanceof Polygon) {
                        unionFeatures.add(toFeatureJson(gi));
                    }
                }
            }

            if (persistMode) {
                markService.removeByIds(Arrays.asList(markId1, markId2));
                for (JSONObject feature : unionFeatures) {
                    Mark newMark = cloneMarkWithoutId(m1);
                    newMark.setGeom(feature);
                    markService.save(newMark);
                }
            }

            resp.put("unionFeatures", unionFeatures);
            resp.put("code", 200);
            resp.put("message", "并集成功");
            return resp;
        } catch (Exception e) {
            resp.put("code", 500);
            resp.put("message", "并集失败: " + e.getMessage());
            return resp;
        }
    }

    private LineString extendLineForSplit(LineString line, Geometry polygonGeom) {
        Coordinate[] coords = line.getCoordinates();
        if (coords == null || coords.length < 2) {
            return line;
        }
        Envelope env = polygonGeom.getEnvelopeInternal();
        double scale = Math.max(env.getWidth(), env.getHeight());
        double extendLen = (scale > 0 ? scale : 1.0) * 4.0 + 1.0;

        Coordinate start = coords[0];
        Coordinate next = coords[1];
        Coordinate end = coords[coords.length - 1];
        Coordinate prev = coords[coords.length - 2];

        Coordinate extStart = extendFrom(start, next, extendLen);
        Coordinate extEnd = extendFrom(end, prev, extendLen);

        Coordinate[] extended = new Coordinate[coords.length + 2];
        extended[0] = extStart;
        System.arraycopy(coords, 0, extended, 1, coords.length);
        extended[extended.length - 1] = extEnd;
        return geometryFactory.createLineString(extended);
    }

    private Coordinate extendFrom(Coordinate anchor, Coordinate towardInner, double length) {
        double vx = anchor.x - towardInner.x;
        double vy = anchor.y - towardInner.y;
        double norm = Math.hypot(vx, vy);
        if (norm == 0) {
            return new Coordinate(anchor.x + length, anchor.y);
        }
        double ux = vx / norm;
        double uy = vy / norm;
        return new Coordinate(anchor.x + ux * length, anchor.y + uy * length);
    }

    private Geometry toJtsGeometry(JSONObject featureJson) {
        if (featureJson == null) return null;
        JSONObject geometry = featureJson.getJSONObject("geometry");
        if (geometry == null) {
            if ("Feature".equals(featureJson.getString("type"))) {
                return null;
            }
            geometry = featureJson;
        }
        return geoJSONReader.read(geometry.toJSONString());
    }

    private Geometry toJtsGeometry(Object featureLike) {
        if (featureLike == null) return null;
        try {
            JSONObject jsonObject;
            if (featureLike instanceof JSONObject) {
                jsonObject = (JSONObject) featureLike;
            } else if (featureLike instanceof String) {
                jsonObject = JSON.parseObject((String) featureLike);
            } else {
                jsonObject = JSON.parseObject(JSON.toJSONString(featureLike));
            }
            return toJtsGeometry(jsonObject);
        } catch (Exception e) {
            return null;
        }
    }

    private Integer parseNullableInt(Object value) {
        if (value == null) return null;
        String str = String.valueOf(value).trim();
        if (str.isEmpty() || "null".equalsIgnoreCase(str)) return null;
        try {
            return Integer.valueOf(str);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private JSONObject toFeatureJson(Geometry geometry) {
        org.wololo.geojson.Geometry geo = geoJSONWriter.write(geometry);
        JSONObject feature = new JSONObject();
        feature.put("type", "Feature");
        feature.put("properties", new JSONObject());
        feature.put("geometry", JSON.parseObject(geo.toString()));
        return feature;
    }

    private Mark cloneMarkWithoutId(Mark src) {
        Mark m = new Mark();
        m.setTaskId(src.getTaskId());
        m.setUserId(src.getUserId());
        m.setTypeId(src.getTypeId());
        m.setAttrJson(src.getAttrJson());
        m.setStatus(src.getStatus());
        m.setFeedback(src.getFeedback());
        return m;
    }
}
