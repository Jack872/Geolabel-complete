package com.example.labelMark.controller;

import com.example.labelMark.DTO.model.ModelUploadDTO;
import com.example.labelMark.domain.Model;
import com.example.labelMark.service.ModelService;
import com.fasterxml.jackson.core.type.TypeReference;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import com.fasterxml.jackson.databind.ObjectMapper;

import javax.annotation.Resource;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 模型管理控制器
 */
@RestController
@RequestMapping("/model")
public class ModelController {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Resource
    private ModelService modelService;
    @Value("${modal.path}")
    private String modalPath;

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

            // 确保目录存在 - 使用与train.py相同的路径格式
            String baseDir = modalPath;
            String uploadDir =baseDir +File.separator+ userId;
            Path uploadPath = Path.of(baseDir, String.valueOf(userId));
            if (!Files.exists(uploadPath)) {
                Files.createDirectories(uploadPath);
            }

            // 根据任务类型创建子目录
            String subDir = "地物分类".equals(taskType) ? "segmentation_results" : "detection_results";
            String taskTypeDir = uploadDir + File.separator + subDir;
            Path taskTypePath = Path.of(uploadDir,subDir);
            if (!Files.exists(taskTypePath)) {
                Files.createDirectories(taskTypePath);
            }

            // 保留原始文件名，避免重命名导致模型加载问题
            String originalFilename = file.getOriginalFilename();
            if (originalFilename == null || originalFilename.trim().isEmpty()) {
                throw new IllegalArgumentException("模型文件名无效，请重新选择文件");
            }
            String filePath = taskTypeDir + File.separator + originalFilename;

            // 检查文件是否已存在，如果存在则添加时间戳
            Path targetPath = Paths.get(filePath);
            if (Files.exists(targetPath)) {
                int dotIndex = originalFilename.lastIndexOf(".");
                String nameWithoutExt = dotIndex > 0 ? originalFilename.substring(0, dotIndex) : originalFilename;
                String extension = dotIndex > 0 ? originalFilename.substring(dotIndex) : "";
                String timestamp = String.valueOf(System.currentTimeMillis());
                filePath = taskTypeDir + File.separator + nameWithoutExt + "_" + timestamp + extension;
                targetPath = Paths.get(filePath);
            }

            // 保存文件
            Files.copy(file.getInputStream(), targetPath);

            // 保存模型信息到数据库
            Model model = new Model();
            model.setModelName(modelName);
            Map<String, Object> modelSpec = normalizeModelSpec(uploadDTO, originalFilename);
            model.setModelDes(OBJECT_MAPPER.writeValueAsString(modelSpec));
            model.setInputNum(uploadDTO.getInputChannels());
            model.setOutputNum(uploadDTO.getNumClasses());
            model.setTaskType(taskType);
            model.setUserId(userId);
            model.setPath(filePath);
            model.setStatus(1);
            model.setModelType(normalizeDisplayModelType(modelType, uploadDTO.getArch()));

            boolean saved = modelService.saveModel(model);

            if (saved) {
                response.put("success", true);
                response.put("message", "Model uploaded successfully");
                response.put("model", model);
                return ResponseEntity.ok(response);
            } else {
                response.put("success", false);
                response.put("message", "Failed to save model information");
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

    /**
     * 删除模型
     */
    @DeleteMapping("/{modelId}")
    public ResponseEntity<Map<String, Object>> deleteModel(@PathVariable Integer modelId) {
        Map<String, Object> response = new HashMap<>();

        // 获取模型信息，以便删除文件
        Model model = modelService.getById(modelId);
        if (model != null && model.getPath() != null) {
            try {
                // 删除文件
                Path filePath = Paths.get(model.getPath());
                Files.deleteIfExists(filePath);
            } catch (IOException e) {
                // 文件删除失败，但仍然可以继续删除数据库记录
                response.put("warning", "Model file could not be deleted: " + e.getMessage());
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
}
