package com.example.labelMark.controller;

import com.example.labelMark.DTO.model.ModelUploadDTO;
import com.example.labelMark.config.MinioConfig;
import com.example.labelMark.domain.Model;
import com.example.labelMark.service.ModelService;
import com.example.labelMark.utils.MinIoUtils;
import com.fasterxml.jackson.core.type.TypeReference;
import io.minio.PutObjectArgs;
import io.minio.MinioClient;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import com.fasterxml.jackson.databind.ObjectMapper;

import javax.annotation.Resource;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.Date;

/**
 * 模型管理控制器
 */
@RestController
@RequestMapping("/model")
public class ModelController {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Resource
    private ModelService modelService;
    @Resource
    private MinioClient minioClient;
    @Resource
    private MinioConfig minioConfig;
    @Resource
    private MinIoUtils minIoUtils;

    /**
     * 根据用户ID获取模型列表
     */
    @GetMapping("/user/{userId}")
    public ResponseEntity<List<Model>> getModelsByUserId(@PathVariable Integer userId, @RequestParam(required = false) String taskType) {
        List<Model> models;
        if (taskType != null && !taskType.isEmpty()) {
            models = modelService.getModelListByUserId(userId, taskType);
        } else {
            // 如果未提供taskType，则获取用户的所有模型
            models = modelService.getModelListByUserIdWithoutTaskType(userId);
        }
        return ResponseEntity.ok(models);
    }

    /**
     * 获取模型训练详情
     */
    @GetMapping("/getModelTrainDetails")
    public ResponseEntity<Map<String, Object>> getModelTrainDetails(
            @RequestParam("model_id") Integer modelId,
            @RequestParam("user_id") Integer userId) {
        Map<String, Object> response = new HashMap<>();
        try {
            if (modelId == null || userId == null) {
                response.put("code", 400);
                response.put("success", false);
                response.put("message", "model_id 和 user_id 不能为空");
                return ResponseEntity.badRequest().body(response);
            }

            Model model = modelService.getById(modelId);
            if (model == null || !userId.equals(model.getUserId())) {
                response.put("code", 404);
                response.put("success", false);
                response.put("message", "未找到模型或无权访问");
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
            }

            Map<String, Object> modelMeta = parseJsonMap(model.getModelDes());
            boolean manualUploadModel = isManualUploadModel(model);
            Map<String, Object> inferParams = safeMap(modelMeta.get("inferParams"));
            Map<String, Object> constructorArgs = safeMap(modelMeta.get("constructorArgs"));

            Map<String, Object> params = new LinkedHashMap<>();
            if (!manualUploadModel) {
                putIfPresent(params, "epochs", firstNonNullNumber(
                        constructorArgs.get("epochs"),
                        constructorArgs.get("num_epochs"),
                        inferParams.get("epochs")));
                putIfPresent(params, "batch_size", firstNonNullNumber(
                        constructorArgs.get("batchSize"),
                        constructorArgs.get("batch_size"),
                        inferParams.get("batch_size")));
                putIfPresent(params, "learning_rate", firstNonNullNumber(
                        constructorArgs.get("learningRate"),
                        constructorArgs.get("learning_rate")));
                putIfPresent(params, "optimizer", firstNonBlank(
                        constructorArgs.get("optimizer"),
                        constructorArgs.get("optim")));
                putIfPresent(params, "img_size", firstNonNullNumber(
                        constructorArgs.get("imgSize"),
                        constructorArgs.get("img_size"),
                        inferParams.get("img_size")));
                putIfPresent(params, "conf_threshold", firstNonNullNumber(
                        inferParams.get("conf_threshold"),
                        inferParams.get("confidenceThreshold")));
            }

            Map<String, Object> data = new LinkedHashMap<>();
            data.put("modelId", model.getModelId());
            data.put("modelName", model.getModelName());
            data.put("modelDes", model.getModelDes());
            data.put("taskType", model.getTaskType());
            data.put("modelType", model.getModelType());
            data.put("inputNum", model.getInputNum());
            data.put("outputNum", model.getOutputNum());
            data.put("mapping", safeString(modelMeta.get("classMapping")));
            data.put("path", model.getPath());
            data.put("userId", model.getUserId());
            data.put("createTime", null);
            data.put("status", normalizeStatus(model.getStatus()));
            data.put("metrics", manualUploadModel ? null : new LinkedHashMap<>());
            data.put("params", params);

            response.put("code", 200);
            response.put("success", true);
            response.put("data", data);
            response.put("message", "获取模型详情成功");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            response.put("code", 500);
            response.put("success", false);
            response.put("message", "获取模型详情失败: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }

    /**
     * 上传模型文件并保存模型信息
     */
    @PostMapping("/upload")
    public ResponseEntity<Map<String, Object>> uploadModel(
            @RequestParam("file") MultipartFile file,
            @RequestParam("modelName") String modelName,
            @RequestParam("modelDes") String modelDes,
            @RequestParam("taskType") String taskType,
            @RequestParam(value = "modelType", required = false) String modelType,
            @RequestParam("userId") Integer userId) {

        Map<String, Object> response = new HashMap<>();

        try {
            ModelUploadDTO uploadDTO = parseAndValidateModelSpec(modelDes);

            String originalFilename = file.getOriginalFilename();
            if (originalFilename == null || originalFilename.trim().isEmpty()) {
                throw new IllegalArgumentException("模型文件名无效，请重新选择文件");
            }
            String normalizedTaskType = normalizeTaskTypeSegment(taskType);
            String storageFileName = sanitizeFileName(originalFilename);

            Model model = new Model();
            model.setModelName(modelName);
            Map<String, Object> modelSpec = normalizeModelSpec(uploadDTO, originalFilename);
            model.setModelDes(OBJECT_MAPPER.writeValueAsString(modelSpec));
            model.setInputNum(uploadDTO.getInputChannels());
            model.setOutputNum(uploadDTO.getNumClasses());
            model.setTaskType(taskType);
            model.setUserId(userId);
            model.setPath("");
            model.setStatus(1);
            model.setModelType(normalizeDisplayModelType(modelType, uploadDTO.getArch()));
            model.setStorageType("minio");
            model.setBucketName(minioConfig.getBucketName());
            model.setFileName(storageFileName);
            model.setOriginalFilename(originalFilename);

            boolean saved = modelService.saveModel(model);
            if (!saved || model.getModelId() == null) {
                response.put("success", false);
                response.put("message", "Failed to save model information");
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
            }

            String objectKey = buildManualModelObjectKey(userId, model.getModelId(), normalizedTaskType, storageFileName);
            try {
                ensureBucketReady();
                minioClient.putObject(
                        PutObjectArgs.builder()
                                .bucket(minioConfig.getBucketName())
                                .object(objectKey)
                                .stream(file.getInputStream(), file.getSize(), -1)
                                .contentType(resolveContentType(file))
                                .build()
                );
            } catch (Exception uploadEx) {
                modelService.removeById(model.getModelId());
                throw new IOException("Failed to upload model to MinIO: " + uploadEx.getMessage(), uploadEx);
            }

            model.setObjectKey(objectKey);
            model.setPath(objectKey);
            boolean updated = modelService.updateById(model);

            if (updated) {
                response.put("success", true);
                response.put("message", "Model uploaded successfully");
                response.put("model", model);
                return ResponseEntity.ok(response);
            } else {
                minIoUtils.remove(objectKey);
                modelService.removeById(model.getModelId());
                response.put("success", false);
                response.put("message", "Failed to persist uploaded model metadata");
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
            }
        } catch (IllegalArgumentException e) {
            response.put("success", false);
            response.put("message", e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
        } catch (IOException e) {
            response.put("success", false);
            response.put("message", "Failed to upload model: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        } catch (Exception e) {
            response.put("success", false);
            response.put("message", "Failed to upload model: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }

    private ModelUploadDTO parseAndValidateModelSpec(String modelDes) {
        try {
            Map<String, Object> rawMap = OBJECT_MAPPER.readValue(modelDes, new TypeReference<Map<String, Object>>() {});
            ModelUploadDTO dto = OBJECT_MAPPER.convertValue(rawMap, ModelUploadDTO.class);
            validateRequiredString(dto.getFramework(), "framework");
            validateRequiredString(dto.getArch(), "arch");
            validateRequiredString(dto.getCheckpointFormat(), "checkpointFormat");
            validatePositive(dto.getInputChannels(), "inputChannels");
            validatePositive(dto.getNumClasses(), "numClasses");
            return dto;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("model_des 必须是合法 JSON，并包含完整 modelSpec 字段");
        }
    }

    private void validateRequiredString(String value, String fieldName) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("modelSpec 缺少必填字段: " + fieldName);
        }
    }

    private void validatePositive(Integer value, String fieldName) {
        if (value == null || value <= 0) {
            throw new IllegalArgumentException("modelSpec." + fieldName + " 必须是正整数");
        }
    }

    private Map<String, Object> normalizeModelSpec(ModelUploadDTO dto, String originalFilename) {
        Map<String, Object> normalized = new LinkedHashMap<>();
        normalized.put("framework", safeLower(dto.getFramework()));
        normalized.put("arch", safeLower(dto.getArch()));
        normalized.put("variant", safeString(dto.getVariant()));
        normalized.put("backbone", safeString(dto.getBackbone()));
        normalized.put("encoder", safeString(dto.getEncoder()));
        normalized.put("checkpointFormat", safeLower(dto.getCheckpointFormat()));
        normalized.put("weightFormat", safeWeightFormat(dto.getWeightFormat(), originalFilename));
        normalized.put("inputChannels", dto.getInputChannels());
        normalized.put("numClasses", dto.getNumClasses());
        normalized.put("constructorArgs", dto.getConstructorArgs() == null ? new HashMap<>() : dto.getConstructorArgs());
        normalized.put("inferParams", dto.getInferParams() == null ? new HashMap<>() : dto.getInferParams());
        normalized.put("classMapping", dto.getClassMapping() == null ? new HashMap<>() : dto.getClassMapping());
        normalized.put("supports", normalizeSupports(dto.getSupports()));
        normalized.put("applicableTypeIds", dto.getApplicableTypeIds() == null ? List.of() : dto.getApplicableTypeIds());
        normalized.put("versionTag", safeString(dto.getVersionTag()));
        normalized.put("description", safeString(dto.getDescription()));
        return normalized;
    }

    private Map<String, Object> normalizeSupports(Map<String, Object> supports) {
        Map<String, Object> normalized = new LinkedHashMap<>();
        normalized.put("preAnnotation", supports != null && truthy(supports.get("preAnnotation")));
        normalized.put("qualityReference", supports != null && truthy(supports.get("qualityReference")));
        normalized.put("batchInference", supports != null && truthy(supports.get("batchInference")));
        return normalized;
    }

    private boolean truthy(Object value) {
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        return value != null && "true".equalsIgnoreCase(String.valueOf(value).trim());
    }

    private String normalizeDisplayModelType(String modelType, String arch) {
        if (modelType != null && !modelType.trim().isEmpty()) {
            return modelType.trim().toLowerCase();
        }
        return safeLower(arch);
    }

    private String safeWeightFormat(String weightFormat, String originalFilename) {
        if (weightFormat != null && !weightFormat.trim().isEmpty()) {
            return weightFormat.trim().toLowerCase();
        }
        if (originalFilename == null || !originalFilename.contains(".")) {
            return "";
        }
        return originalFilename.substring(originalFilename.lastIndexOf(".") + 1).toLowerCase();
    }

    private String safeLower(String value) {
        return value == null ? "" : value.trim().toLowerCase();
    }

    private String safeString(String value) {
        return value == null ? "" : value.trim();
    }

    private void ensureBucketReady() {
        if (!minIoUtils.bucketExists(minioConfig.getBucketName())) {
            boolean created = minIoUtils.makeBucket(minioConfig.getBucketName());
            if (!created) {
                throw new IllegalStateException("MinIO bucket unavailable: " + minioConfig.getBucketName());
            }
        }
    }

    private String buildManualModelObjectKey(Integer userId, Integer modelId, String taskType, String fileName) {
        return "models/manual/" + userId + "/" + taskType + "/" + modelId + "/" + fileName;
    }

    private String normalizeTaskTypeSegment(String taskType) {
        if ("地物分类".equals(taskType)) {
            return "segmentation";
        }
        if ("目标检测".equals(taskType)) {
            return "detection";
        }
        return safeLower(taskType).replaceAll("[^a-z0-9_-]+", "_");
    }

    private String sanitizeFileName(String fileName) {
        String candidate = fileName == null ? "" : fileName.trim();
        if (candidate.isEmpty()) {
            return "model.bin";
        }
        candidate = candidate.replace("\\", "/");
        int slashIndex = candidate.lastIndexOf('/');
        if (slashIndex >= 0) {
            candidate = candidate.substring(slashIndex + 1);
        }
        candidate = candidate.replaceAll("[\\r\\n]", "_");
        return candidate.isEmpty() ? "model.bin" : candidate;
    }

    private String resolveContentType(MultipartFile file) {
        if (StringUtils.hasText(file.getContentType())) {
            return file.getContentType();
        }
        return "application/octet-stream";
    }

    /**
     * 删除模型
     */
    @DeleteMapping("/{modelId}")
    public ResponseEntity<Map<String, Object>> deleteModel(@PathVariable Integer modelId) {
        Map<String, Object> response = new HashMap<>();

        Model model = modelService.getById(modelId);
        if (model != null) {
            String objectKey = trimToNull(model.getObjectKey());
            if (objectKey != null) {
                boolean removed = minIoUtils.remove(objectKey);
                if (!removed) {
                    response.put("warning", "Model object could not be deleted from MinIO");
                }
            }
            String legacyPath = trimToNull(model.getPath());
            if (objectKey == null && legacyPath != null) {
                try {
                    Path filePath = Paths.get(legacyPath);
                    Files.deleteIfExists(filePath);
                } catch (IOException e) {
                    response.put("warning", "Legacy model file could not be deleted: " + e.getMessage());
                }
            }
        }

        boolean deleted = modelService.deleteModel(modelId);
        if (deleted) {
            response.put("success", true);
            response.put("message", "Model deleted successfully");
            return ResponseEntity.ok(response);
        } else {
            response.put("success", false);
            response.put("message", "Failed to delete model");
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }

    /**
     * 更新模型信息
     */
    @PutMapping("/{modelId}")
    public ResponseEntity<Map<String, Object>> updateModel(@PathVariable Integer modelId, @RequestBody Model model) {
        Map<String, Object> response = new HashMap<>();

        model.setModelId(modelId);
        boolean updated = modelService.updateModel(model);

        if (updated) {
            response.put("success", true);
            response.put("message", "Model updated successfully");
            return ResponseEntity.ok(response);
        } else {
            response.put("success", false);
            response.put("message", "Failed to update model");
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }

    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private Map<String, Object> parseJsonMap(String rawJson) {
        if (!StringUtils.hasText(rawJson)) {
            return new LinkedHashMap<>();
        }
        try {
            return OBJECT_MAPPER.readValue(rawJson, new TypeReference<Map<String, Object>>() {});
        } catch (Exception ignored) {
            return new LinkedHashMap<>();
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> safeMap(Object value) {
        if (value instanceof Map) {
            return new LinkedHashMap<>((Map<String, Object>) value);
        }
        return new LinkedHashMap<>();
    }

    private void putIfPresent(Map<String, Object> target, String key, Object value) {
        if (value == null) {
            return;
        }
        if (value instanceof String && !StringUtils.hasText((String) value)) {
            return;
        }
        target.put(key, value);
    }

    private Object firstNonNullNumber(Object... values) {
        for (Object value : values) {
            if (value == null) {
                continue;
            }
            if (value instanceof Number) {
                return value;
            }
            String str = String.valueOf(value).trim();
            if (!str.isEmpty()) {
                return str;
            }
        }
        return null;
    }

    private String firstNonBlank(Object... values) {
        for (Object value : values) {
            if (value == null) {
                continue;
            }
            String str = String.valueOf(value).trim();
            if (!str.isEmpty()) {
                return str;
            }
        }
        return null;
    }

    private String normalizeStatus(Integer status) {
        if (status == null) {
            return "unknown";
        }
        if (status == 1) {
            return "completed";
        }
        if (status == 0) {
            return "training";
        }
        return String.valueOf(status);
    }

    private boolean isManualUploadModel(Model model) {
        String objectKey = trimToNull(model.getObjectKey());
        if (objectKey != null && objectKey.startsWith("models/manual/")) {
            return true;
        }
        String path = trimToNull(model.getPath());
        return path != null && path.startsWith("models/manual/");
    }

    private String safeString(Object value) {
        if (value == null) {
            return "";
        }
        if (value instanceof Map || value instanceof List) {
            try {
                return OBJECT_MAPPER.writeValueAsString(value);
            } catch (Exception ignored) {
                return String.valueOf(value);
            }
        }
        return String.valueOf(value);
    }
}
