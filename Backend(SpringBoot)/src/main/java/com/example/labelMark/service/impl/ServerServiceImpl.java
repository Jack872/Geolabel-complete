package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.labelMark.DTO.prov.ProvEntityRef;
import com.example.labelMark.config.MinioConfig;
import com.example.labelMark.controller.ServerController;
import com.example.labelMark.domain.Dataset;
import com.example.labelMark.domain.FileMetadata;
import com.example.labelMark.domain.Server;
import com.example.labelMark.domain.SysFile;
import com.example.labelMark.domain.SysUser;
import com.example.labelMark.mapper.FileMetadataMapper;
import com.example.labelMark.mapper.ServerMapper;
import com.example.labelMark.mapper.SysUserMapper;
import com.example.labelMark.service.*;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.utils.ResultGenerator;
import com.example.labelMark.utils.CoordinateSystemUtils;
import io.minio.GetObjectArgs;
import io.minio.MinioClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * <p>
 *  服务实现类
 * </p>
 *
 *
 * @since 2024-04-15
 */
@Service
public class ServerServiceImpl extends ServiceImpl<ServerMapper, Server> implements ServerService {

    @Resource
    private ServerMapper serverMapper;

    @Resource
    private SysFileService sysFileService;
    @Value("${geoserver.local-coverage-dir}") // 假设你有这个配置
    private String localCoverageDir;
    @Resource
    private ProvenanceService provenanceService;

    @Resource
    private DatasetService datasetService;
    @Value("${geoserver.url}")
    private String geoserverUrl;
    @Resource
    private MinioConfig minioConfig;
    @Resource
    private MinioClient minioClient;
    @Resource
    private GeoServerService geoServerService;

    @Resource
    private CoordinateSystemUtils coordinateSystemUtils;
    @Resource
    private FileMetadataMapper fileMetadataMapper;

    private static final Logger logger = LoggerFactory.getLogger(ServerService.class);
    @Override
    public List<Server> getServers(Integer userId) {
        if (userId == null) {
            // 如果没有提供userId，返回空列表
            return List.of();
        }

        // 先查询用户信息，确定是否是管理员
        // SysUser user = sysUserMapper.selectById(userId);
        // if (user != null && user.getIsadmin() == 1) {
        //     // 管理员可以查看所有服务
        //     return serverMapper.selectList(null);
        // }

        // 非管理员用户只能查看自己创建的服务
        QueryWrapper<Server> wrapper = new QueryWrapper<>();
        wrapper.eq("user_id", userId);

        return serverMapper.selectList(wrapper);
    }

    @Override
    public int deleteServerByName(String serName) {
        QueryWrapper<Server> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("ser_name", serName);
        int delete = serverMapper.delete(queryWrapper);
        return delete;
    }

    @Override
    public List<Server> getServersBySetName(String setName, Integer userId) {
        QueryWrapper<Server> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("set_name", setName)
                     .eq("user_id", userId);
        return serverMapper.selectList(queryWrapper);
    }

    @Override
    public int deleteServersBySetName(String setName, Integer userId) {
        QueryWrapper<Server> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("set_name", setName)
                     .eq("user_id", userId);
        return serverMapper.delete(queryWrapper);
    }

    @Override
    public boolean createServer(Server server) {
        boolean save = save(server);
        return save;
    }

    @Override
    public Map<String, List<String>> getServersBySetName(Integer userId) {
        // 首先获取用户的所有服务
        List<Server> servers = getServers(userId);

        // 按照set_name分组，对于每个set_name，收集服务名称列表
        Map<String, List<String>> result = new HashMap<>();

        // 分组处理，创建影像集名称到服务名称列表的映射
        for (Server server : servers) {
            String setName = server.getSetName();
            // 如果set_name为空，或为null，则分到"未分组"类别
            if (setName == null || setName.trim().isEmpty()) {
                setName = "未分组";
            }

            // 如果map中没有这个key，则创建新的list
            if (!result.containsKey(setName)) {
                result.put(setName, new ArrayList<>());
            }

            // 把服务名称加入到对应的列表中
            result.get(setName).add(server.getSerName());
        }

        // 追加“本地影像集”键，便于任务创建时统一展示影像集
        List<Dataset> localDatasets = datasetService.list(
                new QueryWrapper<Dataset>()
                        .eq("user_id", userId)
                        .eq("set_type", "local")
        );
        for (Dataset dataset : localDatasets) {
            String setName = dataset.getName();
            if (setName != null && !setName.trim().isEmpty() && !result.containsKey(setName)) {
                result.put(setName, new ArrayList<>());
            }
        }

        return result;
    }



    @Override
    @Transactional(rollbackFor = Exception.class) // 事务加在这里！
    public void publishServices(List<Integer> fileIds, Integer userId, String username) throws Exception {

        // 3. GeoServer 容器内的 coverage 存储路径
        String localCoverageDirInContainer = localCoverageDir;

        for (Integer fileId : fileIds) {
            Date taskStartTime = new Date();

            String filename = null;
            try {
                // 1. 获取文件和数据集信息
                SysFile file = sysFileService.getFileById(fileId); // 使用 this 调用
                if (file == null) {
                    logger.warn("文件不存在，跳过: fileId={}", fileId);
                    continue;
                }

                Dataset dataset = datasetService.getById(file.getDatasetId());
                if (dataset == null) {
                    logger.warn("数据集不存在，跳过: fileId={}", fileId);
                    continue;
                }

                filename = file.getFileName();
                if (!filename.toLowerCase().endsWith(".tif") && !filename.toLowerCase().endsWith(".tiff")) {
                    logger.warn("非 GeoTIFF 文件，跳过: {}", filename);
                    continue;
                }

                String sername = filename.contains(".") ? filename.substring(0, filename.lastIndexOf('.')) : filename;
                String setName = dataset.getName();
                String seryear = dataset.getYear();
                String serdesc = file.getFileName();

                // === 📥 从 MinIO 下载到 GeoServer 本地目录 ===
                String localTifPathInContainer = localCoverageDirInContainer + "/" + filename;
                File localFile = new File(localTifPathInContainer);

                if (!localFile.exists()) {
                    // ✅ 关键：自动创建多级父目录
                    Path path = Paths.get(localTifPathInContainer);
                    Files.createDirectories(path.getParent()); // 自动创建 coverages 目录
                    logger.info("开始从 MinIO 下载文件: {} -> {}", filename, localTifPathInContainer);
                    try (InputStream inputStream = minioClient.getObject(
                            GetObjectArgs.builder()
                                    .bucket(minioConfig.getBucketName())
                                    .object(filename)
                                    .build()
                    ); // 新版 MinIO SDK 返回 CompletableFuture<InputStream>
                         OutputStream out = Files.newOutputStream(path)) {
                        logger.info("MinIO 文件开始下载: {}", inputStream);
                        byte[] buffer = new byte[8192];
                        int len;
                        while ((len = inputStream.read(buffer)) != -1) {
                            out.write(buffer, 0, len);
                        }
                        logger.info("文件下载完成: {}", filename);
                    } catch (Exception e) {
                        logger.error("MinIO 文件下载失败: {}", filename, e);
                        throw new IllegalStateException("MinIO 文件下载失败: " + filename, e);
                    }
                } else {
                    logger.info("文件已存在，跳过下载: {}", localTifPathInContainer);
                }

                // === 🗂️ 构造 file:// URL ===
                String fileUrl = "file:///" + localTifPathInContainer;
                logger.info("使用本地文件路径发布: {}", fileUrl);

                // === 1️⃣ 检查并创建 Store ===
                boolean storeExists = geoServerService.checkStoreExists("LUU", sername);
                if (!storeExists) {
                    ResponseEntity<String> createResp = geoServerService.createRemoteGeoServerStore(sername, fileUrl);
                    if (!createResp.getStatusCode().is2xxSuccessful()) {
                        throw new IllegalStateException("创建 GeoServer Store 失败: " + createResp.getBody());
                    }

                    // 再次验证
                    storeExists = geoServerService.checkStoreExists("LUU", sername);
                    if (!storeExists) {
                        throw new IllegalStateException("CoverageStore 未创建成功");
                    }
                }

                // === 2️⃣ 检查并发布 Coverage ===
                // 动态获取坐标系 - 从本地文件路径检测
                String coordinateSystem = coordinateSystemUtils.getCoordinateSystemFromFile(localTifPathInContainer);
                if ("UNKNOWN".equalsIgnoreCase(coordinateSystem) || "NONE".equalsIgnoreCase(coordinateSystem)) {
                    FileMetadata metadata = fileMetadataMapper.selectById(fileId);
                    if (metadata != null && metadata.getCrsCode() != null && !metadata.getCrsCode().trim().isEmpty()) {
                        coordinateSystem = metadata.getCrsCode().trim().toUpperCase();
                        logger.info("检测失败，回退使用上传元数据坐标系: {}", coordinateSystem);
                    }
                }
                logger.info("为文件 {} 检测到坐标系: {}", filename, coordinateSystem);

                String coverageName = sername;

                if ("NONE".equals(coordinateSystem)) {
                    // 真正的无坐标系（像素坐标），跳过GeoServer
                    coverageName = geoServerService.publish(sername, seryear, setName, coordinateSystem);
                    logger.info("无坐标系图片已处理，覆盖名称: {}", coverageName);
                } else if ("UNKNOWN".equals(coordinateSystem)) {
                    // CRS检测失败，让GeoServer自动检测（传null触发auto-detect模式）
                    coverageName = geoServerService.publish(sername, seryear, setName, null);
                    boolean coverageExists = geoServerService.checkCoverageExists("LUU", coverageName);
                    if (!coverageExists) {
                        throw new IllegalStateException("Coverage 发布失败（自动检测CRS）");
                    }
                    logger.info("CRS自动检测发布成功，覆盖名称: {}", coverageName);
                } else {
                    // 有明确CRS，正常发布
                    boolean coverageExists = geoServerService.checkCoverageExists("LUU", sername);
                    if (!coverageExists) {
                        coverageName = geoServerService.publish(sername, seryear, setName, coordinateSystem);
                        coverageExists = geoServerService.checkCoverageExists("LUU", coverageName);
                        if (!coverageExists) {
                            throw new IllegalStateException("Coverage 发布失败");
                        }
                    }
                }

                // 2. 数据库操作 (Server)
                String publishUrl = String.format(
                        "%s/rest/workspaces/LUU/coveragestores/%s/coverages/%s",
                        geoserverUrl, sername, coverageName
                );

                Server server = new Server();
                server.setSerYear(seryear);
                server.setSerName(sername);
                server.setSerDesc(serdesc);
                server.setPublisher(username);
                server.setUserId(userId);
                server.setPublishTime(String.valueOf(LocalDateTime.now()));
                server.setPublishUrl(publishUrl);
                server.setSetName(setName);

                createServer(server); // 这一步会保存数据库

                // 3. 更新文件状态
                sysFileService.updateFileStatus(filename, 1);

                // 4. 记录 PROV 溯源
                ProvEntityRef inputEntity = ProvEntityRef.of(
                        fileId.toString(),
                        "RAW_IMAGE",
                                filename);
                ProvEntityRef outputEntity = ProvEntityRef.of(
                        server.getSerId().toString(),
                        "MAP_SERVICE",
                        server.getSerName());

                Map<String, Object> outAttrs = new HashMap<>();
                outAttrs.put("publish_url", server.getPublishUrl());
                outputEntity.setAttributes(outAttrs);

                Map<String, Object> provParams = new HashMap<>();
                provParams.put("startTime", taskStartTime);
                provParams.put("dataset", dataset.getName());

                provenanceService.recordActivity(
                        "PUBLISH_SERVICE",
                        username,
                        "PERSON",
                        inputEntity,
                        outputEntity,
                        provParams
                );

            } catch (Exception ex) {
                logger.error("单个文件发布失败: fileId={}, error={}", fileId, ex.getMessage(), ex);
                // 【关键】抛出异常触发事务回滚。如果不抛出，前面的数据库操作（Server创建）会提交，造成数据不一致。
                throw new RuntimeException("文件发布失败: " + filename, ex);
            }
        }
}
}
