package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.labelMark.DTO.TDML.TdmlExportOptions;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.DTO.prov.ProvEntityRef;
import com.example.labelMark.DTO.sample.DatasetMeta;
import com.example.labelMark.DTO.sample.MetaCategory;
import com.example.labelMark.DTO.sample.MetaImage;
import com.example.labelMark.DTO.sample.MetaObject;
import com.example.labelMark.config.MinioConfig;
import com.example.labelMark.domain.*;
import com.example.labelMark.mapper.*;
import com.example.labelMark.service.*;
import com.example.labelMark.utils.*;
import com.example.labelMark.vo.LoginUser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import io.minio.GetObjectArgs;
import io.minio.GetPresignedObjectUrlArgs;
import io.minio.ListObjectsArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.Result;
import io.minio.messages.Item;
import io.minio.http.Method;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.FileSystemUtils;

import javax.annotation.Resource;
import javax.imageio.ImageIO;
import javax.servlet.http.HttpServletResponse;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.nio.file.StandardCopyOption;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.stream.Collectors;
import java.util.zip.ZipOutputStream;

/**
 * @Description
 * @Author wh
 * @Date 2025/12/16
 */
@Service
public class SampleSetServiceImpl extends ServiceImpl<SampleSetMapper, SampleSet> implements SampleSetService {
    private static final Set<String> QUALITY_PROVENANCE_TYPES = new HashSet<>(Arrays.asList("QUALITY_EVALUATE", "QUALITY_REFERENCE_EVALUATE"));
    private static final int MAX_QUALITY_PROVENANCE_RECORDS = 3;

    @Autowired
    private TaskService taskService;
    @Autowired private MarkService markService;
    @Autowired private ServerService serverService;
    @Autowired private GeoServerRESTClient geoServerRESTClient;
    @Autowired private GeoServerService geoServerService;
    @Autowired private TypeService typeService;
    @Autowired private SysFileService sysFileService;
    @Resource
    private ProvenanceService provenanceService;
    @Resource
    private ProvActivityMapper provActivityMapper;
    @Resource private ProvUtils provUtils;

    @Resource private ProvEntityMapper provEntityMapper;
    @Resource private ProvRelationMapper provRelationMapper;
    @Resource private ProvAgentMapper provAgentMapper;
    @Resource private MinioClient minioClient;
    @Resource private MinioConfig minioConfig;
    @Resource private MinioFileResolveService minioFileResolveService;

    private static final Logger logger = LoggerFactory.getLogger(SampleSetServiceImpl.class);
    @Value("${sampleSet.path}")
    private String sampleSetPath;
    @Transactional(rollbackFor = Exception.class)
    public int createMergedDataset(List<Integer> taskIds, String datasetName, Map<String, Object> params) throws IOException {
        ImageIO.setUseCache(false);
        // 1. 准备路径
        Path outputDir = Paths.get(sampleSetPath + File.separator + datasetName);
        Path imageDir = outputDir.resolve("images");
        Path slicesDir = outputDir.resolve("slices");
        Path metaJsonPath = outputDir.resolve("project_meta.json");

        try {
            SampleUtils.createDirs(imageDir, slicesDir);

            // 获取参数
            String username = params.get("username") != null ? params.get("username").toString() : "system";
            String description = params.get("description") != null ? params.get("description").toString() : "";
            double expandRatio = params.getOrDefault("expandRatio", 0.1) instanceof Number ? ((Number) params.get("expandRatio")).doubleValue() : 0.1;
            boolean forceSquare = params.getOrDefault("forceSquare", true) instanceof Boolean ? (Boolean) params.get("forceSquare") : true;
            Integer targetSize = params.get("targetSize") != null ? Integer.parseInt(params.get("targetSize").toString()) : null;
            if (targetSize != null && targetSize <= 0) targetSize = null;

            DatasetMeta projectMeta = new DatasetMeta();
            projectMeta.setDatasetName(datasetName);
            projectMeta.setCreateTime(new Date().toString());

            Map<String, MetaCategory> categoryMap = new HashMap<>();
            int globalObjectId = 1;
            int nextCategoryId = 1;
            int totalSliceCount = 0;
            String taskType = null;

            // ================== 循环开始 ==================
            for (Integer taskId : taskIds) {
                System.out.println("Processing Task: " + taskId);

                Task task = taskService.selectTaskById(taskId);
                if (task == null) continue;
                List<TaskItem> taskItems = taskService.getTaskItems(taskId);
                if (taskItems == null || taskItems.isEmpty()) {
                    taskItems = new ArrayList<>();
                    taskItems.add(null);
                }

                if (taskType == null) {
                    taskType = task.getTaskType();
                }

                for (TaskItem taskItem : taskItems) {
                    Integer taskItemId = taskItem != null ? taskItem.getTaskItemId() : null;
                    Task effectiveTask = mergeTaskWithItem(task, taskItem);
                    List<Mark> marks = markService.getMarkByTaskItem(taskId, taskItemId);
                    if (marks == null || marks.isEmpty()) continue;
                    String sourceKey = taskItemId == null ? String.valueOf(taskId) : (taskId + "_" + taskItemId);

                    if ("地物分类".equals(task.getTaskType())) {
                        totalSliceCount += processSegmentationTask(
                                effectiveTask, marks, taskId, taskItemId, sourceKey, params, targetSize,
                                slicesDir, outputDir, projectMeta, categoryMap,
                                globalObjectId);
                        globalObjectId = projectMeta.getImages().stream()
                                .flatMap(img -> img.getObjects().stream())
                                .mapToInt(MetaObject::getId).max().orElse(globalObjectId) + 1;
                        continue;
                    }

                    BufferedImage sourceImage = null;
                    String largeFileName;
                    if ("local".equals(effectiveTask.getTaskSource()) && effectiveTask.getLocalImagePath() != null) {
                        largeFileName = "train_" + sourceKey + ".jpg";
                        Path largeFilePath = imageDir.resolve(largeFileName);
                        sourceImage = loadTaskSourceImage(effectiveTask, taskId, taskItemId);
                        if (sourceImage == null) continue;
                        if (!largeFilePath.toFile().exists()) {
                            ImageIO.write(sourceImage, "jpg", largeFilePath.toFile());
                        }
                    } else {
                        Server server = serverService.getById(effectiveTask.getServerId());
                        if (server == null) continue;
                        String readableTime = server.getSerYear().replaceAll("[:.]", "").replace("T", "_");
                        String LayerName = server.getSerName() + "_" + server.getSetName() + "_" + readableTime;

                        String layerInfo = geoServerRESTClient.getLayerInfo(LayerName);
                        if (layerInfo == null || !layerInfo.trim().startsWith("{")) continue;

                        ObjectMapper objectMapper = new ObjectMapper();
                        JsonNode rootNode = objectMapper.readTree(layerInfo);
                        String coverageHref = rootNode.path("layer").path("resource").path("href").asText();
                        String coverageInfo = geoServerRESTClient.getCoverageInfo(coverageHref);
                        if (coverageInfo == null || !coverageInfo.trim().startsWith("{")) continue;

                        JsonNode coverageRootNode = objectMapper.readTree(coverageInfo);
                        String srs = coverageRootNode.path("coverage").path("srs").asText();
                        JsonNode bboxNode = coverageRootNode.path("coverage").path("nativeBoundingBox");
                        double minx = bboxNode.path("minx").asDouble();
                        double maxx = bboxNode.path("maxx").asDouble();
                        double miny = bboxNode.path("miny").asDouble();
                        double maxy = bboxNode.path("maxy").asDouble();

                        double height = 2048;
                        double width = Math.ceil(((maxx - minx) / (maxy - miny)) * height);
                        String bboxStr = String.format("%f,%f,%f,%f", minx, miny, maxx, maxy);
                        largeFileName = "train_" + sourceKey + ".tif";
                        Path largeFilePath = imageDir.resolve(largeFileName);

                        if (!largeFilePath.toFile().exists()) {
                            ResponseEntity<byte[]> result = geoServerService.getGeoserverImg(
                                    LayerName, (int) Math.round(width), (int) Math.round(height), bboxStr, srs
                            );
                            try (FileOutputStream fos = new FileOutputStream(largeFilePath.toFile())) {
                                if (result.getBody() != null) fos.write(result.getBody());
                            }
                        }

                        Map<String, Double> tifParams = new HashMap<>();
                        tifParams.put("minx", Math.abs(minx));
                        tifParams.put("maxy", Math.abs(maxy));
                        tifParams.put("serverHeight", Math.abs(maxy) - Math.abs(miny));
                        tifParams.put("serverWidth", Math.abs(maxx) - Math.abs(minx));
                        Map<String, Double> dimensions = new HashMap<>();
                        dimensions.put("width", width);
                        dimensions.put("height", height);

                        List<Map<String, Object>> markMapList = DomainToMapList.convertDomainListToMapList(marks);
                        List<Map<String, Object>> segmentationArr = CovertCoordinateToPixel.covertCoordinateToPixel(markMapList, tifParams, dimensions);

                        sourceImage = ImageIO.read(largeFilePath.toFile());
                        if (sourceImage == null) continue;

                        MetaImage metaImage = new MetaImage();
                        metaImage.setId(taskItemId != null ? taskItemId : taskId);
                        metaImage.setFileName(largeFileName);
                        metaImage.setOriginalTaskId(taskId);

                        for (int i = 0; i < segmentationArr.size(); i++) {
                            Map<String, Object> segItem = segmentationArr.get(i);
                            Integer typeId = (Integer) segItem.get("type_id");
                            String typeName = typeService.getTypeNameById(typeId);
                            String typeColor = (String) segItem.get("type_color");

                            if (!categoryMap.containsKey(typeName)) {
                                MetaCategory category = new MetaCategory();
                                category.setId(typeId);
                                category.setName(typeName);
                                category.setColor(typeColor);
                                categoryMap.put(typeName, category);
                            }
                            int finalNextCategoryId = nextCategoryId;
                            MetaCategory cat = categoryMap.computeIfAbsent(typeName, k -> {
                                MetaCategory c = new MetaCategory();
                                c.setId(finalNextCategoryId);
                                c.setName(typeName);
                                c.setColor(typeColor);
                                return c;
                            });
                            if (cat.getId() == nextCategoryId) nextCategoryId++;

                            List<Double> rawBbox = (List<Double>) segItem.get("bbox");
                            boolean smallObjectOptimize = params.get("smallObjectOptimize") != null
                                    ? Boolean.parseBoolean(params.get("smallObjectOptimize").toString()) : true;
                            double maxSide = Math.max((double) rawBbox.get(2), (double) rawBbox.get(3));

                            SampleUtils.CropRect cropRect;
                            double scale = 1.0;
                            int finalW;
                            int finalH;
                            if (targetSize != null && smallObjectOptimize && maxSide < targetSize) {
                                cropRect = SampleUtils.calculateFixedWindowRect(rawBbox, sourceImage.getWidth(), sourceImage.getHeight(), targetSize);
                                finalW = targetSize;
                                finalH = targetSize;
                            } else {
                                cropRect = SampleUtils.calculateCropRect(rawBbox, sourceImage.getWidth(), sourceImage.getHeight(), expandRatio, forceSquare);
                                if (targetSize != null) {
                                    finalW = targetSize;
                                    finalH = targetSize;
                                    scale = (double) targetSize / cropRect.getW();
                                } else {
                                    finalW = cropRect.getFinalW();
                                    finalH = cropRect.getFinalH();
                                }
                            }

                            String sliceName = "slice_" + sourceKey + "_" + i + ".jpg";
                            Path slicePath = slicesDir.resolve(sliceName);
                            if (!slicePath.toFile().exists()) {
                                SampleUtils.cropAndSave(sourceImage, cropRect, finalW, finalH, slicePath.toFile());
                            }

                            List<List<Double>> originalPoly = (List<List<Double>>) segItem.get("segmentation");
                            List<List<Double>> localPoly = SampleUtils.transformPoly(originalPoly, cropRect.getX(), cropRect.getY(), scale);
                            List<Double> localBbox = SampleUtils.transformBbox(rawBbox, cropRect.getX(), cropRect.getY(), scale);

                            MetaObject obj = new MetaObject();
                            obj.setId(globalObjectId++);
                            obj.setCategoryId(cat.getId());
                            obj.setCategoryName(cat.getName());
                            obj.setSliceFileName(sliceName);
                            obj.setWidth(finalW);
                            obj.setHeight(finalH);
                            obj.setBbox(localBbox);
                            obj.setSegmentation(localPoly);
                            metaImage.getObjects().add(obj);
                            totalSliceCount++;
                        }
                        sourceImage.flush();
                        projectMeta.getImages().add(metaImage);
                    }
                }
            }
            ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
            projectMeta.setCategories(new ArrayList<>(categoryMap.values()));
            mapper.writeValue(metaJsonPath.toFile(), projectMeta);

            // ================== 数据库记录 ==================
            SampleSet sampleSet = new SampleSet();
            sampleSet.setName(datasetName);
            sampleSet.setCreator(username);
            sampleSet.setDescription(description);
            sampleSet.setTaskIds(taskIds.toString());
            sampleSet.setNum(totalSliceCount);
            sampleSet.setWidth(targetSize != null ? targetSize : 0);
            sampleSet.setHeight(targetSize != null ? targetSize : 0);
            sampleSet.setImageUrl(slicesDir.toString());
            sampleSet.setLabelUrl(metaJsonPath.toString());
            sampleSet.setCreateDate(new Date());
            String allTypeNames = String.join(",", categoryMap.keySet());
            sampleSet.setType(allTypeNames);
            sampleSet.setTaskType(taskType);
            sampleSet.setCrs("EPSG:3857");

            boolean saveResult = this.save(sampleSet);
            if (!saveResult) {
                throw new RuntimeException("数据库保存SampleSet失败");
            }

            // ================== 新增：记录 PROV 溯源 (多对一合并) ==================
            try {
                String operatorId = params.get("userId") != null ? params.get("userId").toString() : username;

                // 1. 将所有 taskId 转换为输入实体列表
                List<ProvEntityRef> inputTasks = taskIds.stream()
                        .map(id -> ProvEntityRef.of(id.toString(), "TASK", "源任务#" + id))
                        .collect(Collectors.toList());

                // 2. 构建输出实体列表 (包装成单元素 List)
                List<ProvEntityRef> outputs = Collections.singletonList(
                        ProvEntityRef.of(
                                sampleSet.getId().toString(),
                                "SAMPLE_SET",
                                "数据集：" + datasetName
                        )
                );

                // 3. 准备详细参数
                Map<String, Object> provParams = new HashMap<>();
                provParams.put("datasetId", sampleSet.getId());
                provParams.put("totalSliceCount", totalSliceCount);
                provParams.put("taskCount", taskIds.size());
                provParams.put("categories", allTypeNames);

                // 4. 调用支持 List 的接口记录溯源
                provenanceService.recordActivity(
                        "DATASET_GENERATE",    // 活动类型
                        operatorId,         // 操作人
                        "PERSON",           // 代理类型
                        inputTasks,         // 输入：多个任务实体
                        outputs,            // 输出：一个数据集实体
                        provParams          // 参数
                );
            } catch (Exception e) {
                log.warn("数据集合并溯源记录失败: " + e.getMessage());
            }
            // ===================================================================

            return totalSliceCount;

        } catch (Exception e) {
            // [手动回滚] 删除已生成的文件
            try {
                FileSystemUtils.deleteRecursively(outputDir);
                // 或者用 FileUtil.del(outputDir); 如果你有 Hutool
            } catch (Exception ex) {
                ex.printStackTrace();
            }
            // 抛出异常，触发 @Transactional 回滚
            throw e;
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteSampleSets(List<Integer> ids) {
        List<SampleSet> sets = this.listByIds(ids);
        if (sets.isEmpty()) return;

        // 1. 删除物理文件
        for (SampleSet s : sets) {
            // 假设 s.getImageUrl() 指向的是 .../slices 目录
            // 我们需要删除上一级目录，即数据集根目录
            try {
                Path slicesDir = Paths.get(s.getImageUrl());
                Path datasetRoot = slicesDir.getParent(); // 获取数据集根目录
                if (Files.exists(datasetRoot)) {
                    FileSystemUtils.deleteRecursively(datasetRoot);
                }
            } catch (Exception e) {
                System.err.println("物理文件删除失败: " + s.getName());
            }
        }

        // 2. 删除数据库记录
        this.removeByIds(ids);

        // 3. 同步删除溯源记录（SAMPLE_SET）
        provenanceService.deleteByBusinessIdsAndTypes(
                ids.stream().map(String::valueOf).collect(Collectors.toList()),
                Collections.singletonList("SAMPLE_SET")
        );
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void downloadSampleSet(Integer id, String format, Map<String, Object> exportOptions, HttpServletResponse response) throws Exception {
        Map<String, Object> exportResult = exportSampleSet(id, format, exportOptions);
        String objectKey = String.valueOf(exportResult.get("objectKey"));
        String downloadName = String.valueOf(exportResult.get("fileName"));
        response.setContentType("application/zip");
        response.setHeader("Content-Disposition", "attachment; filename=\"" + downloadName + "\"");
        try (InputStream in = minioClient.getObject(
                GetObjectArgs.builder().bucket(minioConfig.getBucketName()).object(objectKey).build())) {
            in.transferTo(response.getOutputStream());
            response.getOutputStream().flush();
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> exportSampleSet(Integer id, String format, Map<String, Object> exportOptions) throws Exception {
        SampleSet sampleSet = this.getById(id);
        if (sampleSet == null) throw new RuntimeException("样本集不存在");

        Path slicesDir = Paths.get(sampleSet.getImageUrl());
        Path metaFile = Paths.get(sampleSet.getLabelUrl());
        if (!Files.exists(metaFile)) throw new RuntimeException("元数据文件丢失");

        ObjectMapper mapper = new ObjectMapper();
        DatasetMeta meta = mapper.readValue(metaFile.toFile(), DatasetMeta.class);

        Path tempRoot = Paths.get(sampleSetPath).resolve("temp_download_" + UUID.randomUUID());
        Files.createDirectories(tempRoot);
        Path tempImages = tempRoot.resolve("images");
        Files.createDirectories(tempImages);
        boolean tdmlFormat = "DML".equalsIgnoreCase(format) || "TDML".equalsIgnoreCase(format);

        try {
            if (tdmlFormat) {
                SampleUtils.generateTrainingTdmlPackage(
                        sampleSet.getId(),
                        meta,
                        slicesDir,
                        tempRoot,
                        toTdmlExportOptions(exportOptions)
                );
            } else {
                // 1. 复制图片
                Set<String> copiedFiles = new HashSet<>();
                for (MetaImage bigImg : meta.getImages()) {
                    for (MetaObject obj : bigImg.getObjects()) {
                        String fileName = obj.getSliceFileName();
                        if (!copiedFiles.contains(fileName)) {
                            Path source = slicesDir.resolve(fileName);
                            if (Files.exists(source)) {
                                Files.copy(source, tempImages.resolve(fileName));
                                copiedFiles.add(fileName);
                            }
                        }
                    }
                }

                // 2. 生成对应格式的标注文件
                provUtils.generateAnnotationFiles(format, meta, tempRoot, sampleSet.getName());
            }

            // 3. 【解耦调用】生成深度溯源元文件并放入打包目录
            String taskIdsStr = sampleSet.getTaskIds().replace("[", "").replace("]", "").replace(" ", "");
            List<ProvActivity> history = null;
            if (!taskIdsStr.isEmpty()) {
                List<String> taskIdList = Arrays.asList(taskIdsStr.split(","));
                String sqlInIds = "'" + String.join("','", taskIdList) + "'";
                // 2. 【核心修改】：通过连接 prov_entity 表来查询业务 ID
                // 逻辑：
                // a. 在 prov_entity 中找到 business_id 为 '23' 的记录对应的内部 UUID (id)
                // b. 在 prov_relation 中找到关联了这些内部 UUID 的 activity_id
                // c. 在 prov_activity 中找到这些 activity
                history = provActivityMapper.selectList(
                        new QueryWrapper<ProvActivity>()
                                .inSql("id", "SELECT r.activity_id FROM prov_relation r " +
                                        "JOIN prov_entity e ON r.entity_id = e.id " +
                                        "WHERE e.business_id IN (" + sqlInIds + ")")
                                .orderByAsc("start_time")
                );
            }
            provUtils.generateProvMetadataFile(sampleSet, format, meta, tempRoot, history);

            String zipFileName = sampleSet.getName() + "_" + format + ".zip";
            Path zipPath = tempRoot.resolve(zipFileName);
            try (OutputStream fileOut = Files.newOutputStream(zipPath);
                 ZipOutputStream zos = new ZipOutputStream(fileOut)) {
                SampleUtils.compressDir(tempRoot, sampleSet.getName(), zos);
            }
            String objectKey = "datasets/" + sampleSet.getTaskIds().replaceAll("[\\[\\]\\s]", "") + "/" + sampleSet.getId() + "/" + zipFileName;
            try (InputStream zipIn = Files.newInputStream(zipPath)) {
                minioClient.putObject(
                        PutObjectArgs.builder()
                                .bucket(minioConfig.getBucketName())
                                .object(objectKey)
                                .stream(zipIn, Files.size(zipPath), -1)
                                .contentType("application/zip")
                                .build()
                );
            }
            sampleSet.setExportObjectKey(objectKey);
            this.updateById(sampleSet);
            String presignedUrl = minioClient.getPresignedObjectUrl(
                    GetPresignedObjectUrlArgs.builder()
                            .method(Method.GET)
                            .bucket(minioConfig.getBucketName())
                            .object(objectKey)
                            .expiry(60 * 60)
                            .build()
            );

            // 5. 记录本次导出活动到数据库
            try {
                LoginUser loginUser = (LoginUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
                String userId = loginUser.getSysUser().getUserid().toString();

                provenanceService.recordActivity(
                        "DATASET_EXPORT",
                        userId,
                        "PERSON",
                        Collections.singletonList(ProvEntityRef.of(sampleSet.getId().toString(), "SAMPLE_SET", sampleSet.getName())),
                        Collections.singletonList(ProvEntityRef.of(sampleSet.getId() + "_" + System.currentTimeMillis(), "ZIP_PACKAGE", "Export ZIP")),
                        new HashMap<String, Object>() {{
                            put("format", format);
                            put("images", meta.getImages().size());
                            if (tdmlFormat) {
                                put("exportType", "trainingdml");
                            }
                        }}
                );
            } catch (Exception e) {
                logger.warn("记录导出活动失败: " + e.getMessage());
            }

            Map<String, Object> result = new HashMap<>();
            result.put("objectKey", objectKey);
            result.put("bucketName", minioConfig.getBucketName());
            result.put("fileName", zipFileName);
            result.put("downloadUrl", presignedUrl);
            return result;

        } finally {
            FileSystemUtils.deleteRecursively(tempRoot);
        }
    }

    @Override
    @Transactional(readOnly = true) // 查询建议使用 readOnly = true，提高性能
    public Map<String, Object> getDatasetProvenance(Integer id) {
        Map<String, Object> result = new HashMap<>();

        // 1. 获取样本集信息
        SampleSet sampleSet = getById(id);
        if (sampleSet == null) return result;

        // 2. 准备业务 ID 列表 (Task IDs + SampleSet ID)
        String taskIdsStr = sampleSet.getTaskIds().replace("[", "").replace("]", "").replace(" ", "");
        List<String> businessIds = new ArrayList<>();
        if (!taskIdsStr.isEmpty()) {
            businessIds.addAll(Arrays.asList(taskIdsStr.split(",")));
        }
        businessIds.add(id.toString()); // 加入样本集自身的 ID

        // 关键增强：补齐与任务关联的 RAW_IMAGE 业务ID（file_id），让上传活动能够进入图谱
        for (String taskIdStr : new ArrayList<>(businessIds)) {
            try {
                Integer taskId = Integer.valueOf(taskIdStr);
                Task task = taskService.selectTaskById(taskId);
                if (task != null && task.getServerId() != null && task.getServerId() > 0) {
                    // 对应 MAP_SERVICE 的稳定 business_id（serverId）
                    businessIds.add(task.getServerId().toString());
                }
                if (task != null && "local".equals(task.getTaskSource()) && task.getLocalImagePath() != null) {
                    String fileName = Paths.get(task.getLocalImagePath().replace('\\', '/')).getFileName() != null
                            ? Paths.get(task.getLocalImagePath().replace('\\', '/')).getFileName().toString()
                            : null;
                    if (fileName != null && !fileName.trim().isEmpty()) {
                        SysFile f = sysFileService.getFileByFileName(fileName);
                        if (f != null && f.getFileId() != null) {
                            businessIds.add(f.getFileId().toString()); // 对应 UPLOAD 产物的 RAW_IMAGE business_id
                        }
                    }
                }
            } catch (Exception ignore) {
            }
        }
        businessIds = businessIds.stream().filter(Objects::nonNull).distinct().collect(Collectors.toList());

        // 将 ID 列表转为 SQL 字符串 (注意防止注入)
        String sqlInIds = businessIds.stream()
                .map(s -> "'" + s.replaceAll("'", "") + "'")
                .collect(Collectors.joining(","));

        // 3. 查询关联的 Activity
        // 逻辑：找到所有 USED 或 GENERATED 了这些业务 ID 对应实体的活动
        List<ProvActivity> activities = provActivityMapper.selectList(
                new QueryWrapper<ProvActivity>()
                        .inSql("id", "SELECT activity_id FROM prov_relation WHERE entity_id IN (" +
                                "SELECT id FROM prov_entity WHERE business_id IN (" + sqlInIds + "))")
                        .orderByAsc("start_time")
        );

        // 4/5. 查询上述活动涉及的所有 Relation 和 Agent
        List<ProvRelation> relations = new ArrayList<>();
        List<ProvAgent> agents = new ArrayList<>();
        List<ProvEntity> entities = new ArrayList<>();

        if (!activities.isEmpty()) {
            Set<String> actIdSet = activities.stream().map(ProvActivity::getId).collect(Collectors.toSet());
            relations = provRelationMapper.selectList(
                    new QueryWrapper<ProvRelation>().in("activity_id", actIdSet)
            );

            // 一跳扩展：把与当前关系实体相连的上游/下游活动也拉入（可补齐 UPLOAD -> PUBLISH_SERVICE -> TASK 的链）
            Set<String> entityIdSet = relations.stream()
                    .map(ProvRelation::getEntityId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());
            if (!entityIdSet.isEmpty()) {
                List<ProvActivity> expandedActivities = provActivityMapper.selectList(
                        new QueryWrapper<ProvActivity>()
                                .inSql("id", "SELECT activity_id FROM prov_relation WHERE entity_id IN (" +
                                        entityIdSet.stream().map(e -> "'" + e.replace("'", "") + "'").collect(Collectors.joining(",")) +
                                        ")")
                                .orderByAsc("start_time")
                );
                for (ProvActivity a : expandedActivities) {
                    if (actIdSet.add(a.getId())) {
                        activities.add(a);
                    }
                }
                relations = provRelationMapper.selectList(
                        new QueryWrapper<ProvRelation>().in("activity_id", actIdSet)
                );
                entityIdSet = relations.stream()
                        .map(ProvRelation::getEntityId)
                        .filter(Objects::nonNull)
                        .collect(Collectors.toSet());
            }

            if (!entityIdSet.isEmpty()) {
                entities = provEntityMapper.selectList(
                        new QueryWrapper<ProvEntity>().in("id", entityIdSet)
                );
            }

            Set<String> agentIds = activities.stream()
                    .map(ProvActivity::getAgentId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());
            if (!agentIds.isEmpty()) {
                agents = provAgentMapper.selectList(
                        new QueryWrapper<ProvAgent>().in("id", agentIds)
                );
            }
        }

        List<ProvActivity> limitedActivities = limitQualityActivities(activities, MAX_QUALITY_PROVENANCE_RECORDS);
        if (limitedActivities.size() != activities.size()) {
            Set<String> keptActivityIds = limitedActivities.stream()
                    .map(ProvActivity::getId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());
            activities = limitedActivities;
            relations = relations.stream()
                    .filter(rel -> rel != null && keptActivityIds.contains(rel.getActivityId()))
                    .collect(Collectors.toList());
            Set<String> keptEntityIds = relations.stream()
                    .map(ProvRelation::getEntityId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());
            entities = entities.stream()
                    .filter(entity -> entity != null && keptEntityIds.contains(entity.getId()))
                    .collect(Collectors.toList());
            Set<String> keptAgentIds = activities.stream()
                    .map(ProvActivity::getAgentId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());
            agents = agents.stream()
                    .filter(agent -> agent != null && keptAgentIds.contains(agent.getId()))
                    .collect(Collectors.toList());
        }

        // 无活动时兜底返回与样本集直接相关的实体
        if (entities.isEmpty()) {
            entities = provEntityMapper.selectList(
                    new QueryWrapper<ProvEntity>()
                            .in("business_id", businessIds)
            );
        }

        // 6. 组装返回结果
        result.put("activities", activities);
        result.put("entities", entities);
        result.put("relations", relations);
        result.put("agents", agents); // 新增
        return result;
    }

    private List<ProvActivity> limitQualityActivities(List<ProvActivity> activities, int keepCount) {
        if (activities == null || activities.isEmpty() || keepCount <= 0) {
            return activities == null ? new ArrayList<>() : activities;
        }
        List<ProvActivity> qualityActivities = activities.stream()
                .filter(activity -> activity != null && QUALITY_PROVENANCE_TYPES.contains(activity.getActType()))
                .sorted((left, right) -> {
                    Date leftTime = left.getStartTime();
                    Date rightTime = right.getStartTime();
                    if (leftTime == null && rightTime == null) {
                        return String.valueOf(right.getId()).compareTo(String.valueOf(left.getId()));
                    }
                    if (leftTime == null) {
                        return 1;
                    }
                    if (rightTime == null) {
                        return -1;
                    }
                    int compare = rightTime.compareTo(leftTime);
                    if (compare != 0) {
                        return compare;
                    }
                    return String.valueOf(right.getId()).compareTo(String.valueOf(left.getId()));
                })
                .collect(Collectors.toList());
        if (qualityActivities.size() <= keepCount) {
            return activities;
        }
        Set<String> keepQualityIds = qualityActivities.stream()
                .limit(keepCount)
                .map(ProvActivity::getId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        return activities.stream()
                .filter(activity -> activity != null && (!QUALITY_PROVENANCE_TYPES.contains(activity.getActType()) || keepQualityIds.contains(activity.getId())))
                .collect(Collectors.toList());
    }

    private boolean isLikelyTiffFile(Path path) {
        try {
            if (path == null || !Files.isRegularFile(path) || Files.size(path) < 4) return false;
            byte[] head = new byte[4];
            try (InputStream in = Files.newInputStream(path)) {
                int n = in.read(head);
                if (n < 4) return false;
            }
            return (head[0] == 0x49 && head[1] == 0x49 && head[2] == 0x2A && head[3] == 0x00)
                    || (head[0] == 0x4D && head[1] == 0x4D && head[2] == 0x00 && head[3] == 0x2A);
        } catch (Exception e) {
            return false;
        }
    }

    private TdmlExportOptions toTdmlExportOptions(Map<String, Object> exportOptions) {
        TdmlExportOptions options = new TdmlExportOptions();
        if (exportOptions == null) {
            return options;
        }

        Object shareMode = exportOptions.get("shareMode");
        if (shareMode != null) {
            options.setShareMode(String.valueOf(shareMode));
        }

        Object baseUrl = exportOptions.get("baseUrl");
        if (baseUrl != null) {
            options.setBaseUrl(String.valueOf(baseUrl));
        }

        Object validateSchema = exportOptions.get("validateSchema");
        if (validateSchema != null) {
            options.setValidateSchema(Boolean.parseBoolean(String.valueOf(validateSchema)));
        }

        Object schemaPath = exportOptions.get("schemaPath");
        if (schemaPath != null) {
            options.setSchemaPath(String.valueOf(schemaPath));
        }

        Object defaultSplit = exportOptions.get("defaultSplit");
        if (defaultSplit != null) {
            options.setDefaultSplit(String.valueOf(defaultSplit));
        }

        Object splitMapping = exportOptions.get("splitMapping");
        if (splitMapping instanceof Map<?, ?>) {
            Map<String, String> mapping = new HashMap<>();
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) splitMapping).entrySet()) {
                if (entry.getKey() != null && entry.getValue() != null) {
                    mapping.put(String.valueOf(entry.getKey()), String.valueOf(entry.getValue()));
                }
            }
            options.setSplitMapping(mapping);
        }

        return options;
    }

    private Integer extractChunkIndex(String objectBasename, String fileName, String baseNoExt) {
        String bn = objectBasename.toLowerCase();
        String fn = fileName.toLowerCase();
        String b0 = baseNoExt.toLowerCase();
        String[] prefixes = new String[]{
                fn + ".part", b0 + ".part", fn + "_part_", b0 + "_part_", fn + ".", b0 + "."
        };
        for (String prefix : prefixes) {
            if (bn.startsWith(prefix)) {
                String tail = bn.substring(prefix.length());
                String digits = tail.replaceAll("[^0-9].*$", "");
                if (!digits.isEmpty()) {
                    try {
                        return Integer.parseInt(digits);
                    } catch (Exception ignore) {
                    }
                }
            }
        }
        return null;
    }

    private boolean downloadSingleObjectFromMinio(List<String> candidates, Path cachedPath) {
        for (String objectName : candidates) {
            if (objectName == null || objectName.trim().isEmpty()) continue;
            try (InputStream in = minioClient.getObject(
                    GetObjectArgs.builder()
                            .bucket(minioConfig.getBucketName())
                            .object(objectName)
                            .build()
            )) {
                Files.copy(in, cachedPath, StandardCopyOption.REPLACE_EXISTING);
                if (isLikelyTiffFile(cachedPath)) return true;
                Files.deleteIfExists(cachedPath);
            } catch (Exception ignore) {
            }
        }
        return false;
    }

    private boolean restoreFromMinioChunks(String normalizedRawPath, String fileName, Path cachedPath) {
        String baseNoExt = fileName.replaceAll("(?i)\\.tiff?$", "");
        Set<String> prefixes = new LinkedHashSet<>();
        prefixes.add(normalizedRawPath);
        prefixes.add(fileName);
        prefixes.add(baseNoExt);

        Map<Integer, String> orderedParts = new TreeMap<>();
        for (String prefix : prefixes) {
            if (prefix == null || prefix.trim().isEmpty()) continue;
            try {
                Iterable<Result<Item>> results = minioClient.listObjects(
                        ListObjectsArgs.builder()
                                .bucket(minioConfig.getBucketName())
                                .prefix(prefix)
                                .recursive(true)
                                .build()
                );
                for (Result<Item> result : results) {
                    Item item = result.get();
                    String objectName = item.objectName();
                    String basename = new File(objectName).getName();
                    Integer idx = extractChunkIndex(basename, fileName, baseNoExt);
                    if (idx != null) orderedParts.putIfAbsent(idx, objectName);
                }
            } catch (Exception ignore) {
            }
        }
        if (orderedParts.isEmpty()) return false;

        try (OutputStream out = Files.newOutputStream(cachedPath)) {
            for (String objectName : orderedParts.values()) {
                try (InputStream in = minioClient.getObject(
                        GetObjectArgs.builder()
                                .bucket(minioConfig.getBucketName())
                                .object(objectName)
                                .build()
                )) {
                    in.transferTo(out);
                }
            }
        } catch (Exception e) {
            try {
                Files.deleteIfExists(cachedPath);
            } catch (IOException ignore) {
            }
            return false;
        }
        return isLikelyTiffFile(cachedPath);
    }

    private BufferedImage loadTaskSourceImage(Task task, Integer taskId, Integer taskItemId) {
        if (task.getFileId() != null) {
            try {
                File resolvedFile = minioFileResolveService.resolveToLocalFile(
                        task.getFileId(),
                        Paths.get(System.getProperty("java.io.tmpdir"), "geolabel_sampleset_cache")
                );
                return ImageIO.read(resolvedFile);
            } catch (Exception e) {
                logger.warn("[SampleSet] file_id 解析影像失败, taskId={}, taskItemId={}, fileId={}, err={}",
                        taskId, taskItemId, task.getFileId(), e.getMessage());
            }
        }
        String rawPath = task.getLocalImagePath();
        if (rawPath == null || rawPath.trim().isEmpty()) return null;
        String normalizedRawPath = rawPath.trim().replace('\\', '/');
        while (normalizedRawPath.endsWith("/")) {
            normalizedRawPath = normalizedRawPath.substring(0, normalizedRawPath.length() - 1);
        }
        String fileName = Paths.get(normalizedRawPath).getFileName() != null
                ? Paths.get(normalizedRawPath).getFileName().toString()
                : "";
        if (fileName.isEmpty()) return null;

        try {
            Path src = Paths.get(normalizedRawPath);
            if (Files.exists(src)) {
                BufferedImage img = ImageIO.read(src.toFile());
                if (img != null) return img;
            }
        } catch (Exception e) {
            logger.warn("[SampleSet] 本地影像不可读，将尝试MinIO恢复, taskId={}, taskItemId={}, path={}, err={}",
                    taskId, taskItemId, rawPath, e.getMessage());
        }

        try {
            Path cacheDir = Paths.get(System.getProperty("java.io.tmpdir"), "geolabel_sampleset_cache");
            Files.createDirectories(cacheDir);
            Path cachedPath = cacheDir.resolve(fileName);

            boolean restored = downloadSingleObjectFromMinio(
                    Arrays.asList(normalizedRawPath, fileName), cachedPath
            );
            if (!restored) {
                restored = restoreFromMinioChunks(normalizedRawPath, fileName, cachedPath);
            }
            if (restored && Files.isRegularFile(cachedPath)) {
                return ImageIO.read(cachedPath.toFile());
            }
        } catch (Exception e) {
            logger.warn("[SampleSet] MinIO恢复影像失败, taskId={}, taskItemId={}, path={}, err={}",
                    taskId, taskItemId, rawPath, e.getMessage());
        }
        return null;
    }

    private Task mergeTaskWithItem(Task task, TaskItem taskItem) {
        if (taskItem == null) return task;
        Task merged = new Task();
        merged.setTaskId(task.getTaskId());
        merged.setTaskName(task.getTaskName());
        merged.setTaskType(task.getTaskType());
        merged.setUserId(task.getUserId());
        merged.setTaskClass(task.getTaskClass());
        merged.setTaskSource(taskItem.getTaskSource() != null ? taskItem.getTaskSource() : task.getTaskSource());
        merged.setServerId(taskItem.getServerId() != null ? taskItem.getServerId() : task.getServerId());
        merged.setMapServer(taskItem.getMapServer() != null ? taskItem.getMapServer() : task.getMapServer());
        merged.setLocalImagePath(taskItem.getLocalImagePath() != null ? taskItem.getLocalImagePath() : task.getLocalImagePath());
        merged.setFileId(taskItem.getFileId());
        return merged;
    }

    // =========================================================================
    // 地物分类（语义分割）滑动窗口裁切私有方法
    // =========================================================================

    /**
     * 处理地物分类（语义分割）任务的滑动窗口裁切。
     * 支持本地无坐标系 TIF 和 GeoServer 两种来源。
     *
     * @return 本次生成的切片数量
     */
    private int processSegmentationTask(
            Task task, List<Mark> marks, Integer taskId, Integer taskItemId, String sourceKey,
            Map<String, Object> params, Integer targetSize,
            Path slicesDir, Path outputDir,
            DatasetMeta projectMeta, Map<String, MetaCategory> categoryMap,
            int startObjectId) throws IOException {

        // ── 1. 参数解析 ──────────────────────────────────────────────────────
        int windowSize = targetSize != null ? targetSize : 256;
        double strideRatio = params.get("strideRatio") instanceof Number
                ? ((Number) params.get("strideRatio")).doubleValue() : 1.0;
        int stride = Math.max(1, (int) (windowSize * strideRatio));
        double minFgRatio = params.get("minFgRatio") instanceof Number
                ? ((Number) params.get("minFgRatio")).doubleValue() : 0.01;

        // ── 2. 获取原始影像 ───────────────────────────────────────────────────
        BufferedImage sourceImage;
        int imgW, imgH;
        List<Map<String, Object>> pixelAnnotations = new ArrayList<>();

        if ("local".equals(task.getTaskSource()) && task.getLocalImagePath() != null) {
            // 本地无坐标系 TIF：直接读取，标注已是 OpenLayers 像素坐标（Y 向上）
            sourceImage = loadTaskSourceImage(task, taskId, taskItemId);
            if (sourceImage == null) {
                System.err.println("[Seg] 本地图片不存在或不可读: " + task.getLocalImagePath());
                return 0;
            }
            imgW = sourceImage.getWidth();
            imgH = sourceImage.getHeight();
            for (Mark mark : marks) {
                Map<String, Object> ann = parseMarkToPixelAnnotation(mark, imgH, true);
                if (ann != null) pixelAnnotations.add(ann);
            }
        } else {
            // GeoServer 任务：下载大图并转换坐标
            Server server = serverService.getById(task.getServerId());
            if (server == null) return 0;
            String readableTime = server.getSerYear().replaceAll("[:.]", "").replace("T", "_");
            String layerName = server.getSerName() + "_" + server.getSetName() + "_" + readableTime;

            String layerInfo = geoServerRESTClient.getLayerInfo(layerName);
            if (layerInfo == null || !layerInfo.trim().startsWith("{")) return 0;

            ObjectMapper om = new ObjectMapper();
            JsonNode root = om.readTree(layerInfo);
            String coverageHref = root.path("layer").path("resource").path("href").asText();
            String coverageInfo = geoServerRESTClient.getCoverageInfo(coverageHref);
            if (coverageInfo == null || !coverageInfo.trim().startsWith("{")) return 0;

            JsonNode covRoot = om.readTree(coverageInfo);
            String srs = covRoot.path("coverage").path("srs").asText();
            JsonNode bboxNode = covRoot.path("coverage").path("nativeBoundingBox");
            double minx = bboxNode.path("minx").asDouble(), maxx = bboxNode.path("maxx").asDouble();
            double miny = bboxNode.path("miny").asDouble(), maxy = bboxNode.path("maxy").asDouble();

            imgH = 2048;
            imgW = (int) Math.ceil(((maxx - minx) / (maxy - miny)) * imgH);
            String bboxStr = String.format("%f,%f,%f,%f", minx, miny, maxx, maxy);

            Path imageDir = outputDir.resolve("images");
            String largeFileName = "train_seg_" + sourceKey + ".tif";
            Path largeFilePath = imageDir.resolve(largeFileName);
            if (!largeFilePath.toFile().exists()) {
                ResponseEntity<byte[]> resp = geoServerService.getGeoserverImg(layerName, imgW, imgH, bboxStr, srs);
                try (FileOutputStream fos = new FileOutputStream(largeFilePath.toFile())) {
                    if (resp.getBody() != null) fos.write(resp.getBody());
                }
            }
            sourceImage = ImageIO.read(largeFilePath.toFile());
            if (sourceImage == null) return 0;

            Map<String, Double> tifParams = new HashMap<>();
            tifParams.put("minx", Math.abs(minx));
            tifParams.put("maxy", Math.abs(maxy));
            tifParams.put("serverHeight", Math.abs(maxy) - Math.abs(miny));
            tifParams.put("serverWidth", Math.abs(maxx) - Math.abs(minx));
            Map<String, Double> dims = new HashMap<>();
            dims.put("width", (double) imgW);
            dims.put("height", (double) imgH);

            List<Map<String, Object>> markMapList = DomainToMapList.convertDomainListToMapList(marks);
            List<Map<String, Object>> converted = CovertCoordinateToPixel.covertCoordinateToPixel(markMapList, tifParams, dims);
            for (Map<String, Object> seg : converted) {
                Map<String, Object> ann = new HashMap<>();
                ann.put("categoryId", seg.get("type_id"));
                ann.put("categoryName", typeService.getTypeNameById((Integer) seg.get("type_id")));
                ann.put("segmentation", seg.get("segmentation"));
                pixelAnnotations.add(ann);
            }
        }

        // ── 3. 更新类别映射 ───────────────────────────────────────────────────
        for (Map<String, Object> ann : pixelAnnotations) {
            Integer catId = (Integer) ann.get("categoryId");
            String catName = (String) ann.get("categoryName");
            if (catId != null && catName != null && !categoryMap.containsKey(catName)) {
                MetaCategory cat = new MetaCategory();
                cat.setId(catId);
                cat.setName(catName);
                categoryMap.put(catName, cat);
            }
        }

        // ── 4. 光栅化全图 Mask ────────────────────────────────────────────────
        BufferedImage maskImage = SampleUtils.rasterizeSegmentationMask(imgW, imgH, pixelAnnotations);

        // ── 5. 滑动窗口裁切 ───────────────────────────────────────────────────
        Path masksDir = outputDir.resolve("masks");
        if (!Files.exists(masksDir)) Files.createDirectories(masksDir);

        Map<Integer, MetaCategory> catById = new HashMap<>();
        for (MetaCategory c : categoryMap.values()) catById.put(c.getId(), c);

        List<SampleUtils.SlidingWindowSlice> slices = SampleUtils.slidingWindowCrop(
                sourceImage, maskImage, taskItemId != null ? taskItemId : taskId,
                windowSize, stride, minFgRatio,
                slicesDir, masksDir,
                pixelAnnotations, catById);

        // ── 6. 构建 MetaImage ─────────────────────────────────────────────────
        MetaImage metaImage = new MetaImage();
        metaImage.setId(taskItemId != null ? taskItemId : taskId);
        metaImage.setFileName("train_seg_" + sourceKey);
        metaImage.setOriginalTaskId(taskId);

        int objId = startObjectId;
        for (SampleUtils.SlidingWindowSlice slice : slices) {
            for (MetaObject obj : slice.getObjects()) {
                obj.setId(objId++);
                metaImage.getObjects().add(obj);
            }
        }
        projectMeta.getImages().add(metaImage);
        sourceImage.flush();

        System.out.printf("[Seg] 任务 %d 完成：生成 %d 个切片（窗口=%d, 步长=%d）%n",
                taskId, slices.size(), windowSize, stride);
        return slices.size();
    }

    /**
     * 将 Mark 域对象解析为像素坐标标注 Map。
     * localFlipY=true 时对 Y 坐标做翻转（OpenLayers 像素投影 Y 向上 → TIF Y 向下）。
     */
    private Map<String, Object> parseMarkToPixelAnnotation(Mark mark, int imgH, boolean localFlipY) {
        try {
            ObjectMapper om = new ObjectMapper();
            JsonNode node = om.readTree(mark.getGeom().toString());
            JsonNode geom = node.path("geometry");
            if (geom.isMissingNode()) return null;

            String geomType = geom.path("type").asText();
            if (!"Polygon".equals(geomType)) return null;

            List<List<Double>> rings = new ArrayList<>();
            for (JsonNode ring : geom.path("coordinates")) {
                List<Double> pts = new ArrayList<>();
                for (JsonNode pt : ring) {
                    double x = pt.get(0).asDouble();
                    double y = pt.get(1).asDouble();
                    if (localFlipY) y = imgH - y;
                    pts.add(x);
                    pts.add(y);
                }
                rings.add(pts);
            }

            Map<String, Object> ann = new HashMap<>();
            ann.put("categoryId", mark.getTypeId());
            ann.put("categoryName", typeService.getTypeNameById(mark.getTypeId()));
            ann.put("segmentation", rings);
            return ann;
        } catch (Exception e) {
            System.err.println("[Seg] 解析 Mark 失败: " + e.getMessage());
            return null;
        }
    }

}
